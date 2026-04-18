import type { RecurrenceRule, RecurrenceType } from '../models/recurrence'
import type { TodoItem } from '../models/todo-item'
import type { ScheduledValue } from '../models/scheduled-value'
import { startOfToday } from '../utils/date'

/** Build a RecurrenceRule, capturing originalDayOfMonth for monthly/yearly to prevent drift. */
export function makeRecurrenceRule(type: RecurrenceType, dueDate?: Date | null): RecurrenceRule {
  const rule: RecurrenceRule = { type }
  if ((type === 'monthly' || type === 'quarterly' || type === 'yearly') && dueDate) {
    rule.originalDayOfMonth = new Date(dueDate).getDate()
  }
  return rule
}

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
 * The field a task's recurrence rule is anchored to:
 * prefers `dueDate` when present, otherwise a precise `scheduledDate`.
 * Returns null when the rule has no concrete date to advance
 * (e.g. only a fuzzy scheduled value, which can't be advanced).
 */
export function recurrenceAnchor(
  t: Pick<TodoItem, 'dueDate' | 'scheduledDate'>,
): { field: 'dueDate' | 'scheduledDate'; date: Date } | null {
  if (t.dueDate) return { field: 'dueDate', date: new Date(t.dueDate) }
  if (t.scheduledDate && t.scheduledDate.kind === 'date') {
    return { field: 'scheduledDate', date: new Date(t.scheduledDate.value) }
  }
  return null
}

/**
 * Compute the field update for advancing a recurring task to its next occurrence.
 * Returns null when the task has no rule or no concrete anchor date.
 */
export function advanceRecurring(
  t: Pick<TodoItem, 'dueDate' | 'scheduledDate' | 'recurrenceRule'>,
): { field: 'dueDate' | 'scheduledDate'; dueDate?: Date; scheduledDate?: ScheduledValue } | null {
  if (!t.recurrenceRule) return null
  const anchor = recurrenceAnchor(t)
  if (!anchor) return null
  const next = computeNextDueDate(anchor.date, t.recurrenceRule)
  if (anchor.field === 'dueDate') return { field: 'dueDate', dueDate: next }
  return { field: 'scheduledDate', scheduledDate: { kind: 'date', value: next } }
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
