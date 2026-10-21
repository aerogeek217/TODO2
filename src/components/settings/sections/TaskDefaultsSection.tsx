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
import {
  GROUP_LABEL,
  LIST_GROUP_CHOICES,
  LIST_SORT_CHOICES,
  SORT_LABEL,
  choicesWith,
  sortOrderWords,
} from '../../../utils/list-options'
import { TODO_SORT_DIRECTIONS, isTodoGroupBy, isTodoSortBy, sortHasDirection } from '../../../models/todo-sort-group'
import { SettingRow } from './SettingRow'
import styles from './sections.module.css'

/** `Off` / `Today` / `Within 3 days` — a range choice as the select shows it. */
function urgentChoiceLabel(range: UrgentDueWithinDays): string {
  return range == null || range === 0 ? urgentRangeLabel(range) : `Within ${urgentRangeLabel(range)}`
}

/**
 * Defaults for new tasks: status, whether they get a next follow-up and the
 * follow-up interval, when a due date makes a task urgent, which tasks are
 * hot, the first day of the week, and how new lists sort and group.
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
      <FollowupIntervalSetting />
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
      <NewListDefaults />
    </div>
  )
}

/**
 * What a new blank list (adding a List widget, or a tab switched to List)
 * starts sorted (and which way, for a sort with a direction) and grouped by.
 * Each change is one undo step.
 */
function NewListDefaults() {
  const sort = useSettingsStore((s) => s.newListSort)
  const direction = useSettingsStore((s) => s.newListSortDirection)
  const group = useSettingsStore((s) => s.newListGroup)
  const setSort = useSettingsStore((s) => s.setNewListSort)
  const setGroup = useSettingsStore((s) => s.setNewListGroup)
  return (
    <>
      <SettingRow label="New lists sort by" help="A list you create starts sorted this way. Edit list changes its own.">
        <select
          className={styles.select}
          aria-label="New lists sort by"
          value={sort}
          // A direction carries over to another sort with one (as in Edit list).
          onChange={(e) => { if (isTodoSortBy(e.target.value)) void setSort(e.target.value, direction) }}
        >
          {choicesWith(LIST_SORT_CHOICES, sort).map((choice) => (
            <option key={choice} value={choice}>{SORT_LABEL[choice]}</option>
          ))}
        </select>
        {sortHasDirection(sort) && (
          <select
            className={styles.select}
            aria-label="New lists sort order"
            value={direction}
            onChange={(e) => void setSort(sort, e.target.value === 'desc' ? 'desc' : 'asc')}
          >
            {TODO_SORT_DIRECTIONS.map((dir) => (
              <option key={dir} value={dir}>{sortOrderWords(sort, dir)}</option>
            ))}
          </select>
        )}
      </SettingRow>
      <SettingRow label="New lists group by" help="A list you create starts grouped this way.">
        <select
          className={styles.select}
          aria-label="New lists group by"
          value={group}
          onChange={(e) => { if (isTodoGroupBy(e.target.value)) void setGroup(e.target.value) }}
        >
          {choicesWith(LIST_GROUP_CHOICES, group).map((choice) => (
            <option key={choice} value={choice}>{GROUP_LABEL[choice]}</option>
          ))}
        </select>
      </SettingRow>
    </>
  )
}
