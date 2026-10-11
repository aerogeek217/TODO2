import type { WeekStart } from './effective-date'
import { startOfDay, MS_PER_DAY } from './date'
import { startOfWeek } from './effective-date'

/**
 * Relative-date group keys shared by every list surface, in display order:
 *  - `overdue` — before today
 *  - `today`   — today
 *  - `week`    — after today, up to the end of the calendar week (honors `weekStartsOn`)
 *  - `later`   — anything after this week
 *
 * A task with no date gets no key; callers render it in a trailing
 * "No Due Date" / "No Follow-up" section.
 */
export type DateBucketKey = 'overdue' | 'today' | 'week' | 'later'

export const DATE_BUCKET_ORDER: readonly DateBucketKey[] = ['overdue', 'today', 'week', 'later']

export const DATE_BUCKET_LABELS: Record<DateBucketKey, string> = {
  overdue: 'Overdue',
  today: 'Today',
  week: 'This Week',
  later: 'Later',
}

export function isDateBucketKey(key: string): key is DateBucketKey {
  return (DATE_BUCKET_ORDER as readonly string[]).includes(key)
}

export interface DateBucketBoundaries {
  /** Today's midnight. */
  base: number
  /** Tomorrow's midnight. */
  tomorrow: number
  /** Midnight of the last day of the current calendar week. */
  thisWeekEnd: number
}

export function dateBucketBoundaries(today: Date, weekStartsOn: WeekStart): DateBucketBoundaries {
  const base = startOfDay(today).getTime()
  const wkStart = startOfWeek(today, weekStartsOn).getTime()
  return { base, tomorrow: base + MS_PER_DAY, thisWeekEnd: wkStart + 6 * MS_PER_DAY }
}

/** Key a date (any time of day) into its relative bucket; `null` for no date. */
export function dateBucketKey(
  date: Date | null,
  today: Date,
  weekStartsOn: WeekStart,
): DateBucketKey | null {
  if (!date) return null
  const ms = startOfDay(date).getTime()
  const b = dateBucketBoundaries(today, weekStartsOn)
  if (ms < b.base) return 'overdue'
  if (ms < b.tomorrow) return 'today'
  if (ms <= b.thisWeekEnd) return 'week'
  return 'later'
}
