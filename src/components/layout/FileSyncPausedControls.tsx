import { useState } from 'react'
import { useFileStorageStore } from '../../services/file-storage-store'
import { Dialog, DialogActions, DialogBody } from '../shared/Dialog'
import dialogStyles from '../overlays/FileSyncDialogs.module.css'

interface FileSyncPausedControlsProps {
  buttonClassName?: string
  primaryButtonClassName?: string
  /** Called when Retry or Overwrite file is pressed (the storage pill closes its popover, the phone its sheet). */
  onDone?: () => void
}

/**
 * The ways forward from a paused sync: Retry (re-run the load decision —
 * re-shows the conflict / upgrade prompt, or re-reads a fixed file) and
 * "Keep browser data…" (confirm, back the file up, overwrite it). Leaving it
 * alone keeps sync paused with both sides untouched. Shared by the storage
 * pill's popover, the phone's status sheet and Settings → File storage.
 */
export function FileSyncPausedControls({ buttonClassName, primaryButtonClassName, onDone }: FileSyncPausedControlsProps) {
  const paused = useFileStorageStore((s) => s.paused)
  const fileName = useFileStorageStore((s) => s.fileName)
  const isLoading = useFileStorageStore((s) => s.isLoading)
  const retry = useFileStorageStore((s) => s.retry)
  const overwrite = useFileStorageStore((s) => s.overwriteFileWithBrowser)
  const [confirming, setConfirming] = useState(false)

  if (!paused) return null

  return (
    <>
      <button className={buttonClassName} onClick={() => { void retry(); onDone?.() }} disabled={isLoading}>
        Retry
      </button>
      <button
        className={primaryButtonClassName ?? buttonClassName}
        onClick={() => setConfirming(true)}
        disabled={isLoading}
      >
        Keep browser data&hellip;
      </button>
      {confirming && (
        // In place: opened from the storage pill's popover, a dialog portaled out of
        // it would count as an outside click and close the popover.
        <Dialog open inline onClose={() => setConfirming(false)} size="md" title="Overwrite the sync file?">
          <DialogBody>
            Replace the contents of <strong>{fileName}</strong> with this browser&rsquo;s
            data? The file&rsquo;s current contents are saved
            as a backup first (Settings &rarr; Database &rarr; Backups), then syncing resumes.
            {paused.reason === 'too-new' && (
              <div className={dialogStyles.note}>
                The file was written by a newer version of TODO2. Overwriting it discards whatever
                that version saved &mdash; updating TODO2 instead keeps it.
              </div>
            )}
            {paused.reason === 'too-old' && (
              <div className={dialogStyles.note}>
                The file was written by an older version of TODO2 that this one can&rsquo;t read.
                Overwriting it discards what that version saved &mdash; the backup of it can only
                be restored by an older TODO2 build.
              </div>
            )}
          </DialogBody>
          <DialogActions>
            <button className={dialogStyles.cancelButton} onClick={() => setConfirming(false)}>
              Cancel
            </button>
            <button
              className={dialogStyles.dangerButton}
              onClick={() => { setConfirming(false); void overwrite(); onDone?.() }}
            >
              Overwrite file
            </button>
          </DialogActions>
        </Dialog>
      )}
    </>
  )
}
