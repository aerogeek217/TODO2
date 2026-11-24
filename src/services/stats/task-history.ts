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
 * task's people and tags (each later add / remove undone, newest first),
 * and the planned day (`planned`, since `planLogSince`). A
 * field the log didn't cover yet (before `historyLogSince` for the H3
 * fields, before `planLogSince` for the planned day) thus reads as it was
 * when the log began — its first logged change's `from`, or what it is now.
 * `taskFieldReplayAt` reads the same replay at a moment instead of a day's
 * end. `filter-history.historyExactness` says
 * when a filter's past counts are exact.
 */

/** When a completed task was completed: `completedAt`, or `modifiedAt` for a row without one. */
function completionOf(task: Pick<PersistedTodoItem, 'completedAt' | 'modifiedAt'>): Date {
  return new Date(task.completedAt ?? task.modifiedAt)
}

type TaskState = 'absent' | 'open' | 'done'

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
interface TaskEvents {
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
interface TaskAtDayEnd {
  state: TaskState
  /** When a done task was completed (`null` when the log doesn't say); `null` unless done. */
  completed: Date | null
  /** Its due date then (`null` unless open). */
  due: Date | null
}

const ABSENT: TaskAtDayEnd = { state: 'absent', completed: null, due: null }


/**
 * A moment a replay reads the task at: which events come after it, and
 * whether the task's own dates put it before its creation or before its
 * completion (for a task completed now).
 */
interface ReplayMoment {
  later: (e: DatedEvent) => boolean
  beforeCreated: boolean
  beforeCompletion: boolean
}

/** The task at `at` (see the module comment for the rule). */
function stateAt(task: PersistedTodoItem, events: TaskEvents, completion: Date | null, at: ReplayMoment): TaskAtDayEnd {
  const { states, deadlines } = events
  if (at.beforeCreated) return ABSENT
  const next = states.find(at.later)
  let state: TaskState
  let completed: Date | null = null
  if (next) {
    state = stateBefore(next.type)
    if (state === 'done') {
      const last = states.filter((e) => !at.later(e) && e.type === 'completed').at(-1)
      completed = last ? new Date(last.time) : null
    }
  } else if (completion) {
    // Done now, with no later event: done since its completion.
    state = at.beforeCompletion ? 'open' : 'done'
    completed = completion
  } else {
    state = 'open'
  }
  if (state === 'absent') return ABSENT
  if (state === 'done') return { state, completed, due: null }
  const nextDeadline = deadlines.find(at.later)
  return { state, completed: null, due: nextDeadline ? nextDeadline.from : (task.dueDate ?? null) }
}

/** The moment at a day's end, in days from `origin` (`taskReplay`, `taskFieldReplay`). */
function dayEndMoments(task: PersistedTodoItem, origin: Date): (day: number) => ReplayMoment {
  const createdDay = daysUntil(task.createdAt, origin)
  const completion = task.isCompleted ? completionOf(task) : null
  const completedDay = completion ? daysUntil(completion, origin) : null
  return (day) => ({
    later: (e) => e.day > day,
    beforeCreated: createdDay != null && createdDay > day,
    beforeCompletion: completedDay != null && completedDay > day,
  })
}

/** The moment just after `time` (epoch ms): every event at or before it has happened (`taskFieldReplayAt`). */
function timeMoments(task: PersistedTodoItem): (time: number) => ReplayMoment {
  const created = new Date(task.createdAt).getTime()
  const completion = task.isCompleted ? completionOf(task).getTime() : null
  return (time) => ({
    later: (e) => e.time > time,
    beforeCreated: !Number.isNaN(created) && created > time,
    beforeCompletion: completion != null && !Number.isNaN(completion) && completion > time,
  })
}

/**
 * `task`'s replay over its `events` (from `eventsByTask`, the same `origin`):
 * the task at the end of a day, given in days from `origin` (`-1` = the day
 * before it). See the module comment for the rule.
 */
export function taskReplay(task: PersistedTodoItem, events: TaskEvents | undefined, origin: Date): (day: number) => TaskAtDayEnd {
  const completion = task.isCompleted ? completionOf(task) : null
  const moment = dayEndMoments(task, origin)
  return (day) => stateAt(task, events ?? NO_EVENTS, completion, moment(day))
}

/** A task's logged fields at a day's end (`taskFieldReplay`), or at a moment (`taskFieldReplayAt`). */
export interface TaskFields {
  /** Open or done (an absent task has no fields). */
  state: Exclude<TaskState, 'absent'>
  /** When a done task was completed (`null` when the log doesn't say); `null` while open. */
  completed: Date | null
  dueDate: Date | null
  nextFollowupAt: Date | null
  lastFollowupAt: Date | null
  /**
   * The planned day (`doDate`), from the `planned` events when they were
   * read. Before `planLogSince` it reads as it was when that log began.
   * `taskAsOf` leaves it out: a filter's history reads the planned day as
   * it is now.
   */
  doDate: Date | null
  statusId: number | null
  markers: MarkerFlags
  personIds: readonly number[]
  tagIds: readonly number[]
}

/** A task's people and tags now: where the replay of its assignments starts. */
interface TaskAssignmentsNow {
  personIds: readonly number[]
  tagIds: readonly number[]
}

/** The scalar fields a replay reads back from their events' `from`. */
type ScalarType = 'deadline' | 'followup' | 'followedUp' | 'planned' | 'status' | 'marker'

const SCALAR_TYPES: readonly ScalarType[] = ['deadline', 'followup', 'followedUp', 'planned', 'status', 'marker']

function isoOf(d: Date | undefined): string | null {
  return d ? new Date(d).toISOString() : null
}

/** `task`'s every logged field at a moment, replayed backwards from now (see the module comment). */
function fieldReplay(
  task: PersistedTodoItem,
  events: TaskEvents | undefined,
  assignments: TaskAssignmentsNow,
): (at: ReplayMoment) => TaskFields | null {
  const evs = events ?? NO_EVENTS
  const completion = task.isCompleted ? completionOf(task) : null
  const all = evs.all
  const byType = (type: TodoEventType) => all.filter((e) => e.type === type)
  const scalars = new Map(SCALAR_TYPES.map((type) => [type, byType(type)] as const))
  const people = byType('person')
  const tags = byType('tag')
  const now: Record<ScalarType, string | number | null> = {
    deadline: isoOf(task.dueDate),
    followup: isoOf(task.nextFollowupAt),
    followedUp: isoOf(task.lastFollowupAt),
    planned: isoOf(task.doDate),
    status: task.statusId ?? null,
    marker: encodeMarkerFlags(task),
  }
  /** The field's stored value at the moment: its next event's `from`, else its value now. */
  const scalar = (type: ScalarType, at: ReplayMoment) => {
    const next = scalars.get(type)?.find(at.later)
    return next ? next.fromValue : now[type]
  }
  /** The set at the moment: `current` with each later add / remove undone, newest first. */
  const replaySet = (list: readonly DatedEvent[], at: ReplayMoment, current: readonly number[]): readonly number[] => {
    const later = list.filter(at.later)
    if (later.length === 0) return current
    const ids = new Set(current)
    for (const e of later.reverse()) {
      if (typeof e.toValue === 'number') ids.delete(e.toValue)
      else if (typeof e.fromValue === 'number') ids.add(e.fromValue)
    }
    return [...ids]
  }
  return (at) => {
    const state = stateAt(task, evs, completion, at)
    if (state.state === 'absent') return null
    const status = scalar('status', at)
    return {
      state: state.state,
      completed: state.completed,
      dueDate: dateOf(scalar('deadline', at)),
      nextFollowupAt: dateOf(scalar('followup', at)),
      lastFollowupAt: dateOf(scalar('followedUp', at)),
      doDate: dateOf(scalar('planned', at)),
      statusId: typeof status === 'number' ? status : null,
      markers: decodeMarkerFlags(scalar('marker', at)),
      personIds: replaySet(people, at, assignments.personIds),
      tagIds: replaySet(tags, at, assignments.tagIds),
    }
  }
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
  const fields = fieldReplay(task, events, assignments)
  const moment = dayEndMoments(task, origin)
  return (day) => fields(moment(day))
}

/**
 * The same replay at a moment rather than a day's end: the task's fields
 * just after `time` (epoch ms) — every event at or before it applied, none
 * after; absent before its `createdAt`, open before the completion of a task
 * completed now with no later event. The week load reads a day's start and
 * each change during it this way.
 */
export function taskFieldReplayAt(
  task: PersistedTodoItem,
  events: TaskEvents | undefined,
  assignments: TaskAssignmentsNow,
): (time: number) => TaskFields | null {
  const fields = fieldReplay(task, events, assignments)
  const moment = timeMoments(task)
  return (time) => fields(moment(time))
}

/**
 * `task` as it was with `fields` (from `taskFieldReplay`): the row a filter
 * reads for that day. What the log doesn't hold (the title, the notes, the
 * recurrence, `createdAt`, `modifiedAt`) stays as it is now, and so does the
 * planned day (a filter's history doesn't replay it).
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
