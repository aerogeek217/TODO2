import { ALL_DATA_TABLES, CURRENT_DB_VERSION } from '../data/database'
import { saveFileHandle, loadFileHandle, clearFileHandle } from './file-handle-idb'
import { MAX_IMPORT_SIZE_BYTES } from '../data/import-validation'
import type { ImportData } from '../data/import-validation'
import { prepareImport } from '../data/import-pipeline'
import type { PrepareImportFailure } from '../data/import-pipeline'
import { restoreFromImportData } from '../data/restore'
import { buildExportData } from '../data/export-data'
import { backupScheduler } from '../data/backup-scheduler'
import { NO_BACKUP_NOTE, takeSafetySnapshot } from '../stores/safety-snapshot'
import { useUndoStore } from '../stores/undo-store'
import type { UnsupportedImportInfo } from '../data/file-version'
import {
  readFileSyncState, writeFileSyncState, clearFileSyncState, fileContentId,
} from './file-sync-state'
import { browserMatchesFile, browserTaskCount } from './file-sync-compare'
import { toDateInputValue } from '../utils/date'
import { registerModuleReset } from '../utils/module-reset'

/**
 * Why sync is paused. While paused the file is never written, no restore has
 * run, and the browser database is untouched; browser edits keep marking the
 * browser dirty so they surface in the next conflict check.
 */
export type SyncPauseReason =
  | PrepareImportFailure   // too-large / invalid-json / not-object / too-new / upgrade-failed / invalid
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
/** Runs before the browser data is backed up and replaced; resolves to a release called after the reload. */
type BeforeImportListener = () => Promise<() => void>
type MigrationConfirmHandler = (info: UnsupportedImportInfo) => Promise<boolean>
type ConflictHandler = (info: SyncConflictInfo) => Promise<SyncConflictChoice>
type FileUpgradeHandler = (info: FileUpgradeInfo) => Promise<boolean>

const FILE_TYPES = [{ description: 'TODO2 Database', accept: { 'application/json': ['.json'] } }]

/**
 * Create New File's suggested name, dated with the local day
 * (`todo2-data-YYYY-MM-DD.json`). The browser empties an existing file picked
 * in the save dialog before the app gets control, so its text can't be
 * backed up; a dated default keeps the suggestion off an older sync file.
 */
export function newSyncFileName(now: Date = new Date()): string {
  return `todo2-data-${toDateInputValue(now)}.json`
}
const DEBOUNCE_MS = 500

const PAUSED_PREFIX = 'File sync paused'

function pauseMessageFor(reason: PrepareImportFailure, error: string): string {
  switch (reason) {
    case 'too-new': return `${PAUSED_PREFIX} — ${error}`
    case 'upgrade-failed': return `${PAUSED_PREFIX} — ${error}`
    default: return `${PAUSED_PREFIX} — the file could not be read: ${error}`
  }
}

/** Reading a sync file's text: what was read, or why it couldn't be. */
type FileRead =
  | { ok: true; text: string; lastModified: number }
  | { ok: false; reason: 'not-found' | 'too-large' | 'read-error'; error: unknown }

/** Reads of a file that keeps being replaced while it is read, before giving up. */
const READ_ATTEMPTS = 3

function isNamedError(e: unknown, name: string): boolean {
  return e instanceof Error && e.name === name
}

/**
 * Reads the file's text, refusing a file over the import cap (50 MB) before
 * reading it. `getFile()` is a snapshot: when a save (this tab's or
 * another's) replaces the file between `getFile()` and reading its text,
 * the read fails with `NotFoundError` / `NotReadableError` although the file
 * is fine — then it is read again. `not-found` only when `getFile()` itself
 * finds no file.
 */
async function readFileText(handle: FileSystemFileHandle): Promise<FileRead> {
  let replacedError: unknown = null
  for (let attempt = 0; attempt < READ_ATTEMPTS; attempt++) {
    let file: File
    try {
      file = await handle.getFile()
    } catch (e: unknown) {
      return { ok: false, reason: isNamedError(e, 'NotFoundError') ? 'not-found' : 'read-error', error: e }
    }
    if (file.size > MAX_IMPORT_SIZE_BYTES) return { ok: false, reason: 'too-large', error: null }
    try {
      return { ok: true, text: await file.text(), lastModified: file.lastModified }
    } catch (e: unknown) {
      if (!isNamedError(e, 'NotFoundError') && !isNamedError(e, 'NotReadableError')) {
        return { ok: false, reason: 'read-error', error: e }
      }
      console.warn('[file-storage] the file was replaced while it was read; reading it again', e)
      replacedError = e
    }
  }
  return { ok: false, reason: 'read-error', error: replacedError }
}

/** Adds `listener` to `set`; returns its removal (a no-op once removed). */
function subscribe<L>(set: Set<L>, listener: L): () => void {
  set.add(listener)
  return () => { set.delete(listener) }
}

function errorDetail(e: unknown): string {
  return e instanceof Error ? `: ${e.message}` : ''
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
 *   already hold identical data (an older file compared after its upgrade;
 *   identical + older → the upgrade prompt).
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
  /** The write in flight; at most one runs at a time. */
  private saveInFlight: Promise<boolean> | null = null
  /** A debounced save asked for while one was in flight. */
  private pendingSave = false
  private saveTimer: ReturnType<typeof setTimeout> | null = null
  private idleWaiters: Array<() => void> = []
  private hookCleanups: Array<() => void> = []
  /** Bumped on every tracked change; a save only clears dirty if unchanged. */
  private changeGen = 0
  private statusListeners = new Set<StatusListener>()
  private afterImportListeners = new Set<AfterImportListener>()
  private beforeImportListeners = new Set<BeforeImportListener>()
  private migrationConfirmHandler: MigrationConfirmHandler | null = null
  private conflictHandler: ConflictHandler | null = null
  private fileUpgradeHandler: FileUpgradeHandler | null = null
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

  /**
   * Calls `listener` with the new status on every change; returns its
   * unsubscribe. Every subscriber gets every change.
   */
  onStatusChange(listener: StatusListener): () => void {
    return subscribe(this.statusListeners, listener)
  }

  /**
   * `listener` runs after the file's data replaced the browser's (the stores
   * reload there); returns its unsubscribe. Subscribers run in turn, each
   * awaited; one that rejects doesn't stop the others, and the load then
   * rejects with its error.
   */
  onAfterImport(listener: AfterImportListener): () => void {
    return subscribe(this.afterImportListeners, listener)
  }

  /**
   * `listener` runs before the browser data is backed up and replaced by
   * the file's, and resolves to a release, called once the after-import
   * reload is done (or the load was cancelled or failed) — the note store
   * saves its pending text and then holds its saves in between. Returns its
   * unsubscribe; every subscriber runs, in turn.
   */
  onBeforeImport(listener: BeforeImportListener): () => void {
    return subscribe(this.beforeImportListeners, listener)
  }

  /**
   * The one answer to "load a file below the supported version?" — a
   * question has one asker, so a later handler replaces an earlier one.
   * Returns the removal, which does nothing once replaced. Without a
   * handler the answer is `false` (stay paused).
   */
  onConfirmMigration(handler: MigrationConfirmHandler): () => void {
    this.migrationConfirmHandler = handler
    return () => { if (this.migrationConfirmHandler === handler) this.migrationConfirmHandler = null }
  }

  /** As `onConfirmMigration`, for a conflict; without a handler it resolves to `'cancel'` (stay paused). */
  onConflict(handler: ConflictHandler): () => void {
    this.conflictHandler = handler
    return () => { if (this.conflictHandler === handler) this.conflictHandler = null }
  }

  /** As `onConfirmMigration`, for an upgrade prompt; without a handler it resolves to `false` (stay paused). */
  onConfirmFileUpgrade(handler: FileUpgradeHandler): () => void {
    this.fileUpgradeHandler = handler
    return () => { if (this.fileUpgradeHandler === handler) this.fileUpgradeHandler = null }
  }

  private notify() {
    const status = this.status
    for (const listener of [...this.statusListeners]) {
      try {
        listener(status)
      } catch (err) {
        console.warn('[file-storage] a status listener failed', err)
      }
    }
  }

  /** Runs every before-import subscriber; resolves to one release for them all. */
  private async holdForImport(): Promise<() => void> {
    const releases: Array<() => void> = []
    const releaseAll = () => { for (const release of releases.splice(0)) release() }
    try {
      for (const listener of [...this.beforeImportListeners]) releases.push(await listener())
    } catch (err) {
      releaseAll()
      throw err
    }
    return releaseAll
  }

  /** Runs every after-import subscriber in turn; rethrows the first failure once all ran. */
  private async afterImport(): Promise<void> {
    let failure: { error: unknown } | null = null
    for (const listener of [...this.afterImportListeners]) {
      try {
        await listener()
      } catch (error) {
        failure ??= { error }
      }
    }
    if (failure) throw failure.error
  }

  /**
   * Back to the state at module load, for tests that share one module
   * instance: no file, no sync, no timers or Dexie hooks, idle (waiters
   * released). A write already running finishes on its own but no longer
   * counts. Subscribers and question handlers stay — they belong to modules
   * (the file-storage store) that outlive the reset; a test removes its own.
   */
  reset(): void {
    this.stopSync()
    this.removeTracking()
    this.handle = null
    this.suppressSync = false
    this.saveInFlight = null
    this.pendingSave = false
    this.changeGen = 0
    this._lastSavedAt = null
    this._error = null
    this._needsPermission = false
    this._paused = null
    this.checkIdle()
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
    } catch (err) {
      console.warn('[file-storage] could not get file access', err)
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
      console.warn('[file-storage] opening the file failed', e)
      this._error = 'Failed to open file'
    }
    this.notify()
  }

  async createFile(): Promise<void> {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: newSyncFileName(),
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
      console.warn('[file-storage] creating the file failed', e)
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
    const handle = this.handle
    if (!handle || this._needsPermission) return
    await this.whenIdle()
    if (this.handle !== handle) return
    const read = await readFileText(handle)
    if (!read.ok) {
      console.warn('[file-storage] could not read the file to back it up', read.error)
      const why = read.reason === 'too-large' ? 'is too large to back up (50 MB max)' : 'could not be read, so it could not be backed up'
      this.pause('backup-failed', `${PAUSED_PREFIX} — ${handle.name} ${why} and was left untouched. Disconnect and create a new file to keep syncing.`)
      return
    }
    if (!(await this.backupFileText(read.text))) return
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
    this.checkIdle()
  }

  /**
   * Resolves once no write to the file is running or scheduled — the file
   * then holds a complete save and is not being replaced. The load path
   * waits for it before reading the file.
   */
  whenIdle(): Promise<void> {
    if (!this.busy) return Promise.resolve()
    return new Promise((resolve) => { this.idleWaiters.push(resolve) })
  }

  private get busy(): boolean {
    return this.saveInFlight !== null || this.saveTimer !== null
  }

  private checkIdle() {
    if (this.busy || this.idleWaiters.length === 0) return
    const waiters = this.idleWaiters
    this.idleWaiters = []
    for (const resolve of waiters) resolve()
  }

  private async loadFromFile(): Promise<void> {
    const handle = this.handle
    if (!handle) return
    this.stopSync()
    this._paused = null
    // A save that was already running finishes before the file is read.
    await this.whenIdle()
    if (this.handle !== handle) return

    const read = await readFileText(handle)
    if (!read.ok) {
      if (read.reason === 'too-large') {
        this.pause('too-large', `${PAUSED_PREFIX} — the file is too large (50 MB max).`)
        return
      }
      if (read.reason === 'not-found') {
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
      console.warn('[file-storage] reading the file failed', read.error)
      this.pause('read-error', `${PAUSED_PREFIX} — the file could not be read${errorDetail(read.error)}`)
      return
    }
    const { text, lastModified } = read

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
      const confirmed = this.migrationConfirmHandler
        ? await this.migrationConfirmHandler(prepared.legacy)
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

    // Identical data on both sides is never a conflict. This also covers a
    // browser upgrading from a build that kept no sync record: its database
    // was upgraded at open by the same transforms that upgraded
    // `prepared.data`, so a file that was in sync before the upgrade still
    // matches — and an older file then gets the upgrade prompt below.
    const identical = !hasRecord || dirty
      ? await browserMatchesFile(prepared.data).catch((err: unknown) => {
        console.warn('[file-storage] comparing the browser data with the file failed', err)
        return false
      })
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
      const choice = this.conflictHandler ? await this.conflictHandler(info) : 'cancel'
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
      const ok = this.fileUpgradeHandler
        ? await this.fileUpgradeHandler({
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

    // The browser already holds this file's data (same content — after the
    // file's upgrade, if it needed one — or clean and synced with this very
    // version of the file): the load loses nothing.
    const browserHoldsFile = identical
      || (!prepared.upgraded && hasRecord && !dirty && fileChanged === false)
    if (!(await this.applyFileData(prepared.data, fileId, browserHoldsFile))) return
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

  /**
   * Replace the browser data with the file's, backing the browser data up
   * first (`takeSafetySnapshot`). If that backup fails the user is asked;
   * on Cancel nothing changes, sync pauses and this returns false. When the
   * browser already holds exactly this file's data (`browserHoldsFile`),
   * nothing can be lost, so a failed backup doesn't stop the load.
   */
  private async applyFileData(data: ImportData, fileId: string, browserHoldsFile: boolean): Promise<boolean> {
    const name = this.handle?.name ?? 'the sync file'
    let noBackup = false
    // Before the backup: note text typed just before is saved (so the
    // backup holds it), and note saves then wait until the stores have
    // reloaded — one landing after the restore would put this browser's
    // text over the file's note.
    const release = await this.holdForImport()
    try {
      if (browserHoldsFile) {
        await backupScheduler.snapshotBeforeDestructive().catch((err) => {
          console.warn('[file-storage] snapshot before reloading the unchanged file failed', err)
        })
      } else {
        const snapshot = await takeSafetySnapshot(`loading ${name} over this browser's data`)
        if (snapshot === 'cancelled') {
          this.pause('backup-failed', `${PAUSED_PREFIX} — this browser's data could not be backed up before loading ${name}, so nothing changed. Retry, or free up browser storage first.`)
          return false
        }
        noBackup = snapshot === 'without-backup'
      }
      this.suppressSync = true
      try {
        await restoreFromImportData(data)
      } finally {
        this.suppressSync = false
      }
      this.changeGen++
      writeFileSyncState({ fileSavedAt: fileId, dirtySince: null })
      await this.afterImport()
    } finally {
      release()
    }
    // After the stores reload (which clears the snackbar): the result toast.
    if (noBackup) useUndoStore.getState().notify(`Loaded ${name}. ${NO_BACKUP_NOTE}`)
    return true
  }

  /**
   * Write the whole browser DB to the file. Skipped unless sync is enabled or
   * `force` (an explicit, user-sanctioned write: create, overwrite, upgrade,
   * seeding an empty file). Writes never overlap: a debounced save asked for
   * while one runs is rescheduled after it, and a forced write waits for it
   * and then writes — it is never dropped. Only ever writes the file attached
   * when it was called. Returns true on success.
   */
  private async saveToFile(opts: { force?: boolean } = {}, handle = this.handle): Promise<boolean> {
    if (!handle || handle !== this.handle || this.suppressSync) return false
    if (!this.syncEnabled && !opts.force) return false

    if (this.saveInFlight) {
      if (!opts.force) {
        this.pendingSave = true
        return false
      }
      await this.saveInFlight
      return this.saveToFile(opts, handle)
    }

    const run = this.writeFile(handle)
    this.saveInFlight = run
    try {
      return await run
    } finally {
      this.saveInFlight = null
      if (this.pendingSave) {
        this.pendingSave = false
        this.scheduleSave()
      }
      this.checkIdle()
    }
  }

  private async writeFile(handle: FileSystemFileHandle): Promise<boolean> {
    const gen = this.changeGen
    try {
      const tables = await buildExportData()
      const savedAt = new Date().toISOString()
      const data = { ...tables, savedAt }

      const writable = await handle.createWritable()
      try {
        await writable.write(JSON.stringify(data, null, 2))
        await writable.close()
      } catch (writeErr) {
        await writable.abort().catch((abortErr: unknown) => {
          console.warn('[file-storage] discarding the failed write failed', abortErr)
        })
        throw writeErr
      }

      // Another file was attached while this save ran: it wrote the file it
      // started on; the sync record now belongs to the new one.
      if (handle !== this.handle) return false
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
    } catch (err) {
      console.warn('[file-storage] saving to the file failed', err)
      if (handle === this.handle) {
        this._error = 'Failed to save to file'
        this.notify()
      }
      return false
    }
  }

  private scheduleSave() {
    if (!this.handle || !this.syncEnabled) return
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      void this.saveToFile().finally(() => this.checkIdle())
    }, DEBOUNCE_MS)
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
registerModuleReset(() => fileStorageService.reset())
