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

/**
 * True when the scheduled date's resolved day is before today — covers both
 * fuzzy-expired (end-of-window passed) and precise past dates. Used for
 * "past" chip styling; `isScheduledExpired` remains fuzzy-only.
 */
export function isScheduledPast(
  t: Pick<TodoItem, 'scheduledDate'>,
  today: Date,
): boolean {
  const resolved = resolveScheduled(t.scheduledDate, today)
  if (!resolved) return false
  return resolved < startOfDay(today)
}

/** True when the deadline is before today. */
export function isDeadlinePast(
  t: Pick<TodoItem, 'dueDate'>,
  today: Date,
): boolean {
  if (!t.dueDate) return false
  return startOfDay(new Date(t.dueDate)) < startOfDay(today)
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

/**
 * Days from `today` to `d` (both normalized to midnight). Negative = past.
 * Returns null when `d` is null/undefined.
 */
export function daysUntil(d: Date | null | undefined, today: Date): number | null {
  if (!d) return null
  const target = startOfDay(new Date(d)).getTime()
  const base = startOfDay(today).getTime()
  return Math.round((target - base) / MS_PER_DAY)
}

/**
 * Proximity factor in [0.15, 1] — used to fade chip color from greyscale (far)
 * toward the full color (at or past the date). Linear ramp over 14 days, with
 * a floor so distant chips stay legible rather than becoming invisible.
 */
export function dateIntensity(days: number | null | undefined): number {
  if (days == null) return 1
  if (days <= 0) return 1
  const f = 1 - days / 14
  return Math.max(0.15, f)
}

/** Structural equality for ScheduledValue (handles Date by time, fuzzy by token). */
export function scheduledValuesEqual(a?: ScheduledValue | null, b?: ScheduledValue | null): boolean {
  if (!a && !b) return true
  if (!a || !b) return false
  if (a.kind !== b.kind) return false
  if (a.kind === 'fuzzy' && b.kind === 'fuzzy') return a.token === b.token
  if (a.kind === 'date' && b.kind === 'date') {
    return new Date(a.value).getTime() === new Date(b.value).getTime()
  }
  return false
}

export { startOfToday }
