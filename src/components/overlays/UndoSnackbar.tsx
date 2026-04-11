import { useUndoStore } from '../../stores/undo-store'
import styles from './UndoSnackbar.module.css'

export function UndoSnackbar() {
  const snackbar = useUndoStore((s) => s.snackbar)
  const { undo, dismissSnackbar } = useUndoStore()

  if (!snackbar) return null

  return (
    <div className={styles.snackbar}>
      <span className={styles.message}>{snackbar.description}</span>
      <button
        className={styles.undoButton}
        onClick={() => {
          undo()
          dismissSnackbar()
        }}
      >
        Undo
      </button>
      <button className={styles.dismissButton} onClick={dismissSnackbar}>
        &times;
      </button>
    </div>
  )
}
