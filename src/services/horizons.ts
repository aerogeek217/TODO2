import type { PersistedTodoItem } from '../models'
import type { WeekStart } from '../utils/effective-date'

/**
 * Which date drove a todo's horizon placement. Mirrors `effectiveDate`'s
 * priority: a `scheduledDate` (precise or fuzzy, regardless of past/future)
 * trumps a `dueDate`. When neither is set we still report `'scheduled'` —
 * the bar segment for that bucket will read 0 anyway since these todos only
 * surface in horizons whose predicate explicitly accepts no-date rows
 * (Someday-style).
 */
export function classifyByDateSource(
  todo: Pick<PersistedTodoItem, 'scheduledDate' | 'dueDate'>,
  _today: Date,
  _weekStartsOn: WeekStart,
): 'scheduled' | 'due' {
  if (todo.scheduledDate != null) return 'scheduled'
  if (todo.dueDate != null) return 'due'
  return 'scheduled'
}
