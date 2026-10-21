import type { RecurrenceRule, RecurrenceType } from '../models/recurrence'
import type { TodoItem } from '../models/todo-item'
import { startOfToday } from './date'

/** Build a RecurrenceRule, capturing originalDayOfMonth for monthly/yearly to prevent drift. */
export function makeRecurrenceRule(type: RecurrenceType, dueDate?: Date | null): RecurrenceRule {
  const rule: RecurrenceRule = { type }
  if ((type === 'monthly' || type === 'quarterly' || type === 'yearly') && dueDate) {
    rule.originalDayOfMonth = new Date(dueDate).getDate()
  }
  return rule
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th')
  return `${n}${s}`
}

/** `Repeats every Monday` etc., from the rule and the task's due date. */
export function describeRecurrence(rule: RecurrenceRule, anchor: Date | undefined): string {
  const wd = anchor ? WEEKDAYS[anchor.getDay()] : undefined
  const dom = rule.originalDayOfMonth ?? anchor?.getDate()
  switch (rule.type) {
    case 'daily': return 'Repeats every day'
    case 'weekly': return wd ? `Repeats every ${wd}` : 'Repeats every week'
    case 'biweekly': return wd ? `Repeats every other ${wd}` : 'Repeats every two weeks'
    case 'monthly': return dom ? `Repeats monthly on the ${ordinal(dom)}` : 'Repeats every month'
    case 'quarterly': return 'Repeats every quarter'
    case 'yearly': return 'Repeats every year'
  }
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

const DAY_STEP: Partial<Record<RecurrenceRule['type'], number>> = { daily: 1, weekly: 7, biweekly: 14 }
const MONTH_STEP: Partial<Record<RecurrenceRule['type'], number>> = { monthly: 1, quarterly: 3, yearly: 12 }

/**
 * The occurrence a few steps short of `target`, reached arithmetically
 * instead of one step at a time: `date` advanced by the whole steps that
 * still end before `target`, less one (the walk that follows takes it from
 * there). Exactly what that many `advanceOnce` calls give — local midnight
 * of the stepped calendar day; for the month rules the kept day of the
 * month, clamped to the month's length. `date` itself when no step can be
 * skipped, or for a month rule without a kept day on the 29th or later
 * (each step locks to the day it lands on, so only a walk knows it).
 */
function skipToward(date: Date, rule: RecurrenceRule, target: Date): Date {
  const days = DAY_STEP[rule.type]
  if (days != null) {
    const between = Math.round(
      (Date.UTC(target.getFullYear(), target.getMonth(), target.getDate())
        - Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())) / 86_400_000,
    )
    const steps = Math.floor(between / days) - 1
    if (steps < 1) return date
    const next = new Date(date.getFullYear(), date.getMonth(), date.getDate() + steps * days)
    next.setHours(0, 0, 0, 0)
    return next
  }
  const months = MONTH_STEP[rule.type]
  if (months == null) return date
  if (rule.originalDayOfMonth == null && date.getDate() > 28) return date
  const targetDay = rule.originalDayOfMonth ?? date.getDate()
  const between = (target.getFullYear() - date.getFullYear()) * 12 + target.getMonth() - date.getMonth()
  const steps = Math.floor(between / months) - 1
  if (steps < 1) return date
  const next = new Date(date.getFullYear(), date.getMonth() + steps * months, 1)
  const maxDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate()
  next.setDate(Math.min(targetDay, maxDay))
  next.setHours(0, 0, 0, 0)
  return next
}

/**
 * Compute the next due date for a recurring task.
 * Keeps advancing until the result is >= today (start of day).
 */
export function computeNextDueDate(currentDueDate: Date, rule: RecurrenceRule): Date {
  const today = startOfToday()

  let next = skipToward(advanceOnce(currentDueDate, rule), rule, today)
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
  // Start from the first occurrence at or after rangeStart: skip to just
  // before the range, then walk.
  let current = dueDate < rangeStart ? skipToward(new Date(dueDate), rule, rangeStart) : new Date(dueDate)
  let iterations = 0
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
