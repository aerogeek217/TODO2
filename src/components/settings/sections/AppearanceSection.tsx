import { useState } from 'react'
import { useSettingsStore, type RowDates, type RowDensity, type ThemeMode } from '../../../stores/settings-store'
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

const DENSITY_OPTIONS: ReadonlyArray<{ density: RowDensity; label: string }> = [
  { density: 'comfortable', label: 'Comfortable' },
  { density: 'compact', label: 'Compact' },
]

const DATES_OPTIONS: ReadonlyArray<{ dates: RowDates; label: string }> = [
  { dates: 'relative', label: 'Relative' },
  { dates: 'numeric', label: 'MM/DD' },
]

/** Theme (the only place it is set), theme colors, the row density and how rows show dates. */
export function AppearanceSection() {
  const themeMode = useSettingsStore((s) => s.themeMode)
  const setThemeMode = useSettingsStore((s) => s.setThemeMode)
  const rowDensity = useSettingsStore((s) => s.rowDensity)
  const setRowDensity = useSettingsStore((s) => s.setRowDensity)
  const rowDates = useSettingsStore((s) => s.rowDates)
  const setRowDates = useSettingsStore((s) => s.setRowDates)
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
      <SettingRow label="Row density" help="Comfortable lets task names wrap to two lines in taller rows; Compact keeps one line per task.">
        <div className={styles.segmented} role="radiogroup" aria-label="Row density">
          {DENSITY_OPTIONS.map(({ density, label }) => (
            <button
              key={density}
              type="button"
              role="radio"
              aria-checked={rowDensity === density}
              className={`${styles.segment} ${rowDensity === density ? styles.segmentActive : ''}`}
              onClick={() => void setRowDensity(density)}
            >
              {label}
            </button>
          ))}
        </div>
      </SettingRow>
      <SettingRow label="Dates" help="How task rows show due and follow-up dates. Relative says Today, the weekday for the next six days, else Nov 20; MM/DD always says 11/20.">
        <div className={styles.segmented} role="radiogroup" aria-label="Dates">
          {DATES_OPTIONS.map(({ dates, label }) => (
            <button
              key={dates}
              type="button"
              role="radio"
              aria-checked={rowDates === dates}
              className={`${styles.segment} ${rowDates === dates ? styles.segmentActive : ''}`}
              onClick={() => void setRowDates(dates)}
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
