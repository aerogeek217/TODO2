import { Fragment } from 'react'
import settingsStyles from './modal-chrome.module.css'
import { useSettingsStore } from '../../stores/settings-store'
import { shortcutListSections } from '../../utils/shortcut-bindings'

/**
 * Every keyboard shortcut with its live keys, by category — the `?` modal
 * (`KeyboardShortcutsModal`). Settings › Keyboard shortcuts edits them
 * (`ShortcutEditor`).
 */
export function ShortcutList() {
  const overrides = useSettingsStore((s) => s.shortcutOverrides)
  const sections = shortcutListSections(overrides)
  return (
    <>
      {sections.map(section => (
        <div key={section.category}>
          <div className={settingsStyles.shortcutCategory}>{section.label}</div>
          <div className={settingsStyles.shortcutGrid}>
            {section.rows.map((row, idx) => (
              <Fragment key={row.id ?? `${section.category}-${idx}`}>
                <span className={settingsStyles.shortcutKey}>{row.label}</span>
                <span className={settingsStyles.shortcutDesc}>{row.description}</span>
              </Fragment>
            ))}
          </div>
        </div>
      ))}
    </>
  )
}
