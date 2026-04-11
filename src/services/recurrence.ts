import type { RecurrenceRule } from '../models/recurrence'
import { startOfToday } from '../utils/date'

/** Advance a due date by one recurrence interval. */
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
      const day = next.getDate()
      next.setMonth(next.getMonth() + 1)
      // Clamp to end of month (e.g. Jan 31 → Feb 28)
      if (next.getDate() !== day) {
        next.setDate(0) // last day of previous month
      }
      break
    }
    case 'yearly': {
      const day = next.getDate()
      next.setFullYear(next.getFullYear() + 1)
      // Handle Feb 29 → Feb 28 in non-leap years
      if (next.getDate() !== day) {
        next.setDate(0)
      }
      break
    }
  }
  // Normalize to midnight to prevent DST drift (spring-forward can shift to 23:00 or 01:00)
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
