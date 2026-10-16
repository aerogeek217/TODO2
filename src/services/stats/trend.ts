import type { PersistedTodoItem, TodoEvent, TodoEventType } from '../../models'
import { DASHBOARD_TREND_RANGES, type DashboardTrendRange } from '../../models/dashboard-config'
import { daysUntil } from '../../utils/effective-date'
import type { StatsContext } from './stats-context'
import { TREND_EVENT_TYPES, trendWindow, type TrendWindow } from '../../utils/trend-window'

/**
 * Created vs completed, and the open-task count over time, rebuilt from the
 * `todoEvents` history. History only covers tasks still in the database
 * (deleting or purging a task deletes its events).
 */

/** The trend ranges: 14 days (daily bars) or 4 / 12 weeks (weekly bars). */
export const TREND_RANGES = DASHBOARD_TREND_RANGES
export type TrendRange = DashboardTrendRange

export interface TrendBucket {
  /** First day of the bar (local midnight). */
  start: Date
  /** Tasks created in the bar's days. */
  createdIds: number[]
  /**
   * Tasks completed in the bar's days, net of reopening: a completion that a
   * later `reopened` undid doesn't count.
   */
  completedIds: number[]
}

export interface TrendStats {
  window: TrendWindow
  buckets: TrendBucket[]
  /** Created in the whole window. */
  created: number
  /** Completed (net of reopened) in the whole window. */
  completed: number
  /** Open tasks at the end of each of `window.days` (today: now). */
  openSeries: number[]
  /** Open tasks when the window started. */
  openAtStart: number
  /** Open now minus open at the start (created − completed + reopened). */
  net: number
}

type TaskState = 'absent' | 'open' | 'done'

/** A task's state just before an event of `type`. */
function stateBefore(type: TodoEventType): TaskState {
  if (type === 'created') return 'absent'
  return type === 'completed' ? 'open' : 'done'
}

interface DatedEvent {
  type: TodoEventType
  /** Calendar days from the window start (negative = before it). */
  day: number
  time: number
  id: number
}

/**
 * The trend over `range` for `tasks` — the tasks passing the screen filter
 * now, completed ones included. `events` must hold every created / completed
 * / reopened event since the window start (more is fine: other tasks' and
 * other types' events are ignored). Pure: one pass over the events, no
 * per-task reads.
 *
 * The open series runs backwards from each task's current state: at any
 * moment a task is in the state it was in just before its next event
 * (before `created` = not there yet, before `completed` = open, before
 * `reopened` = done), or in its current state when no event follows.
 */
export function computeTrend(
  tasks: readonly PersistedTodoItem[],
  events: readonly TodoEvent[],
  ctx: Pick<StatsContext, 'today' | 'weekStartsOn'>,
  range: TrendRange,
): TrendStats {
  const window = trendWindow(range, ctx.today, ctx.weekStartsOn)
  const byId = new Map(tasks.map((t) => [t.id, t]))
  const types = new Set(TREND_EVENT_TYPES)

  const perTask = new Map<number, DatedEvent[]>()
  for (const e of events) {
    if (!byId.has(e.todoId) || !types.has(e.type)) continue
    const at = new Date(e.timestamp)
    const time = at.getTime()
    if (Number.isNaN(time)) continue
    const list = perTask.get(e.todoId) ?? []
    list.push({ type: e.type, day: daysUntil(at, window.start) ?? 0, time, id: e.id ?? 0 })
    perTask.set(e.todoId, list)
  }

  const bucketOf = (day: number): number | null => {
    if (day < 0 || day >= window.days.length) return null
    return window.granularity === 'day' ? day : Math.floor(day / 7)
  }
  const buckets: TrendBucket[] = window.bucketStarts.map((start) => ({ start, createdIds: [], completedIds: [] }))

  const dayCount = window.days.length
  // A task without events keeps its current state across the whole window.
  let constantOpen = 0
  const series = new Array<number>(dayCount).fill(0)
  let openAtStart = 0

  for (const task of tasks) {
    const list = perTask.get(task.id)
    const current: TaskState = task.isCompleted ? 'done' : 'open'
    if (!list) {
      if (current === 'open') constantOpen++
      continue
    }
    list.sort((a, b) => a.time - b.time || a.id - b.id)

    // Bars: created, and completions not undone by a later reopen.
    const pending: DatedEvent[] = []
    for (const e of list) {
      if (e.type === 'created') {
        const b = bucketOf(e.day)
        if (b != null) buckets[b]?.createdIds.push(task.id)
      } else if (e.type === 'completed') {
        pending.push(e)
      } else {
        pending.pop()
      }
    }
    for (const e of pending) {
      const b = bucketOf(e.day)
      if (b != null) buckets[b]?.completedIds.push(task.id)
    }

    // Series: the state at a moment is the state before the next event.
    const stateAfterDay = (lastDay: number): TaskState => {
      const next = list.find((e) => e.day > lastDay)
      return next ? stateBefore(next.type) : current
    }
    if (stateAfterDay(-1) === 'open') openAtStart++
    for (let i = 0; i < dayCount; i++) {
      if (stateAfterDay(i) === 'open') series[i] = (series[i] ?? 0) + 1
    }
  }

  const openSeries = series.map((n) => n + constantOpen)
  openAtStart += constantOpen
  const created = buckets.reduce((n, b) => n + b.createdIds.length, 0)
  const completed = buckets.reduce((n, b) => n + b.completedIds.length, 0)
  const openNow = openSeries.at(-1) ?? openAtStart
  return { window, buckets, created, completed, openSeries, openAtStart, net: openNow - openAtStart }
}
