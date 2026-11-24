import { useEffect, useMemo } from 'react'
import { computeWeekLoad, type WeekLoad } from '../services/stats/week-load'
import { useSettingsStore } from '../stores/settings-store'
import { useStatusUpdateStore } from '../stores/status-update-store'
import { useTodoStore } from '../stores/todo-store'
import { useToday } from './use-today'
import { useTrendEvents } from './use-trend-events'

/**
 * The week load (`services/stats/week-load`) over every task — the screen
 * filter is never applied, so it means the whole workload whatever filter
 * is on. Its events come through `trend-events-store`'s `week-load` window
 * (from this week's start, 8 weeks back); the status updates from their
 * store (loaded here if nothing has yet). Memoized on the tasks, the
 * events, the status updates, the day, the first day of the week and the
 * two log stamps. `null` until the first read of the events lands.
 */
export function useWeekLoad(): WeekLoad | null {
  const today = useToday()
  const tasks = useTodoStore((s) => s.todos)
  const events = useTrendEvents('week-load')
  const statusUpdates = useStatusUpdateStore((s) => s.byTodo)
  const weekStartsOn = useSettingsStore((s) => s.weekStartsOn)
  const planLogSince = useSettingsStore((s) => s.planLogSince)
  const historyLogSince = useSettingsStore((s) => s.historyLogSince)

  useEffect(() => {
    void useStatusUpdateStore.getState().ensureLoaded()
  }, [])

  return useMemo(() => {
    if (!events) return null
    // Today's split reads the moment; a new day (`today`) recomputes it.
    const now = new Date()
    return computeWeekLoad({
      tasks, events, statusUpdates, weekStartsOn, planLogSince, historyLogSince,
      now: now.getTime() < today.getTime() ? today : now,
    })
  }, [tasks, events, statusUpdates, today, weekStartsOn, planLogSince, historyLogSince])
}
