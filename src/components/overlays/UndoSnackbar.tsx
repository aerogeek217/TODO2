import { useUndoStore } from '../../stores/undo-store'
import styles from './UndoSnackbar.module.css'
import { KEEPS_SELECTION_ATTR } from '../../utils/dom-contract'

export function UndoSnackbar() {
  const snackbar = useUndoStore((s) => s.snackbar)
  const undo = useUndoStore((s) => s.undo)
  const dismissSnackbar = useUndoStore((s) => s.dismissSnackbar)

  // The snackbar appears inside a live region that is always there, so its
  // message is announced (a region mounted with its text may not be; cr31
  // T13). The region has no box of its own; the snackbar is fixed.
  return (
    <div role="status" aria-live="polite" data-snackbar-live="">
    {snackbar && (
    <div className={styles.snackbar} {...{ [KEEPS_SELECTION_ATTR]: '' }}>
      {snackbar.detail ? (
        <span className={styles.lines}>
          <span className={styles.message}>{snackbar.description}</span>
          <span className={styles.detail} data-snackbar-detail="">{snackbar.detail}</span>
        </span>
      ) : (
        <span className={snackbar.notice ? styles.notice : styles.message}>{snackbar.description}</span>
      )}
      {snackbar.action && (
        <button
          className={styles.actionButton}
          data-snackbar-action=""
          onClick={() => {
            snackbar.action?.run()
            dismissSnackbar()
          }}
        >
          {snackbar.action.label}
        </button>
      )}
      {!snackbar.notice && (
        <button
          className={styles.undoButton}
          onClick={() => {
            undo()
            dismissSnackbar()
          }}
        >
          Undo
        </button>
      )}
      <button className={styles.dismissButton} onClick={dismissSnackbar} aria-label="Dismiss">
        &times;
      </button>
    </div>
    )}
    </div>
  )
}
