import { useState } from 'react'
import { useSettingsStore, type ThemeMode } from '../../../stores/settings-store'
import { useIsMobile } from '../../../hooks/use-is-mobile'
import { ThemeColorsEditor } from '../ThemeColorsEditor'
import { NlpSyntaxModal } from '../NlpSyntaxModal'
import { SettingRow } from './SettingRow'
import { SettingSwitch } from './SettingSwitch'
import { useStackedLayer } from './settings-layer'
import styles from './sections.module.css'

const THEME_OPTIONS: ReadonlyArray<{ mode: ThemeMode; label: string }> = [
  { mode: 'system', label: 'System' },
  { mode: 'light', label: 'Light' },
  { mode: 'dark', label: 'Dark' },
]

/**
 * Appearance › Theme: the theme (the only place it is set), its colors,
 * whether widgets show their names, the top bar's tally (desktop: the phone has no top bar), and on the phone the
 * quick-add syntax.
 */
export function ThemeSection() {
  const themeMode = useSettingsStore((s) => s.themeMode)
  const setThemeMode = useSettingsStore((s) => s.setThemeMode)
  const tallyMarks = useSettingsStore((s) => s.tallyMarks)
  const showWidgetNames = useSettingsStore((s) => s.showWidgetNames)
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
      <SettingRow label="Theme colors" help="Override accent, surface and priority colors per theme.">
        <button type="button" className={`${styles.button} ${styles.buttonSecondary}`} onClick={() => setShowThemeColors(true)}>
          Customize colors…
        </button>
      </SettingRow>
      <SettingRow label="Show widget names" help="A widget alone in its cell shows its name above it.">
        <SettingSwitch label="Show widget names" on={showWidgetNames} onFlip={() => void useSettingsStore.getState().setShowWidgetNames(!showWidgetNames)} />
      </SettingRow>
      {!isMobile && (
        <SettingRow label="Tally of today’s tasks" help="A mark in the top bar for each task you finish today, in fives. Wiped at midnight.">
          <SettingSwitch label="Tally of today’s tasks" on={tallyMarks} onFlip={() => void useSettingsStore.getState().setTallyMarks(!tallyMarks)} />
        </SettingRow>
      )}
      {/* On desktop the syntax lives with the keyboard shortcuts. */}
      {isMobile && (
        <SettingRow label="Quick-add syntax" help="People, tags and slash commands you can type into a new task.">
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
