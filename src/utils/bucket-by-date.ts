import type { PersistedTodoItem } from '../models'
import type { WeekStart } from './effective-date'
import { startOfDay, MS_PER_DAY } from './date'
import { startOfWeek } from './effective-date'

/**
 * Vocabulary for relative-date bucket windows. The bucketer walks the
 * caller-supplied window list in order and assigns each todo to the first
 * matching window. The terminal `later` catch-all captures everything not
 * consumed by an earlier window.
 *
 * Boundaries:
 *  - `overdue`     — ms < today midnight
 *  - `today`       — ms < tomorrow midnight (so today only when paired with `overdue` upstream)
 *  - `thisWeek`    — ms ≤ end of calendar week (honors `weekStartsOn`)
 *  - `nextWeek`    — ms ≤ end of calendar week + 7
 *  - `thisMonth`   — ms ≤ last day-midnight of current calendar month
 *  - `later`       — catch-all
 */
export type DateBucketKey =
  | 'overdue'
  | 'today'
  | 'thisWeek'
  | 'nextWeek'
  | 'thisMonth'
  | 'later'

interface BoundaryCtx {
  base: number
  tomorrow: number
  thisWeekEnd: number
  nextWeekEnd: number
  thisMonthEnd: number
}

const WINDOW_MATCHERS: Record<DateBucketKey, (ms: number, c: BoundaryCtx) => boolean> = {
  overdue:    (ms, c) => ms < c.base,
  today:      (ms, c) => ms < c.tomorrow,
  thisWeek:   (ms, c) => ms <= c.thisWeekEnd,
  nextWeek:   (ms, c) => ms <= c.nextWeekEnd,
  thisMonth:  (ms, c) => ms <= c.thisMonthEnd,
  later:      () => true,
}

/**
 * Compute the inclusive boundary timestamps used by every bucketer. Centralised
 * so `weekBoundaries` and the bucket-by-date matchers stay in lockstep.
 */
export function dateBucketBoundaries(today: Date, weekStartsOn: WeekStart): BoundaryCtx {
  const base = startOfDay(today).getTime()
  const tomorrow = base + MS_PER_DAY
  const wkStart = startOfWeek(today, weekStartsOn).getTime()
  const thisWeekEnd = wkStart + 6 * MS_PER_DAY
  const nextWeekEnd = thisWeekEnd + 7 * MS_PER_DAY
  const thisMonthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0).getTime()
  return { base, tomorrow, thisWeekEnd, nextWeekEnd, thisMonthEnd }
}

export interface DateBucket<T> {
  key: DateBucketKey
  todos: T[]
}

export interface BucketByDateResult<T> {
  /** Per-window buckets in the caller-supplied window order; empty windows omitted. */
  buckets: DateBucket<T>[]
  /** Todos for which `getDate` returned null. Caller decides how (or whether) to render them. */
  noDate: T[]
}

/**
 * Walk `todos` once and partition them into the supplied windows. Each todo
 * is assigned to the first window whose matcher returns true; null dates land
 * in `noDate`. Use the terminal catch-all (`later`) to keep dates
 * past the last named window.
 */
export function bucketByDate<T extends PersistedTodoItem>(
  todos: readonly T[],
  getDate: (t: T) => Date | null,
  today: Date,
  weekStartsOn: WeekStart,
  windows: readonly DateBucketKey[],
): BucketByDateResult<T> {
  const ctx = dateBucketBoundaries(today, weekStartsOn)
  const map = new Map<DateBucketKey, T[]>()
  const noDate: T[] = []

  for (const t of todos) {
    const d = getDate(t)
    if (d === null) { noDate.push(t); continue }
    const ms = d.getTime()
    let placed = false
    for (const key of windows) {
      if (WINDOW_MATCHERS[key](ms, ctx)) {
        let arr = map.get(key)
        if (!arr) { arr = []; map.set(key, arr) }
        arr.push(t)
        placed = true
        break
      }
    }
    // No window matched: caller forgot a catch-all. Surface via noDate so we
    // never silently drop a todo.
    if (!placed) noDate.push(t)
  }

  const buckets: DateBucket<T>[] = []
  for (const key of windows) {
    const arr = map.get(key)
    if (arr && arr.length > 0) buckets.push({ key, todos: arr })
  }
  return { buckets, noDate }
}
