import { backupRepository } from '../data/backup-repository'
import { useUIStore } from './ui-store'
import { backupScheduler } from '../data/backup-scheduler'

/**
 * `taken` — the backup snapshot is stored; `without-backup` — it failed and
 * the user chose to go ahead anyway; `cancelled` — it failed and the user
 * cancelled: the caller must not change anything.
 */
export type SafetySnapshotResult = 'taken' | 'without-backup' | 'cancelled'

/** Appended to an operation's result message when it ran without a backup. */
export const NO_BACKUP_NOTE = 'No backup was taken.'

/**
 * The one gate in front of every destructive operation that promises a
 * backup (import / restore, loading the sync file over browser data,
 * deleting completed tasks, bulk delete, append import, audit cleanup):
 * snapshot the database first. If the snapshot can't be stored (e.g. browser storage is
 * full), nothing has changed yet, so ask "Continue without a backup?" —
 * Cancel is the default and Esc. Continuing leaves a warning on the sync
 * warning strip until dismissed.
 *
 * `operation` completes "…before <operation>", e.g. `deleting 7 tasks`.
 *
 * Call it outside any tracked store write: it may wait on the user.
 */
export async function takeSafetySnapshot(operation: string): Promise<SafetySnapshotResult> {
  try {
    await backupScheduler.snapshotBeforeDestructive()
    return 'taken'
  } catch (err) {
    console.warn(`[backup] snapshot before ${operation} failed`, err)
  }
  const proceed = await useUIStore.getState().askConfirmation({
    title: 'Continue without a backup?',
    message: `A backup could not be saved before ${operation}, so nothing has changed yet. `
      + 'Browser storage may be full. '
      + 'Continue without a backup, or cancel?',
    confirmLabel: 'Continue',
    cancelLabel: 'Cancel',
    danger: true,
    cancelIsDefault: true,
  })
  if (!proceed) return 'cancelled'
  backupRepository.reportSnapshotWarning(`No backup was taken before ${operation} — the backup could not be saved.`)
  return 'without-backup'
}
