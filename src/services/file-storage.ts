import { ALL_DATA_TABLES } from '../data/database'
import { saveFileHandle, loadFileHandle, clearFileHandle } from './file-handle-idb'
import { validateImportData, MAX_IMPORT_SIZE_BYTES } from '../data/import-validation'
import { restoreFromImportData } from '../data/restore'
import { buildExportData } from './export-import'
import { backupScheduler } from './backup-scheduler'
import { detectLegacyFormat } from './migration-check'
import type { LegacyImportInfo } from './migration-check'

export type FileStorageStatus = {
  isConnected: boolean
  fileName: string | null
  lastSavedAt: Date | null
  needsPermission: boolean
  error: string | null
}

type StatusListener = (status: FileStorageStatus) => void
type AfterImportListener = () => Promise<void>
type MigrationConfirmListener = (info: LegacyImportInfo) => Promise<boolean>

const FILE_TYPES = [{ description: 'TODO2 Database', accept: { 'application/json': ['.json'] } }]
const DEBOUNCE_MS = 500

class FileStorageService {
  private handle: FileSystemFileHandle | null = null
  private suppressSync = false
  private saving = false
  private pendingSave = false
  private saveTimer: ReturnType<typeof setTimeout> | null = null
  private hookCleanups: Array<() => void> = []
  private listener: StatusListener | null = null
  private afterImportListener: AfterImportListener | null = null
  private migrationConfirmListener: MigrationConfirmListener | null = null
  private _lastSavedAt: Date | null = null
  private _error: string | null = null
  private _needsPermission = false

  get isSupported(): boolean {
    return 'showOpenFilePicker' in window
  }

  get status(): FileStorageStatus {
    return {
      isConnected: this.handle !== null && !this._needsPermission,
      fileName: this.handle?.name ?? null,
      lastSavedAt: this._lastSavedAt,
      needsPermission: this._needsPermission,
      error: this._error,
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

  private notify() {
    this.listener?.(this.status)
  }

  async initialize(): Promise<void> {
    if (!this.isSupported) return

    const handle = await loadFileHandle()
    if (!handle) return

    this.handle = handle
    const perm = await handle.queryPermission({ mode: 'readwrite' })

    if (perm === 'granted') {
      await this.loadFromFile()
      if (this.handle) this.installHooks()
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
        this.installHooks()
      } else {
        this._error = 'Permission denied'
      }
    } catch {
      this._error = 'Could not get file access'
    }
    this.notify()
  }

  async openFile(): Promise<void> {
    this.removeHooks()
    try {
      const [handle] = await window.showOpenFilePicker({ types: FILE_TYPES })
      this.handle = handle
      this._error = null
      this._needsPermission = false
      await saveFileHandle(handle)
      await this.loadFromFile()
      this.installHooks()
    } catch (e: unknown) {
      if (e instanceof Error && e.name === 'AbortError') return // user cancelled
      this._error = 'Failed to open file'
    }
    this.notify()
  }

  async createFile(): Promise<void> {
    this.removeHooks()
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: 'todo2-data.json',
        types: FILE_TYPES,
      })
      this.handle = handle
      this._error = null
      this._needsPermission = false
      await saveFileHandle(handle)
      await this.saveToFile()
      this.installHooks()
    } catch (e: unknown) {
      if (e instanceof Error && e.name === 'AbortError') return
      this._error = 'Failed to create file'
    }
    this.notify()
  }

  async disconnect(): Promise<void> {
    this.removeHooks()
    this.handle = null
    this._needsPermission = false
    this._lastSavedAt = null
    this._error = null
    await clearFileHandle()
    this.notify()
  }

  private async loadFromFile(): Promise<void> {
    if (!this.handle) return

    this.suppressSync = true
    try {
      const file = await this.handle.getFile()

      if (file.size > MAX_IMPORT_SIZE_BYTES) {
        this._error = 'File too large (50 MB max)'
        this.suppressSync = false
        this.notify()
        return
      }

      const text = await file.text()

      if (!text.trim()) {
        // Empty file — seed it with current DB contents
        this.suppressSync = false
        await this.saveToFile()
        return
      }

      let parsed: unknown
      try {
        parsed = JSON.parse(text)
      } catch (parseErr) {
        const detail = parseErr instanceof SyntaxError ? `: ${parseErr.message}` : ''
        this._error = `File contains invalid JSON${detail}`
        this.suppressSync = false
        this.notify()
        return
      }

      const result = validateImportData(parsed)
      if (!result.ok) {
        this._error = result.error
        this.suppressSync = false
        this.notify()
        return
      }

      const legacyInfo = detectLegacyFormat(parsed)
      if (legacyInfo && this.migrationConfirmListener) {
        const confirmed = await this.migrationConfirmListener(legacyInfo)
        if (!confirmed) {
          this.suppressSync = false
          return
        }
      }

      await backupScheduler.snapshotBeforeDestructive().catch(() => {})
      await restoreFromImportData(result.data)

      // Notify caller to refresh all Zustand stores
      await this.afterImportListener?.()
    } catch (e: unknown) {
      if (e instanceof Error && e.name === 'NotFoundError') {
        this._error = 'File not found — it may have been moved or deleted'
        this.handle = null
        await clearFileHandle().catch(() => {})
      } else {
        this._error = 'Failed to read file'
      }
      this.notify()
    } finally {
      this.suppressSync = false
    }
  }

  private async saveToFile(): Promise<void> {
    if (!this.handle || this.suppressSync) return

    if (this.saving) {
      this.pendingSave = true
      return
    }

    this.saving = true
    try {
      const tables = await buildExportData()
      const data = { ...tables, savedAt: new Date().toISOString() }

      const writable = await this.handle.createWritable()
      try {
        await writable.write(JSON.stringify(data, null, 2))
        await writable.close()
      } catch (writeErr) {
        await writable.abort().catch(() => {})
        throw writeErr
      }

      this._lastSavedAt = new Date()
      this._error = null
      this.notify()
    } catch {
      this._error = 'Failed to save to file'
      this.notify()
    } finally {
      this.saving = false
      if (this.pendingSave) {
        this.pendingSave = false
        this.scheduleSave()
      }
    }
  }

  private scheduleSave() {
    if (!this.handle || this.suppressSync) return
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => this.saveToFile(), DEBOUNCE_MS)
  }

  private installHooks() {
    this.removeHooks()
    const tables = ALL_DATA_TABLES
    for (const table of tables) {
      const onCreating = () => this.scheduleSave()
      const onUpdating = () => this.scheduleSave()
      const onDeleting = () => this.scheduleSave()

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

  private removeHooks() {
    for (const cleanup of this.hookCleanups) cleanup()
    this.hookCleanups = []
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
  }
}

export const fileStorageService = new FileStorageService()
