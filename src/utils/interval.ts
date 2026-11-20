import type { Interval, IntervalUnit } from '../models/interval'
import { startOfDay } from './date'

/**
 * The one interval grammar (`models/interval`): a whole number and `d`, `w`,
 * `m` or `y` — `3d`, `2w`, `1m`, `1y` — read, written, said in words and
 * added to a day. The follow-up intervals (`utils/followup`, which re-exports
 * these under its older names), a task's repeat (`utils/recurrence`) and a
 * Relative filter end (`utils/date-anchor`) all go through it, so `1m` is a
 * calendar month everywhere.
 */

/** Largest count an interval takes (`999d` … `999y`). */
export const MAX_INTERVAL_COUNT = 999

/** What a field says when its text doesn't read as an interval. */
export const INTERVAL_HINT = 'Use a number and d, w, m or y: 3d, 2w, 1m, 1y'

const INTERVAL_PATTERN = /^\s*(\d{1,3})\s*([dwmy])\s*$/i

/** `3d` / `2w` / `1m` / `1y` (case-insensitive, count 1–999) → interval, else null. */
export function parseInterval(text: string): Interval | null {
  const m = text.match(INTERVAL_PATTERN)
  if (!m || m[1] == null || m[2] == null) return null
  const count = parseInt(m[1], 10)
  if (count < 1 || count > MAX_INTERVAL_COUNT) return null
  return { count, unit: m[2].toLowerCase() as IntervalUnit }
}

/** The compact form, as stored and typed: `{2, 'w'}` → `2w`. */
export function formatInterval(i: Interval): string {
  return `${i.count}${i.unit}`
}

/** Whether two intervals are the same (`2w` and `2w`; `14d` and `2w` are not). */
export function intervalsEqual(a: Interval | null | undefined, b: Interval | null | undefined): boolean {
  if (a == null || b == null) return a == null && b == null
  return a.count === b.count && a.unit === b.unit
}

const UNIT_WORDS: Record<IntervalUnit, string> = { d: 'day', w: 'week', m: 'month', y: 'year' }

/** A unit's word for `count` of it: `day` / `days`. */
export function unitWord(unit: IntervalUnit, count: number): string {
  return `${UNIT_WORDS[unit]}${count === 1 ? '' : 's'}`
}

/** In words: `{2, 'w'}` → `2 weeks`, `{1, 'm'}` → `1 month`. */
export function describeInterval(i: Interval): string {
  return `${i.count} ${unitWord(i.unit, i.count)}`
}

/** The unit a typed word names (`day`, `days`, `wk`, `weeks`, `month`, `mo`, `yr`, `years`), or null. */
export function unitOfWord(word: string): IntervalUnit | null {
  const w = word.toLowerCase()
  if (w === 'd' || w === 'day' || w === 'days') return 'd'
  if (w === 'w' || w === 'wk' || w === 'wks' || w === 'week' || w === 'weeks') return 'w'
  if (w === 'm' || w === 'mo' || w === 'mos' || w === 'month' || w === 'months') return 'm'
  if (w === 'y' || w === 'yr' || w === 'yrs' || w === 'year' || w === 'years') return 'y'
  return null
}

/**
 * `months` calendar months from `d`'s day, at local midnight, on `dayOfMonth`
 * (default `d`'s own) clamped to the target month's last day: Jan 31 + 1 is
 * Feb 28 (29 in a leap year); with `dayOfMonth` 31, Feb 28 + 1 is Mar 31 —
 * a repeat's kept day (`RecurrenceRule.originalDayOfMonth`), so it never drifts.
 */
function addMonths(d: Date, months: number, dayOfMonth?: number): Date {
  const first = new Date(d.getFullYear(), d.getMonth() + months, 1)
  const lastDay = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate()
  return new Date(first.getFullYear(), first.getMonth(), Math.min(dayOfMonth ?? d.getDate(), lastDay))
}

/**
 * The day `times` intervals after `from`'s day (before it for a negative
 * `times`), at local midnight: days and weeks as calendar days, months and
 * years as calendar months (`addMonths`, on `dayOfMonth` when given).
 */
export function addInterval(from: Date, interval: Interval, times = 1, dayOfMonth?: number): Date {
  const base = startOfDay(from)
  const n = interval.count * times
  switch (interval.unit) {
    case 'd': return startOfDay(new Date(base.getFullYear(), base.getMonth(), base.getDate() + n))
    case 'w': return startOfDay(new Date(base.getFullYear(), base.getMonth(), base.getDate() + n * 7))
    case 'm': return addMonths(base, n, dayOfMonth)
    case 'y': return addMonths(base, n * 12, dayOfMonth)
  }
}
