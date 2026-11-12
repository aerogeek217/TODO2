import type { PersistedTodoItem, TodoEvent } from '../../models'
import type { TrendRange } from '../../models/glance-widgets'
import type { StatsContext } from './stats-context'
import { eventsByTask, taskAsOf, taskFieldReplay, taskReplay, type DatedEvent, type TaskFields } from './task-history'
import { addDays } from '../../utils/calendar-grid'
import { daysUntil } from '../../utils/effective-date'
import type { FilterCriteria } from '../../utils/filter-criteria'
import { matchesFilter, readsText, type FilterSettings } from '../../utils/filter-match'
import { textMatchContextFor, type TodoNameLookups } from '../../utils/filter'
import { FILTER_HISTORY_EVENT_TYPES, TREND_EVENT_TYPES, trendWindow, type TrendWindow } from '../../utils/trend-window'

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

/** One day of the window: what was created and completed in it, and what was open at its end. */
export interface TrendDay {
  createdIds: number[]
  /** Net of reopening, as a bar's. */
  completedIds: number[]
  /** Open at the day's end (today: now). */
  openIds: number[]
}

export interface TrendStats {
  window: TrendWindow
  buckets: TrendBucket[]
  /** Each of `window.days` (the Burndown's and Cumulative's points). */
  daily: TrendDay[]
  /** Created in the whole window. */
  created: number
  /** Completed (net of reopened) in the whole window. */
  completed: number
  /** Open tasks at the end of each of `window.days` (today: now). */
  openSeries: number[]
  /** Open tasks when the window started. */
  openAtStart: number
  /** The tasks open when the window started. */
  openAtStartIds: number[]
  /** Open now minus open at the start (created − completed + reopened). */
  net: number
}

/**
 * The filter a trend counts by, evaluated on each day as the task was at
 * that day's end (`task-history.taskFieldReplay`, as a Number's line). Each
 * stage is matched as given, so the caller passes stages that admit
 * completed tasks (`statsFilter`, `{ ...filter, showCompleted: true }`): a
 * completion is counted when the filter kept the task on its day.
 */
export interface TrendFilter {
  stages: readonly FilterCriteria[]
  /** The tasks' people and tags now (where their replay starts) and the names a text filter reads. */
  lookups: TodoNameLookups
  settings: FilterSettings
}

/**
 * The trend over `range` for `tasks`, completed ones included. Without a
 * `filter`, `tasks` are counted as they are (the screen-filtered set), and
 * `events` must hold every created / completed / reopened event since the
 * window start. With one, a task counts on a day only while every stage
 * keeps it as it was at that day's end — created on a day the filter kept it,
 * completed likewise, open at a day's end while kept — so a tag added
 * mid-range brings the task in from that day; `events` must then hold every
 * `FILTER_HISTORY_EVENT_TYPES` event since the window start. More events are
 * fine (other tasks' and other types' are ignored). Pure.
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
  filter?: TrendFilter,
): TrendStats {
  const window = trendWindow(range, ctx.today, ctx.weekStartsOn)
  const types = filter ? FILTER_HISTORY_EVENT_TYPES : TREND_EVENT_TYPES
  const byTask = eventsByTask(events, new Set(tasks.map((t) => t.id)), types, window.start)
  const dayCount = window.days.length

  const bucketOf = (day: number): number | null => {
    if (day < 0 || day >= dayCount) return null
    return window.granularity === 'day' ? day : Math.floor(day / 7)
  }
  const daily: TrendDay[] = window.days.map(() => ({ createdIds: [], completedIds: [], openIds: [] }))
  const openAtStartIds: number[] = []
  const dayBefore = addDays(window.start, -1)
  const text = filter?.stages.some(readsText) ?? false

  for (const task of tasks) {
    const list = byTask.get(task.id)
    const states = list?.states ?? []
    // Done before the window and never reopened in it: in no count.
    if (task.isCompleted && states.every((e) => e.day < 0)) {
      const done = daysUntil(task.completedAt ?? task.modifiedAt, window.start)
      if (done != null && done < 0 && (states.at(-1)?.type ?? 'completed') === 'completed') continue
    }

    // Whether the filter kept the task at a day's end (always, without one).
    let member: (day: number) => boolean = () => true
    if (filter) {
      const assignments = {
        personIds: (filter.lookups.assignedPeopleMap.get(task.id) ?? []).flatMap((p) => (p.id != null ? [p.id] : [])),
        tagIds: (filter.lookups.assignedTagsMap.get(task.id) ?? []).flatMap((t) => (t.id != null ? [t.id] : [])),
      }
      const fieldsAt = taskFieldReplay(task, list, assignments, window.start)
      const kept = (fields: TaskFields | null, date: Date): boolean => {
        if (!fields) return false
        const row = taskAsOf(task, fields)
        const searchCtx = text ? textMatchContextFor(row, filter.lookups) : undefined
        const personIds = [...fields.personIds]
        const tagIds = [...fields.tagIds]
        return filter.stages.every((f) => matchesFilter(f, row, personIds, date, searchCtx, tagIds, filter.settings))
      }
      const cache = new Map<number, boolean>()
      member = (day) => {
        let v = cache.get(day)
        if (v === undefined) {
          v = kept(fieldsAt(day), day < 0 ? dayBefore : (window.days[day] ?? dayBefore))
          cache.set(day, v)
        }
        return v
      }
    }

    // Created, and completions not undone by a later reopen.
    const pending: DatedEvent[] = []
    for (const e of states) {
      if (e.type === 'created') {
        if (e.day >= 0 && e.day < dayCount && member(e.day)) daily[e.day]?.createdIds.push(task.id)
      } else if (e.type === 'completed') {
        pending.push(e)
      } else {
        pending.pop()
      }
    }
    for (const e of pending) {
      if (e.day >= 0 && e.day < dayCount && member(e.day)) daily[e.day]?.completedIds.push(task.id)
    }

    // The task at each day's end.
    const at = taskReplay(task, list, window.start)
    if (at(-1).state === 'open' && member(-1)) openAtStartIds.push(task.id)
    for (let i = 0; i < dayCount; i++) {
      if (at(i).state === 'open' && member(i)) daily[i]?.openIds.push(task.id)
    }
  }

  const buckets: TrendBucket[] = window.bucketStarts.map((start) => ({ start, createdIds: [], completedIds: [] }))
  for (const [i, day] of daily.entries()) {
    const b = bucketOf(i)
    const bucket = b == null ? undefined : buckets[b]
    if (!bucket) continue
    bucket.createdIds.push(...day.createdIds)
    bucket.completedIds.push(...day.completedIds)
  }
  const openSeries = daily.map((d) => d.openIds.length)
  const created = buckets.reduce((n, b) => n + b.createdIds.length, 0)
  const completed = buckets.reduce((n, b) => n + b.completedIds.length, 0)
  const openAtStart = openAtStartIds.length
  const openNow = openSeries.at(-1) ?? openAtStart
  return { window, buckets, daily, created, completed, openSeries, openAtStart, openAtStartIds, net: openNow - openAtStart }
}

/** Each bar's days in `window`: the indexes of its first and last day (every bar holds at least one). */
export function trendBucketDays(window: TrendWindow): Array<{ first: number; last: number }> {
  const starts = window.bucketStarts.map((s) => Math.max(0, window.days.findIndex((d) => d.getTime() === s.getTime())))
  return starts.map((first, i) => ({ first, last: Math.max(first, (starts[i + 1] ?? window.days.length) - 1) }))
}

/** The running totals at each day's end (Cumulative): created since the window began, on top of what was open then, and completed. */
export interface TrendCumulative {
  /** Open at the start plus created through each day. */
  created: number[]
  /** Completed through each day. */
  completed: number[]
}

/** The Cumulative presentation's two lines: their gap is what is open (where the filter's membership didn't change). */
export function trendCumulative(stats: Pick<TrendStats, 'daily' | 'openAtStart'>): TrendCumulative {
  let made = stats.openAtStart
  let done = 0
  const created: number[] = []
  const completed: number[] = []
  for (const day of stats.daily) {
    made += day.createdIds.length
    done += day.completedIds.length
    created.push(made)
    completed.push(done)
  }
  return { created, completed }
}
