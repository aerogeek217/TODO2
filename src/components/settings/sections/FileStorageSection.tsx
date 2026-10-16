import { useFileStorageStore } from '../../../services/file-storage-store'
import { useIsMobile } from '../../../hooks/use-is-mobile'
import { FileSyncPausedControls } from '../../layout/FileSyncPausedControls'
import { SettingRow } from './SettingRow'
import styles from './sections.module.css'

/**
 * The sync file: attach / create one, or — once attached — its state
 * (syncing, permission needed, paused) and the ways forward.
 */
export function FileStorageSection() {
  const fileStorage = useFileStorageStore()
  const isMobile = useIsMobile()
  const secondary = `${styles.button} ${styles.buttonSecondary}`
  const primary = `${styles.button} ${styles.buttonPrimary}`

  let body
  if (!fileStorage.isSupported) {
    body = (
      <SettingRow label="Sync file">
        <span className={styles.muted}>
          {isMobile
            ? 'File sync is not supported on this browser. Use Import / Export instead.'
            : 'File sync requires Chrome or Edge (File System Access API). Use Import / Export to keep a backup.'}
        </span>
      </SettingRow>
    )
  } else if (fileStorage.needsPermission) {
    body = (
      <SettingRow label="Sync file" help="Permission needed to sync to this file." column>
        <span className={styles.fileName}>{fileStorage.fileName}</span>
        <button type="button" className={primary} onClick={fileStorage.reconnect} disabled={fileStorage.isLoading}>
          Grant Access
        </button>
      </SettingRow>
    )
  } else if (fileStorage.paused) {
    body = (
      <SettingRow label="Sync file" help={fileStorage.paused.message} column>
        <span className={styles.fileName}>{fileStorage.fileName}</span>
        <div className={styles.buttonRow}>
          <FileSyncPausedControls buttonClassName={secondary} primaryButtonClassName={primary} />
          <button type="button" className={secondary} onClick={fileStorage.disconnect} disabled={fileStorage.isLoading}>
            Disconnect
          </button>
        </div>
      </SettingRow>
    )
  } else if (fileStorage.isConnected) {
    body = (
      <SettingRow
        label="Sync file"
        help={fileStorage.lastSavedAt ? `Last saved ${fileStorage.lastSavedAt.toLocaleTimeString()}` : 'Every change is written to the file a moment after you make it.'}
        column
      >
        <span className={styles.fileName}>{fileStorage.fileName}</span>
        <button type="button" className={secondary} onClick={fileStorage.openFile} disabled={fileStorage.isLoading}>
          Attach to Different File
        </button>
      </SettingRow>
    )
  } else {
    body = (
      <SettingRow
        label="Sync file"
        help={(
          <>
            Your tasks live in this browser’s storage. Attach a file to keep a copy you can back up or move to another machine.
            <br />
            An existing file you replace is emptied by the browser before TODO2 can back it up.
          </>
        )}
      >
        <button type="button" className={primary} onClick={fileStorage.openFile} disabled={fileStorage.isLoading}>
          Attach to File
        </button>
        <button type="button" className={secondary} onClick={fileStorage.createFile} disabled={fileStorage.isLoading}>
          Create New File
        </button>
      </SettingRow>
    )
  }

  return (
    <div className={styles.section}>
      {body}
      {fileStorage.error && <div className={styles.errorMsg}>{fileStorage.error}</div>}
    </div>
  )
}
