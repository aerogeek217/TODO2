/**
 * Persistent bookkeeping for the attached sync file.
 *
 * Lives in `localStorage`, deliberately **outside** the Dexie database:
 * `restoreFromImportData` clears every data table (including `settings`), and
 * this state must survive both restores and reloads. `localStorage` writes are
 * synchronous, so a change made right before the tab closes still marks the
 * browser dirty (an async IndexedDB write might not land).
 *
 * - `fileSavedAt` — identity of the file content this browser last read or
 *   wrote (the file's `savedAt`; see `fileContentId`). `null` = no record of
 *   ever syncing with the current file.
 * - `dirtySince` — ISO time of the first browser change not yet written to the
 *   file (set by any write while not successfully synced: sync paused,
 *   permission needed, failed save, or simply the 500 ms debounce window).
 *   `null` = everything in the browser is in the file.
 */
export interface FileSyncState {
  fileSavedAt: string | null
  dirtySince: string | null
}

export const FILE_SYNC_STATE_KEY = 'todo2-file-sync-state'

const EMPTY: FileSyncState = { fileSavedAt: null, dirtySince: null }

export function readFileSyncState(): FileSyncState {
  try {
    const raw = localStorage.getItem(FILE_SYNC_STATE_KEY)
    if (!raw) return { ...EMPTY }
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return { ...EMPTY }
    const o = parsed as Record<string, unknown>
    return {
      fileSavedAt: typeof o.fileSavedAt === 'string' ? o.fileSavedAt : null,
      dirtySince: typeof o.dirtySince === 'string' ? o.dirtySince : null,
    }
  } catch {
    return { ...EMPTY }
  }
}

export function writeFileSyncState(state: FileSyncState): void {
  try {
    localStorage.setItem(FILE_SYNC_STATE_KEY, JSON.stringify(state))
  } catch (err) {
    console.warn('[file-sync] could not persist sync state', err)
  }
}

export function clearFileSyncState(): void {
  try {
    localStorage.removeItem(FILE_SYNC_STATE_KEY)
  } catch { /* ignore */ }
}

/**
 * Stable identity of a sync file's content. Files written by sync carry
 * `savedAt` (a fresh ISO stamp per save); manual exports carry `exportedAt`;
 * anything else falls back to the file's last-modified time.
 */
export function fileContentId(raw: Record<string, unknown>, lastModified: number): string {
  if (typeof raw.savedAt === 'string') return raw.savedAt
  if (typeof raw.exportedAt === 'string') return `exported:${raw.exportedAt}`
  return `modified:${lastModified}`
}
