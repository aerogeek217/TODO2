import type { PersistedTodoItem, TodoEvent, TodoEventType } from '../../models'
import { daysUntil } from '../../utils/effective-date'
import { completionOf } from './closed-this-week'

/**
 * A task as it was at a past day's end, replayed from its `todoEvents` — the
 * one replay a Number's history, What changed and Created vs completed's
 * open series read, so they agree on every day.
 *
 * At a day's end a task is in the state just before its next state event
 * (before `created` = not there yet, before `completed` = open, before
 * `reopened` = done), with the due date just before its next `deadline`
 * event (that event's `from`); with no later event, as it is now. Where the
 * log has gaps (tasks from before it, an import, a hand-made file), the
 * task's own dates fill in: it isn't there before its `createdAt`, and a
 * task completed now with no later event was open until its completion day.
 * A due date change with no event is taken as always having been the date
 * it has now.
 */

export type TaskState = 'absent' | 'open' | 'done'

/** The event types that move a task's state. */
const STATE_TYPES: ReadonlySet<TodoEventType> = new Set(['created', 'completed', 'reopened'])

/** A task's state just before an event of `type` (a state event). */
function stateBefore(type: TodoEventType): TaskState {
  if (type === 'created') return 'absent'
  return type === 'completed' ? 'open' : 'done'
}

export interface DatedEvent {
  type: TodoEventType
  /** Calendar days from the replay's origin day (0 = that day, negative = before it). */
  day: number
  time: number
  id: number
  /** A `deadline` event's due date before it; `null` for other types. */
  from: Date | null
}

/** One task's events, oldest first: all of them, its state events, its `deadline` events. */
export interface TaskEvents {
  all: readonly DatedEvent[]
  states: readonly DatedEvent[]
  deadlines: readonly DatedEvent[]
}

const NO_EVENTS: TaskEvents = { all: [], states: [], deadlines: [] }

function dateOf(v: string | number | null): Date | null {
  if (typeof v !== 'string') return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * The events of each task `ids` holds, of `types`, oldest first (by time,
 * then id), each dated in calendar days from `origin`. Events with a bad
 * timestamp are skipped.
 */
export function eventsByTask(
  events: readonly TodoEvent[],
  ids: { has(id: number): boolean },
  types: readonly TodoEventType[],
  origin: Date,
): Map<number, TaskEvents> {
  const wanted = new Set(types)
  const lists = new Map<number, DatedEvent[]>()
  for (const e of events) {
    if (!ids.has(e.todoId) || !wanted.has(e.type)) continue
    const at = new Date(e.timestamp)
    const time = at.getTime()
    if (Number.isNaN(time)) continue
    const list = lists.get(e.todoId) ?? []
    list.push({ type: e.type, day: daysUntil(at, origin) ?? 0, time, id: e.id ?? 0, from: e.type === 'deadline' ? dateOf(e.fromValue) : null })
    lists.set(e.todoId, list)
  }
  const out = new Map<number, TaskEvents>()
  for (const [id, list] of lists) {
    list.sort((a, b) => a.time - b.time || a.id - b.id)
    out.set(id, { all: list, states: list.filter((e) => STATE_TYPES.has(e.type)), deadlines: list.filter((e) => e.type === 'deadline') })
  }
  return out
}

/** A task at a day's end. */
export interface TaskAtDayEnd {
  state: TaskState
  /** When a done task was completed (`null` when the log doesn't say); `null` unless done. */
  completed: Date | null
  /** Its due date then (`null` unless open). */
  due: Date | null
}

const ABSENT: TaskAtDayEnd = { state: 'absent', completed: null, due: null }

/**
 * `task`'s replay over its `events` (from `eventsByTask`, the same `origin`):
 * the task at the end of a day, given in days from `origin` (`-1` = the day
 * before it). See the module comment for the rule.
 */
export function taskReplay(task: PersistedTodoItem, events: TaskEvents | undefined, origin: Date): (day: number) => TaskAtDayEnd {
  const { states, deadlines } = events ?? NO_EVENTS
  const createdDay = daysUntil(task.createdAt, origin)
  const completion = task.isCompleted ? completionOf(task) : null
  const completedDay = completion ? daysUntil(completion, origin) : null
  return (day) => {
    if (createdDay != null && createdDay > day) return ABSENT
    const next = states.find((e) => e.day > day)
    let state: TaskState
    let completed: Date | null = null
    if (next) {
      state = stateBefore(next.type)
      if (state === 'done') {
        const last = states.filter((e) => e.day <= day && e.type === 'completed').at(-1)
        completed = last ? new Date(last.time) : null
      }
    } else if (completion) {
      // Done now, with no later event: done since its completion day.
      state = completedDay != null && completedDay > day ? 'open' : 'done'
      completed = completion
    } else {
      state = 'open'
    }
    if (state === 'absent') return ABSENT
    if (state === 'done') return { state, completed, due: null }
    const nextDeadline = deadlines.find((e) => e.day > day)
    return { state, completed: null, due: nextDeadline ? nextDeadline.from : (task.dueDate ?? null) }
  }
}
