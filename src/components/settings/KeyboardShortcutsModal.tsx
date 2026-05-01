import { Fragment } from 'react'
import styles from './EntityEditor.module.css'
import settingsStyles from './modal-chrome.module.css'
import { formatShortcut } from '../../utils/platform'
import { getShortcutDocSections } from '../../services/keyboard-shortcuts'

interface KeyboardShortcutsModalProps {
  onClose: () => void
}

export function KeyboardShortcutsModal({ onClose }: KeyboardShortcutsModalProps) {
  const sections = getShortcutDocSections()
  return (
    <>
      <div className={styles.backdrop} onClick={onClose} />
      <div className={styles.modal}>
        <div className={styles.header}>
          <div className={styles.title}>Keyboard Shortcuts</div>
          <button className={styles.closeBtn} onClick={onClose}>&times;</button>
        </div>

        <div className={styles.list}>
          {sections.map(section => (
            <div key={section.category}>
              <div className={settingsStyles.shortcutCategory}>{section.label}</div>
              <div className={settingsStyles.shortcutGrid}>
                {section.rows.map((row, idx) => (
                  <Fragment key={`${section.category}-${idx}`}>
                    <span className={settingsStyles.shortcutKey}>{formatShortcut(row.label)}</span>
                    <span className={settingsStyles.shortcutDesc}>{row.description}</span>
                  </Fragment>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
