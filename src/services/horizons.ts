import type { PersistedTodoItem } from '../models'
import type { WeekStart } from '../utils/effective-date'
import { startOfDay, MS_PER_DAY } from '../utils/date'

/** Start of the week containing `today`, honoring `weekStartsOn` (0 = Sun, 1 = Mon). */
export function startOfWeek(today: Date, ws: WeekStart): Date {
  const base = startOfDay(today)
  const dow = base.getDay()
  const days = (dow - ws + 7) % 7
  return new Date(base.getTime() - days * MS_PER_DAY)
}

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
