import { useId, useState, type ReactNode } from 'react'
import type { SyncConflictInfo, SyncConflictChoice } from '../../services/file-storage'
import { Dialog, DialogActions, DialogBody } from '../shared/Dialog'
import styles from './FileSyncDialogs.module.css'

interface SyncConflictDialogProps {
  info: SyncConflictInfo
  onChoose: (choice: SyncConflictChoice) => void
}

function formatTime(iso: string | null): string {
  if (!iso) return 'unknown'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString()
}

function tasks(n: number): string {
  return `${n} task${n === 1 ? '' : 's'}`
}

type Side = Exclude<SyncConflictChoice, 'cancel'>

/**
 * Asked before ANY change when the browser database and the sync file
 * disagree — the user picks which version to keep: the two sides are
 * selectable cards (radios, nothing picked at first) and the one confirm is
 * named after the pick. Nothing has been read into or written out of either
 * side yet; Cancel leaves sync paused.
 */
export function SyncConflictDialog({ info, onChoose }: SyncConflictDialogProps) {
  const { browser, file } = info
  const [picked, setPicked] = useState<Side | null>(null)
  const name = useId()
  const fileOlder = file.schemaVersion !== null && file.schemaVersion < browser.schemaVersion
  const intro = info.reason === 'browser-changes'
    ? `This browser has changes that were never saved to ${info.fileName}${
      file.changedSinceLastSync ? ', and the file was also changed elsewhere since the last sync' : ''
    }.`
    : `This browser has no record of syncing with ${info.fileName}, and the two hold different data.`
  const confirmLabel = picked === 'browser' ? 'Keep browser data'
    : picked === 'file' ? `Keep ${info.fileName}`
      : 'Pick a version'

  const card = (side: Side, title: string, lines: ReactNode) => (
    <label className={`${styles.side} ${styles.sideCard} ${picked === side ? styles.sidePicked : ''}`}>
      <span className={styles.sideHead}>
        <input
          type="radio"
          name={name}
          value={side}
          checked={picked === side}
          onChange={() => setPicked(side)}
        />
        <span className={styles.sideTitle}>{title}</span>
      </span>
      {lines}
    </label>
  )

  return (
    <Dialog
      open
      onClose={() => onChoose('cancel')}
      blockBackdropClose
      size="md"
      title="Browser data and sync file differ"
    >
      <DialogBody>
        {intro} Choose which version to keep — the other one is replaced. Nothing has changed yet.
        <div className={styles.sides} data-testid="sync-conflict-sides" role="radiogroup" aria-label="Version to keep">
          {card('browser', 'This browser', (
            <>
              <span className={styles.sideLine}>{tasks(browser.taskCount)}</span>
              <span className={styles.sideLine}>
                {browser.unsyncedSince
                  ? `Unsaved changes since ${formatTime(browser.unsyncedSince)}`
                  : 'No unsaved changes recorded'}
              </span>
              <span className={styles.sideLine}>Schema v{browser.schemaVersion}</span>
            </>
          ))}
          {card('file', info.fileName, (
            <>
              <span className={styles.sideLine}>{tasks(file.taskCount)}</span>
              <span className={styles.sideLine}>
                Saved {formatTime(file.savedAt ?? file.lastModified)}
                {file.changedSinceLastSync === false ? ' (unchanged since last sync)' : ''}
              </span>
              <span className={styles.sideLine}>
                Schema v{file.schemaVersion ?? '?'}{fileOlder ? ' (older format)' : ''}
              </span>
            </>
          ))}
        </div>
        <div className={styles.note}>
          A backup of the side being replaced is saved first (Settings → Database → Backups).
          {fileOlder ? ` Either choice saves the file in the v${browser.schemaVersion} format, which older TODO2 builds can't open.` : ''}
        </div>
      </DialogBody>
      <DialogActions>
        <button className={styles.cancelButton} onClick={() => onChoose('cancel')}>
          Cancel (pause sync)
        </button>
        <button
          className={styles.primaryButton}
          disabled={picked === null}
          onClick={() => { if (picked) onChoose(picked) }}
        >
          {confirmLabel}
        </button>
      </DialogActions>
    </Dialog>
  )
}
