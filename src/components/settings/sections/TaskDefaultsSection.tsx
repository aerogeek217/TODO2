import { useState } from 'react'
import { useSettingsStore } from '../../../stores/settings-store'
import { useStatusStore } from '../../../stores/status-store'
import { FollowupIntervalSetting } from '../FollowupIntervalSetting'
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
import { TODO_SORT_DIRECTIONS, isTodoGroupBy, isTodoSortBy, sortDirectionOnPick, sortHasDirection } from '../../../models/todo-sort-group'
import { STALE_AFTER_MAX_DAYS, isStaleAfterDays } from '../../../utils/stale'
import { SettingRow } from './SettingRow'
import styles from './sections.module.css'

/** `Off` / `Today` / `Within 3 days` — a range choice as the select shows it. */
function urgentChoiceLabel(range: UrgentDueWithinDays): string {
  return range == null || range === 0 ? urgentRangeLabel(range) : `Within ${urgentRangeLabel(range)}`
}

/**
 * Defaults for new tasks: status, whether they get a next follow-up and the
 * follow-up interval, when a due date makes a task urgent, when an untouched task's row fades, the first day of the week, how
 * new lists sort and group, and what a note's converted lines become.
 */
export function TaskDefaultsSection() {
  const defaultStatusId = useSettingsStore((s) => s.defaultStatusId)
  const setDefaultStatusId = useSettingsStore((s) => s.setDefaultStatusId)
  const weekStartsOn = useSettingsStore((s) => s.weekStartsOn)
  const setWeekStartsOn = useSettingsStore((s) => s.setWeekStartsOn)
  const statuses = useStatusStore((s) => s.statuses)
  const removeConvertedLines = useSettingsStore((s) => s.removeConvertedLines)
  const setRemoveConvertedLines = useSettingsStore((s) => s.setRemoveConvertedLines)
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
      <StaleAfterDaysSetting />
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
 * "Fade tasks untouched for": the days without a change after which an open
 * task's row is drawn faded (0 = never). A whole number, committed on Enter
 * / blur; anything else reverts. Each change is one undo step.
 */
function StaleAfterDaysSetting() {
  const days = useSettingsStore((s) => s.staleAfterDays)
  const setDays = useSettingsStore((s) => s.setStaleAfterDays)
  const stored = String(days)
  const [draft, setDraft] = useState(stored)
  const [syncedFrom, setSyncedFrom] = useState(stored)
  if (stored !== syncedFrom) {
    setSyncedFrom(stored)
    setDraft(stored)
  }
  const parsed = /^\d+$/.test(draft.trim()) ? Number(draft.trim()) : Number.NaN
  const valid = isStaleAfterDays(parsed)

  const commit = () => {
    if (!valid) {
      setDraft(stored)
      return
    }
    setDraft(String(parsed))
    if (parsed !== days) void setDays(parsed)
  }

  return (
    <SettingRow
      label="Fade tasks untouched for"
      help="An open task nobody has changed for this many days is drawn faded in lists; hovering it brings it back. 0 turns the fade off."
    >
      <input
        type="number"
        inputMode="numeric"
        min={0}
        max={STALE_AFTER_MAX_DAYS}
        step={1}
        className={styles.input}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          // Esc reverts a changed draft and stays in Settings; with nothing
          // to revert it reaches the modal, which closes.
          if (e.key === 'Escape' && draft !== stored) {
            e.preventDefault()
            e.stopPropagation()
            setDraft(stored)
          }
        }}
        aria-label="Fade tasks untouched for (days)"
        aria-invalid={!valid}
        style={{ width: 64, textAlign: 'right' }}
        autoComplete="off"
      />
      <span className={styles.muted}>{parsed === 0 ? 'days (off)' : parsed === 1 ? 'day' : 'days'}</span>
    </SettingRow>
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
          // A direction carries over to another sort with one, or the sort starts in its own (as in Edit list).
          onChange={(e) => { if (isTodoSortBy(e.target.value)) void setSort(e.target.value, sortDirectionOnPick(e.target.value, direction)) }}
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
