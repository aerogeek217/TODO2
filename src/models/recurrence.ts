import type { Interval } from './interval'

/**
 * A task's repeat (schema v84): it repeats every `every` from its due date —
 * any interval of the app's one grammar (`2w`, `1m`, `3m`, `1y`; `models/interval`).
 * v84 converted the six fixed choices before it (daily 1d, weekly 1w,
 * biweekly 2w, monthly 1m, quarterly 3m, yearly 1y).
 */
export interface RecurrenceRule {
  every: Interval
  /**
   * The due date's day of the month when the repeat was set, kept for a
   * month or year interval so it never drifts (Jan 31 → Feb 28 → Mar 31,
   * not Mar 28).
   */
  originalDayOfMonth?: number
}
