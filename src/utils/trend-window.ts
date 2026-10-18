import type { TodoEventType } from '../models'
import type { DashboardTrendRange } from '../models/dashboard-config'
import { addDays, weekStartOf } from './calendar-grid'
import { daysUntil, type WeekStart } from './effective-date'

/** The event types the dashboard trend reads. */
export const TREND_EVENT_TYPES: readonly TodoEventType[] = ['created', 'completed', 'reopened']

export interface TrendWindow {
  range: DashboardTrendRange
  granularity: 'day' | 'week'
  /** First day of the window (local midnight). */
  start: Date
  /** Every day from `start` through today (local midnights). */
  days: Date[]
  /** First day of each bar: every day, or each week's first day (`weekStartsOn`). */
  bucketStarts: Date[]
}

/**
 * The days a trend range covers, ending today: 14 days = today and the 13
 * before; 4 / 12 weeks = this week (so far) and the 3 / 11 before it.
 */
export function trendWindow(range: DashboardTrendRange, today: Date, weekStartsOn: WeekStart): TrendWindow {
  const weeks = range === '4w' ? 4 : range === '12w' ? 12 : 0
  const start = weeks === 0 ? addDays(today, -13) : addDays(weekStartOf(today, weekStartsOn), -7 * (weeks - 1))
  const dayCount = (daysUntil(today, start) ?? 0) + 1
  const days = Array.from({ length: dayCount }, (_, i) => addDays(start, i))
  const bucketStarts = weeks === 0 ? days : Array.from({ length: weeks }, (_, i) => addDays(start, 7 * i))
  return { range, granularity: weeks === 0 ? 'day' : 'week', start, days, bucketStarts }
}
