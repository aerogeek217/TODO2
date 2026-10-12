import { useState } from 'react'
import { useSettingsStore, type ThemeMode } from '../../../stores/settings-store'
import { useIsMobile } from '../../../hooks/use-is-mobile'
import { ThemeColorsEditor } from '../ThemeColorsEditor'
import { NlpSyntaxModal } from '../NlpSyntaxModal'
import { SettingRow } from './SettingRow'
import { useStackedLayer } from './settings-layer'
import styles from './sections.module.css'

const THEME_OPTIONS: ReadonlyArray<{ mode: ThemeMode; label: string }> = [
  { mode: 'system', label: 'System' },
  { mode: 'light', label: 'Light' },
  { mode: 'dark', label: 'Dark' },
]

/** Theme (the only place it is set) and theme colors. */
export function AppearanceSection() {
  const themeMode = useSettingsStore((s) => s.themeMode)
  const setThemeMode = useSettingsStore((s) => s.setThemeMode)
  const isMobile = useIsMobile()
  const [showThemeColors, setShowThemeColors] = useState(false)
  const [showNlpSyntax, setShowNlpSyntax] = useState(false)
  useStackedLayer(showThemeColors || showNlpSyntax)

  return (
    <div className={styles.section}>
      <SettingRow label="Theme" help="System follows your OS setting.">
        <div className={styles.segmented} role="radiogroup" aria-label="Theme">
          {THEME_OPTIONS.map(({ mode, label }) => (
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={themeMode === mode}
              className={`${styles.segment} ${themeMode === mode ? styles.segmentActive : ''}`}
              onClick={() => setThemeMode(mode)}
            >
              {label}
            </button>
          ))}
        </div>
      </SettingRow>
      <SettingRow label="Theme colors" help="Override accent and surface colors per theme.">
        <button type="button" className={`${styles.button} ${styles.buttonSecondary}`} onClick={() => setShowThemeColors(true)}>
          Customize colors…
        </button>
      </SettingRow>
      {/* On desktop the syntax lives with the keyboard shortcuts. */}
      {isMobile && (
        <SettingRow label="Quick-add syntax" help="People, tags and other details you can type into a new task.">
          <button type="button" className={`${styles.button} ${styles.buttonSecondary}`} onClick={() => setShowNlpSyntax(true)}>
            Show syntax…
          </button>
        </SettingRow>
      )}

      {showThemeColors && <ThemeColorsEditor onClose={() => setShowThemeColors(false)} />}
      {showNlpSyntax && <NlpSyntaxModal onClose={() => setShowNlpSyntax(false)} />}
    </div>
  )
}
