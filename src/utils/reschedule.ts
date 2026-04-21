import type { PersistedTodoItem } from '../models'

/**
 * Build the `update(todo)` payload for rescheduling a todo to a specific day.
 * Mirrors `CalendarView`'s drop handler: preserves the time component from
 * whichever field (scheduledDate or dueDate) drives placement, defaults to
 * noon when neither has a time. When the todo has a scheduledDate, reschedule
 * commits to a precise `{ kind: 'date' }` value regardless of its prior kind;
 * otherwise the dueDate is updated.
 */
export function buildRescheduleUpdate(todo: PersistedTodoItem, targetDate: Date): PersistedTodoItem {
  const newDate = new Date(targetDate)
  const timeSource = todo.scheduledDate?.kind === 'date'
    ? new Date(todo.scheduledDate.value)
    : todo.dueDate
      ? new Date(todo.dueDate)
      : null
  if (timeSource) {
    newDate.setHours(timeSource.getHours(), timeSource.getMinutes(), timeSource.getSeconds())
  } else {
    newDate.setHours(12, 0, 0, 0)
  }
  const modifiedAt = new Date()
  if (todo.scheduledDate) {
    return { ...todo, scheduledDate: { kind: 'date', value: newDate }, modifiedAt }
  }
  return { ...todo, dueDate: newDate, modifiedAt }
}
