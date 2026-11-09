import type { TodoPredicate } from '../../../models'
import type { NumberCompare, TrendRange } from '../../../models/glance-widgets'
import type { HistoryField } from '../../../services/stats/filter-history'
import { describeFilters, predicateLineItems, type FilterChipNames } from '../../../utils/filter-chips'
import { admitsCompleted, predicateToCriteria } from '../../../utils/filter-criteria'
import { formatFollowupDate } from '../../../utils/followup'
import { formatDateWith } from '../../../utils/date'

/**
 * The glance widgets' words: a Number's sub-line, counts as
 * `shown of total`, range labels. Pure, so the copy is testable on its own.
 */

/** `5`, or `5 of 19` when the screen filter hides some. */
export function countOf(shown: number, total: number): string {
  return shown === total ? String(shown) : `${shown} of ${total}`
}

/** `+3` / `−2` / `0`. */
export function signed(n: number): string {
  if (n > 0) return `+${n}`
  if (n < 0) return `−${-n}`
  return '0'
}

const RANGE_WORDS: Record<TrendRange, string> = {
  '14d': 'the last 14 days',
  '4w': 'the last 4 weeks',
  '12w': 'the last 12 weeks',
}

const RANGE_LABEL: Record<TrendRange, string> = {
  '14d': 'Last 14 days',
  '4w': 'Last 4 weeks',
  '12w': 'Last 12 weeks',
}

/** `the last 14 days` — the range inside a sentence. */
export function trendRangeWords(range: TrendRange): string {
  return RANGE_WORDS[range]
}

/** `Last 14 days` — the Created vs completed header. */
export function trendRangeLabel(range: TrendRange): string {
  return RANGE_LABEL[range]
}

/** `open since Sun 27 Sep` — the trend's stats row. */
export function sinceLabel(start: Date, today: Date): string {
  return `open since ${formatFollowupDate(start, today)}`
}

/** A trend bar's label: the day number (daily) or `Sep 28` (weekly). */
export function trendBucketLabel(start: Date, granularity: 'day' | 'week'): string {
  if (granularity === 'day') return String(start.getDate())
  return start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// ── The task dialog's words ──────────────────────────────────────────────────

/** A dialog line under the top-bar filter: it counts only what the filter shows. */
export function withScreenNote(description: string): string {
  return `${description} Only tasks the top-bar filter shows.`
}

// ── The Number widget's words ────────────────────────────────────────────────

/**
 * What a Number counts, in words — its task dialog's line under its title:
 * `Every open task.`, or its filter (`Open tasks where Due is overdue ·
 * Tags is Project: Atlas.`; an expression in words).
 */
export function numberDescription(filter: TodoPredicate, names: FilterChipNames): string {
  const items = predicateLineItems(filter, names)
  if (items.length === 0) return filter.showCompleted ? 'Every task.' : 'Every open task.'
  const which = admitsCompleted(predicateToCriteria(filter)) ? 'Tasks' : 'Open tasks'
  return `${which} where ${describeFilters(items)}.`
}

/**
 * A Number's change: since yesterday (`+2 vs yesterday`, `No change vs
 * yesterday`), or since the same point of last week (`+2 vs last Wed`).
 */
export function deltaLabel(delta: number, against: Exclude<NumberCompare, 'none'> = 'yesterday', today?: Date): string {
  const then = against === 'lastWeek' && today ? `last ${formatDateWith(today, { weekday: 'short' })}` : 'yesterday'
  return delta === 0 ? `No change vs ${then}` : `${signed(delta)} vs ${then}`
}

/** What the history log reads as it is now on some day of the line, in words. */
const APPROXIMATE_WORDS: Record<HistoryField, string> = {
  state: 'completion',
  due: 'due dates',
  status: 'statuses',
  completed: 'completion dates',
  created: 'created dates',
  followup: 'next follow-ups',
  lastFollowup: 'last follow-ups',
  markers: 'priorities',
  people: 'people',
  tags: 'tags',
  text: 'text',
  modified: 'modified dates',
}

/** The ≈ mark's tooltip: which fields some days read as they are now. */
export function approximateNote(fields: readonly HistoryField[]): string {
  const words = fields.map((f) => APPROXIMATE_WORDS[f])
  const list = words.length > 1 ? `${words.slice(0, -1).join(', ')} and ${words.at(-1)}` : (words[0] ?? '')
  return `Approximate: on some of these days, ${list} read as they are now (the history log doesn’t hold them that far back).`
}
