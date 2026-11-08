import type { TodoItem } from '../models/todo-item'
import { isDeadlinePast } from './effective-date'
import { isFollowupOverdue } from './followup'
import { startOfDay } from './date'
import { isUrgentByDate, type UrgentDueWithinDays } from './urgency'

/**
 * A task's due and follow-up dates as its row colours them — the one
 * reading the Rows date cells, Stacked's details line and a Lines row
 * (`utils/list-zoom.rowTone` / `lineDate`) share.
 */

/**
 * The due date's state: `past` — before today (bold, the late colour; a
 * completed task's too, its row's own look over it), `soon` — inside the
 * Settings "due soon" range, the one that makes a task urgent (open tasks
 * only). Both false without a due date.
 */
export interface DueState {
  past: boolean
  soon: boolean
}

export function dueState(
  todo: Pick<TodoItem, 'dueDate' | 'isCompleted' | 'urgent'>,
  today: Date,
  range: UrgentDueWithinDays,
): DueState {
  return { past: isDeadlinePast(todo, today), soon: isUrgentByDate(todo, today, range) }
}

/**
 * The next follow-up's state: `late` — before today, `today`, else
 * `upcoming` (a completed task's always: nothing is chased on it);
 * `undefined` without one.
 */
export type FollowupState = 'late' | 'today' | 'upcoming'

export function followupState(
  todo: Pick<TodoItem, 'nextFollowupAt' | 'isCompleted'>,
  today: Date,
): FollowupState | undefined {
  const next = todo.nextFollowupAt
  if (!next) return undefined
  if (isFollowupOverdue(todo, today)) return 'late'
  if (!todo.isCompleted && startOfDay(new Date(next)).getTime() === startOfDay(today).getTime()) return 'today'
  return 'upcoming'
}
