import { startOfDay, startOfToday, MS_PER_DAY } from './date'
import type { FuzzyToken, ScheduledValue } from '../models/scheduled-value'
import type { TodoItem } from '../models/todo-item'

/**
 * Resolve a fuzzy token to a concrete Date: the end-of-window (inclusive last day).
 * Sunday is treated as end-of-week; locale-aware week start is a later plan.
 */
export function resolveFuzzy(token: FuzzyToken, today: Date): Date {
  const base = startOfDay(today)
  switch (token) {
    case 'today':
      return base
    case 'tomorrow':
      return startOfDay(new Date(base.getTime() + MS_PER_DAY))
    case 'this-week': {
      const dow = base.getDay()
      const daysUntilSunday = dow === 0 ? 0 : 7 - dow
      return startOfDay(new Date(base.getTime() + daysUntilSunday * MS_PER_DAY))
    }
    case 'next-week': {
      const dow = base.getDay()
      const daysUntilSunday = dow === 0 ? 0 : 7 - dow
      return startOfDay(new Date(base.getTime() + (daysUntilSunday + 7) * MS_PER_DAY))
    }
    case 'this-month':
      return new Date(base.getFullYear(), base.getMonth() + 1, 0)
    case 'next-month':
      return new Date(base.getFullYear(), base.getMonth() + 2, 0)
  }
}

/** Resolve scheduledDate to a concrete Date, or null if unset. */
export function resolveScheduled(s: ScheduledValue | undefined, today: Date): Date | null {
  if (!s) return null
  if (s.kind === 'date') return startOfDay(new Date(s.value))
  return resolveFuzzy(s.token, today)
}

/**
 * The unified "when does this task want attention" date.
 * Returns min(resolvedScheduled, deadline), or null if both absent (Someday).
 */
export function effectiveDate(
  t: Pick<TodoItem, 'scheduledDate' | 'dueDate'>,
  today: Date,
): Date | null {
  const sched = resolveScheduled(t.scheduledDate, today)
  const due = t.dueDate ? startOfDay(new Date(t.dueDate)) : null
  if (sched && due) return sched < due ? sched : due
  return sched ?? due
}

/**
 * True when `scheduledDate` is fuzzy and its end-of-window is before today.
 * Precise-scheduled tasks are NOT "expired"; this is only for fuzzy values.
 */
export function isScheduledExpired(
  t: Pick<TodoItem, 'scheduledDate'>,
  today: Date,
): boolean {
  if (!t.scheduledDate || t.scheduledDate.kind !== 'fuzzy') return false
  const resolved = resolveFuzzy(t.scheduledDate.token, today)
  return resolved < startOfDay(today)
}

/** Human-readable label for a scheduled chip. */
export function scheduledLabel(s: ScheduledValue, today: Date): string {
  if (s.kind === 'fuzzy') {
    switch (s.token) {
      case 'today': return 'Today'
      case 'tomorrow': return 'Tomorrow'
      case 'this-week': return 'This week'
      case 'next-week': return 'Next week'
      case 'this-month': return 'This month'
      case 'next-month': return 'Next month'
    }
  }
  const d = startOfDay(new Date(s.value))
  const base = startOfDay(today)
  const diff = Math.round((d.getTime() - base.getTime()) / MS_PER_DAY)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Tomorrow'
  if (diff === -1) return 'Yesterday'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export { startOfToday }
