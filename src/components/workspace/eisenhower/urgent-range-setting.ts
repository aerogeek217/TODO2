import { useSettingsStore } from '../../../stores/settings-store'
import { useToday } from '../../../hooks/use-today'
import { formatFollowupDay } from '../../../utils/followup'
import {
  URGENT_DUE_WITHIN_CHOICES,
  urgentRangeLabel,
  type UrgentDueWithinDays,
} from '../../../utils/urgency'
import type { WidgetSetting } from '../../shared/WidgetKindMenu'

/** The setting's name, as Settings › Tasks words it. */
export const URGENT_RANGE_SETTING_LABEL = 'Due date makes a task urgent'

/** `only the flag counts` / `Sat 10` / `by Tue 13` — what a range means from `today`. */
export function urgentRangeNote(range: UrgentDueWithinDays, today: Date): string {
  if (range == null) return 'only the flag counts'
  const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() + range)
  return range === 0 ? formatFollowupDay(day, today) : `by ${formatFollowupDay(day, today)}`
}

/**
 * The app-wide "Due date makes a task urgent" range as a widget setting (the
 * Eisenhower tab menu's submenu, the phone's tab sheet). Picking a value saves
 * it at once; it never marks the layout unsaved.
 */
export function useUrgentRangeSetting(): WidgetSetting {
  const range = useSettingsStore((s) => s.urgentDueWithinDays)
  const today = useToday()
  // A range set outside the offered choices (e.g. by an import) still shows.
  const choices = URGENT_DUE_WITHIN_CHOICES.includes(range) ? URGENT_DUE_WITHIN_CHOICES : [...URGENT_DUE_WITHIN_CHOICES, range]
  return {
    label: URGENT_RANGE_SETTING_LABEL,
    value: urgentRangeLabel(range),
    heading: URGENT_RANGE_SETTING_LABEL,
    options: choices.map((r) => ({
      key: r == null ? 'off' : String(r),
      label: urgentRangeLabel(r),
      note: urgentRangeNote(r, today),
      checked: r === range,
      onSelect: () => { void useSettingsStore.getState().setUrgentDueWithinDays(r) },
    })),
    footnote: 'Overdue tasks count too. One setting for the whole app; also in Settings › Tasks.',
  }
}
