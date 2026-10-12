import { useSettingsStore } from '../../../stores/settings-store'
import { useStatusStore } from '../../../stores/status-store'
import { FollowupIntervalSetting } from '../FollowupIntervalSetting'
import { SettingRow } from './SettingRow'
import styles from './sections.module.css'

/** Defaults for new tasks: status, next follow-up, and the first day of the week. */
export function TaskDefaultsSection() {
  const defaultStatusId = useSettingsStore((s) => s.defaultStatusId)
  const setDefaultStatusId = useSettingsStore((s) => s.setDefaultStatusId)
  const weekStartsOn = useSettingsStore((s) => s.weekStartsOn)
  const setWeekStartsOn = useSettingsStore((s) => s.setWeekStartsOn)
  const statuses = useStatusStore((s) => s.statuses)

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
      <FollowupIntervalSetting
        rowClassName={styles.row}
        labelClassName={styles.labelInline}
        inputClassName={styles.input}
        hintClassName={styles.muted}
      />
      <SettingRow label="Week starts on" help="Calendars and the This Week group.">
        <select
          className={styles.select}
          aria-label="Week starts on"
          value={weekStartsOn}
          onChange={(e) => setWeekStartsOn(Number(e.target.value) === 0 ? 0 : 1)}
        >
          <option value={1}>Monday</option>
          <option value={0}>Sunday</option>
        </select>
      </SettingRow>
    </div>
  )
}
