import type { ListTabBadges, TabBadgeRange, TabBadgeRanges } from '../models/list-definition'
import type { TodoItem } from '../models/todo-item'
import { daysUntil } from './effective-date'

/**
 * A list tab's badges: how many of its open tasks are due, and how many due
 * for a follow-up, each within a range (Settings › Tasks, or the list's own
 * from Edit list). A range is `off`, `overdue` (overdue only) or a day count:
 * overdue plus that many days ahead (`0` = overdue and today).
 */

/** Largest day count accepted from storage / import. */
const MAX_TAB_BADGE_DAYS = 365

/** The ranges Settings and Edit list offer. */
export const TAB_BADGE_CHOICES: readonly TabBadgeRange[] = ['off', 'overdue', 0, 1, 2, 3, 7, 14]

export const DEFAULT_TAB_BADGES: TabBadgeRanges = { due: 3, followup: 0 }

export function tabBadgeRangeLabel(range: TabBadgeRange): string {
  if (range === 'off') return 'Off'
  if (range === 'overdue') return 'Overdue only'
  if (range === 0) return 'Overdue and today'
  if (range === 1) return 'Overdue and tomorrow'
  return `Overdue and next ${range} days`
}

/** A range as a settings value / option value. */
export function formatTabBadgeRange(range: TabBadgeRange): string {
  return String(range)
}

/** Stored value → range; `undefined` when it isn't one. */
export function parseTabBadgeRange(value: unknown): TabBadgeRange | undefined {
  if (value === 'off' || value === 'overdue') return value
  const days = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN
  return Number.isInteger(days) && days >= 0 && days <= MAX_TAB_BADGE_DAYS ? days : undefined
}

/** A stored list's override; `undefined` when absent or malformed. */
export function pickListTabBadges(value: unknown): ListTabBadges | undefined {
  if (value === 'off') return 'off'
  if (typeof value !== 'object' || value === null) return undefined
  const { due, followup } = value as Record<string, unknown>
  const pickedDue = parseTabBadgeRange(due)
  const pickedFollowup = parseTabBadgeRange(followup)
  return pickedDue !== undefined && pickedFollowup !== undefined ? { due: pickedDue, followup: pickedFollowup } : undefined
}

/** The ranges a list's tab uses: its own, else the app's. */
export function tabBadgeRangesFor(own: ListTabBadges | undefined, app: TabBadgeRanges): TabBadgeRanges {
  if (own === 'off') return { due: 'off', followup: 'off' }
  return own ?? app
}

export interface TabBadgeCounts {
  due: number
  dueOverdue: number
  followup: number
  followupOverdue: number
}

/** `-1` overdue, `0` inside the range, `null` outside it (or with no date). */
function rangeHit(date: Date | null | undefined, range: TabBadgeRange, today: Date): -1 | 0 | null {
  if (range === 'off') return null
  const days = daysUntil(date, today)
  if (days == null) return null
  if (days < 0) return -1
  return range !== 'overdue' && days <= range ? 0 : null
}

/**
 * Whether `task` would count toward a badge with `ranges` — open, its due
 * date or next follow-up inside its range. A list's filter need only run on
 * these: the rest add nothing to `countTabBadges`.
 */
export function inTabBadgeRange(
  task: Pick<TodoItem, 'isCompleted' | 'dueDate' | 'nextFollowupAt'>,
  ranges: TabBadgeRanges,
  today: Date,
): boolean {
  return !task.isCompleted
    && (rangeHit(task.dueDate, ranges.due, today) != null || rangeHit(task.nextFollowupAt, ranges.followup, today) != null)
}

/** The badge counts of `tasks` (those a list shows); completed tasks never count. */
export function countTabBadges(
  tasks: readonly Pick<TodoItem, 'isCompleted' | 'dueDate' | 'nextFollowupAt'>[],
  ranges: TabBadgeRanges,
  today: Date,
): TabBadgeCounts {
  const counts: TabBadgeCounts = { due: 0, dueOverdue: 0, followup: 0, followupOverdue: 0 }
  for (const task of tasks) {
    if (task.isCompleted) continue
    const due = rangeHit(task.dueDate, ranges.due, today)
    if (due != null) {
      counts.due += 1
      if (due < 0) counts.dueOverdue += 1
    }
    const followup = rangeHit(task.nextFollowupAt, ranges.followup, today)
    if (followup != null) {
      counts.followup += 1
      if (followup < 0) counts.followupOverdue += 1
    }
  }
  return counts
}

/** What the range reaches beyond overdue, in words: `today`, `by tomorrow`, `within 3 days`. */
function whenWords(range: TabBadgeRange): string {
  if (range === 0) return 'today'
  if (range === 1) return 'by tomorrow'
  return `within ${String(range)} days`
}

function line(count: number, overdue: number, name: string, range: TabBadgeRange): string {
  const rest = count - overdue
  const detail = overdue === 0
    ? whenWords(range)
    : rest === 0
      ? (count === 1 ? 'overdue' : 'all overdue')
      : `${overdue} overdue, ${rest} ${whenWords(range)}`
  return `${count} ${name}: ${detail}`
}

/** The badge in words, a line per kind: `3 due: 1 overdue, 2 within 3 days`. Empty with nothing counted. */
export function tabBadgeSummary(counts: TabBadgeCounts, ranges: TabBadgeRanges): string[] {
  const lines: string[] = []
  if (counts.due > 0) lines.push(line(counts.due, counts.dueOverdue, 'due', ranges.due))
  if (counts.followup > 0) {
    lines.push(line(counts.followup, counts.followupOverdue, counts.followup === 1 ? 'follow-up' : 'follow-ups', ranges.followup))
  }
  return lines
}
