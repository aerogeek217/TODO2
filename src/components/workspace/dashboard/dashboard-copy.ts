import type { MarkerKey, MarkerSet } from '../../../models'
import type { DashboardTrendRange } from '../../../models/dashboard-config'
import type { TileStats } from '../../../services/stats/tiles'
import type { FilterChip } from '../../../utils/filter-chips'
import { formatFollowupDate, formatFollowupDay } from '../../../utils/followup'
import { addDays } from '../../../utils/calendar-grid'
import { lineMarkers, type HotRule } from '../../../utils/hot'
import { urgentRangeLabel, type UrgentDueWithinDays } from '../../../utils/urgency'

/**
 * The dashboard's words: tile sub-lines, the Hot rule in words, counts as
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

const RANGE_WORDS: Record<DashboardTrendRange, string> = {
  '14d': 'the last 14 days',
  '4w': 'the last 4 weeks',
  '12w': 'the last 12 weeks',
}

const RANGE_LABEL: Record<DashboardTrendRange, string> = {
  '14d': 'Last 14 days',
  '4w': 'Last 4 weeks',
  '12w': 'Last 12 weeks',
}

/** `the last 14 days` — the range inside a sentence. */
export function trendRangeWords(range: DashboardTrendRange): string {
  return RANGE_WORDS[range]
}

/** `Last 14 days` — the Created vs completed header. */
export function trendRangeLabel(range: DashboardTrendRange): string {
  return RANGE_LABEL[range]
}

/** One marker as a line part: `urgent`, `important`, `Focus`. */
function markerWord(k: MarkerKey): string {
  return k === 'focus' ? 'Focus' : k
}

/** A Hot rule line, short: `urgent + important`, `Focus`. */
export function hotLineLabel(line: MarkerSet): string {
  return lineMarkers(line).map(markerWord).join(' + ')
}

/**
 * The Hot rule in words, for the Hot section: `Urgent and important, or in
 * Focus`. A Focus-only line reads `in Focus`.
 */
export function hotRuleInWords(rule: HotRule): string {
  const lines = rule.map((line) => {
    const keys = lineMarkers(line)
    if (keys.length === 1 && keys[0] === 'focus') return 'in Focus'
    return keys.map(markerWord).join(' and ')
  }).filter((s) => s !== '')
  const text = lines.join(', or ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}

const MARKER_SHORT: Record<MarkerKey, string> = { urgent: 'U', important: 'I', focus: 'F' }
const MARKER_NAME: Record<MarkerKey, string> = { urgent: 'Urgent', important: 'Important', focus: 'Focus' }

/**
 * The Hot rule at a glance, for the tab menu's `Hot is` item: `U+I or Focus`
 * (a one-marker line names it; a longer line uses initials).
 */
export function hotRuleShort(rule: HotRule): string {
  return rule.map((line) => {
    const keys = lineMarkers(line)
    const only = keys.length === 1 ? keys[0] : undefined
    return only ? MARKER_NAME[only] : keys.map((k) => MARKER_SHORT[k]).join('+')
  }).filter((s) => s !== '').join(' or ')
}

/** What a tile's sub-line needs beyond its own stats. */
export interface TileCopyContext {
  today: Date
  /** The trend's net change over its range (Open). */
  trendNet: number | null
  trendRange: DashboardTrendRange
}

/** The sub-line under a tile's count. Empty = none. */
export function tileSubLine(id: keyof TileStats, tiles: TileStats, ctx: TileCopyContext): string {
  switch (id) {
    case 'open': {
      if (ctx.trendNet == null) return ''
      const range = RANGE_WORDS[ctx.trendRange]
      return ctx.trendNet === 0 ? `No change in ${range}` : `${signed(ctx.trendNet)} in ${range}`
    }
    case 'hot': {
      const parts = tiles.hot.lines.filter((l) => l.ids.length > 0)
      if (parts.length === 0) return 'Nothing hot right now'
      const only = parts.length === 1 ? parts[0] : undefined
      if (only && hotLineLabel(only.line) === 'Focus') return `${only.ids.length} in Focus`
      return parts.map((l) => `${l.ids.length} ${hotLineLabel(l.line)}`).join(' · ')
    }
    case 'urgent': {
      const { flagged, byDate } = tiles.urgent
      const parts: string[] = []
      if (flagged > 0) parts.push(`${flagged} flagged`)
      if (byDate > 0) parts.push(`${byDate} by due date`)
      return parts.length > 0 ? parts.join(' · ') : 'Nothing urgent'
    }
    case 'overdue': {
      const { oldest, oldestDaysLate } = tiles.overdue
      if (!oldest) return 'Nothing overdue'
      return `Oldest ${formatFollowupDay(oldest, ctx.today)} · ${oldestDaysLate}d late`
    }
    case 'followupDue': {
      const { late, today, upcoming } = tiles.followupDue
      if (late > 0 && upcoming > 0) return `${late} late · ${upcoming} more in 7 days`
      if (late > 0) return today > 0 ? `${late} late · ${today} today` : `${late} late`
      if (upcoming > 0) return `${upcoming} more in the next 7 days`
      return today > 0 ? 'All due today' : 'Nothing due'
    }
    case 'focus': {
      const n = tiles.focus.dueToday
      return n > 0 ? `${n} due today` : 'None due today'
    }
    case 'dueToday': {
      const n = tiles.dueToday.upcoming
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

/** A list's filters in a few words: `Status: Waiting`, `@Priya`, `#q4`. */
export function listTileHint(chips: readonly FilterChip[]): string {
  if (chips.length === 0) return 'All tasks'
  return chips.map((c) => {
    if (c.field === 'people') return `@${c.value}`
    if (c.field === 'tags') return c.value
    return `${c.label}: ${c.value}`
  }).join(' · ')
}

// ── The task dialog's words ──────────────────────────────────────────────────

const SETTINGS_NOTE = '(Settings › Tasks)'

/** What a tile's dialog needs to say what the tile counts. */
export interface TileDescriptionContext {
  today: Date
  urgentRange: UrgentDueWithinDays
  hotRule: HotRule
}

/**
 * What a built-in tile counts, in words — the task dialog's line under its
 * title: `Hot = urgent and important, or in Focus (Settings › Tasks).`
 */
export function tileDescription(id: keyof TileStats, ctx: TileDescriptionContext): string {
  switch (id) {
    case 'open':
      return 'Every open task.'
    case 'hot': {
      const words = hotRuleInWords(ctx.hotRule)
      return `Hot = ${words.charAt(0).toLowerCase()}${words.slice(1)} ${SETTINGS_NOTE}.`
    }
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

/** What a tile counts, in a few words — the Customize dialog's line beside it. */
export function tileCatalogHint(id: keyof TileStats, ctx: { today: Date; urgentRange: UrgentDueWithinDays }): string {
  switch (id) {
    case 'open': return 'All open tasks'
    case 'hot': return 'Matches the Hot setting'
    case 'urgent':
      if (ctx.urgentRange == null) return 'Flagged urgent'
      if (ctx.urgentRange === 0) return 'Flagged, or due today or earlier'
      return `Flagged, or due within ${urgentRangeLabel(ctx.urgentRange)}`
    case 'overdue': return 'Due before today'
    case 'followupDue': return 'Next follow-up today or earlier'
    case 'focus': return 'Marked Focus'
    case 'dueToday': return 'Due today'
    case 'dueNext7': return `Today through ${formatFollowupDay(addDays(ctx.today, 6), ctx.today)}`
    case 'noFollowup': return 'Open, no next follow-up'
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

/** A Next 7 days column's dialog: title and line. `index` 0 = Late, 1 = today. */
export function nextDayDialogWords(date: Date | null, index: number, today: Date): { title: string; description: string } {
  if (date == null) return { title: 'Late', description: 'Open tasks due, or to follow up, before today.' }
  if (index === 1) return { title: 'Today', description: 'Open tasks due, or to follow up, today.' }
  const day = formatFollowupDay(date, today)
  return { title: day, description: `Open tasks due, or to follow up, on ${day}.` }
}

/** A trend bar's dialog: title and line (`Thu 8`, or `Week of Sep 28`). */
export function trendBucketDialogWords(start: Date, granularity: 'day' | 'week', today: Date): { title: string; description: string } {
  if (granularity === 'day') {
    const day = formatFollowupDay(start, today)
    return { title: day, description: `Tasks completed or created on ${day}.` }
  }
  const week = `Week of ${trendBucketLabel(start, 'week')}`
  return { title: week, description: `Tasks completed or created in the week of ${trendBucketLabel(start, 'week')}.` }
}
