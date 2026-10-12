import styles from './EntityEditor.module.css'
import { ShortcutList } from './ShortcutList'

interface KeyboardShortcutsModalProps {
  onClose: () => void
}

export function KeyboardShortcutsModal({ onClose }: KeyboardShortcutsModalProps) {
  return (
    <>
      <div className={styles.backdrop} onClick={onClose} />
      <div className={styles.modal}>
        <div className={styles.header}>
          <div className={styles.title}>Keyboard Shortcuts</div>
          <button className={styles.closeBtn} onClick={onClose}>&times;</button>
        </div>

        <div className={styles.list}>
          <ShortcutList />
        </div>
      </div>
    </>
  )
}
