import { useSyncWarning } from './sync-status'
import { SyncWarningActions, SyncWarningMessage } from './SyncWarningContent'
import styles from './FileSyncBanner.module.css'

/**
 * The full-width sync warning strip under the top bar: permission needed,
 * sync paused, a file-storage error, or a backup snapshot that failed its
 * self-check. These block syncing, so they stay loud; everyday storage
 * status lives in the top bar's storage pill.
 */
export function FileSyncBanner() {
  const warning = useSyncWarning()
  if (!warning) return null
  return (
    <div className={styles.strip} role="alert" data-testid={warning.kind === 'paused' ? 'file-sync-paused' : undefined}>
      <svg className={styles.icon} width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M8 2.2 14.3 13H1.7z" />
        <path d="M8 6.4v3M8 11.2h.01" />
      </svg>
      <span className={styles.message}><SyncWarningMessage warning={warning} /></span>
      <span className={styles.actions}><SyncWarningActions warning={warning} /></span>
    </div>
  )
}
