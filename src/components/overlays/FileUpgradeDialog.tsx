import type { FileUpgradeInfo } from '../../services/file-storage'
import { Dialog, DialogActions, DialogBody } from '../shared/Dialog'
import styles from './FileSyncDialogs.module.css'

interface FileUpgradeDialogProps {
  info: FileUpgradeInfo
  onConfirm: () => void
  onCancel: () => void
}

/** One-time consent before an older sync file is loaded and rewritten. */
export function FileUpgradeDialog({ info, onConfirm, onCancel }: FileUpgradeDialogProps) {
  return (
    <Dialog open onClose={onCancel} blockBackdropClose size="md" title="Upgrade sync file?">
      <DialogBody>
        {info.fileName} was saved by an older version of TODO2 (schema v{info.fromVersion}).
        To keep syncing, this version will load it and save it back in the v{info.toVersion} format.
        Older TODO2 builds won&rsquo;t be able to open the file afterwards.
        <div className={styles.note}>
          A copy of the file as it is now is saved first (Settings &rarr; Database &rarr; Backups).
          Cancel leaves the file and this browser&rsquo;s data untouched and pauses sync.
        </div>
      </DialogBody>
      <DialogActions>
        <button className={styles.cancelButton} onClick={onCancel}>
          Cancel (pause sync)
        </button>
        <button className={styles.primaryButton} onClick={onConfirm}>
          Upgrade file
        </button>
      </DialogActions>
    </Dialog>
  )
}
