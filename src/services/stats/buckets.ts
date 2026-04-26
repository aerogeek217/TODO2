import type { WeekStart } from '../../utils/effective-date'
import { MS_PER_DAY } from '../../utils/date'
import { startOfWeek } from '../horizons'

export interface WeekBucket {
  /** Inclusive start of the week (midnight local). */
  start: Date
  /** Exclusive end (= start + 7 days). */
  end: Date
}

/**
 * Build `weeks` consecutive weekly buckets ending in the week containing `now`.
 * Returned chronologically — `[oldest, …, current week]`. Honors
 * `weekStartsOn` so adjacent week ranges never overlap. Used by the discipline
 * scoreboard for its 12-week window.
 */
export function weeklyBuckets(now: Date, weeks: number, weekStartsOn: WeekStart): WeekBucket[] {
  if (weeks <= 0) return []
  const currentStart = startOfWeek(now, weekStartsOn)
  const out: WeekBucket[] = []
  for (let i = weeks - 1; i >= 0; i--) {
    const start = new Date(currentStart.getTime() - i * 7 * MS_PER_DAY)
    const end = new Date(start.getTime() + 7 * MS_PER_DAY)
    out.push({ start, end })
  }
  return out
}
