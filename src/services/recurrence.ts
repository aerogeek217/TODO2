import type { RecurrenceRule, RecurrenceType } from '../models/recurrence'
import type { TodoItem } from '../models/todo-item'
import { startOfToday } from '../utils/date'

/** Build a RecurrenceRule, capturing originalDayOfMonth for monthly/yearly to prevent drift. */
export function makeRecurrenceRule(type: RecurrenceType, dueDate?: Date | null): RecurrenceRule {
  const rule: RecurrenceRule = { type }
  if ((type === 'monthly' || type === 'quarterly' || type === 'yearly') && dueDate) {
    rule.originalDayOfMonth = new Date(dueDate).getDate()
  }
  return rule
}

/**
 * Advance a due date by one recurrence interval.
 *
 * Day-of-month integrity: monthly/quarterly/yearly read `originalDayOfMonth`
 * from the rule (captured at creation), so a Jan-31 monthly rule that lands on
 * Feb-28 elevates back to Mar-31; a Feb-29 yearly rule that lands on Feb-28 in
 * year N+1 elevates back to Feb-29 in the next leap year. The fallback to
 * `next.getDate()` only applies when the rule was constructed without a date
 * anchor (legacy rules); those will lock to whatever day they last landed on.
 *
 * DST: `setHours(0, 0, 0, 0)` re-anchors to local midnight so spring-forward
 * (which can shift 00:00 → 01:00) and fall-back (00:00 → 23:00 prev day) don't
 * leak into the stored date. Local-midnight semantics mean a same-day fixture
 * is timezone-stable across the DST boundaries.
 */
function advanceOnce(date: Date, rule: RecurrenceRule): Date {
  const next = new Date(date)
  switch (rule.type) {
    case 'daily':
      next.setDate(next.getDate() + 1)
      break
    case 'weekly':
      next.setDate(next.getDate() + 7)
      break
    case 'biweekly':
      next.setDate(next.getDate() + 14)
      break
    case 'monthly': {
      const targetDay = rule.originalDayOfMonth ?? next.getDate()
      // Set to 1 first to avoid overflow (e.g. Jan 31 + 1 month → Mar 3)
      next.setDate(1)
      next.setMonth(next.getMonth() + 1)
      const maxDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate()
      next.setDate(Math.min(targetDay, maxDay))
      break
    }
    case 'quarterly': {
      const targetDay = rule.originalDayOfMonth ?? next.getDate()
      next.setDate(1)
      next.setMonth(next.getMonth() + 3)
      const maxDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate()
      next.setDate(Math.min(targetDay, maxDay))
      break
    }
    case 'yearly': {
      const targetDay = rule.originalDayOfMonth ?? next.getDate()
      next.setDate(1)
      next.setFullYear(next.getFullYear() + 1)
      const maxDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate()
      next.setDate(Math.min(targetDay, maxDay))
      break
    }
  }
  // Re-anchor to local midnight; see advanceOnce JSDoc for DST rationale.
  next.setHours(0, 0, 0, 0)
  return next
}

const MAX_ITERATIONS = 10_000

/**
 * Compute the next due date for a recurring task.
 * Keeps advancing until the result is >= today (start of day).
 */
export function computeNextDueDate(currentDueDate: Date, rule: RecurrenceRule): Date {
  const today = startOfToday()

  let next = advanceOnce(currentDueDate, rule)
  let iterations = 0
  while (next < today) {
    next = advanceOnce(next, rule)
    if (++iterations >= MAX_ITERATIONS) break
  }
  return next
}

/**
 * The next due date for a recurring task's next occurrence: its rule
 * advances from the due date. Returns null when the task has no rule or no
 * due date (the rule has nothing to advance).
 */
export function advanceRecurring(
  t: Pick<TodoItem, 'dueDate' | 'recurrenceRule'>,
): { dueDate: Date } | null {
  if (!t.recurrenceRule || t.dueDate == null) return null
  return { dueDate: computeNextDueDate(new Date(t.dueDate), t.recurrenceRule) }
}

/**
 * Generate all recurring instances between start and end dates (exclusive of end).
 * Returns an array of dates for virtual calendar instances.
 */
export function generateRecurringInstances(
  dueDate: Date,
  rule: RecurrenceRule,
  rangeStart: Date,
  rangeEnd: Date,
): Date[] {
  const instances: Date[] = []
  // Start from the first occurrence at or after rangeStart
  let current = new Date(dueDate)
  let iterations = 0
  // Advance to reach the range
  while (current < rangeStart) {
    current = advanceOnce(current, rule)
    if (++iterations >= MAX_ITERATIONS) return instances
  }
  // Collect instances within range
  while (current < rangeEnd) {
    instances.push(new Date(current))
    current = advanceOnce(current, rule)
    if (++iterations >= MAX_ITERATIONS) break
  }
  return instances
}
