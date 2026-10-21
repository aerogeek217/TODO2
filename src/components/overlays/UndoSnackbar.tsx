import { useUndoStore } from '../../stores/undo-store'
import styles from './UndoSnackbar.module.css'
import { KEEPS_SELECTION_ATTR } from '../../utils/dom-contract'

export function UndoSnackbar() {
  const snackbar = useUndoStore((s) => s.snackbar)
  const undo = useUndoStore((s) => s.undo)
  const dismissSnackbar = useUndoStore((s) => s.dismissSnackbar)

  if (!snackbar) return null

  return (
    <div className={styles.snackbar} {...{ [KEEPS_SELECTION_ATTR]: '' }}>
      {snackbar.detail ? (
        <span className={styles.lines}>
          <span className={styles.message}>{snackbar.description}</span>
          <span className={styles.detail} data-snackbar-detail="">{snackbar.detail}</span>
        </span>
      ) : (
        <span className={snackbar.notice ? styles.notice : styles.message}>{snackbar.description}</span>
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
  )
}
