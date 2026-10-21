import { backupRepository } from '../data/backup-repository'
import { backupScheduler } from '../data/backup-scheduler'
import { cleanupIssues } from '../data/audit'
import { prepareImportText } from '../data/import-pipeline'
import type { ImportData } from '../data/import-validation'
import { restoreFromImportData } from '../data/restore'
import { useFileOpsStore } from '../stores/file-ops-store'
import { useNoteStore } from '../stores/note-store'
import { takeSafetySnapshot } from '../stores/safety-snapshot'
import { refreshAllStores, refreshTaskStores } from './refresh-all'

/**
 * The one way the app's data is replaced underneath the stores — a Settings
 * import, a backup restore, the audit's cleanup, the sync file's data loaded
 * over this browser's (`file-storage`), an append import. `replaceData` owns
 * every step, in order:
 *
 * 1. hold the note store's saves (`holdForDataReplace`): text typed just
 *    before is saved first, so the backup holds it, and no save lands over
 *    the new notes;
 * 2. the safety snapshot of the current data (`takeSafetySnapshot`: a failed
 *    one asks "Continue without a backup?" — Cancel changes nothing), or a
 *    best-effort one when nothing can be lost;
 * 3. the write;
 * 4. the stores' reload — `refreshAllStores` (it clears the undo stack, the
 *    selection, unsaved drafts …) after a replace, `refreshTaskStores` after
 *    an append import, which replaces nothing and keeps the undo history and
 *    unsaved edits;
 * 5. the `onDataReplaced` listeners.
 */

/** What replaced the data; `onDataReplaced` listeners get it. */
export type DataReplaceSource = 'import' | 'backup-restore' | 'audit-cleanup' | 'sync-file' | 'append-import'

/**
 * The backup taken first. `{ operation }`: the safety snapshot (`operation`
 * completes "…before <operation>"); `best-effort`: a snapshot whose failure
 * is only logged — for a replace that can't lose anything (the browser
 * already holds the incoming data).
 */
export type ReplaceBackup = { operation: string } | 'best-effort'

/**
 * `done`: written and reloaded (`noBackup`: without the backup snapshot — the
 * user chose to continue); `cancelled`: the snapshot failed and the user
 * cancelled — nothing changed.
 */
export type ReplaceOutcome<T> =
  | { status: 'done'; result: T; noBackup: boolean }
  | { status: 'cancelled' }

type ReplaceListener = (source: DataReplaceSource) => void | Promise<void>

const listeners = new Set<ReplaceListener>()

/**
 * `listener` runs after each data replace, once the stores have reloaded;
 * returns its unsubscribe. Listeners run in turn, each awaited; one that
 * rejects doesn't stop the others, and the replace then rejects with its
 * error.
 */
export function onDataReplaced(listener: ReplaceListener): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/**
 * Runs `fn` with the note store's saves held (`holdForDataReplace`; holds
 * nest). For a caller whose replace follows other steps that must see the
 * typed text saved — the sync file's load decision compares the browser's
 * data with the file before it replaces anything.
 */
export async function withDataReplaceHold<T>(fn: () => Promise<T>): Promise<T> {
  const release = await useNoteStore.getState().holdForDataReplace()
  try {
    return await fn()
  } finally {
    release()
  }
}

/** Runs a data replace (see the module comment); `write` does the database write. */
export async function replaceData<T>(
  source: DataReplaceSource,
  { backup, write }: { backup: ReplaceBackup; write: () => Promise<T> },
): Promise<ReplaceOutcome<T>> {
  return withDataReplaceHold(async (): Promise<ReplaceOutcome<T>> => {
    let noBackup = false
    if (backup === 'best-effort') {
      await backupScheduler.snapshotBeforeDestructive().catch((err: unknown) => {
        console.warn(`[replace-data] snapshot before the ${source} replace failed`, err)
      })
    } else {
      const snapshot = await takeSafetySnapshot(backup.operation)
      if (snapshot === 'cancelled') return { status: 'cancelled' }
      noBackup = snapshot === 'without-backup'
    }
    const result = await write()
    let failure: { error: unknown } | null = null
    try {
      await (source === 'append-import' ? refreshTaskStores() : refreshAllStores())
    } catch (error) {
      failure = { error }
    }
    for (const listener of [...listeners]) {
      try {
        await listener(source)
      } catch (error) {
        failure ??= { error }
      }
    }
    if (failure) throw failure.error
    return { status: 'done', result, noBackup }
  })
}

/**
 * A replace from Settings: `done` (`noBackup` — it ran without the backup
 * snapshot, the user chose to continue) or `cancelled` — nothing changed.
 */
export type ImportOutcome =
  | { status: 'done'; noBackup: boolean }
  | { status: 'cancelled' }

/** A backup restore: an import's outcome, or the backup is missing / unreadable. */
export type RestoreOutcome = ImportOutcome | { status: 'error'; error: string }

/** Audit cleanup: `cleaned` records fixed or deleted, or `cancelled` — nothing changed. */
export type CleanupOutcome =
  | { status: 'done'; cleaned: number; noBackup: boolean }
  | { status: 'cancelled' }

/** Replaces the database with imported data (Settings › Import JSON), backing up the current data first. */
export async function restoreFromImport(data: ImportData): Promise<ImportOutcome> {
  const outcome = await replaceData('import', {
    backup: { operation: 'importing the file' },
    write: () => restoreFromImportData(data),
  })
  return outcome.status === 'done' ? { status: 'done', noBackup: outcome.noBackup } : outcome
}

/** Restores a backup (Settings › Backups), backing up the current data first; the backup list reloads after. */
export async function restoreBackup(id: number): Promise<RestoreOutcome> {
  // Read and check the backup before snapshotting: the snapshot's pruning
  // may delete the oldest backup — possibly this one.
  const backup = await backupRepository.getSnapshot(id)
  if (!backup) return { status: 'error', error: 'Backup not found' }
  const prepared = prepareImportText(backup.data)
  if (!prepared.ok) return { status: 'error', error: prepared.error }
  const outcome = await replaceData('backup-restore', {
    backup: { operation: 'restoring the backup' },
    write: () => restoreFromImportData(prepared.data),
  })
  if (outcome.status === 'cancelled') return outcome
  await useFileOpsStore.getState().loadBackups()
  return { status: 'done', noBackup: outcome.noBackup }
}

/**
 * Cleans the issues of the audit report on show (Settings › Data integrity),
 * backing up the database first; the report goes once cleaned, and stays
 * when the user cancels.
 */
export async function cleanupCurrentAudit(): Promise<CleanupOutcome> {
  const report = useFileOpsStore.getState().auditReport
  if (!report) return { status: 'done', cleaned: 0, noBackup: false }
  const outcome = await replaceData('audit-cleanup', {
    backup: { operation: 'cleaning up the database' },
    write: () => cleanupIssues(report.issues),
  })
  if (outcome.status === 'cancelled') return outcome
  useFileOpsStore.getState().setAuditReport(null)
  return { status: 'done', cleaned: outcome.result, noBackup: outcome.noBackup }
}
