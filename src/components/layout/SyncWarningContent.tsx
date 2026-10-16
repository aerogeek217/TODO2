import { useFileStorageStore } from '../../services/file-storage-store'
import { useFileOpsStore } from '../../stores/file-ops-store'
import { FileSyncPausedControls } from './FileSyncPausedControls'
import type { SyncWarning } from './sync-status'
import styles from './FileSyncBanner.module.css'

/** A sync warning's message in words. */
export function SyncWarningMessage({ warning }: { warning: SyncWarning }) {
  if (warning.kind === 'permission') {
    return <>File sync to <strong>{warning.fileName}</strong> is paused &mdash; permission needed.</>
  }
  return <>{warning.message}</>
}

/**
 * The ways forward from a sync warning: Grant access, Retry / Keep browser
 * data…, or dismiss (× on the strip, a Dismiss button elsewhere). Shared by
 * the warning strip and the storage pill's popover.
 */
export function SyncWarningActions({ warning, dismissAsText = false }: { warning: SyncWarning; dismissAsText?: boolean }) {
  const reconnect = useFileStorageStore((s) => s.reconnect)
  const dismissError = useFileStorageStore((s) => s.dismissError)
  const dismissSnapshotWarning = useFileOpsStore((s) => s.dismissSnapshotWarning)

  switch (warning.kind) {
    case 'permission':
      return <button type="button" className={styles.primary} onClick={() => { void reconnect() }}>Grant access</button>
    case 'paused':
      return <FileSyncPausedControls buttonClassName={styles.ghost} primaryButtonClassName={styles.primary} />
    case 'error':
    case 'snapshot': {
      const onDismiss = warning.kind === 'error' ? dismissError : dismissSnapshotWarning
      return dismissAsText
        ? <button type="button" className={styles.ghost} onClick={onDismiss}>Dismiss</button>
        : (
          <button type="button" className={styles.dismiss} onClick={onDismiss} aria-label="Dismiss" title="Dismiss">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        )
    }
  }
}
