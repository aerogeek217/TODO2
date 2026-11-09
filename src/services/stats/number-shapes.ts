import type { PersistedTodoItem } from '../../models'
import { goalBound, type NumberGoal, type NumberOldestBy } from '../../models/number-shapes'
import { daysUntil, type WeekStart } from '../../utils/effective-date'

/**
 * A Number's shapes' statistics (D26 P6, board Y), over the ids its filter
 * keeps (`number-count.numberIds`): a share of a second filter's tasks, the
 * age of its stalest task, its count against a goal. Pure.
 */

// ── Share of… ───────────────────────────────────────────────────────────────

export interface NumberShare {
  /** The tasks both filters keep, in the Number's order (its count). */
  ids: number[]
  /** How many the second filter keeps (the whole). */
  of: number
  /** `ids` as a whole percent of `of`; `null` when `of` is 0. */
  percent: number | null
}

/** A whole percent of `part` in `whole`; `null` for an empty whole. */
export function percentOf(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 100) : null
}

/**
 * The Number's tasks (`ids`) as a share of the second filter's (`ofIds`):
 * the ones both keep, out of the second filter's.
 */
export function shareOf(ids: readonly number[], ofIds: readonly number[]): NumberShare {
  const whole = new Set(ofIds)
  const kept = ids.filter((id) => whole.has(id))
  return { ids: kept, of: ofIds.length, percent: percentOf(kept.length, ofIds.length) }
}

/** A share's series: each day's whole percent (`null` when nothing is in the whole that day, read as 0). */
export function shareSeries(parts: readonly number[], wholes: readonly number[]): number[] {
  return parts.map((n, i) => percentOf(n, wholes[i] ?? 0) ?? 0)
}

// ── Oldest ──────────────────────────────────────────────────────────────────

/** A task's date its age counts from, by `by`; `null` when it has none (no due date). */
export function oldestDate(t: Pick<PersistedTodoItem, 'lastFollowupAt' | 'createdAt' | 'modifiedAt' | 'dueDate'>, by: NumberOldestBy): Date | null {
  switch (by) {
    // Never followed up: stale since it was made.
    case 'lastFollowup': return t.lastFollowupAt ?? t.createdAt
    case 'created': return t.createdAt
    case 'modified': return t.modifiedAt
    case 'deadline': return t.dueDate ?? null
  }
}

export interface NumberOldest {
  /** The aged tasks, oldest first (ties in the Number's order): what a click opens. */
  ids: number[]
  /** The oldest one: its id, its title and its age in days (negative: a due date still ahead). */
  oldest: { id: number; title: string; days: number } | null
  /** The median age of the aged tasks, in whole days (`null` with none). */
  median: number | null
}

/** The middle value of `sorted` (ascending), the two middle ones' mean rounded for an even count. */
function medianOf(sorted: readonly number[]): number | null {
  if (sorted.length === 0) return null
  const mid = Math.floor(sorted.length / 2)
  const hi = sorted[mid] ?? 0
  return sorted.length % 2 === 1 ? hi : Math.round(((sorted[mid - 1] ?? hi) + hi) / 2)
}

/**
 * The age (days to `today`, by local day) of each of the Number's tasks by
 * `by` — a task without that date (no due date) isn't aged —, the oldest,
 * and the median.
 */
export function oldestOf(
  ids: readonly number[],
  todoById: ReadonlyMap<number, PersistedTodoItem>,
  by: NumberOldestBy,
  today: Date,
): NumberOldest {
  const aged: Array<{ t: PersistedTodoItem; days: number; at: number }> = []
  ids.forEach((id, at) => {
    const t = todoById.get(id)
    const date = t ? oldestDate(t, by) : null
    const until = date ? daysUntil(date, today) : null
    if (t && until != null && Number.isFinite(until)) aged.push({ t, days: -until, at })
  })
  aged.sort((a, b) => b.days - a.days || a.at - b.at)
  const first = aged[0]
  return {
    ids: aged.map((a) => a.t.id),
    oldest: first ? { id: first.t.id, title: first.t.title, days: first.days } : null,
    median: medianOf(aged.map((a) => a.days).sort((a, b) => a - b)),
  }
}

// ── Against a goal ──────────────────────────────────────────────────────────

/**
 * Where a count stands against its goal: an at-least goal is `met`, `onPace`
 * (a weekly one at or past where the week should be by today's end) or
 * `behind`; an at-most one is `within` or `over`.
 */
export type GoalState = 'met' | 'onPace' | 'behind' | 'within' | 'over'

export interface GoalProgress {
  way: 'atMost' | 'atLeast'
  target: number
  /** How full the bar is: the count's share of the target, 0 – 1. */
  fraction: number
  /** A weekly goal's pace: what the week should hold by the end of today (`null` without a period). */
  pace: number | null
  /** Where the pace tick sits on the bar, 0 – 1 (`null` without a period). */
  paceFraction: number | null
  state: GoalState
  /** It lights: an at-least goal behind its pace (or, without a period, not met yet), an at-most one over its limit. */
  lit: boolean
}

/** Days of the week gone by the end of `today`, 1 – 7. */
export function weekDaysGone(today: Date, weekStartsOn: WeekStart): number {
  return ((today.getDay() - weekStartsOn + 7) % 7) + 1
}

/** `count` against `goal` on `today` (a weekly goal's week starting on `weekStartsOn`). */
export function goalProgress(count: number, goal: NumberGoal, today: Date, weekStartsOn: WeekStart): GoalProgress {
  const { way, value: target } = goalBound(goal)
  const fraction = target > 0 ? Math.min(1, count / target) : (way === 'atLeast' || count > 0 ? 1 : 0)
  const pace = goal.period === 'week' ? (target * weekDaysGone(today, weekStartsOn)) / 7 : null
  const paceFraction = pace == null ? null : target > 0 ? pace / target : 1
  if (way === 'atMost') {
    const over = count > target
    return { way, target, fraction, pace, paceFraction, state: over ? 'over' : 'within', lit: over }
  }
  const state: GoalState = count >= target ? 'met' : pace != null && count >= pace ? 'onPace' : 'behind'
  return { way, target, fraction, pace, paceFraction, state, lit: state === 'behind' }
}
