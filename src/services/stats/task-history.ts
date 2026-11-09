import { decodeMarkerFlags, encodeMarkerFlags, type MarkerFlags, type PersistedTodoItem, type TodoEvent, type TodoEventType } from '../../models'
import { daysUntil } from '../../utils/effective-date'

/**
 * A task as it was at a past day's end, replayed from its `todoEvents` — the
 * one replay a Number's history and Created vs completed's open series
 * read, so they agree on every day.
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
 *
 * `taskFieldReplay` replays every logged field the same way, backwards from
 * now: a field at a day's end is the `from` of its next event after that
 * day, else what it is now — the due date, the status, and (the history log
 * H3, D26) the next and last follow-up dates, the priority flags and the
 * task's people and tags (each later add / remove undone, newest first). A
 * field the log didn't cover yet (before `historyLogSince`, for the H3
 * fields) thus reads as it was when the log began — its first logged
 * change's `from`, or what it is now. `filter-history.historyExactness` says
 * when a filter's past counts are exact.
 */

/** When a completed task was completed: `completedAt`, or `modifiedAt` for a row without one. */
export function completionOf(task: Pick<PersistedTodoItem, 'completedAt' | 'modifiedAt'>): Date {
  return new Date(task.completedAt ?? task.modifiedAt)
}

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
  /** The event's values as stored (`models/todo-event` has their encodings). */
  fromValue: string | number | null
  toValue: string | number | null
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
    list.push({
      type: e.type, day: daysUntil(at, origin) ?? 0, time, id: e.id ?? 0,
      from: e.type === 'deadline' ? dateOf(e.fromValue) : null,
      fromValue: e.fromValue ?? null, toValue: e.toValue ?? null,
    })
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

/** A task's logged fields at a day's end (`taskFieldReplay`). */
export interface TaskFields {
  /** Open or done (an absent task has no fields). */
  state: Exclude<TaskState, 'absent'>
  /** When a done task was completed (`null` when the log doesn't say); `null` while open. */
  completed: Date | null
  dueDate: Date | null
  nextFollowupAt: Date | null
  lastFollowupAt: Date | null
  statusId: number | null
  markers: MarkerFlags
  personIds: readonly number[]
  tagIds: readonly number[]
}

/** A task's people and tags now: where the replay of its assignments starts. */
export interface TaskAssignmentsNow {
  personIds: readonly number[]
  tagIds: readonly number[]
}

/** The scalar fields a replay reads back from their events' `from`. */
type ScalarType = 'deadline' | 'followup' | 'followedUp' | 'status' | 'marker'

const SCALAR_TYPES: readonly ScalarType[] = ['deadline', 'followup', 'followedUp', 'status', 'marker']

function isoOf(d: Date | undefined): string | null {
  return d ? new Date(d).toISOString() : null
}

/**
 * `task`'s every logged field at the end of a day (in days from `origin`,
 * as `taskReplay`; `null` while the task is absent), replayed backwards from
 * its fields now and its people and tags now (`assignments`) over its
 * `events` (from `eventsByTask` with the field types, the same `origin`).
 * See the module comment for the rule.
 */
export function taskFieldReplay(
  task: PersistedTodoItem,
  events: TaskEvents | undefined,
  assignments: TaskAssignmentsNow,
  origin: Date,
): (day: number) => TaskFields | null {
  const state = taskReplay(task, events, origin)
  const all = events?.all ?? []
  const byType = (type: TodoEventType) => all.filter((e) => e.type === type)
  const scalars = new Map(SCALAR_TYPES.map((type) => [type, byType(type)] as const))
  const people = byType('person')
  const tags = byType('tag')
  const now: Record<ScalarType, string | number | null> = {
    deadline: isoOf(task.dueDate),
    followup: isoOf(task.nextFollowupAt),
    followedUp: isoOf(task.lastFollowupAt),
    status: task.statusId ?? null,
    marker: encodeMarkerFlags(task),
  }
  /** The field's stored value at the day's end: its next event's `from`, else its value now. */
  const scalar = (type: ScalarType, day: number) => {
    const next = scalars.get(type)?.find((e) => e.day > day)
    return next ? next.fromValue : now[type]
  }
  /** The set at the day's end: `current` with each later add / remove undone, newest first. */
  const replaySet = (list: readonly DatedEvent[], day: number, current: readonly number[]): readonly number[] => {
    const later = list.filter((e) => e.day > day)
    if (later.length === 0) return current
    const ids = new Set(current)
    for (const e of later.reverse()) {
      if (typeof e.toValue === 'number') ids.delete(e.toValue)
      else if (typeof e.fromValue === 'number') ids.add(e.fromValue)
    }
    return [...ids]
  }
  return (day) => {
    const at = state(day)
    if (at.state === 'absent') return null
    const status = scalar('status', day)
    return {
      state: at.state,
      completed: at.completed,
      dueDate: dateOf(scalar('deadline', day)),
      nextFollowupAt: dateOf(scalar('followup', day)),
      lastFollowupAt: dateOf(scalar('followedUp', day)),
      statusId: typeof status === 'number' ? status : null,
      markers: decodeMarkerFlags(scalar('marker', day)),
      personIds: replaySet(people, day, assignments.personIds),
      tagIds: replaySet(tags, day, assignments.tagIds),
    }
  }
}

/**
 * `task` as it was with `fields` (from `taskFieldReplay`): the row a filter
 * reads for that day. What the log doesn't hold (the title, the notes, the
 * recurrence, `createdAt`, `modifiedAt`) stays as it is now.
 */
export function taskAsOf(task: PersistedTodoItem, fields: TaskFields): PersistedTodoItem {
  const done = fields.state === 'done'
  return {
    ...task,
    isCompleted: done,
    completedAt: done ? (fields.completed ?? (task.isCompleted ? completionOf(task) : undefined)) : undefined,
    dueDate: fields.dueDate ?? undefined,
    nextFollowupAt: fields.nextFollowupAt ?? undefined,
    lastFollowupAt: fields.lastFollowupAt ?? undefined,
    statusId: fields.statusId ?? undefined,
    urgent: fields.markers.urgent || undefined,
    important: fields.markers.important || undefined,
    focus: fields.markers.focus || undefined,
  }
}
