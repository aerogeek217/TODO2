import type { PersistedTodoItem, TodoChanges } from '../models'
import type { CalendarDateType } from '../models/workspace-layout'

/** The task field a calendar date type sets. */
export const CALENDAR_DATE_FIELD = {
  due: 'dueDate',
  followup: 'nextFollowupAt',
} as const satisfies Record<CalendarDateType, keyof PersistedTodoItem>

/**
 * Build the `update(id, changes)` changes for moving one of a todo's dates to a
 * specific day (calendar drops): the due date (default) or the next
 * follow-up. Keeps that field's time of day, or noon when the task had no
 * such date. The other date is untouched; setting a follow-up never touches
 * `lastFollowupAt`.
 */
export function buildRescheduleUpdate(
  todo: Pick<PersistedTodoItem, 'dueDate' | 'nextFollowupAt'>,
  targetDate: Date,
  type: CalendarDateType = 'due',
): TodoChanges {
  const field = CALENDAR_DATE_FIELD[type]
  const current = todo[field]
  const newDate = new Date(targetDate)
  if (current) {
    const timeSource = new Date(current)
    newDate.setHours(timeSource.getHours(), timeSource.getMinutes(), timeSource.getSeconds(), 0)
  } else {
    newDate.setHours(12, 0, 0, 0)
  }
  return { [field]: newDate }
}
