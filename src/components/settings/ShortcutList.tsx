import { Fragment } from 'react'
import settingsStyles from './modal-chrome.module.css'
import { formatShortcut } from '../../utils/platform'
import { getShortcutDocSections } from '../../services/keyboard-shortcuts'

/**
 * Every keyboard shortcut, by category. Rendered by the `?` modal
 * (`KeyboardShortcutsModal`) and inline in Settings → Keyboard shortcuts.
 */
export function ShortcutList() {
  const sections = getShortcutDocSections()
  return (
    <>
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
    </>
  )
}
