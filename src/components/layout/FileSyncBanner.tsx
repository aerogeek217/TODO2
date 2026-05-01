import { useState, useCallback } from 'react'
import { useFileStorageStore } from '../../stores/file-storage-store'
import styles from './FileSyncBanner.module.css'

const DISMISSED_KEY = 'todo2-file-sync-banner-dismissed'

export function FileSyncBanner() {
  const { isConnected, isSupported, needsPermission, reconnect, fileName, error } = useFileStorageStore()
  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem(DISMISSED_KEY) === '1',
  )
  const [errorDismissed, setErrorDismissed] = useState<string | null>(null)

  const handleDismiss = useCallback(() => {
    localStorage.setItem(DISMISSED_KEY, '1')
    setDismissed(true)
  }, [])

  // Always show when permission is needed (even if previously dismissed)
  if (needsPermission) {
    return (
      <div className={`${styles.banner} ${styles.bannerWarning}`}>
        <span className={styles.message}>
          File sync to <strong>{fileName}</strong> is paused &mdash; permission needed.
        </span>
        <button className={styles.grantAccess} onClick={reconnect}>
          Grant Access
        </button>
      </div>
    )
  }

  // Surface file-storage errors (e.g. failed pre-import snapshot, parse
  // failures, write failures) so they don't sit invisibly in the store.
  if (error && error !== errorDismissed) {
    return (
      <div className={`${styles.banner} ${styles.bannerWarning}`}>
        <span className={styles.message}>{error}</span>
        <button className={styles.dismiss} onClick={() => setErrorDismissed(error)} title="Dismiss">
          &times;
        </button>
      </div>
    )
  }

  if (!isSupported || isConnected || dismissed) return null

  return (
    <div className={styles.banner}>
      <span className={styles.message}>
        Your data is stored locally in this browser. To back up to a file,
        go to <strong>Settings &rarr; File Storage</strong>.
      </span>
      <button className={styles.dismiss} onClick={handleDismiss} title="Dismiss">
        &times;
      </button>
    </div>
  )
}
