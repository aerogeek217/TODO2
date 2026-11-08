import type { PersistedTodoItem, TodoEvent } from '../../models'
import type { NumberMetric } from '../../models/glance-widgets'
import { addDays, weekStartOf } from '../../utils/calendar-grid'
import { daysUntil } from '../../utils/effective-date'
import { HISTORY_EVENT_TYPES, METRIC_HISTORY_DAYS } from '../../utils/trend-window'
import type { StatsContext } from './stats-context'
import { eventsByTask, taskReplay } from './task-history'

/**
 * A Number's history line (D25 N, the brief's gauges): what Open, Overdue,
 * Due today and Closed this week read at the end of each of the last 14
 * days, rebuilt from the tasks and their `todoEvents`. Today's value is the
 * count now, so the line ends on the number the widget shows.
 *
 * Follow-up dates and the Focus / Urgent markers aren't logged, so their
 * metrics have no history.
 */

/** The metrics with a history line. */
export const HISTORY_METRICS = ['open', 'overdue', 'dueToday', 'closedThisWeek'] as const
export type HistoryMetric = (typeof HISTORY_METRICS)[number]

export function hasHistory(metric: NumberMetric): metric is HistoryMetric {
  return (HISTORY_METRICS as readonly string[]).includes(metric)
}

export interface MetricHistory {
  /** The 14 days, oldest first (local midnights); the last is today. */
  days: Date[]
  /** Each metric's value at the end of each of `days` (today: now). */
  series: Record<HistoryMetric, number[]>
}

/**
 * The history over `tasks` — the tasks passing the screen filter now,
 * completed ones included. `events` must hold every created / completed /
 * reopened / deadline event since `historyEventsStart` (more is fine: other
 * tasks' and other types' events are ignored). Pure.
 *
 * A past day reads each task as it was at that day's end (`task-history`'s
 * replay: its state and due date then, from its events and, where the log
 * has gaps, its own dates).
 */
export function computeMetricHistory(
  tasks: readonly PersistedTodoItem[],
  events: readonly TodoEvent[],
  ctx: Pick<StatsContext, 'today' | 'weekStartsOn'>,
): MetricHistory {
  const first = addDays(ctx.today, -(METRIC_HISTORY_DAYS - 1))
  const days = Array.from({ length: METRIC_HISTORY_DAYS }, (_, i) => addDays(first, i))
  const weekStarts = days.map((d) => weekStartOf(d, ctx.weekStartsOn))
  const byTask = eventsByTask(events, new Set(tasks.map((t) => t.id)), HISTORY_EVENT_TYPES, first)

  const series: Record<HistoryMetric, number[]> = {
    open: new Array<number>(METRIC_HISTORY_DAYS).fill(0),
    overdue: new Array<number>(METRIC_HISTORY_DAYS).fill(0),
    dueToday: new Array<number>(METRIC_HISTORY_DAYS).fill(0),
    closedThisWeek: new Array<number>(METRIC_HISTORY_DAYS).fill(0),
  }
  const add = (metric: HistoryMetric, i: number) => { series[metric][i] = (series[metric][i] ?? 0) + 1 }

  for (const task of tasks) {
    const at = taskReplay(task, byTask.get(task.id), first)
    for (let i = 0; i < METRIC_HISTORY_DAYS; i++) {
      const day = days[i]
      const weekStart = weekStarts[i]
      if (!day || !weekStart) continue
      const { state, completed, due } = at(i)
      if (state === 'absent') continue
      if (state === 'done') {
        const fromWeek = completed ? daysUntil(completed, weekStart) : null
        if (fromWeek != null && fromWeek >= 0 && (daysUntil(completed, day) ?? 1) <= 0) add('closedThisWeek', i)
        continue
      }
      add('open', i)
      const dueIn = daysUntil(due, day)
      if (dueIn != null && dueIn < 0) add('overdue', i)
      if (dueIn === 0) add('dueToday', i)
    }
  }

  return { days, series }
}

/** Today's value against yesterday's: `today − yesterday`; `null` with fewer than two days. */
export function historyDelta(values: readonly number[]): number | null {
  const today = values.at(-1)
  const yesterday = values.at(-2)
  return today == null || yesterday == null ? null : today - yesterday
}
