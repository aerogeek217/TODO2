import type { DateAnchor, OffsetUnit, RelativeDateToken } from '../models/filter-predicate'
import { RELATIVE_DATE_TOKENS } from '../models/filter-predicate'
import { formatDateWith, startOfDay } from './date'
import { daysUntil, resolveDateAnchor, resolveRelativeToken, type WeekStart } from './effective-date'

/**
 * Read a persisted date-range endpoint. Accepts the current `DateAnchor`
 * object shape and the legacy pre-DSL-extension ISO-string form, auto-upgrading
 * the latter to `{kind:'fixed', iso}`. Unknown shapes return `null` so callers
 * can treat garbage as "no filter" instead of crashing.
 *
 * Lives in `utils/` (not `stores/`) so the `data/` migration + restore paths
 * can call it without introducing a data→stores dependency.
 */
export function readDateAnchor(v: unknown): DateAnchor | null {
  if (v === null || v === undefined) return null
  if (typeof v === 'string') return { kind: 'fixed', iso: v }
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    if (o.kind === 'fixed' && typeof o.iso === 'string') {
      return { kind: 'fixed', iso: o.iso }
    }
    if (o.kind === 'relative' && typeof o.token === 'string'
        && (RELATIVE_DATE_TOKENS as readonly string[]).includes(o.token)) {
      return { kind: 'relative', token: o.token as RelativeDateToken }
    }
    if (o.kind === 'offset') return readOffsetAnchor(o)
  }
  return null
}

const OFFSET_UNITS: readonly string[] = ['w', 'm', 'y']

/**
 * A stored offset anchor (`kind: 'offset'`) from its known keys: its whole
 * count (`days`) and, for weeks, months or years, its `unit` (an absent or
 * `d` unit is days). `null` when malformed — a count that isn't a finite
 * number, a unit this build doesn't know.
 */
export function readOffsetAnchor(o: Record<string, unknown>): DateAnchor | null {
  if (typeof o.days !== 'number' || !Number.isFinite(o.days)) return null
  const days = Math.trunc(o.days)
  if (o.unit === undefined || o.unit === 'd') return { kind: 'offset', days }
  if (typeof o.unit !== 'string' || !OFFSET_UNITS.includes(o.unit)) return null
  return { kind: 'offset', days, unit: o.unit as OffsetUnit }
}

/** Whether two range ends are the same anchor (both open, or the same kind and value). */
export function dateAnchorsEqual(a: DateAnchor | null, b: DateAnchor | null): boolean {
  if (a == null || b == null) return a == null && b == null
  if (a.kind === 'fixed' && b.kind === 'fixed') return a.iso === b.iso
  if (a.kind === 'relative' && b.kind === 'relative') return a.token === b.token
  if (a.kind === 'offset' && b.kind === 'offset') return a.days === b.days && (a.unit ?? 'd') === (b.unit ?? 'd')
  return false
}

/** Labels of the relative date tokens (sentence case; the words and the Relative list lower-case them). */
const RELATIVE_TOKEN_LABELS: Record<RelativeDateToken, string> = {
  'yesterday': 'Yesterday',
  'today': 'Today',
  'tomorrow': 'Tomorrow',
  'start-of-week': 'Start of week',
  'end-of-week': 'End of week',
  'start-of-next-week': 'Start of next week',
  'end-of-next-week': 'End of next week',
  'start-of-month': 'Start of month',
  'end-of-month': 'End of month',
  'start-of-next-month': 'Start of next month',
  'end-of-next-month': 'End of next month',
  'end-of-month-plus-3': 'End of (month + 3)',
  'start-of-last-week': 'Start of last week',
  'end-of-last-week': 'End of last week',
  'start-of-last-month': 'Start of last month',
  'end-of-last-month': 'End of last month',
}

/** A rolling day as the words and the Relative list say it: `today`, `end of week`. */
export function rollingDayLabel(token: RelativeDateToken): string {
  return RELATIVE_TOKEN_LABELS[token].toLowerCase()
}

/** Which end of a date range an input authors. */
export type DateAnchorSide = 'from' | 'to'

/**
 * How a range's ends are entered (the date panel's Show row, cr25 P8):
 * `calendar` — each end a calendar date (`{ kind: 'fixed' }`); `relative` —
 * each end typed as an interval from today (`offset`: `+2w`, `-1m`, `+3d`)
 * or a rolling day (`relative` token). Not stored: it is read from the ends
 * (`entryModeOf`).
 */
export type DateEntryMode = 'calendar' | 'relative'

/** How a Relative end's typing is explained when it doesn't read. */
export const RELATIVE_END_HINT = 'Type +2w, -1m, +3d or today, or pick a rolling day'

/**
 * A Relative end as its field shows it (typed intervals, board R1): an offset
 * signed and compact in the unit it was stored in (`+2w`, `-1m`, `-30d`), a
 * day offset of 0 and the `today` token as `today`, any other rolling day by
 * its words (`end of week`, `yesterday`), a saved mix's calendar date as
 * `11/30/2026`; `''` for no end.
 */
export function relativeEndText(a: DateAnchor | null): string {
  if (a == null) return ''
  switch (a.kind) {
    case 'fixed': {
      const d = startOfDay(new Date(a.iso))
      return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`
    }
    case 'relative': return rollingDayLabel(a.token)
    case 'offset':
      if (a.days === 0) return 'today'
      return `${a.days > 0 ? '+' : '-'}${Math.abs(a.days)}${a.unit ?? 'd'}`
  }
}

/** The most days a typed day count takes (`+3660d`, ten years), as an expression's. */
const MAX_OFFSET_DAYS = 3660

/** The most weeks, months or years a typed count takes (`+999m`). */
const MAX_OFFSET_COUNT = 999

/**
 * What is typed into a Relative end: an interval from today, signed (`+2w`,
 * `-1m`, `+3d`, `-1y`; a count up to 999 — a day count up to 3660, as an
 * expression's), `0` or `today` (the `today` rolling day), any rolling day by
 * its words (`end of week`, `yesterday`), or a date as the field shows one
 * (`11/30/2026`). `null` for an empty field (no end); `'invalid'` for text
 * that doesn't read, which is never stored.
 */
export function parseRelativeEnd(text: string): DateAnchor | null | 'invalid' {
  const t = text.trim().toLowerCase().replace(/\s+/g, ' ')
  if (t === '') return null
  if (t === '0' || t === 'today') return { kind: 'relative', token: 'today' }
  const token = RELATIVE_DATE_TOKENS.find((k) => rollingDayLabel(k) === t)
  if (token) return { kind: 'relative', token }
  const m = /^([+-])(\d{1,4})([dwmy])$/.exec(t)
  if (m && m[2] != null && m[3] != null) {
    const n = parseInt(m[2], 10)
    const unit = m[3]
    if (n > (unit === 'd' ? MAX_OFFSET_DAYS : MAX_OFFSET_COUNT)) return 'invalid'
    if (n === 0) return { kind: 'relative', token: 'today' }
    const days = m[1] === '-' ? -n : n
    return unit === 'd' ? { kind: 'offset', days } : { kind: 'offset', days, unit: unit as OffsetUnit }
  }
  const date = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t)
  if (date && date[1] && date[2] && date[3]) {
    const month = parseInt(date[1], 10)
    const dayOfMonth = parseInt(date[2], 10)
    const d = new Date(parseInt(date[3], 10), month - 1, dayOfMonth)
    if (d.getMonth() + 1 === month && d.getDate() === dayOfMonth) return fixedAnchorOn(d)
  }
  return 'invalid'
}

/** The stored end for a calendar day: its local midnight, as a typed date stores it. */
export function fixedAnchorOn(day: Date): DateAnchor {
  return { kind: 'fixed', iso: startOfDay(day).toISOString() }
}

/**
 * The mode a range opens in: Relative when any end is a day count or a
 * rolling day; Calendar when every end it has is a date; Relative for a
 * range with no end yet (a new range — the user's habit).
 */
export function entryModeOf(start: DateAnchor | null, end: DateAnchor | null): DateEntryMode {
  const ends = [start, end].filter((a): a is DateAnchor => a != null)
  return ends.length > 0 && ends.every((a) => a.kind === 'fixed') ? 'calendar' : 'relative'
}

/** Whether a range can be shown in Calendar: every end it has is a date. */
export function fitsCalendar(start: DateAnchor | null, end: DateAnchor | null): boolean {
  return [start, end].every((a) => a == null || a.kind === 'fixed')
}

/** The most days from today a date switched to Relative becomes (`+999d`); further, it stays a date. */
const MAX_DAY_COUNT = 999

/**
 * An end in `mode`: to Calendar, its day today as a date; to Relative, a
 * date as days from today (today itself: the `today` rolling day) — a date
 * more than `MAX_DAY_COUNT` days away stays a date (shown as its own text,
 * as a saved mix's is).
 */
export function convertAnchor(a: DateAnchor | null, mode: DateEntryMode, today: Date, weekStartsOn: WeekStart): DateAnchor | null {
  if (a == null) return null
  if (mode === 'calendar') return a.kind === 'fixed' ? a : fixedAnchorOn(resolveDateAnchor(a, today, weekStartsOn))
  if (a.kind !== 'fixed') return a
  const days = daysUntil(new Date(a.iso), today) ?? 0
  if (Math.abs(days) > MAX_DAY_COUNT) return a
  return days === 0 ? { kind: 'relative', token: 'today' } : { kind: 'offset', days }
}

/**
 * What a mode switch converted one end from, kept while the panel is open:
 * switching back to `mode` while the end is still `converted` restores
 * `original` exactly (a rolling day, a number of days, a date).
 */
export interface ModeSwitchMemo {
  mode: DateEntryMode
  original: DateAnchor | null
  converted: DateAnchor | null
}

/**
 * One end switched from `from` to `to`: restored from `memo` when it was
 * converted from `to` and hasn't changed since, else converted
 * (`convertAnchor`). Returns the end and the memo that brings it back.
 */
export function switchAnchorMode(
  a: DateAnchor | null,
  from: DateEntryMode,
  to: DateEntryMode,
  memo: ModeSwitchMemo | undefined,
  today: Date,
  weekStartsOn: WeekStart,
): { anchor: DateAnchor | null; memo: ModeSwitchMemo } {
  const restored = memo && memo.mode === to && dateAnchorsEqual(a, memo.converted)
  const anchor = restored ? memo.original : convertAnchor(a, to, today, weekStartsOn)
  return { anchor, memo: { mode: from, original: a, converted: anchor } }
}

/**
 * The rolling days each Relative end's chevron offers, in order: a range
 * starts at the start of a week or month and ends at its end. Any other
 * token a stored filter holds is listed with them while it is the value.
 */
export const ROLLING_DAYS: Record<DateAnchorSide, readonly RelativeDateToken[]> = {
  from: ['today', 'start-of-week', 'start-of-month'],
  to: ['today', 'end-of-week', 'end-of-month'],
}

/** A Calendar end's Set to… item: picking it fills the date with its day today. */
interface CalendarPreset {
  label: string
  day: (today: Date, weekStartsOn: WeekStart) => Date
}

function tokenDay(token: RelativeDateToken): CalendarPreset['day'] {
  return (today, weekStartsOn) => resolveRelativeToken(token, today, weekStartsOn)
}

/** Each end's Set to… items in groups (a separator between): the named days. */
export const CALENDAR_PRESETS: Record<DateAnchorSide, readonly (readonly CalendarPreset[])[]> = {
  from: [
    [
      { label: 'Today', day: tokenDay('today') },
      { label: 'Start of this week', day: tokenDay('start-of-week') },
      { label: 'Start of this month', day: tokenDay('start-of-month') },
      { label: 'Start of last month', day: (today) => new Date(today.getFullYear(), today.getMonth() - 1, 1) },
    ],
  ],
  to: [
    [
      { label: 'Today', day: tokenDay('today') },
      { label: 'End of this week', day: tokenDay('end-of-week') },
      { label: 'End of this month', day: tokenDay('end-of-month') },
      { label: 'End of next month', day: tokenDay('end-of-next-month') },
    ],
  ],
}

/** A day as the line under a Relative end names it: `Thu, Dec 3` (with its year when not this year's). */
function endDay(d: Date, today: Date): string {
  return formatDateWith(d, d.getFullYear() === today.getFullYear()
    ? { weekday: 'short', month: 'short', day: 'numeric' }
    : { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
}

/**
 * The line under a Relative end: its day today (`Thu, Dec 3`), and with the
 * other end open, which way the range runs from it (`Thu, Dec 3 and
 * earlier` under a To, `… and later` under a From). `null` for no end.
 */
export function resolvedEndWords(
  side: DateAnchorSide,
  a: DateAnchor | null,
  other: DateAnchor | null,
  today: Date,
  weekStartsOn: WeekStart,
): string | null {
  if (a == null) return null
  const words = endDay(resolveDateAnchor(a, today, weekStartsOn), today)
  if (other != null) return words
  return side === 'to' ? `${words} and earlier` : `${words} and later`
}
