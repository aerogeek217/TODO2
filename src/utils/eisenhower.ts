import type { TodoItem } from '../models/todo-item'
import { EISENHOWER_QUADRANTS, type EisenhowerQuadrant } from '../models/workspace-layout'
import { daysUntil } from './effective-date'
import { formatFollowupDay } from './followup'
import { isEffectivelyUrgent, isUrgentByDate, type UrgentDueWithinDays } from './urgency'

/**
 * The Eisenhower matrix: a task's quadrant comes from effective Urgent (flag
 * OR due within the app-wide range, see `utils/urgency`) and its Important
 * flag. Dropping a task on a quadrant gives it that quadrant's flags — except
 * that a task urgent because of its due date can't leave the urgent column
 * (clearing a flag wouldn't move it) and never gets the urgent flag written.
 */

export interface QuadrantFlags {
  urgent: boolean
  important: boolean
}

export const QUADRANT_FLAGS: Record<EisenhowerQuadrant, QuadrantFlags> = {
  do: { urgent: true, important: true },
  schedule: { urgent: false, important: true },
  delegate: { urgent: true, important: false },
  drop: { urgent: false, important: false },
}

export const QUADRANT_NAME: Record<EisenhowerQuadrant, string> = {
  do: 'Do',
  schedule: 'Schedule',
  delegate: 'Delegate',
  drop: 'Drop',
}

/** The plain-words subtitle of a quadrant. */
export const QUADRANT_SUBTITLE: Record<EisenhowerQuadrant, string> = {
  do: 'Urgent and important',
  schedule: 'Important, not urgent',
  delegate: 'Urgent, not important',
  drop: 'Neither',
}

export function quadrantOf(urgent: boolean, important: boolean): EisenhowerQuadrant {
  if (urgent) return important ? 'do' : 'delegate'
  return important ? 'schedule' : 'drop'
}

type MatrixFields = Pick<TodoItem, 'urgent' | 'important' | 'dueDate' | 'isCompleted'>

export interface EisenhowerPlacement {
  quadrant: EisenhowerQuadrant
  /** The due date alone makes the task urgent (open tasks only). */
  urgentByDate: boolean
}

/** Where a task sits: completed tasks by their flags only. */
export function classifyEisenhower(todo: MatrixFields, today: Date, range: UrgentDueWithinDays): EisenhowerPlacement {
  return {
    quadrant: quadrantOf(isEffectivelyUrgent(todo, today, range), todo.important === true),
    urgentByDate: isUrgentByDate(todo, today, range),
  }
}

type SortFields = Pick<TodoItem, 'dueDate' | 'isCompleted' | 'sortOrder'>

/**
 * Order inside a quadrant: open before completed; then by due date (overdue
 * first, as the earliest), tasks without a due date last; ties by `sortOrder`.
 */
export function compareInQuadrant(a: SortFields, b: SortFields): number {
  if (a.isCompleted !== b.isCompleted) return a.isCompleted ? 1 : -1
  const ad = a.dueDate ? new Date(a.dueDate).getTime() : null
  const bd = b.dueDate ? new Date(b.dueDate).getTime() : null
  if (ad != null && bd != null && ad !== bd) return ad - bd
  if (ad != null && bd == null) return -1
  if (ad == null && bd != null) return 1
  return a.sortOrder - b.sortOrder
}

/** Tasks per quadrant, each sorted by {@link compareInQuadrant}. */
export function buildQuadrants<T extends MatrixFields & SortFields>(
  todos: readonly T[],
  today: Date,
  range: UrgentDueWithinDays,
): Record<EisenhowerQuadrant, T[]> {
  const out: Record<EisenhowerQuadrant, T[]> = { do: [], schedule: [], delegate: [], drop: [] }
  for (const t of todos) out[classifyEisenhower(t, today, range).quadrant].push(t)
  for (const q of EISENHOWER_QUADRANTS) out[q].sort(compareInQuadrant)
  return out
}

/** The flag writes one task needs: only the flags that change. */
export interface FlagChange {
  todoId: number
  urgent?: boolean
  important?: boolean
}

export type QuadrantDropResult<T> =
  /** Nothing changes (every task is already there). */
  | { kind: 'none' }
  /** Refused: these tasks are urgent by their due date and the target isn't urgent. */
  | { kind: 'blocked'; blocked: T[] }
  | { kind: 'apply'; changes: FlagChange[] }

/**
 * What dropping `todos` on quadrant `target` does. Each task takes the
 * target's flags where they differ from its effective quadrant (sideways:
 * Urgent; up / down: Important; diagonal: both). A task urgent by its due
 * date (flagged or not) blocks a drop on a not-urgent quadrant — one blocked
 * task refuses the whole drop — and into an urgent quadrant only its
 * Important flag changes (the urgent flag is never written for it).
 */
export function resolveQuadrantDrop<T extends MatrixFields & { id: number }>(
  todos: readonly T[],
  target: EisenhowerQuadrant,
  today: Date,
  range: UrgentDueWithinDays,
): QuadrantDropResult<T> {
  const flags = QUADRANT_FLAGS[target]
  const blocked: T[] = []
  const changes: FlagChange[] = []
  for (const t of todos) {
    const byDate = isUrgentByDate(t, today, range)
    if (byDate && !flags.urgent) {
      blocked.push(t)
      continue
    }
    const change: FlagChange = { todoId: t.id }
    if (!byDate && (t.urgent === true) !== flags.urgent) change.urgent = flags.urgent
    if ((t.important === true) !== flags.important) change.important = flags.important
    if (change.urgent !== undefined || change.important !== undefined) changes.push(change)
  }
  if (blocked.length > 0) return { kind: 'blocked', blocked }
  return changes.length > 0 ? { kind: 'apply', changes } : { kind: 'none' }
}

/** `+ Urgent`, `− Important`, `+ Urgent · − Important` — what a drop changes. */
export function dropPreviewLabel(changes: readonly FlagChange[]): string {
  const parts: string[] = []
  const urgent = changes.find((c) => c.urgent !== undefined)?.urgent
  const important = changes.find((c) => c.important !== undefined)?.important
  if (urgent !== undefined) parts.push(`${urgent ? '+' : '−'} Urgent`)
  if (important !== undefined) parts.push(`${important ? '+' : '−'} Important`)
  return parts.join(' · ')
}

/**
 * The undo step / snackbar text: `Marked urgent · Send board update`,
 * `Marked urgent, not important · 3 tasks`.
 */
export function dropDescription(changes: readonly FlagChange[], titleOf: (todoId: number) => string | undefined): string {
  const urgent = changes.find((c) => c.urgent !== undefined)?.urgent
  const important = changes.find((c) => c.important !== undefined)?.important
  const parts: string[] = []
  if (urgent !== undefined) parts.push(urgent ? 'urgent' : 'not urgent')
  if (important !== undefined) parts.push(important ? 'important' : 'not important')
  const first = changes[0]
  const what = changes.length === 1 && first ? (titleOf(first.todoId) ?? 'task') : `${changes.length} tasks`
  return `Marked ${parts.join(', ')} · ${what}`
}

function withinPhrase(range: number): string {
  return range === 0 ? 'due today or overdue' : `due within ${range} ${range === 1 ? 'day' : 'days'}`
}

/**
 * The refusal tooltip's lines for a blocked drop on `target`:
 * `Can’t move to Drop` / why / what to change.
 */
export function blockedDropLines(
  target: EisenhowerQuadrant,
  blocked: readonly (MatrixFields & { title: string })[],
  total: number,
  today: Date,
  range: UrgentDueWithinDays,
): [string, string, string] {
  const title = `Can’t move to ${QUADRANT_NAME[target]}`
  const only = blocked.length === 1 && total === 1 ? blocked[0] : undefined
  if (only?.dueDate && range != null) {
    const days = daysUntil(only.dueDate, today) ?? 0
    const day = formatFollowupDay(only.dueDate, today)
    const why = days < 0
      ? `${only.title} is overdue (${day}), so it counts as urgent.`
      : days === 0
        ? `${only.title} is due today, so it counts as urgent.`
        : `${only.title} is due ${day}, within ${range} ${range === 1 ? 'day' : 'days'}, so it counts as urgent.`
    return [title, why, 'Change its due date or the due-soon range first.']
  }
  const n = blocked.length
  const verb = n === 1 ? 'is' : 'are'
  const they = n === 1 ? 'it counts' : 'they count'
  const why = `${n} of ${total} ${total === 1 ? 'task' : 'tasks'} ${verb} ${range == null ? 'due soon' : withinPhrase(range)}, so ${they} as urgent.`
  return [title, why, `Change ${n === 1 ? 'its due date' : 'their due dates'} or the due-soon range first.`]
}

/** Where a task would land among a quadrant's sorted tasks (its index without it). */
export function insertionIndex<T extends SortFields & { id: number }>(sorted: readonly T[], task: T): number {
  const others = sorted.filter((t) => t.id !== task.id)
  const i = others.findIndex((t) => compareInQuadrant(task, t) < 0)
  return i === -1 ? others.length : i
}
