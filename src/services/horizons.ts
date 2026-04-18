import type { PersistedTodoItem } from '../models'
import type { WeekStart } from '../utils/effective-date'
import { effectiveDate, isDeadlinePast } from '../utils/effective-date'
import { startOfDay, MS_PER_DAY } from '../utils/date'

/** The 5 fixed horizon slots on the dashboard ribbon. */
export const HORIZON_KEYS = [
  'thisweek',
  'nextweek',
  'thismonth',
  'later',
  'someday',
] as const

export type HorizonKey = typeof HORIZON_KEYS[number]

/**
 * Grain for the bin charts inside each horizon cell.
 * - `day`   — thisweek / nextweek render as N day bars
 * - `week`  — thismonth renders remaining weeks of the current month (≤5 bars)
 * - `month` — later renders 3 month bars
 * - `null`  — someday renders a dot cluster instead of bars
 */
export const HORIZON_GRAIN: Record<HorizonKey, 'day' | 'week' | 'month' | null> = {
  thisweek: 'day',
  nextweek: 'day',
  thismonth: 'week',
  later: 'month',
  someday: null,
}

export interface BinStats {
  /** Number of tasks whose effective date falls in this bin. */
  load: number
  /** Number of those tasks that are overdue (effective date < today). */
  overdue: number
  /** Number of those tasks that carry a `dueDate`. */
  hasDeadline: number
  /** True when this bin's date range includes today (day-grain only). */
  isToday: boolean
  /** Human-readable label (e.g. "Mon 15", "Apr 13–19", "May"). */
  label: string
  /** Bin's start (inclusive) — used by callers for navigation / filter sync. */
  start: Date
  /** Bin's end (exclusive) — used by callers for navigation / filter sync. */
  end: Date
}

/** Start of the week containing `today`, honoring `weekStartsOn` (0 = Sun, 1 = Mon). */
function startOfWeek(today: Date, ws: WeekStart): Date {
  const base = startOfDay(today)
  const dow = base.getDay()
  const days = (dow - ws + 7) % 7
  return new Date(base.getTime() - days * MS_PER_DAY)
}

function fmtMonthDay(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function fmtWeekdayDay(d: Date): string {
  return d.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric' })
}

function fmtMonth(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short' })
}

/**
 * Compute the bin date ranges for a horizon slot. Caller does the bucketing;
 * this function is the single source of truth for horizon geometry.
 */
export function horizonBinRanges(
  slot: HorizonKey,
  today: Date,
  weekStartsOn: WeekStart,
): Array<{ start: Date; end: Date; label: string; isToday: boolean }> {
  const base = startOfDay(today)
  const grain = HORIZON_GRAIN[slot]
  if (grain === null) return []

  switch (slot) {
    case 'thisweek': {
      const start = startOfWeek(today, weekStartsOn)
      const out: Array<{ start: Date; end: Date; label: string; isToday: boolean }> = []
      for (let i = 0; i < 7; i++) {
        const s = new Date(start.getTime() + i * MS_PER_DAY)
        const e = new Date(s.getTime() + MS_PER_DAY)
        out.push({
          start: s,
          end: e,
          label: fmtWeekdayDay(s),
          isToday: s.getTime() === base.getTime(),
        })
      }
      return out
    }
    case 'nextweek': {
      const thisStart = startOfWeek(today, weekStartsOn)
      const start = new Date(thisStart.getTime() + 7 * MS_PER_DAY)
      const out: Array<{ start: Date; end: Date; label: string; isToday: boolean }> = []
      for (let i = 0; i < 7; i++) {
        const s = new Date(start.getTime() + i * MS_PER_DAY)
        const e = new Date(s.getTime() + MS_PER_DAY)
        out.push({ start: s, end: e, label: fmtWeekdayDay(s), isToday: false })
      }
      return out
    }
    case 'thismonth': {
      // Weekly bins from start-of-week that contains today, clipped to end-of-month.
      const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 1) // exclusive
      let weekStart = startOfWeek(today, weekStartsOn)
      const out: Array<{ start: Date; end: Date; label: string; isToday: boolean }> = []
      while (weekStart.getTime() < monthEnd.getTime()) {
        const weekEnd = new Date(weekStart.getTime() + 7 * MS_PER_DAY)
        const binEnd = weekEnd.getTime() < monthEnd.getTime() ? weekEnd : monthEnd
        const labelEnd = new Date(binEnd.getTime() - MS_PER_DAY)
        const label = `${fmtMonthDay(weekStart)}–${fmtMonthDay(labelEnd)}`
        out.push({
          start: new Date(weekStart),
          end: binEnd,
          label,
          isToday: base.getTime() >= weekStart.getTime() && base.getTime() < binEnd.getTime(),
        })
        weekStart = weekEnd
      }
      return out
    }
    case 'later': {
      // Next 3 months as monthly bins.
      const out: Array<{ start: Date; end: Date; label: string; isToday: boolean }> = []
      for (let i = 1; i <= 3; i++) {
        const start = startOfDay(new Date(today.getFullYear(), today.getMonth() + i, 1))
        const end = startOfDay(new Date(today.getFullYear(), today.getMonth() + i + 1, 1))
        out.push({ start, end, label: fmtMonth(start), isToday: false })
      }
      return out
    }
    case 'someday':
      return []
  }
}

/**
 * Bucket `tasks` into the slot's bins. Returns one BinStats per bin range.
 * Tasks with no effective date are excluded — "Someday" content is shown
 * via the dot cluster (`horizonSomedayCount`), not via bins.
 */
export function horizonBins(
  slot: HorizonKey,
  tasks: PersistedTodoItem[],
  today: Date,
  weekStartsOn: WeekStart,
): BinStats[] {
  const ranges = horizonBinRanges(slot, today, weekStartsOn)
  if (ranges.length === 0) return []

  const base = startOfDay(today)
  const bins: BinStats[] = ranges.map((r) => ({
    load: 0,
    overdue: 0,
    hasDeadline: 0,
    isToday: r.isToday,
    label: r.label,
    start: r.start,
    end: r.end,
  }))

  for (const t of tasks) {
    const eff = effectiveDate(t, base)
    if (!eff) continue
    const ms = eff.getTime()
    const idx = bins.findIndex((b) => ms >= b.start.getTime() && ms < b.end.getTime())
    if (idx === -1) continue
    bins[idx].load++
    if (ms < base.getTime()) bins[idx].overdue++
    if (t.dueDate != null) bins[idx].hasDeadline++
    // Overdue-flag on today's bin: any task whose deadline is past today also
    // bumps the overdue count (covers past-deadline tasks still scheduled).
    if (bins[idx].isToday && isDeadlinePast(t, base)) {
      // Already counted in overdue above if eff < today; only add if not already.
      if (ms >= base.getTime()) bins[idx].overdue++
    }
  }

  return bins
}

/** Count tasks with neither `scheduledDate` nor `dueDate` set. */
export function horizonSomedayCount(tasks: PersistedTodoItem[]): number {
  return tasks.filter((t) => t.scheduledDate == null && t.dueDate == null).length
}
