import { useMemo } from 'react'
import { useSettingsStore } from '../stores/settings-store'
import type { FilterSettings } from '../utils/filter-match'

/**
 * The settings a filter is evaluated with (urgent range, Hot rule, week
 * start), subscribed: pass it to the filter evaluators from a memo so a
 * change in Settings re-filters at once.
 */
export function useFilterSettings(): FilterSettings {
  const urgentRange = useSettingsStore((s) => s.urgentDueWithinDays)
  const hotRule = useSettingsStore((s) => s.hotRule)
  const weekStartsOn = useSettingsStore((s) => s.weekStartsOn)
  return useMemo(() => ({ urgentRange, hotRule, weekStartsOn }), [urgentRange, hotRule, weekStartsOn])
}
