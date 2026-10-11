import type { PersistedTodoItem } from '../models'

/**
 * Build the `update(todo)` payload for rescheduling a todo to a specific day
 * (calendar drops): moves the due date, keeping its time component, or noon
 * when the task had no due date.
 */
export function buildRescheduleUpdate(todo: PersistedTodoItem, targetDate: Date): PersistedTodoItem {
  const newDate = new Date(targetDate)
  if (todo.dueDate) {
    const timeSource = new Date(todo.dueDate)
    newDate.setHours(timeSource.getHours(), timeSource.getMinutes(), timeSource.getSeconds())
  } else {
    newDate.setHours(12, 0, 0, 0)
  }
  return { ...todo, dueDate: newDate, modifiedAt: new Date() }
}
