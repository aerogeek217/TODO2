/**
 * An interval as the app types it everywhere: a whole number and a unit —
 * `d` days, `w` weeks, `m` calendar months, `y` calendar years (`3d`, `2w`,
 * `1m`, `1y`). A follow-up's quick intervals, a task's repeat (schema v84)
 * and a Relative filter end share it (`utils/interval`). A month or a year is
 * never 30 or 365 days: Jan 31 + 1m is Feb 28 (29 in a leap year).
 */
export type IntervalUnit = 'd' | 'w' | 'm' | 'y'

export interface Interval {
  count: number
  unit: IntervalUnit
}
