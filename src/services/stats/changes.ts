import type { PersistedTodoItem, Tag, TodoEvent, TodoEventType } from '../../models'
import type { TaskDialogPayload } from '../../stores/task-dialog-payload'
import { addDays, weekStartOf } from '../../utils/calendar-grid'
import { daysUntil } from '../../utils/effective-date'
import { CHANGES_EVENT_TYPES, STUCK_STATUS_DAYS } from '../../utils/trend-window'
import { completionOf } from './closed-this-week'
import { idsByDate, openTasks, type StatsContext } from './stats-context'

/**
 * What changed (D25 L, the morning brief's text): template sentences —
 * no AI — over the tasks, their `todoEvents` and today, in a fixed order:
 *
 * 1. `late` — how many went late since yesterday.
 * 2. `followups` — the follow-ups due, against yesterday.
 * 3. `tag` — the picked tag with the most late tasks.
 * 4. `status` — a status that has held tasks unchanged for 3+ weeks.
 * 5. `dueToday` — how many are due today.
 * 6. `closed` — how many closed this week, against the weekly average.
 *
 * A sentence with nothing to say is left out; none at all = nothing new.
 */

export type ChangeId = 'late' | 'followups' | 'tag' | 'status' | 'dueToday' | 'closed'

/** One sentence, and the tasks behind it (its drill; `null` = none to open). */
export interface Change {
  id: ChangeId
  text: string
  drill: Omit<TaskDialogPayload, 'fromTabId'> | null
}

/** Weeks the closed sentence averages over, at most. */
export const CLOSED_AVERAGE_WEEKS = 4

/**
 * This week's closes read as "about the usual" within this share of the
 * average, or within `CLOSED_ABOUT_MIN` of it, whichever is wider.
 */
export const CLOSED_ABOUT_SHARE = 0.2
export const CLOSED_ABOUT_MIN = 0.5

/** What the changes are read with. */
export type ChangesContext = Pick<StatsContext, 'today' | 'weekStartsOn' | 'assignedTagsMap' | 'statuses'>

/** `1 task` / `3 tasks`. */
function tasksWord(n: number): string {
  return n === 1 ? '1 task' : `${n} tasks`
}

/** `2.5` / `4`: an average, to one place when it isn't whole. */
function averageText(avg: number): string {
  const r = Math.round(avg * 10) / 10
  return Number.isInteger(r) ? String(r) : r.toFixed(1)
}

type TaskState = 'absent' | 'open' | 'done'

/** A task's state just before an event of `type` (a state event). */
function stateBefore(type: TodoEventType): TaskState {
  if (type === 'created') return 'absent'
  return type === 'completed' ? 'open' : 'done'
}

const STATE_TYPES: ReadonlySet<TodoEventType> = new Set(['created', 'completed', 'reopened'])

interface DatedEvent {
  type: TodoEventType
  time: number
  id: number
  /** Days from today (0 = today, negative = before). */
  day: number
  fromValue: string | number | null
}

/** The events of each task in `ids`, oldest first (the types What changed reads). */
function eventsByTask(events: readonly TodoEvent[], ids: ReadonlySet<number>, today: Date): Map<number, DatedEvent[]> {
  const types = new Set(CHANGES_EVENT_TYPES)
  const out = new Map<number, DatedEvent[]>()
  for (const e of events) {
    if (!ids.has(e.todoId) || !types.has(e.type)) continue
    const at = new Date(e.timestamp)
    const time = at.getTime()
    if (Number.isNaN(time)) continue
    const list = out.get(e.todoId) ?? []
    list.push({ type: e.type, time, id: e.id ?? 0, day: daysUntil(at, today) ?? 0, fromValue: e.fromValue })
    out.set(e.todoId, list)
  }
  for (const list of out.values()) list.sort((a, b) => a.time - b.time || a.id - b.id)
  return out
}

function dateOf(v: string | number | null): Date | null {
  if (typeof v !== 'string') return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * Whether an open task late now was already late at yesterday's end: it
 * was there and open then (the state before its first state event today,
 * else as now — not there before its `createdAt`), and its due date then
 * (the `from` of its first `deadline` event today, else as now) was before
 * yesterday.
 */
function lateYesterday(task: PersistedTodoItem, list: readonly DatedEvent[], today: Date): boolean {
  const yesterday = addDays(today, -1)
  if ((daysUntil(task.createdAt, today) ?? 0) >= 0) return false
  const nextState = list.find((e) => e.day >= 0 && STATE_TYPES.has(e.type))
  if (nextState && stateBefore(nextState.type) !== 'open') return false
  const nextDeadline = list.find((e) => e.day >= 0 && e.type === 'deadline')
  const due = nextDeadline ? dateOf(nextDeadline.fromValue) : (task.dueDate ?? null)
  const dueIn = daysUntil(due, yesterday)
  return dueIn != null && dueIn < 0
}

/** When an open task took its status: its last `status` event, else its creation inside the window, else before the window. */
function statusSince(task: PersistedTodoItem, list: readonly DatedEvent[]): Date | null {
  const last = list.filter((e) => e.type === 'status').at(-1)
  if (last) return new Date(last.time)
  return task.createdAt ? new Date(task.createdAt) : null
}

const todos = (todoIds: readonly number[]) => ({ kind: 'todos' as const, todoIds: [...todoIds] })

/**
 * The sentences over `tasks` (completed ones included: the closed count
 * reads them) — usually the screen-filtered tasks. `events` must hold every
 * created / completed / reopened / deadline / status event of the last
 * `STUCK_STATUS_DAYS` days (`eventsWindowRead('changes')`; more is fine).
 * `tagIds` are the picked tags, in pick order. Pure.
 */
export function computeChanges(
  tasks: readonly PersistedTodoItem[],
  events: readonly TodoEvent[],
  ctx: ChangesContext,
  tagIds: readonly number[],
): Change[] {
  const { today } = ctx
  const open = openTasks(tasks)
  const byTask = eventsByTask(events, new Set(open.map((t) => t.id)), today)
  const out: Change[] = []

  // 1. Went late since yesterday: late now, not late at yesterday's end.
  const late = open.filter((t) => (daysUntil(t.dueDate, today) ?? 0) < 0)
  const wentLate = late.filter((t) => !lateYesterday(t, byTask.get(t.id) ?? [], today))
  if (wentLate.length > 0) {
    out.push({
      id: 'late',
      text: `${tasksWord(wentLate.length)} went late since yesterday.`,
      drill: {
        title: 'Went late since yesterday',
        glyph: 'overdue',
        description: 'Open tasks that are late now and weren’t at the end of yesterday.',
        source: todos(idsByDate(wentLate, 'deadline')),
      },
    })
  }

  // 2. Follow-ups due (today or late) against yesterday's end. Follow-up dates
  // aren't logged: yesterday's were the late ones now and the ones followed up today.
  const due = open.filter((t) => (daysUntil(t.nextFollowupAt, today) ?? 1) <= 0)
  const dueIds = new Set(due.map((t) => t.id))
  const lateFollowups = due.filter((t) => (daysUntil(t.nextFollowupAt, today) ?? 0) < 0).length
  const followedToday = open.filter((t) => !dueIds.has(t.id) && daysUntil(t.lastFollowupAt, today) === 0).length
  const nowDue = due.length
  const wasDue = lateFollowups + followedToday
  if (nowDue > 0 || wasDue > 0) {
    const diff = nowDue - wasDue
    const text = nowDue === 0
      ? `No follow-ups are due, down from ${wasDue} yesterday.`
      : diff > 0
        ? `Follow-ups due grew to ${nowDue}, ${diff} more than yesterday.`
        : diff < 0
          ? `Follow-ups due fell to ${nowDue}, ${-diff} fewer than yesterday.`
          : `Follow-ups due are holding at ${nowDue}.`
    out.push({
      id: 'followups',
      text,
      drill: nowDue === 0 ? null : {
        title: 'Follow-ups due',
        glyph: 'followup',
        description: 'Open tasks whose next follow-up is today or earlier.',
        source: todos(idsByDate(due, 'followup')),
      },
    })
  }

  // 3. The picked tag with the most late tasks (ties: the first picked).
  if (tagIds.length > 0 && late.length > 0) {
    const picked = new Map(tagIds.map((id, i) => [id, i]))
    const perTag = new Map<number, { tag: Tag; tasks: PersistedTodoItem[] }>()
    for (const t of late) {
      for (const tag of ctx.assignedTagsMap.get(t.id) ?? []) {
        if (tag.id == null || !picked.has(tag.id)) continue
        const entry = perTag.get(tag.id) ?? { tag, tasks: [] }
        entry.tasks.push(t)
        perTag.set(tag.id, entry)
      }
    }
    const top = [...perTag.values()].sort((a, b) =>
      b.tasks.length - a.tasks.length || (picked.get(a.tag.id ?? 0) ?? 0) - (picked.get(b.tag.id ?? 0) ?? 0))[0]
    if (top) {
      out.push({
        id: 'tag',
        text: `#${top.tag.name} has the most late tasks (${top.tasks.length}).`,
        drill: {
          title: `Late in #${top.tag.name}`,
          glyph: 'tag',
          description: `Open tasks tagged #${top.tag.name} that are late.`,
          source: todos(idsByDate(top.tasks, 'deadline')),
        },
      })
    }
  }

  // 4. A status holding tasks unchanged for STUCK_STATUS_DAYS or more (the most; ties: status order).
  const stuck = new Map<number, PersistedTodoItem[]>()
  for (const t of open) {
    if (t.statusId == null) continue
    const since = statusSince(t, byTask.get(t.id) ?? [])
    const held = since ? -(daysUntil(since, today) ?? 0) : STUCK_STATUS_DAYS
    if (held < STUCK_STATUS_DAYS) continue
    const list = stuck.get(t.statusId) ?? []
    list.push(t)
    stuck.set(t.statusId, list)
  }
  const stuckStatus = ctx.statuses
    .filter((s) => s.id != null && (stuck.get(s.id)?.length ?? 0) > 0)
    .map((s) => ({ status: s, tasks: stuck.get(s.id ?? 0) ?? [] }))
    .sort((a, b) => b.tasks.length - a.tasks.length)[0]
  if (stuckStatus) {
    const { status, tasks: held } = stuckStatus
    out.push({
      id: 'status',
      text: `${status.name} has held ${tasksWord(held.length)} for 3+ weeks.`,
      drill: {
        title: `Stuck in ${status.name}`,
        glyph: 'status',
        description: `Open tasks whose status has been ${status.name} for ${STUCK_STATUS_DAYS} days or more.`,
        source: todos(idsByDate(held, 'deadline')),
      },
    })
  }

  // 5. Due today.
  const dueToday = open.filter((t) => daysUntil(t.dueDate, today) === 0)
  if (dueToday.length > 0) {
    out.push({
      id: 'dueToday',
      text: dueToday.length === 1 ? '1 task is due today.' : `${dueToday.length} tasks are due today.`,
      drill: {
        title: 'Due today',
        glyph: 'calendar',
        description: 'Open tasks due today.',
        source: todos(idsByDate(dueToday, 'deadline')),
      },
    })
  }

  // 6. Closed this week, against the average of the full weeks before it
  // (up to four, only weeks the tasks' history covers: from the first task's creation).
  const weekStart = weekStartOf(today, ctx.weekStartsOn)
  const closedIn = (start: Date, end: Date) => tasks.filter((t) => {
    if (!t.isCompleted) return false
    const when = completionOf(t)
    return (daysUntil(when, start) ?? -1) >= 0 && (daysUntil(when, end) ?? 1) <= 0
  })
  const closedNow = closedIn(weekStart, today)
    .sort((a, b) => completionOf(b).getTime() - completionOf(a).getTime() || a.sortOrder - b.sortOrder)
  const first = tasks.reduce<number | null>((min, t) => {
    const at = new Date(t.createdAt).getTime()
    return Number.isFinite(at) && (min == null || at < min) ? at : min
  }, null)
  const weeks: number[] = []
  for (let k = 1; k <= CLOSED_AVERAGE_WEEKS; k++) {
    const start = addDays(weekStart, -7 * k)
    if (first == null || (daysUntil(new Date(first), start) ?? 1) > 0) break
    weeks.push(closedIn(start, addDays(start, 6)).length)
  }
  const avg = weeks.length > 0 ? weeks.reduce((n, w) => n + w, 0) / weeks.length : null
  const n = closedNow.length
  if (n > 0 || (avg != null && avg > 0)) {
    let text: string
    if (avg == null || avg === 0) text = `${n} closed this week.`
    else if (n === 0) text = `Nothing closed this week yet; you usually close ${averageText(avg)} a week.`
    else if (Math.abs(n - avg) <= Math.max(CLOSED_ABOUT_MIN, avg * CLOSED_ABOUT_SHARE)) text = `${n} closed this week, about your usual ${averageText(avg)} a week.`
    else text = `${n} closed this week, ${n > avg ? 'above' : 'below'} your usual ${averageText(avg)} a week.`
    out.push({
      id: 'closed',
      text,
      drill: n === 0 ? null : {
        title: 'Closed this week',
        glyph: 'done',
        description: avg == null
          ? 'Tasks completed this week, newest first.'
          : `Tasks completed this week, newest first. The usual is the average of the last ${weeks.length === 1 ? 'week' : `${weeks.length} weeks`}.`,
        source: todos(closedNow.map((t) => t.id)),
      },
    })
  }

  return out
}

/** What a What changed with nothing to say shows. */
export const NOTHING_CHANGED = 'Nothing new since yesterday.'
