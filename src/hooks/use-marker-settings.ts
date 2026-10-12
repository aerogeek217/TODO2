import { useMemo } from 'react'
import { useSettingsStore } from '../stores/settings-store'
import type { MarkerSettings } from '../utils/markers'

/**
 * The settings a Markers filter is evaluated with (urgent range, Hot rule),
 * subscribed: pass it to the filter evaluators from a memo so a change in
 * Settings re-filters at once.
 */
export function useMarkerSettings(): MarkerSettings {
  const urgentRange = useSettingsStore((s) => s.urgentDueWithinDays)
  const hotRule = useSettingsStore((s) => s.hotRule)
  return useMemo(() => ({ urgentRange, hotRule }), [urgentRange, hotRule])
}
