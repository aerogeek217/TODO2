import type { PersistedTodoItem, TodoEvent, TodoEventType } from '../../models'
import { addDays, weekStartOf } from '../../utils/calendar-grid'
import { compareTodosByDate, daysUntil, type TodoDateField } from '../../utils/effective-date'
import { isEffectivelyUrgent } from '../../utils/urgency'
import type { StatsContext } from '../../services/stats/stats-context'
import { eventsByTask, taskReplay } from '../../services/stats/task-history'
import { TREND_EVENT_TYPES } from '../../utils/trend-window'

/**
 * The v77 Number metrics, frozen as `services/stats/metrics` and
 * `closed-this-week` counted them before D26 P5 replaced them with filters:
 * the reference the v78 conversion's counts are proved against
 * (`src/test/data/v78-numbers.test.ts`) — and `metric-history`'s line for
 * Open, Overdue, Due today and Closed this week, which `filter-history`
 * reproduces (`src/test/services/stats/filter-history.test.ts`).
 */

const NEXT_DAYS = 7

function openTasks(tasks: readonly PersistedTodoItem[]): PersistedTodoItem[] {
  return tasks.filter((t) => !t.isCompleted)
}

function idsByDate(tasks: readonly PersistedTodoItem[], field: TodoDateField): number[] {
  return [...tasks].sort(compareTodosByDate(field)).map((t) => t.id)
}

function completionOf(task: Pick<PersistedTodoItem, 'completedAt' | 'modifiedAt'>): Date {
  return new Date(task.completedAt ?? task.modifiedAt)
}

/**
 * The counted metrics (each a Number's). Every one counts open tasks only; its
 * `ids` are the tasks it counts, in dialog order (by due date, or by next
 * follow-up for the follow-up metrics; overdue first, undated last, ties by
 * `sortOrder`). A metric's count is `ids.length`.
 */
export interface MetricStats {
  /** Every open task. (The `+N in the last …` line comes from the trend.) */
  open: { ids: number[] }
  /** Effective urgent: `flagged` + `byDate` (urgent only by its due date). */
  urgent: { ids: number[]; flagged: number; byDate: number }
  /** Due before today; the oldest due day and how many days late it is. */
  overdue: { ids: number[]; oldest: Date | null; oldestDaysLate: number }
  /**
   * Next follow-up today or earlier (`late` + `today`); `upcoming` = follow-ups
   * on the rest of the next 7 days (tomorrow … today + 6), not in the count;
   * `next` = the soonest follow-up after today, however far.
   */
  followupDue: { ids: number[]; late: number; today: number; upcoming: number; next: Date | null }
  /** In Focus; `dueToday` of them due today. */
  focus: { ids: number[]; dueToday: number }
  /** Due today; `upcoming` = due tomorrow … today + 6, not in the count. */
  dueToday: { ids: number[]; upcoming: number }
  /** Due today … today + 6. */
  dueNext7: { ids: number[] }
  /** Open tasks without a next follow-up date. */
  noFollowup: { ids: number[] }
}

/** Every counted metric over `tasks` (completed tasks are skipped). */
export function computeMetrics(tasks: readonly PersistedTodoItem[], ctx: StatsContext): MetricStats {
  const { today, urgentRange } = ctx
  const open = openTasks(tasks)

  const urgent: PersistedTodoItem[] = []
  let flagged = 0
  const overdue: PersistedTodoItem[] = []
  const followupDue: PersistedTodoItem[] = []
  let followupLate = 0
  let followupUpcoming = 0
  let followupNext: Date | null = null
  const focus: PersistedTodoItem[] = []
  let focusDueToday = 0
  const dueToday: PersistedTodoItem[] = []
  const dueNext7: PersistedTodoItem[] = []
  const noFollowup: PersistedTodoItem[] = []

  for (const t of open) {
    if (isEffectivelyUrgent(t, today, urgentRange)) {
      urgent.push(t)
      if (t.urgent === true) flagged++
    }

    const due = daysUntil(t.dueDate, today)
    if (due != null) {
      if (due < 0) overdue.push(t)
      if (due === 0) dueToday.push(t)
      if (due >= 0 && due < NEXT_DAYS) dueNext7.push(t)
    }

    const fu = daysUntil(t.nextFollowupAt, today)
    if (fu == null) {
      noFollowup.push(t)
    } else if (fu <= 0) {
      followupDue.push(t)
      if (fu < 0) followupLate++
    } else {
      if (fu < NEXT_DAYS) followupUpcoming++
      const at = t.nextFollowupAt ? new Date(t.nextFollowupAt) : null
      if (at && (!followupNext || at.getTime() < followupNext.getTime())) followupNext = at
    }

    if (t.focus === true) {
      focus.push(t)
      if (due === 0) focusDueToday++
    }
  }

  const overdueIds = idsByDate(overdue, 'deadline')
  const oldestTask = overdue.find((t) => t.id === overdueIds[0])
  const oldest = oldestTask?.dueDate ?? null

  return {
    open: { ids: idsByDate(open, 'deadline') },
    urgent: {
      ids: idsByDate(urgent, 'deadline'),
      flagged,
      byDate: urgent.length - flagged,
    },
    overdue: {
      ids: overdueIds,
      oldest,
      oldestDaysLate: oldest ? -(daysUntil(oldest, today) ?? 0) : 0,
    },
    followupDue: {
      ids: idsByDate(followupDue, 'followup'),
      late: followupLate,
      today: followupDue.length - followupLate,
      upcoming: followupUpcoming,
      next: followupNext,
    },
    focus: { ids: idsByDate(focus, 'deadline'), dueToday: focusDueToday },
    dueToday: { ids: idsByDate(dueToday, 'deadline'), upcoming: dueNext7.length - dueToday.length },
    dueNext7: { ids: idsByDate(dueNext7, 'deadline') },
    noFollowup: { ids: idsByDate(noFollowup, 'deadline') },
  }
}


/** The Number widget's Closed this week. */
export interface ClosedThisWeek {
  /** Newest completion first; ties by `sortOrder`, then id. */
  ids: number[]
  /** The week's first day (`weekStartsOn`), local midnight. */
  weekStart: Date
}


/**
 * Tasks completed this week: from the week's first day (Settings' week
 * start) through today, by local day (`completionOf`: its completion day).
 */
export function computeClosedThisWeek(
  tasks: readonly PersistedTodoItem[],
  ctx: Pick<StatsContext, 'today' | 'weekStartsOn'>,
): ClosedThisWeek {
  const weekStart = weekStartOf(ctx.today, ctx.weekStartsOn)
  const done: Array<{ task: PersistedTodoItem; at: number }> = []
  for (const t of tasks) {
    if (!t.isCompleted) continue
    const when = completionOf(t)
    const at = when.getTime()
    if (!Number.isFinite(at)) continue
    const fromStart = daysUntil(when, weekStart) ?? -1
    const fromToday = daysUntil(when, ctx.today) ?? 1
    if (fromStart >= 0 && fromToday <= 0) done.push({ task: t, at })
  }
  done.sort((a, b) => b.at - a.at || a.task.sortOrder - b.task.sortOrder || a.task.id - b.task.id)
  return { ids: done.map((d) => d.task.id), weekStart }
}

// ── metric-history ──────────────────────────────────────────────────────────

const HISTORY_DAYS = 14
/** The event types the v77 history read: the trend's and `deadline`. */
export const HISTORY_EVENT_TYPES: readonly TodoEventType[] = [...TREND_EVENT_TYPES, 'deadline']

type HistoryMetric = 'open' | 'overdue' | 'dueToday' | 'closedThisWeek'

export interface MetricHistory {
  days: Date[]
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
  const first = addDays(ctx.today, -(HISTORY_DAYS - 1))
  const days = Array.from({ length: HISTORY_DAYS }, (_, i) => addDays(first, i))
  const weekStarts = days.map((d) => weekStartOf(d, ctx.weekStartsOn))
  const byTask = eventsByTask(events, new Set(tasks.map((t) => t.id)), HISTORY_EVENT_TYPES, first)

  const series: Record<HistoryMetric, number[]> = {
    open: new Array<number>(HISTORY_DAYS).fill(0),
    overdue: new Array<number>(HISTORY_DAYS).fill(0),
    dueToday: new Array<number>(HISTORY_DAYS).fill(0),
    closedThisWeek: new Array<number>(HISTORY_DAYS).fill(0),
  }
  const add = (metric: HistoryMetric, i: number) => { series[metric][i] = (series[metric][i] ?? 0) + 1 }

  for (const task of tasks) {
    const at = taskReplay(task, byTask.get(task.id), first)
    for (let i = 0; i < HISTORY_DAYS; i++) {
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
