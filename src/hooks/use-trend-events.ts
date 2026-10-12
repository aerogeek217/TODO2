import { useEffect } from 'react'
import { todoEventRepository } from '../data/todo-event-repository'
import type { TodoEvent } from '../models'
import type { TrendRange } from '../services/stats/trend'
import { useSettingsStore } from '../stores/settings-store'
import { trendEventsKey, useTrendEventsStore } from '../stores/trend-events-store'
import { useToday } from './use-today'

/**
 * The history events `computeTrend` needs for `range`, ending today: read
 * once per (range, day) through `trend-events-store`, and read again after
 * any event write (Dexie hook) while mounted. `null` until the first read
 * lands; afterwards the last read stays on show while a re-read runs.
 */
export function useTrendEvents(range: TrendRange): readonly TodoEvent[] | null {
  const today = useToday()
  const weekStartsOn = useSettingsStore((s) => s.weekStartsOn)
  const key = trendEventsKey(range, today, weekStartsOn)
  const entry = useTrendEventsStore((s) => s.entries.get(key))

  useEffect(() => todoEventRepository.onChange(() => useTrendEventsStore.getState().invalidate()), [])

  const needsLoad = entry == null || (entry.stale && !entry.loading)
  useEffect(() => {
    if (needsLoad) void useTrendEventsStore.getState().load(range, today, weekStartsOn)
  }, [needsLoad, range, today, weekStartsOn])

  return entry?.events ?? null
}
