import { useSettingsStore } from '../../../stores/settings-store'
import { useStatusStore } from '../../../stores/status-store'
import { FollowupIntervalSetting } from '../FollowupIntervalSetting'
import { SettingRow } from './SettingRow'
import styles from './sections.module.css'

/**
 * What a new task gets: its status, whether it gets a next follow-up and the
 * follow-up interval — and what a note's line made into a task becomes.
 */
export function NewTasksSection() {
  const defaultStatusId = useSettingsStore((s) => s.defaultStatusId)
  const setDefaultStatusId = useSettingsStore((s) => s.setDefaultStatusId)
  const statuses = useStatusStore((s) => s.statuses)
  const removeConvertedLines = useSettingsStore((s) => s.removeConvertedLines)
  const setRemoveConvertedLines = useSettingsStore((s) => s.setRemoveConvertedLines)

  return (
    <div className={styles.section}>
      <SettingRow label="Default status" help="Given to every new task.">
        <select
          className={styles.select}
          aria-label="Default status for new tasks"
          value={defaultStatusId ?? ''}
          onChange={(e) => setDefaultStatusId(e.target.value ? Number(e.target.value) : null)}
        >
          <option value="">None</option>
          {statuses.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </SettingRow>
      <FollowupIntervalSetting />
      <SettingRow
        label="Remove note lines after converting"
        help="A line made into a task goes from the note, without asking. Ctrl+Z in the note brings it back. Off: one converted line stays marked ✓, and converting several asks."
      >
        <button
          type="button"
          role="switch"
          aria-checked={removeConvertedLines}
          aria-label="Remove note lines after converting"
          className={`${styles.switch} ${removeConvertedLines ? styles.switchOn : ''}`}
          onClick={() => void setRemoveConvertedLines(!removeConvertedLines)}
        />
      </SettingRow>
    </div>
  )
}
