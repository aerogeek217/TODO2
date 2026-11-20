import type { Interval } from '../models/interval'
import type { RecurrenceRule } from '../models/recurrence'
import type { TodoItem } from '../models/todo-item'
import { formatDateWith, startOfToday } from './date'
import { addInterval, unitWord } from './interval'

/** Whether an interval counts calendar months (`m`, `y`): a repeat by it keeps its day of the month. */
function countsMonths(every: Interval): boolean {
  return every.unit === 'm' || every.unit === 'y'
}

/**
 * Build a repeat every `every` from `dueDate`, keeping the due date's day of
 * the month for a month or year interval (`originalDayOfMonth`) so it never
 * drifts.
 */
export function makeRecurrenceRule(every: Interval, dueDate?: Date | null): RecurrenceRule {
  const rule: RecurrenceRule = { every: { count: every.count, unit: every.unit } }
  if (countsMonths(every) && dueDate) {
    rule.originalDayOfMonth = new Date(dueDate).getDate()
  }
  return rule
}

/**
 * What a new due date writes on a task (the editor's due date, the review
 * card's): the date, and the repeat rule anchored to it — a repeating task
 * keeps repeating, from the new date; clearing the date drops the rule (it
 * is anchored to the due date).
 */
export function dueDateChanges(
  next: Date | null,
  every: Interval | null | undefined,
): Pick<TodoItem, 'dueDate' | 'recurrenceRule'> {
  return {
    dueDate: next ?? undefined,
    recurrenceRule: every && next ? makeRecurrenceRule(every, next) : undefined,
  }
}

/**
 * A repeat in words, as rows, the calendar, the stacked details and Quick
 * Add's chip say it: `Every day`, `Every week` — `Every Mon` for a week from
 * a due date —, `Every 2 weeks`, `Every month`, `Every 3 months`, `Every year`.
 */
export function describeRecurrence(rule: Pick<RecurrenceRule, 'every'>, anchor: Date | undefined): string {
  const { count, unit } = rule.every
  if (count === 1) {
    if (unit === 'w' && anchor) return `Every ${formatDateWith(anchor, { weekday: 'short' })}`
    return `Every ${unitWord(unit, 1)}`
  }
  return `Every ${count} ${unitWord(unit, count)}`
}

/** A day as the repeat's read-back names it: `Mon, Dec 7`. */
function repeatDay(d: Date): string {
  return formatDateWith(d, { weekday: 'short', month: 'short', day: 'numeric' })
}

/**
 * The repeat field's read-back (the task editor's and the review card's Due
 * cell): `Every 2 weeks · next Mon, Dec 7` — the next due date completing the
 * task would give —, the words alone without a due date.
 */
export function repeatReadBack(rule: RecurrenceRule, due: Date | null | undefined): string {
  const words = describeRecurrence(rule, due ?? undefined)
  if (due == null) return words
  return `${words} · next ${repeatDay(computeNextDueDate(new Date(due), rule))}`
}

/**
 * Advance a due date by one repeat interval.
 *
 * Day-of-month integrity: a month or year interval reads `originalDayOfMonth`
 * from the rule (captured when it was set), so a Jan-31 monthly rule that
 * lands on Feb-28 elevates back to Mar-31; a Feb-29 yearly rule that lands on
 * Feb-28 in year N+1 elevates back to Feb-29 in the next leap year. The
 * fallback to the date's own day only applies when the rule was constructed
 * without a date anchor (legacy rules); those lock to whatever day they last
 * landed on.
 *
 * DST: `addInterval` re-anchors to local midnight, so spring-forward (which
 * can shift 00:00 → 01:00) and fall-back (00:00 → 23:00 prev day) don't leak
 * into the stored date.
 */
function advanceOnce(date: Date, rule: RecurrenceRule): Date {
  return addInterval(date, rule.every, 1, countsMonths(rule.every) ? rule.originalDayOfMonth : undefined)
}

const MAX_ITERATIONS = 10_000

/**
 * The occurrence a few steps short of `target`, reached arithmetically
 * instead of one step at a time: `date` advanced by the whole steps that
 * still end before `target`, less one (the walk that follows takes it from
 * there). Exactly what that many `advanceOnce` calls give — local midnight
 * of the stepped calendar day; for a month or year interval the kept day of
 * the month, clamped to the month's length. `date` itself when no step can
 * be skipped, or for a month interval without a kept day on the 29th or
 * later (each step locks to the day it lands on, so only a walk knows it).
 */
function skipToward(date: Date, rule: RecurrenceRule, target: Date): Date {
  const { count, unit } = rule.every
  if (unit === 'd' || unit === 'w') {
    const days = count * (unit === 'w' ? 7 : 1)
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
  const months = count * (unit === 'y' ? 12 : 1)
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
