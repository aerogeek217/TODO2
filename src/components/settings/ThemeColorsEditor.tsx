import { useState } from 'react'
import { useSettingsStore, type ThemeColors, type ThemeName } from '../../stores/settings-store'
import { useResolvedTheme } from '../../hooks/use-resolved-theme'
import { ColorInput } from '../shared/ColorInput'
import styles from './EntityEditor.module.css'
import settingsStyles from './modal-chrome.module.css'
import editorStyles from './ThemeColorsEditor.module.css'

const colorLabels: Record<keyof ThemeColors, string> = {
  accent: 'Accent',
  canvasBg: 'Canvas Background',
  surface: 'Surface',
  danger: 'Danger accent',
  warning: 'Warning accent',
  star: 'Follow up',
  scheduled: 'Scheduled date',
  deadline: 'Deadline date',
}

const themeLabel: Record<ThemeName, string> = { dark: 'Dark', light: 'Light' }

interface ThemeColorsEditorProps {
  onClose: () => void
}

export function ThemeColorsEditor({ onClose }: ThemeColorsEditorProps) {
  const { colors, setColor, resetColors } = useSettingsStore()
  // Editor binds to the resolved theme on mount; the Light/Dark toggle below
  // only switches which `colors[theme]` bag the inputs read/write — it does
  // not change the user's actual theme preference (that lives in
  // SettingsPage's theme-mode control).
  const resolvedTheme = useResolvedTheme()
  const [workingTheme, setWorkingTheme] = useState<ThemeName>(resolvedTheme)
  const workingColors = colors[workingTheme]

  return (
    <>
      <div className={styles.backdrop} onClick={onClose} />
      <div className={styles.modal}>
        <div className={styles.header}>
          <div className={styles.title}>Theme Colors — {themeLabel[workingTheme]}</div>
          <button className={styles.closeBtn} onClick={onClose}>&times;</button>
        </div>

        <div className={editorStyles.themeToggle} role="tablist" aria-label="Working theme">
          {(['dark', 'light'] as const).map((theme) => (
            <button
              key={theme}
              type="button"
              role="tab"
              aria-selected={workingTheme === theme}
              className={`${editorStyles.themeToggleBtn} ${workingTheme === theme ? editorStyles.themeToggleBtnActive : ''}`}
              onClick={() => setWorkingTheme(theme)}
            >
              {themeLabel[theme]}
            </button>
          ))}
        </div>

        <div className={styles.list}>
          {(Object.keys(colorLabels) as Array<keyof ThemeColors>).map((key) => (
            <div key={key} className={settingsStyles.colorRow}>
              <span className={settingsStyles.colorLabel}>{colorLabels[key]}</span>
              <ColorInput value={workingColors[key]} onChange={(color) => setColor(workingTheme, key, color)} />
            </div>
          ))}
        </div>

        <div className={settingsStyles.buttonRow}>
          <button className={`${settingsStyles.button} ${settingsStyles.buttonSecondary}`} onClick={() => resetColors(workingTheme)}>
            Reset {themeLabel[workingTheme]} to Defaults
          </button>
        </div>
      </div>
    </>
  )
}
