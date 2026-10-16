import styles from './EntityEditor.module.css'
import { EditorModal } from './EditorModal'
import { ShortcutList } from './ShortcutList'

interface KeyboardShortcutsModalProps {
  onClose: () => void
}

export function KeyboardShortcutsModal({ onClose }: KeyboardShortcutsModalProps) {
  return (
    <EditorModal title="Keyboard Shortcuts" onClose={onClose}>
      <div className={styles.list}>
        <ShortcutList />
      </div>
    </EditorModal>
  )
}
