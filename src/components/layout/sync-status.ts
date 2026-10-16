import { useFileStorageStore } from '../../services/file-storage-store'
import { useFileOpsStore } from '../../services/file-ops-store'

/** What the storage pill says, from the file storage status. */
export type StoragePillKind = 'local' | 'syncing' | 'paused' | 'error'

export interface StoragePillInput {
  isConnected: boolean
  fileName: string | null
  needsPermission: boolean
  paused: unknown
  error: string | null
  dismissedError: string | null
}

export interface StoragePillState {
  kind: StoragePillKind
  text: string
}

/**
 * The storage pill's state. A paused sync (including one waiting for
 * permission) wins over an error, an error the user hasn't dismissed wins
 * over syncing, and with no file attached it's "Local only".
 */
export function storagePillState(s: StoragePillInput): StoragePillState {
  if (s.needsPermission || s.paused != null) return { kind: 'paused', text: 'Sync paused' }
  if (s.error != null && s.error !== s.dismissedError) return { kind: 'error', text: 'Sync error' }
  if (s.isConnected) return { kind: 'syncing', text: s.fileName ?? 'Syncing' }
  return { kind: 'local', text: 'Local only' }
}

/** A sync problem that keeps the full-width warning strip up. */
export type SyncWarning =
  | { kind: 'permission'; fileName: string | null }
  | { kind: 'paused'; message: string }
  | { kind: 'error'; message: string }
  | { kind: 'snapshot'; message: string }

/** The current sync warning, most urgent first, or null when all is well. */
export function useSyncWarning(): SyncWarning | null {
  const needsPermission = useFileStorageStore((s) => s.needsPermission)
  const fileName = useFileStorageStore((s) => s.fileName)
  const paused = useFileStorageStore((s) => s.paused)
  const error = useFileStorageStore((s) => s.error)
  const dismissedError = useFileStorageStore((s) => s.dismissedError)
  const snapshotWarning = useFileOpsStore((s) => s.snapshotWarning)
  if (needsPermission) return { kind: 'permission', fileName }
  // Sync paused (unreadable / newer / older file, or a cancelled conflict):
  // nothing has been written either way until the user picks a way forward.
  if (paused) return { kind: 'paused', message: paused.message }
  // File-storage errors (failed pre-import snapshot, parse or write failures).
  if (error && error !== dismissedError) return { kind: 'error', message: error }
  // A backup snapshot that failed its import self-check (it was still saved).
  if (snapshotWarning) return { kind: 'snapshot', message: snapshotWarning }
  return null
}

/** The strip's old "stored locally" dismissal flag; the pill replaced the strip's info branch. */
const LEGACY_BANNER_DISMISSED_KEY = 'todo2-file-sync-banner-dismissed'

/** Drops storage keys nothing reads any more. */
export function removeLegacySyncKeys(): void {
  try {
    localStorage.removeItem(LEGACY_BANNER_DISMISSED_KEY)
  } catch {
    // Storage unavailable (private mode, blocked): nothing to clean up.
  }
}
