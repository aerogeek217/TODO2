import type { TrendRange } from '../../../models/glance-widgets'
import type { HistoryAgainst } from '../../../services/stats/metric-history'
import type { MetricStats } from '../../../services/stats/metrics'
import { formatFollowupDate, formatFollowupDay, formatWeekdayNumeric } from '../../../utils/followup'
import { addDays } from '../../../utils/calendar-grid'
import { formatDateWith } from '../../../utils/date'
import { urgentRangeLabel, type UrgentDueWithinDays } from '../../../utils/urgency'

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

/** What a Number's sub-line needs beyond its metric's stats. */
export interface MetricCopyContext {
  today: Date
  /** The trend's net change over its range (Open). */
  trendNet: number | null
  trendRange: TrendRange
}

/** The sub-line under a Number's count. Empty = none. */
export function metricSubLine(id: keyof MetricStats, metrics: MetricStats, ctx: MetricCopyContext): string {
  switch (id) {
    case 'open': {
      if (ctx.trendNet == null) return ''
      const range = RANGE_WORDS[ctx.trendRange]
      return ctx.trendNet === 0 ? `No change in ${range}` : `${signed(ctx.trendNet)} in ${range}`
    }
    case 'urgent': {
      const { flagged, byDate } = metrics.urgent
      const parts: string[] = []
      if (flagged > 0) parts.push(`${flagged} flagged`)
      if (byDate > 0) parts.push(`${byDate} by due date`)
      return parts.length > 0 ? parts.join(' · ') : 'Nothing urgent'
    }
    case 'overdue': {
      const { oldest, oldestDaysLate } = metrics.overdue
      if (!oldest) return 'Nothing overdue'
      return `Oldest ${formatFollowupDay(oldest, ctx.today)} · ${oldestDaysLate}d late`
    }
    case 'followupDue': {
      const { late, today, upcoming } = metrics.followupDue
      if (late > 0 && upcoming > 0) return `${late} late · ${upcoming} more in 7 days`
      if (late > 0) return today > 0 ? `${late} late · ${today} today` : `${late} late`
      if (today > 0) return upcoming > 0 ? `${upcoming} more in the next 7 days` : 'All due today'
      // None due yet: when the next one is.
      const { next } = metrics.followupDue
      return next ? `Next one ${formatWeekdayNumeric(next)}` : 'Nothing due'
    }
    case 'focus': {
      const n = metrics.focus.dueToday
      return n > 0 ? `${n} due today` : 'None due today'
    }
    case 'dueToday': {
      const n = metrics.dueToday.upcoming
      return n > 0 ? `${n} more in the next 7 days` : 'None in the next 7 days'
    }
    case 'dueNext7':
    case 'noFollowup':
      return ''
  }
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

/** A Next 7 days column's labels: `Late` / `–`, `Today` / `10`, `Sun` / `11`. */
export function nextDayLabels(date: Date | null, index: number): [string, string] {
  if (date == null) return ['Late', '–']
  if (index === 1) return ['Today', String(date.getDate())]
  return [date.toLocaleDateString('en-US', { weekday: 'short' }), String(date.getDate())]
}

// ── The task dialog's words ──────────────────────────────────────────────────

const SETTINGS_NOTE = '(Settings › Tasks)'

/** What a Number's dialog needs to say what it counts. */
export interface MetricDescriptionContext {
  today: Date
  urgentRange: UrgentDueWithinDays
}

/**
 * What a metric counts, in words — the task dialog's line under its
 * title: `Urgent = flagged urgent, or due within 3 days (Settings › Tasks).`
 */
export function metricDescription(id: keyof MetricStats, ctx: MetricDescriptionContext): string {
  switch (id) {
    case 'open':
      return 'Every open task.'
    case 'urgent':
      if (ctx.urgentRange == null) return 'Urgent = flagged urgent. Due dates don’t make tasks urgent ' + SETTINGS_NOTE + '.'
      if (ctx.urgentRange === 0) return `Urgent = flagged urgent, or due today or earlier ${SETTINGS_NOTE}.`
      return `Urgent = flagged urgent, or due within ${urgentRangeLabel(ctx.urgentRange)} ${SETTINGS_NOTE}.`
    case 'overdue':
      return 'Open tasks due before today.'
    case 'followupDue':
      return 'Open tasks whose next follow-up is today or earlier.'
    case 'focus':
      return 'Open tasks in Focus.'
    case 'dueToday':
      return 'Open tasks due today.'
    case 'dueNext7':
      return `Open tasks due today through ${formatFollowupDay(addDays(ctx.today, 6), ctx.today)}.`
    case 'noFollowup':
      return 'Open tasks with no next follow-up date.'
  }
}

/** The Stale tasks header: `Not changed in 14 days or more · oldest 39 days`. */
export function staleSubLine(days: number, oldestDays: number | null): string {
  const base = `Not changed in ${days} days or more`
  return oldestDays == null ? base : `${base} · oldest ${oldestDays} days`
}

/** A dialog line under the top-bar filter: it counts only what the filter shows. */
export function withScreenNote(description: string): string {
  return `${description} Only tasks the top-bar filter shows.`
}

// ── The Number widget's words ────────────────────────────────────────────────

/** Closed this week's sub-line: `Since Sun 4`. */
export function closedSubLine(weekStart: Date, today: Date): string {
  return `Since ${formatFollowupDay(weekStart, today)}`
}

/**
 * A Number's change: since yesterday (`+2 vs yesterday`, `No change vs
 * yesterday`), or — Closed this week — since the same point of last week
 * (`+2 vs last Wed`).
 */
export function deltaLabel(delta: number, against: HistoryAgainst = 'yesterday', today?: Date): string {
  const then = against === 'lastWeek' && today ? `last ${formatDateWith(today, { weekday: 'short' })}` : 'yesterday'
  return delta === 0 ? `No change vs ${then}` : `${signed(delta)} vs ${then}`
}
