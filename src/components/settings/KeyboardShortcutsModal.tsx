import styles from './EntityEditor.module.css'
import settingsStyles from './modal-chrome.module.css'
import { formatShortcut } from '../../utils/platform'

interface KeyboardShortcutsModalProps {
  onClose: () => void
}

export function KeyboardShortcutsModal({ onClose }: KeyboardShortcutsModalProps) {
  const convertShortcut = formatShortcut('Alt-t')
  const boldShortcut = formatShortcut('Mod-b')
  const italicShortcut = formatShortcut('Mod-i')
  const quickAdd = formatShortcut('Mod-Space')
  const palette = formatShortcut('Mod-K')
  const undo = formatShortcut('Mod-Z')
  const redo = formatShortcut('Mod-Y')
  const selectAll = formatShortcut('Mod-A')
  return (
    <>
      <div className={styles.backdrop} onClick={onClose} />
      <div className={styles.modal}>
        <div className={styles.header}>
          <div className={styles.title}>Keyboard Shortcuts</div>
          <button className={styles.closeBtn} onClick={onClose}>&times;</button>
        </div>

        <div className={styles.list}>
          <div className={settingsStyles.shortcutCategory}>General</div>
          <div className={settingsStyles.shortcutGrid}>
            <span className={settingsStyles.shortcutKey}>{quickAdd}</span>
            <span className={settingsStyles.shortcutDesc}>Quick Add task</span>
            <span className={settingsStyles.shortcutKey}>{palette}</span>
            <span className={settingsStyles.shortcutDesc}>Command Palette</span>
            <span className={settingsStyles.shortcutKey}>{undo}</span>
            <span className={settingsStyles.shortcutDesc}>Undo</span>
            <span className={settingsStyles.shortcutKey}>{redo}</span>
            <span className={settingsStyles.shortcutDesc}>Redo</span>
            <span className={settingsStyles.shortcutKey}>Esc</span>
            <span className={settingsStyles.shortcutDesc}>Close overlay / Clear selection</span>
            <span className={settingsStyles.shortcutKey}>?</span>
            <span className={settingsStyles.shortcutDesc}>Show this help</span>
            <span className={settingsStyles.shortcutKey}>{selectAll}</span>
            <span className={settingsStyles.shortcutDesc}>Select all visible tasks</span>
          </div>

          <div className={settingsStyles.shortcutCategory}>Navigation</div>
          <div className={settingsStyles.shortcutGrid}>
            <span className={settingsStyles.shortcutKey}>Up / Down</span>
            <span className={settingsStyles.shortcutDesc}>Select previous / next task</span>
            <span className={settingsStyles.shortcutKey}>Shift+Up / Down</span>
            <span className={settingsStyles.shortcutDesc}>Extend selection</span>
            <span className={settingsStyles.shortcutKey}>Home / End</span>
            <span className={settingsStyles.shortcutDesc}>Select first / last task</span>
            <span className={settingsStyles.shortcutKey}>G then C</span>
            <span className={settingsStyles.shortcutDesc}>Go to Canvas</span>
            <span className={settingsStyles.shortcutKey}>G then L</span>
            <span className={settingsStyles.shortcutDesc}>Go to List</span>
            <span className={settingsStyles.shortcutKey}>G then A</span>
            <span className={settingsStyles.shortcutDesc}>Go to Calendar</span>
            <span className={settingsStyles.shortcutKey}>G then S</span>
            <span className={settingsStyles.shortcutDesc}>Go to Settings</span>
            <span className={settingsStyles.shortcutKey}>F</span>
            <span className={settingsStyles.shortcutDesc}>Focus filters</span>
          </div>

          <div className={settingsStyles.shortcutCategory}>Task Editing</div>
          <div className={settingsStyles.shortcutGrid}>
            <span className={settingsStyles.shortcutKey}>Enter</span>
            <span className={settingsStyles.shortcutDesc}>Edit selected task</span>
            <span className={settingsStyles.shortcutKey}>Space</span>
            <span className={settingsStyles.shortcutDesc}>Toggle complete</span>
            <span className={settingsStyles.shortcutKey}>Delete</span>
            <span className={settingsStyles.shortcutDesc}>Delete selected task(s)</span>
            <span className={settingsStyles.shortcutKey}>Insert</span>
            <span className={settingsStyles.shortcutDesc}>Create task below selected</span>
          </div>

          <div className={settingsStyles.shortcutCategory}>Notes</div>
          <div className={settingsStyles.shortcutGrid}>
            <span className={settingsStyles.shortcutKey}>{convertShortcut}</span>
            <span className={settingsStyles.shortcutDesc}>Convert current line to task</span>
            <span className={settingsStyles.shortcutKey}>{boldShortcut}</span>
            <span className={settingsStyles.shortcutDesc}>Bold</span>
            <span className={settingsStyles.shortcutKey}>{italicShortcut}</span>
            <span className={settingsStyles.shortcutDesc}>Italic</span>
          </div>
        </div>
      </div>
    </>
  )
}
