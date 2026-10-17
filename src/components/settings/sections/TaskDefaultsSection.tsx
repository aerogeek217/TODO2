import { useSettingsStore } from '../../../stores/settings-store'
import { useStatusStore } from '../../../stores/status-store'
import { FollowupIntervalSetting } from '../FollowupIntervalSetting'
import { HotRuleEditor } from '../../shared/HotRuleEditor'
import { HotIcon } from '../../shared/MarkerIcons'
import {
  URGENT_DUE_WITHIN_CHOICES,
  formatUrgentDueWithinDays,
  parseUrgentDueWithinDays,
  urgentRangeLabel,
  type UrgentDueWithinDays,
} from '../../../utils/urgency'
import { SettingRow } from './SettingRow'
import styles from './sections.module.css'

/** `Off` / `Today` / `Within 3 days` — a range choice as the select shows it. */
function urgentChoiceLabel(range: UrgentDueWithinDays): string {
  return range == null || range === 0 ? urgentRangeLabel(range) : `Within ${urgentRangeLabel(range)}`
}

/**
 * Defaults for new tasks: status, next follow-up, when a due date makes a
 * task urgent, which tasks are hot, and the first day of the week.
 */
export function TaskDefaultsSection() {
  const defaultStatusId = useSettingsStore((s) => s.defaultStatusId)
  const setDefaultStatusId = useSettingsStore((s) => s.setDefaultStatusId)
  const weekStartsOn = useSettingsStore((s) => s.weekStartsOn)
  const setWeekStartsOn = useSettingsStore((s) => s.setWeekStartsOn)
  const statuses = useStatusStore((s) => s.statuses)
  const urgentRange = useSettingsStore((s) => s.urgentDueWithinDays)
  const setUrgentRange = useSettingsStore((s) => s.setUrgentDueWithinDays)
  // A range set outside the offered choices (e.g. by an import) still shows.
  const urgentChoices = URGENT_DUE_WITHIN_CHOICES.includes(urgentRange)
    ? URGENT_DUE_WITHIN_CHOICES
    : [...URGENT_DUE_WITHIN_CHOICES, urgentRange]

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
      <SettingRow
        label="Due date makes a task urgent"
        help="Overdue tasks count too. They show a clock instead of the urgent mark."
      >
        <select
          className={styles.select}
          aria-label="Due date makes a task urgent"
          value={formatUrgentDueWithinDays(urgentRange)}
          onChange={(e) => {
            const next = parseUrgentDueWithinDays(e.target.value)
            if (next !== undefined) void setUrgentRange(next)
          }}
        >
          {urgentChoices.map((range) => (
            <option key={formatUrgentDueWithinDays(range)} value={formatUrgentDueWithinDays(range)}>
              {urgentChoiceLabel(range)}
            </option>
          ))}
        </select>
      </SettingRow>
      <SettingRow
        label={<span className={styles.labelWithIcon}><span className={styles.hotIcon}><HotIcon /></span>Hot tasks</span>}
        help="A task is hot when it matches any line. Within a line it needs everything lit."
        column
      >
        <HotRuleEditor />
      </SettingRow>
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
