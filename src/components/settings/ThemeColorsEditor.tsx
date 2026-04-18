import { useSettingsStore, type ThemeColors } from '../../stores/settings-store'
import { ColorInput } from '../shared/ColorInput'
import styles from './EntityEditor.module.css'
import settingsStyles from '../../views/SettingsPage.module.css'

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

interface ThemeColorsEditorProps {
  onClose: () => void
}

export function ThemeColorsEditor({ onClose }: ThemeColorsEditorProps) {
  const { colors, setColor, resetColors } = useSettingsStore()

  return (
    <>
      <div className={styles.backdrop} onClick={onClose} />
      <div className={styles.modal}>
        <div className={styles.header}>
          <div className={styles.title}>Theme Colors</div>
          <button className={styles.closeBtn} onClick={onClose}>&times;</button>
        </div>

        <div className={styles.list}>
          {(Object.keys(colorLabels) as Array<keyof ThemeColors>).map((key) => (
            <div key={key} className={settingsStyles.colorRow}>
              <span className={settingsStyles.colorLabel}>{colorLabels[key]}</span>
              <ColorInput value={colors[key]} onChange={(color) => setColor(key, color)} />
            </div>
          ))}
        </div>

        <div className={settingsStyles.buttonRow}>
          <button className={`${settingsStyles.button} ${settingsStyles.buttonSecondary}`} onClick={resetColors}>
            Reset to Defaults
          </button>
        </div>
      </div>
    </>
  )
}
