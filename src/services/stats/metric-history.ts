import type { PersistedTodoItem, TodoEvent, TodoEventType } from '../../models'
import type { NumberMetric } from '../../models/glance-widgets'
import { addDays, weekStartOf } from '../../utils/calendar-grid'
import { daysUntil } from '../../utils/effective-date'
import { HISTORY_EVENT_TYPES, METRIC_HISTORY_DAYS } from '../../utils/trend-window'
import { completionOf } from './closed-this-week'
import type { StatsContext } from './stats-context'

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

type TaskState = 'absent' | 'open' | 'done'

const STATE_TYPES: ReadonlySet<TodoEventType> = new Set(['created', 'completed', 'reopened'])

/** A task's state just before an event of `type` (a state event). */
function stateBefore(type: TodoEventType): TaskState {
  if (type === 'created') return 'absent'
  return type === 'completed' ? 'open' : 'done'
}

interface DatedEvent {
  type: TodoEventType
  /** Calendar days from the history's first day (negative = before it). */
  day: number
  time: number
  id: number
  /** A `deadline` event's due date before it. */
  from: Date | null
}

function dateOf(v: string | number | null): Date | null {
  if (typeof v !== 'string') return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * The history over `tasks` — the tasks passing the screen filter now,
 * completed ones included. `events` must hold every created / completed /
 * reopened / deadline event since `historyEventsStart` (more is fine: other
 * tasks' and other types' events are ignored). Pure.
 *
 * A past day reads each task as it was at that day's end: in the state just
 * before its next state event (before `created` = not there yet, before
 * `completed` = open, before `reopened` = done), with the due date just
 * before its next `deadline` event (that event's `from`); with no later
 * event, as it is now. Where the log has gaps (tasks from before it, an
 * import), the task's own dates fill in: it isn't there before its
 * `createdAt`, and a task completed now with no later event was open until
 * its completion day. A due date change with no event is taken as always
 * having been the date it has now.
 */
export function computeMetricHistory(
  tasks: readonly PersistedTodoItem[],
  events: readonly TodoEvent[],
  ctx: Pick<StatsContext, 'today' | 'weekStartsOn'>,
): MetricHistory {
  const first = addDays(ctx.today, -(METRIC_HISTORY_DAYS - 1))
  const days = Array.from({ length: METRIC_HISTORY_DAYS }, (_, i) => addDays(first, i))
  const weekStarts = days.map((d) => weekStartOf(d, ctx.weekStartsOn))
  const byId = new Map(tasks.map((t) => [t.id, t]))
  const types = new Set(HISTORY_EVENT_TYPES)

  const perTask = new Map<number, DatedEvent[]>()
  for (const e of events) {
    if (!byId.has(e.todoId) || !types.has(e.type)) continue
    const at = new Date(e.timestamp)
    const time = at.getTime()
    if (Number.isNaN(time)) continue
    const list = perTask.get(e.todoId) ?? []
    list.push({ type: e.type, day: daysUntil(at, first) ?? 0, time, id: e.id ?? 0, from: e.type === 'deadline' ? dateOf(e.fromValue) : null })
    perTask.set(e.todoId, list)
  }

  const series: Record<HistoryMetric, number[]> = {
    open: new Array<number>(METRIC_HISTORY_DAYS).fill(0),
    overdue: new Array<number>(METRIC_HISTORY_DAYS).fill(0),
    dueToday: new Array<number>(METRIC_HISTORY_DAYS).fill(0),
    closedThisWeek: new Array<number>(METRIC_HISTORY_DAYS).fill(0),
  }
  const add = (metric: HistoryMetric, i: number) => { series[metric][i] = (series[metric][i] ?? 0) + 1 }

  for (const task of tasks) {
    const list = (perTask.get(task.id) ?? []).sort((a, b) => a.time - b.time || a.id - b.id)
    const stateEvents = list.filter((e) => STATE_TYPES.has(e.type))
    const deadlineEvents = list.filter((e) => e.type === 'deadline')
    const createdDay = daysUntil(task.createdAt, first)
    const completedDay = task.isCompleted ? daysUntil(completionOf(task), first) : null

    for (let i = 0; i < METRIC_HISTORY_DAYS; i++) {
      const day = days[i]
      const weekStart = weekStarts[i]
      if (!day || !weekStart) continue
      if (createdDay != null && createdDay > i) continue

      // The state at the day's end, and when a done task was completed.
      const next = stateEvents.find((e) => e.day > i)
      let state: TaskState
      let completed: Date | null = null
      if (next) {
        state = stateBefore(next.type)
        if (state === 'done') {
          const last = stateEvents.filter((e) => e.day <= i && e.type === 'completed').at(-1)
          completed = last ? new Date(last.time) : null
        }
      } else if (task.isCompleted) {
        // Done now, with no later event: done since its completion day.
        state = completedDay != null && completedDay > i ? 'open' : 'done'
        completed = completionOf(task)
      } else {
        state = 'open'
      }
      if (state === 'absent') continue

      if (state === 'done') {
        const fromWeek = completed ? daysUntil(completed, weekStart) : null
        if (fromWeek != null && fromWeek >= 0 && (daysUntil(completed, day) ?? 1) <= 0) add('closedThisWeek', i)
        continue
      }

      add('open', i)
      const nextDeadline = deadlineEvents.find((e) => e.day > i)
      const due = nextDeadline ? nextDeadline.from : (task.dueDate ?? null)
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
