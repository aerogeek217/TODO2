import type { TodoEventType } from '../models'
import type { TrendRange } from '../models/glance-widgets'
import { addDays, weekStartOf } from './calendar-grid'
import { daysUntil, type WeekStart } from './effective-date'

/** The event types Created vs completed reads. */
export const TREND_EVENT_TYPES: readonly TodoEventType[] = ['created', 'completed', 'reopened']

export interface TrendWindow {
  range: TrendRange
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
export function trendWindow(range: TrendRange, today: Date, weekStartsOn: WeekStart): TrendWindow {
  const weeks = range === '4w' ? 4 : range === '12w' ? 12 : 0
  const start = weeks === 0 ? addDays(today, -13) : addDays(weekStartOf(today, weekStartsOn), -7 * (weeks - 1))
  const dayCount = (daysUntil(today, start) ?? 0) + 1
  const days = Array.from({ length: dayCount }, (_, i) => addDays(start, i))
  const bucketStarts = weeks === 0 ? days : Array.from({ length: weeks }, (_, i) => addDays(start, 7 * i))
  return { range, granularity: weeks === 0 ? 'day' : 'week', start, days, bucketStarts }
}

/** Days in a Number's history line: today and the 13 before. */
export const NUMBER_HISTORY_DAYS = 14

/**
 * The event types a filter's history reads (`services/stats/filter-history`,
 * a Number's line): every one that moves a field a filter can test — the
 * trend's (each day's open / done state), the due date, the status and the
 * history log H3's follow-ups, markers, people and tags.
 */
export const FILTER_HISTORY_EVENT_TYPES: readonly TodoEventType[] = [
  ...TREND_EVENT_TYPES, 'deadline', 'status', 'followup', 'followedUp', 'marker', 'person', 'tag',
]

/**
 * The first day a Number's history needs events from: its first day's week
 * start (a range from the week's start, as `completed this week`, reaches
 * back to it), else the first day.
 */
export function historyEventsStart(today: Date, weekStartsOn: WeekStart): Date {
  const first = addDays(today, -(NUMBER_HISTORY_DAYS - 1))
  return weekStartOf(first, weekStartsOn)
}

// ── Status flow (D26 P8) ──

/** The weeks a Status flow covers. */
export const STATUS_FLOW_WEEKS = [8, 12, 26] as const
export type StatusFlowWeeks = (typeof STATUS_FLOW_WEEKS)[number]

/**
 * A Status flow's days: each of its last `weeks` weeks' end (the week's
 * last day; this week's: today), oldest first.
 */
export function statusFlowDays(today: Date, weeks: number, weekStartsOn: WeekStart): Date[] {
  const thisWeek = weekStartOf(today, weekStartsOn)
  return Array.from({ length: weeks }, (_, i) => (i === weeks - 1 ? today : addDays(thisWeek, -7 * (weeks - 1 - i) + 6)))
}

/**
 * What the history cache reads (`trend-events-store`): a trend range's
 * window, `history` — a Number's 14 days —, or a Status flow's weeks
 * (`flow8`, `flow12`, `flow26`).
 */
export type EventsWindow = TrendRange | 'history' | `flow${StatusFlowWeeks}`

/** The first day and the event types `window` reads. */
export function eventsWindowRead(window: EventsWindow, today: Date, weekStartsOn: WeekStart): { start: Date; types: readonly TodoEventType[] } {
  if (window === 'history') return { start: historyEventsStart(today, weekStartsOn), types: FILTER_HISTORY_EVENT_TYPES }
  if (window.startsWith('flow')) {
    // From its first week's start: a filter's range from a week's start (`completed this week`) reaches back to it.
    const first = statusFlowDays(today, Number(window.slice(4)), weekStartsOn)[0] ?? today
    return { start: weekStartOf(first, weekStartsOn), types: FILTER_HISTORY_EVENT_TYPES }
  }
  return { start: trendWindow(window as TrendRange, today, weekStartsOn).start, types: TREND_EVENT_TYPES }
}
