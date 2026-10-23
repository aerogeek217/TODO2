import { useMemo } from 'react'
import { useFileStorageStore } from '../../services/file-storage-store'
import { useFileOpsStore } from '../../stores/file-ops-store'
import type { SyncPauseReason } from '../../services/file-storage'

/**
 * Everything the storage pill (desktop) and the phone's status button say
 * about where the data lives and what needs the user: one state, the most
 * urgent first — Permission needed › Sync paused › Sync error › Backup
 * warning › Synced / Local only.
 */
export type StoragePillKind = 'local' | 'syncing' | 'permission' | 'paused' | 'error' | 'backup'

export interface StoragePillInput {
  isConnected: boolean
  fileName: string | null
  needsPermission: boolean
  paused: { reason?: SyncPauseReason; message: string } | null
  error: string | null
  dismissedError: string | null
  /** A backup that would not restore, or an operation run without one (`file-ops-store`). */
  snapshotWarning: string | null
}

/** Something waiting for the user, in the pill's order. */
export type SyncWarning =
  | { kind: 'permission'; fileName: string; refused: boolean }
  | { kind: 'paused'; reason: SyncPauseReason | null; message: string; fileName: string | null }
  | { kind: 'error'; message: string }
  | { kind: 'backup'; message: string }

export interface StoragePillState {
  kind: StoragePillKind
  text: string
  /** How many warnings are active (the pill's count badge from two on). */
  warningCount: number
}

/** The error texts that mean the browser said no to Grant access. */
const REFUSED_ERRORS: ReadonlySet<string> = new Set(['Permission denied', 'Could not get file access'])

/**
 * The active warnings, most urgent first. An error isn't its own warning
 * while permission is needed or sync is paused (it is that state's cause —
 * a refused grant shows as the permission warning's flag), nor once the
 * user dismissed that error.
 */
export function syncWarnings(s: StoragePillInput): SyncWarning[] {
  const out: SyncWarning[] = []
  if (s.needsPermission) {
    out.push({ kind: 'permission', fileName: s.fileName ?? 'the sync file', refused: s.error != null && REFUSED_ERRORS.has(s.error) })
  }
  // Sync paused (unreadable / newer / older file, or a cancelled prompt):
  // nothing has been written either way until the user picks a way forward.
  if (s.paused) out.push({ kind: 'paused', reason: s.paused.reason ?? null, message: s.paused.message, fileName: s.fileName })
  if (s.error != null && s.error !== s.dismissedError && !s.needsPermission && !s.paused) {
    out.push({ kind: 'error', message: s.error })
  }
  if (s.snapshotWarning) out.push({ kind: 'backup', message: s.snapshotWarning })
  return out
}

const WARNING_TEXT: Record<SyncWarning['kind'], string> = {
  permission: 'Permission needed',
  paused: 'Sync paused',
  error: 'Sync error',
  backup: 'Backup warning',
}

/**
 * The pill's state: its most urgent warning, else Synced (syncing to the
 * file — its name is in the pill's tooltip and popover), else Local only.
 */
export function storagePillState(s: StoragePillInput): StoragePillState {
  const warnings = syncWarnings(s)
  const first = warnings.at(0)
  if (first) return { kind: first.kind, text: WARNING_TEXT[first.kind], warningCount: warnings.length }
  if (s.isConnected) return { kind: 'syncing', text: 'Synced', warningCount: 0 }
  return { kind: 'local', text: 'Local only', warningCount: 0 }
}

/** The pill's accessible name: `Storage: <text>`, plus the count when several warnings are active. */
export function storagePillLabel(state: StoragePillState): string {
  return state.warningCount > 1 ? `Storage: ${state.text}, ${state.warningCount} warnings` : `Storage: ${state.text}`
}

/** Red for a failure; amber for waiting on the user; none for Local only / Syncing. */
export function warningTone(kind: StoragePillKind): 'danger' | 'warning' | null {
  if (kind === 'error') return 'danger'
  if (kind === 'local' || kind === 'syncing') return null
  return 'warning'
}

/** A warning in words: its title, why it shows, an optional flag line and what it means. */
export interface SyncWarningCopy {
  title: string
  why: string
  flag: string | null
  body: string | null
}

const PAUSED_PREFIX = 'File sync paused — '

/**
 * A paused message without its `File sync paused — ` prefix, as a sentence:
 * a capital first letter — unless it starts with the file's name, which is
 * shown as it is spelled.
 */
function pausedWhy(message: string, fileName: string | null): string {
  const rest = message.startsWith(PAUSED_PREFIX) ? message.slice(PAUSED_PREFIX.length) : message
  if (fileName && rest.startsWith(fileName)) return rest
  return rest.charAt(0).toUpperCase() + rest.slice(1)
}

function pausedBody(reason: SyncPauseReason | null): string | null {
  // After a failed write-back the browser already holds the file's data.
  if (reason === 'write-failed') return null
  const untouched = 'Nothing has been written to either side.'
  if (reason === 'conflict-cancelled') {
    return `${untouched} Retry shows the choice again; Keep browser data… overwrites the file after a backup of it.`
  }
  if (reason === 'too-new') return `${untouched} Update TODO2 to keep what that version saved, or keep this browser’s data.`
  if (reason === 'too-old') return `${untouched} Open the file in an older TODO2 build to keep what it holds, or keep this browser’s data.`
  return untouched
}

/** A backup warning that a saved backup would not restore (the others say none was saved). */
export function isUnrestorableBackupWarning(message: string): boolean {
  return message.startsWith('Backup snapshot (')
}

/** One warning's words — shared by the pill's popover and the phone's status sheet. */
export function syncWarningCopy(w: SyncWarning): SyncWarningCopy {
  switch (w.kind) {
    case 'permission':
      return {
        title: WARNING_TEXT.permission,
        why: `Sync to ${w.fileName} is paused until your browser lets TODO2 open the file.`,
        flag: w.refused ? 'Your browser refused access last time.' : null,
        body: 'You’re working on this browser’s data. Nothing is written to the file meanwhile.',
      }
    case 'paused':
      return { title: WARNING_TEXT.paused, why: pausedWhy(w.message, w.fileName), flag: null, body: pausedBody(w.reason) }
    case 'error':
      return {
        title: WARNING_TEXT.error,
        why: w.message,
        flag: null,
        body: 'Your changes are still kept in this browser. Dismiss hides this until a different error happens.',
      }
    case 'backup':
      return {
        title: WARNING_TEXT.backup,
        why: w.message,
        flag: null,
        body: isUnrestorableBackupWarning(w.message)
          ? 'It was saved anyway — a partly restorable backup beats none. Check it in Settings › Database › Backups.'
          : 'Free up browser storage so the next one works, or delete old backups.',
      }
  }
}

/** The storage state from the stores, as `storagePillState` reads it. */
export function useStoragePillInput(): StoragePillInput {
  const isConnected = useFileStorageStore((s) => s.isConnected)
  const fileName = useFileStorageStore((s) => s.fileName)
  const needsPermission = useFileStorageStore((s) => s.needsPermission)
  const paused = useFileStorageStore((s) => s.paused)
  const error = useFileStorageStore((s) => s.error)
  const dismissedError = useFileStorageStore((s) => s.dismissedError)
  const snapshotWarning = useFileOpsStore((s) => s.snapshotWarning)
  return useMemo(
    () => ({ isConnected, fileName, needsPermission, paused, error, dismissedError, snapshotWarning }),
    [isConnected, fileName, needsPermission, paused, error, dismissedError, snapshotWarning],
  )
}

/** The storage pill's state and its active warnings, from the stores. */
export function useStorageStatus(): { state: StoragePillState; warnings: SyncWarning[] } {
  const input = useStoragePillInput()
  return useMemo(() => ({ state: storagePillState(input), warnings: syncWarnings(input) }), [input])
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
