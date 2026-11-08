import type { PersistedTodoItem, TodoEvent } from '../../models'
import type { TrendRange } from '../../models/glance-widgets'
import type { StatsContext } from './stats-context'
import { eventsByTask, taskReplay, type DatedEvent } from './task-history'
import { TREND_EVENT_TYPES, trendWindow, type TrendWindow } from '../../utils/trend-window'

/**
 * Created vs completed, and the open-task count over time, rebuilt from the
 * `todoEvents` history. History only covers tasks still in the database
 * (deleting or purging a task deletes its events).
 */

/** A trend range: 14 days (daily bars) or 4 / 12 weeks (weekly bars) — `TREND_RANGES`. */
export type { TrendRange }

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

/**
 * The trend over `range` for `tasks` — the tasks passing the screen filter
 * now, completed ones included. `events` must hold every created / completed
 * / reopened event since the window start (more is fine: other tasks' and
 * other types' events are ignored). Pure: one pass over the events, no
 * per-task reads.
 *
 * The open series reads each task at each day's end through
 * `task-history`'s replay — the one a Number's history reads, so the Open
 * Number's line and its sub-line's net agree.
 */
export function computeTrend(
  tasks: readonly PersistedTodoItem[],
  events: readonly TodoEvent[],
  ctx: Pick<StatsContext, 'today' | 'weekStartsOn'>,
  range: TrendRange,
): TrendStats {
  const window = trendWindow(range, ctx.today, ctx.weekStartsOn)
  const byTask = eventsByTask(events, new Set(tasks.map((t) => t.id)), TREND_EVENT_TYPES, window.start)

  const bucketOf = (day: number): number | null => {
    if (day < 0 || day >= window.days.length) return null
    return window.granularity === 'day' ? day : Math.floor(day / 7)
  }
  const buckets: TrendBucket[] = window.bucketStarts.map((start) => ({ start, createdIds: [], completedIds: [] }))

  const dayCount = window.days.length
  const series = new Array<number>(dayCount).fill(0)
  let openAtStart = 0

  for (const task of tasks) {
    const list = byTask.get(task.id)

    // Bars: created, and completions not undone by a later reopen.
    const pending: DatedEvent[] = []
    for (const e of list?.all ?? []) {
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

    // Series: the task at each day's end.
    const at = taskReplay(task, list, window.start)
    if (at(-1).state === 'open') openAtStart++
    for (let i = 0; i < dayCount; i++) {
      if (at(i).state === 'open') series[i] = (series[i] ?? 0) + 1
    }
  }

  const openSeries = series
  const created = buckets.reduce((n, b) => n + b.createdIds.length, 0)
  const completed = buckets.reduce((n, b) => n + b.completedIds.length, 0)
  const openNow = openSeries.at(-1) ?? openAtStart
  return { window, buckets, created, completed, openSeries, openAtStart, net: openNow - openAtStart }
}
