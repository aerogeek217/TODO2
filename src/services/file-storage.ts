import { ALL_DATA_TABLES, CURRENT_DB_VERSION } from '../data/database'
import { saveFileHandle, loadFileHandle, clearFileHandle } from './file-handle-idb'
import { MAX_IMPORT_SIZE_BYTES } from '../data/import-validation'
import type { ImportData } from '../data/import-validation'
import { prepareImport } from '../data/import-pipeline'
import type { PrepareImportFailure } from '../data/import-pipeline'
import { restoreFromImportData } from '../data/restore'
import { buildExportData } from './export-import'
import { backupScheduler } from './backup-scheduler'
import type { UnsupportedImportInfo } from './migration-check'
import {
  readFileSyncState, writeFileSyncState, clearFileSyncState, fileContentId,
} from './file-sync-state'
import { browserMatchesFile, browserTaskCount } from './file-sync-compare'

/**
 * Why sync is paused. While paused the file is never written, no restore has
 * run, and the browser database is untouched; browser edits keep marking the
 * browser dirty so they surface in the next conflict check.
 */
export type SyncPauseReason =
  | PrepareImportFailure   // invalid-json / not-object / too-new / upgrade-failed / invalid
  | 'too-large'
  | 'read-error'
  | 'conflict-cancelled'
  | 'upgrade-cancelled'
  | 'legacy-cancelled'
  | 'backup-failed'

export interface SyncPause {
  reason: SyncPauseReason
  message: string
}

export type FileStorageStatus = {
  /** True only while changes are actively being written to the file. */
  isConnected: boolean
  fileName: string | null
  lastSavedAt: Date | null
  needsPermission: boolean
  error: string | null
  paused: SyncPause | null
}

export interface SyncSideSummary {
  taskCount: number
  schemaVersion: number | null
}

export interface SyncConflictInfo {
  fileName: string
  /**
   * `browser-changes`: this browser has changes that were never written to the
   * file. `no-sync-record`: this browser has no record of syncing with this
   * file (first attach, or the record was lost) and their contents differ.
   */
  reason: 'browser-changes' | 'no-sync-record'
  browser: { taskCount: number; schemaVersion: number; unsyncedSince: string | null }
  file: SyncSideSummary & {
    savedAt: string | null
    lastModified: string
    /** null = unknown (no sync record). */
    changedSinceLastSync: boolean | null
  }
}

export type SyncConflictChoice = 'file' | 'browser' | 'cancel'

export interface FileUpgradeInfo {
  fileName: string
  fromVersion: number
  toVersion: number
}

type StatusListener = (status: FileStorageStatus) => void
type AfterImportListener = () => Promise<void>
type MigrationConfirmListener = (info: UnsupportedImportInfo) => Promise<boolean>
type ConflictListener = (info: SyncConflictInfo) => Promise<SyncConflictChoice>
type FileUpgradeListener = (info: FileUpgradeInfo) => Promise<boolean>

const FILE_TYPES = [{ description: 'TODO2 Database', accept: { 'application/json': ['.json'] } }]
const DEBOUNCE_MS = 500

const PAUSED_PREFIX = 'File sync paused'

function pauseMessageFor(reason: PrepareImportFailure, error: string): string {
  switch (reason) {
    case 'too-new': return `${PAUSED_PREFIX} — ${error}`
    case 'upgrade-failed': return `${PAUSED_PREFIX} — ${error}`
    default: return `${PAUSED_PREFIX} — the file could not be read: ${error}`
  }
}

/**
 * File System Access sync. Rule: when the browser data and the sync file
 * disagree, the user decides before anything changes.
 *
 * Load (startup / Grant Access / attach / Retry) reads and prepares the file
 * WITHOUT touching anything, then:
 *
 * - any failure (unreadable, invalid, too new, upgrade failed) → paused;
 * - below the floor → `MigrationDialog` (cancel → paused);
 * - browser clean and synced with some version of this file → load the file
 *   (multi-machine case), asking first if it needs a schema upgrade;
 * - browser has unsynced changes, or there is no sync record and the browser
 *   has tasks → conflict dialog (file / browser / cancel) unless both sides
 *   already hold identical data.
 *
 * While synced, Dexie hooks write the whole DB to the file 500 ms after each
 * change. Change-tracking hooks stay installed while a file is attached even
 * when sync is paused or permission is missing, so unsynced edits are always
 * recorded (`file-sync-state.ts`).
 */
class FileStorageService {
  private handle: FileSystemFileHandle | null = null
  /** True only during restore, so the restore's own writes aren't tracked. */
  private suppressSync = false
  /** Writes reach the file only while this is true. */
  private syncEnabled = false
  private saving = false
  private pendingSave = false
  private saveTimer: ReturnType<typeof setTimeout> | null = null
  private hookCleanups: Array<() => void> = []
  /** Bumped on every tracked change; a save only clears dirty if unchanged. */
  private changeGen = 0
  private listener: StatusListener | null = null
  private afterImportListener: AfterImportListener | null = null
  private migrationConfirmListener: MigrationConfirmListener | null = null
  private conflictListener: ConflictListener | null = null
  private fileUpgradeListener: FileUpgradeListener | null = null
  private _lastSavedAt: Date | null = null
  private _error: string | null = null
  private _needsPermission = false
  private _paused: SyncPause | null = null

  get isSupported(): boolean {
    return 'showOpenFilePicker' in window
  }

  get status(): FileStorageStatus {
    return {
      isConnected: this.handle !== null && !this._needsPermission && this.syncEnabled,
      fileName: this.handle?.name ?? null,
      lastSavedAt: this._lastSavedAt,
      needsPermission: this._needsPermission,
      error: this._error,
      paused: this._paused,
    }
  }

  onStatusChange(listener: StatusListener) {
    this.listener = listener
  }

  onAfterImport(listener: AfterImportListener) {
    this.afterImportListener = listener
  }

  onConfirmMigration(listener: MigrationConfirmListener) {
    this.migrationConfirmListener = listener
  }

  /** Without a listener a conflict resolves to `'cancel'` (stay paused). */
  onConflict(listener: ConflictListener) {
    this.conflictListener = listener
  }

  /** Without a listener an upgrade prompt resolves to `false` (stay paused). */
  onConfirmFileUpgrade(listener: FileUpgradeListener) {
    this.fileUpgradeListener = listener
  }

  private notify() {
    this.listener?.(this.status)
  }

  async initialize(): Promise<void> {
    if (!this.isSupported) return

    const handle = await loadFileHandle()
    if (!handle) return

    this.handle = handle
    this.installTracking()
    const perm = await handle.queryPermission({ mode: 'readwrite' })

    if (perm === 'granted') {
      await this.loadFromFile()
    } else {
      this._needsPermission = true
    }
    this.notify()
  }

  async reconnect(): Promise<void> {
    if (!this.handle) return
    try {
      const perm = await this.handle.requestPermission({ mode: 'readwrite' })
      if (perm === 'granted') {
        this._needsPermission = false
        this._error = null
        await this.loadFromFile()
      } else {
        this._error = 'Permission denied'
      }
    } catch {
      this._error = 'Could not get file access'
    }
    this.notify()
  }

  /** Re-run the load decision (banner "Retry" / after a cancelled prompt). */
  async retry(): Promise<void> {
    if (!this.handle || this._needsPermission) return
    await this.loadFromFile()
    this.notify()
  }

  async openFile(): Promise<void> {
    try {
      const [handle] = await window.showOpenFilePicker({ types: FILE_TYPES })
      if (!handle) return
      this.stopSync()
      this.handle = handle
      this._error = null
      this._needsPermission = false
      this._paused = null
      await saveFileHandle(handle)
      // A newly attached file has no sync record with this browser.
      clearFileSyncState()
      this.installTracking()
      await this.loadFromFile()
    } catch (e: unknown) {
      if (e instanceof Error && e.name === 'AbortError') return // user cancelled
      this._error = 'Failed to open file'
    }
    this.notify()
  }

  async createFile(): Promise<void> {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: 'todo2-data.json',
        types: FILE_TYPES,
      })
      this.stopSync()
      this.handle = handle
      this._error = null
      this._needsPermission = false
      this._paused = null
      await saveFileHandle(handle)
      clearFileSyncState()
      this.installTracking()
      // A brand-new file: writing the browser data into it loses nothing.
      if (await this.saveToFile({ force: true })) this.syncEnabled = true
    } catch (e: unknown) {
      if (e instanceof Error && e.name === 'AbortError') return
      this._error = 'Failed to create file'
    }
    this.notify()
  }

  async disconnect(): Promise<void> {
    this.stopSync()
    this.removeTracking()
    this.handle = null
    this._needsPermission = false
    this._lastSavedAt = null
    this._error = null
    this._paused = null
    clearFileSyncState()
    await clearFileHandle()
    this.notify()
  }

  /**
   * Banner action (after the user confirms): keep this browser's data and
   * overwrite the file with it. The file's current text is saved as a backup
   * snapshot first. Resumes sync on success.
   */
  async overwriteFileWithBrowser(): Promise<void> {
    if (!this.handle || this._needsPermission) return
    let text: string
    try {
      text = await (await this.handle.getFile()).text()
    } catch (err) {
      console.warn('[file-storage] could not read the file to back it up', err)
      this.pause('backup-failed', `${PAUSED_PREFIX} — ${this.handle.name} could not be read, so it could not be backed up and was left untouched. Disconnect and create a new file to keep syncing.`)
      return
    }
    if (!(await this.backupFileText(text))) return
    if (await this.saveToFile({ force: true })) {
      this._paused = null
      this.syncEnabled = true
    }
    this.notify()
  }

  private pause(reason: SyncPauseReason, message: string) {
    this.stopSync()
    this._paused = { reason, message }
    this.notify()
  }

  private stopSync() {
    this.syncEnabled = false
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
  }

  private async loadFromFile(): Promise<void> {
    const handle = this.handle
    if (!handle) return
    this.stopSync()
    this._paused = null

    let text: string
    let lastModified: number
    try {
      const file = await handle.getFile()
      if (file.size > MAX_IMPORT_SIZE_BYTES) {
        this.pause('too-large', `${PAUSED_PREFIX} — the file is too large (50 MB max).`)
        return
      }
      text = await file.text()
      lastModified = file.lastModified
    } catch (e: unknown) {
      if (e instanceof Error && e.name === 'NotFoundError') {
        // The file is gone — nothing to protect on disk. Forget it.
        this._error = 'File not found — it may have been moved or deleted'
        this.handle = null
        this.removeTracking()
        clearFileSyncState()
        await clearFileHandle().catch((err) => {
          console.warn('[file-storage] clearFileHandle failed after NotFoundError', err)
        })
        this.notify()
        return
      }
      const detail = e instanceof Error ? `: ${e.message}` : ''
      this.pause('read-error', `${PAUSED_PREFIX} — the file could not be read${detail}`)
      return
    }

    if (!text.trim()) {
      // Empty file — nothing to lose; seed it with the browser's data.
      if (await this.saveToFile({ force: true })) this.syncEnabled = true
      this.notify()
      return
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch (parseErr) {
      const detail = parseErr instanceof SyntaxError ? `: ${parseErr.message}` : ''
      this.pause('invalid-json', `${PAUSED_PREFIX} — the file contains invalid JSON${detail}`)
      return
    }

    const prepared = prepareImport(parsed)
    if (!prepared.ok) {
      this.pause(prepared.reason, pauseMessageFor(prepared.reason, prepared.error))
      return
    }
    const raw = parsed as Record<string, unknown>
    const fileId = fileContentId(raw, lastModified)

    if (prepared.legacy) {
      const confirmed = this.migrationConfirmListener
        ? await this.migrationConfirmListener(prepared.legacy)
        : false
      if (!confirmed) {
        this.pause('legacy-cancelled', `${PAUSED_PREFIX} — the file is in an older format that needs your confirmation to load.`)
        return
      }
    }

    const state = readFileSyncState()
    const hasRecord = state.fileSavedAt !== null
    const fileChanged = hasRecord ? state.fileSavedAt !== fileId : null
    const dirty = state.dirtySince !== null

    // Identical data on both sides is never a conflict (and covers browsers
    // upgrading from builds that didn't keep a sync record).
    const sameSchema = prepared.sourceVersion === CURRENT_DB_VERSION
    const identical = (!hasRecord || dirty) && sameSchema
      ? await browserMatchesFile(prepared.data).catch(() => false)
      : false

    let conflictReason: SyncConflictInfo['reason'] | null = null
    if (!identical) {
      if (hasRecord && dirty) conflictReason = 'browser-changes'
      else if (!hasRecord && (await browserTaskCount()) > 0) conflictReason = 'no-sync-record'
    }

    if (conflictReason) {
      const info: SyncConflictInfo = {
        fileName: handle.name,
        reason: conflictReason,
        browser: {
          taskCount: await browserTaskCount(),
          schemaVersion: CURRENT_DB_VERSION,
          unsyncedSince: state.dirtySince,
        },
        file: {
          taskCount: prepared.data.todos.length,
          schemaVersion: prepared.sourceVersion,
          savedAt: typeof raw.savedAt === 'string' ? raw.savedAt
            : typeof raw.exportedAt === 'string' ? raw.exportedAt : null,
          lastModified: new Date(lastModified).toISOString(),
          changedSinceLastSync: fileChanged,
        },
      }
      const choice = this.conflictListener ? await this.conflictListener(info) : 'cancel'
      if (choice === 'cancel') {
        this.pause('conflict-cancelled', `${PAUSED_PREFIX} — this browser and ${handle.name} have different data. Choose which version to keep.`)
        return
      }
      if (choice === 'browser') {
        if (!(await this.backupFileText(text))) return
        if (await this.saveToFile({ force: true })) this.syncEnabled = true
        this.notify()
        return
      }
      // choice === 'file' — falls through to the load below (the dialog
      // already told the user an older file is saved back in this format).
    } else if (prepared.upgraded && !prepared.legacy) {
      const ok = this.fileUpgradeListener
        ? await this.fileUpgradeListener({
          fileName: handle.name,
          fromVersion: prepared.sourceVersion ?? CURRENT_DB_VERSION,
          toVersion: CURRENT_DB_VERSION,
        })
        : false
      if (!ok) {
        this.pause('upgrade-cancelled', `${PAUSED_PREFIX} — ${handle.name} was saved by an older version of TODO2 and needs to be upgraded before syncing.`)
        return
      }
    }

    // Every path that rewrites the file at a newer schema (confirmed upgrade,
    // below-floor confirm, conflict "Use file" with an older file) lands
    // here: back up the raw text BEFORE anything changes on either side.
    if (prepared.upgraded && !(await this.backupFileText(text))) return

    await this.applyFileData(prepared.data, fileId)
    if (prepared.upgraded) {
      // Older file, upgrade confirmed: write it back at CURRENT_DB_VERSION.
      await this.saveToFile({ force: true })
    }
    this.syncEnabled = true
    this.notify()
  }

  /**
   * Back up the sync file's raw text (Settings → Backups) before it is
   * overwritten or rewritten at another schema version. On failure nothing is
   * written: sync pauses and this returns false. Empty text needs no backup.
   */
  private async backupFileText(text: string): Promise<boolean> {
    if (!text.trim()) return true
    try {
      await backupScheduler.snapshotFileBeforeOverwrite(text)
      return true
    } catch (err) {
      console.warn('[file-storage] could not back up the file before rewriting it', err)
      const name = this.handle?.name ?? 'the sync file'
      this.pause('backup-failed', `${PAUSED_PREFIX} — ${name} could not be backed up before being rewritten, so it was left untouched. Retry, or free up browser storage first.`)
      return false
    }
  }

  /** Replace the browser data with the file's (browser snapshot first). */
  private async applyFileData(data: ImportData, fileId: string): Promise<void> {
    let snapshotFailed = false
    await backupScheduler.snapshotBeforeDestructive().catch((err) => {
      console.warn('[file-storage] pre-destructive snapshot failed', err)
      snapshotFailed = true
    })
    this.suppressSync = true
    try {
      await restoreFromImportData(data)
    } finally {
      this.suppressSync = false
    }
    this.changeGen++
    writeFileSyncState({ fileSavedAt: fileId, dirtySince: null })
    await this.afterImportListener?.()
    if (snapshotFailed) {
      this._error = 'Pre-import snapshot failed — your data was loaded, but the backup may be unavailable.'
    }
  }

  /**
   * Write the whole browser DB to the file. Skipped unless sync is enabled or
   * `force` (an explicit, user-sanctioned write). Returns true on success.
   */
  private async saveToFile(opts: { force?: boolean } = {}): Promise<boolean> {
    if (!this.handle || this.suppressSync) return false
    if (!this.syncEnabled && !opts.force) return false

    if (this.saving) {
      this.pendingSave = true
      return false
    }

    this.saving = true
    const gen = this.changeGen
    try {
      const tables = await buildExportData()
      const savedAt = new Date().toISOString()
      const data = { ...tables, savedAt }

      const writable = await this.handle.createWritable()
      try {
        await writable.write(JSON.stringify(data, null, 2))
        await writable.close()
      } catch (writeErr) {
        await writable.abort().catch(() => {})
        throw writeErr
      }

      const prev = readFileSyncState()
      writeFileSyncState({
        fileSavedAt: savedAt,
        // Changes made while this save ran are not in the file yet.
        dirtySince: gen === this.changeGen ? null : prev.dirtySince,
      })
      this._lastSavedAt = new Date()
      this._error = null
      this.notify()
      return true
    } catch {
      this._error = 'Failed to save to file'
      this.notify()
      return false
    } finally {
      this.saving = false
      if (this.pendingSave) {
        this.pendingSave = false
        this.scheduleSave()
      }
    }
  }

  private scheduleSave() {
    if (!this.handle || !this.syncEnabled) return
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => { void this.saveToFile() }, DEBOUNCE_MS)
  }

  /** Every tracked DB write: record it as unsynced, then save if syncing. */
  private onLocalChange() {
    if (this.suppressSync) return
    this.changeGen++
    const state = readFileSyncState()
    if (state.dirtySince === null) {
      writeFileSyncState({ ...state, dirtySince: new Date().toISOString() })
    }
    this.scheduleSave()
  }

  private installTracking() {
    if (this.hookCleanups.length > 0) return
    for (const table of ALL_DATA_TABLES) {
      const onCreating = () => this.onLocalChange()
      const onUpdating = () => this.onLocalChange()
      const onDeleting = () => this.onLocalChange()

      table.hook('creating').subscribe(onCreating)
      table.hook('updating').subscribe(onUpdating)
      table.hook('deleting').subscribe(onDeleting)

      this.hookCleanups.push(
        () => table.hook('creating').unsubscribe(onCreating),
        () => table.hook('updating').unsubscribe(onUpdating),
        () => table.hook('deleting').unsubscribe(onDeleting),
      )
    }
  }

  private removeTracking() {
    for (const cleanup of this.hookCleanups) cleanup()
    this.hookCleanups = []
  }
}

export const fileStorageService = new FileStorageService()
