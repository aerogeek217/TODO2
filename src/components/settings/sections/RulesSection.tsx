import { useState } from 'react'
import { useSettingsStore } from '../../../stores/settings-store'
import {
  URGENT_DUE_WITHIN_CHOICES,
  formatUrgentDueWithinDays,
  parseUrgentDueWithinDays,
  urgentRangeLabel,
  type UrgentDueWithinDays,
} from '../../../utils/urgency'
import { STALE_AFTER_MAX_DAYS, isStaleAfterDays } from '../../../utils/stale'
import { formatTabBadgeRange, parseTabBadgeRange, TAB_BADGE_CHOICES, tabBadgeRangeLabel } from '../../../utils/tab-badges'
import type { TabBadgeRange } from '../../../models/list-definition'
import { SettingRow } from './SettingRow'
import styles from './sections.module.css'

/** `Off` / `Today` / `Within 3 days` — a range choice as the select shows it. */
function urgentChoiceLabel(range: UrgentDueWithinDays): string {
  return range == null || range === 0 ? urgentRangeLabel(range) : `Within ${urgentRangeLabel(range)}`
}

/** A tab badge range's select; a range set outside the offered choices (e.g. by an import) still shows. */
function TabBadgeRangeSelect({ label, value, onChange }: { label: string; value: TabBadgeRange; onChange: (next: TabBadgeRange) => void }) {
  const choices = TAB_BADGE_CHOICES.includes(value) ? TAB_BADGE_CHOICES : [...TAB_BADGE_CHOICES, value]
  return (
    <select
      className={styles.select}
      aria-label={label}
      value={formatTabBadgeRange(value)}
      onChange={(e) => {
        const next = parseTabBadgeRange(e.target.value)
        if (next !== undefined) onChange(next)
      }}
    >
      {choices.map((range) => (
        <option key={formatTabBadgeRange(range)} value={formatTabBadgeRange(range)}>{tabBadgeRangeLabel(range)}</option>
      ))}
    </select>
  )
}

/**
 * Tasks › Rules: what things mean — when a due date makes a task urgent, when
 * an untouched task is stale, the tab badges' ranges and the first day of the
 * week. How a stale or priority task looks is Appearance › Task rows.
 */
export function RulesSection() {
  const weekStartsOn = useSettingsStore((s) => s.weekStartsOn)
  const setWeekStartsOn = useSettingsStore((s) => s.setWeekStartsOn)
  const urgentRange = useSettingsStore((s) => s.urgentDueWithinDays)
  const setUrgentRange = useSettingsStore((s) => s.setUrgentDueWithinDays)
  const tabBadges = useSettingsStore((s) => s.tabBadges)
  const setTabBadges = useSettingsStore((s) => s.setTabBadges)
  // A range set outside the offered choices (e.g. by an import) still shows.
  const urgentChoices = URGENT_DUE_WITHIN_CHOICES.includes(urgentRange)
    ? URGENT_DUE_WITHIN_CHOICES
    : [...URGENT_DUE_WITHIN_CHOICES, urgentRange]

  return (
    <div className={styles.section}>
      <SettingRow
        label="Due date makes a task urgent"
        help="Overdue tasks count too. A task urgent by its due date gets a dashed ring."
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
      <SettingRow
        label="Tab badges"
        help="A list's tab counts its open tasks due, and due for a follow-up, in these ranges. Edit list can change them for one list."
        column
      >
        <span className={styles.subControl}>
          <span className={styles.subLabel} aria-hidden="true">Due</span>
          <TabBadgeRangeSelect label="Tab badges: due" value={tabBadges.due} onChange={(due) => void setTabBadges({ ...tabBadges, due })} />
        </span>
        <span className={styles.subControl}>
          <span className={styles.subLabel} aria-hidden="true">Follow-up</span>
          <TabBadgeRangeSelect label="Tab badges: follow-up" value={tabBadges.followup} onChange={(followup) => void setTabBadges({ ...tabBadges, followup })} />
        </span>
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

/**
 * "Stale after": the days without a change after which an open task is stale
 * (0 = never) — faded and cobwebbed per Appearance › Task rows. A whole
 * number, committed on Enter
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
      label="Stale after"
      help="An open task nobody has changed for this many days is stale: Appearance › Task rows fades it and puts a cobweb in its checkbox. 0: nothing goes stale."
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
        aria-label="Stale after (days)"
        aria-invalid={!valid}
        style={{ width: 64, textAlign: 'right' }}
        autoComplete="off"
      />
      <span className={styles.muted}>{parsed === 0 ? 'days (never)' : parsed === 1 ? 'day' : 'days'}</span>
    </SettingRow>
  )
}
