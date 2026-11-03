import type { DateAnchor, RelativeDateToken } from '../models/filter-predicate'
import { RELATIVE_DATE_TOKENS } from '../models/filter-predicate'
import { addDays, startOfDay } from './date'
import { daysUntil, resolveDateAnchor, resolveRelativeToken, type WeekStart } from './effective-date'
import { formatFollowupDate } from './followup'

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
    if (o.kind === 'offset' && typeof o.days === 'number' && Number.isFinite(o.days)) {
      return { kind: 'offset', days: Math.trunc(o.days) }
    }
  }
  return null
}

/** Whether two range ends are the same anchor (both open, or the same kind and value). */
export function dateAnchorsEqual(a: DateAnchor | null, b: DateAnchor | null): boolean {
  if (a == null || b == null) return a == null && b == null
  if (a.kind === 'fixed' && b.kind === 'fixed') return a.iso === b.iso
  if (a.kind === 'relative' && b.kind === 'relative') return a.token === b.token
  if (a.kind === 'offset' && b.kind === 'offset') return a.days === b.days
  return false
}

/** Labels of the relative date tokens (sentence case; the words and the Relative list lower-case them). */
export const RELATIVE_TOKEN_LABELS: Record<RelativeDateToken, string> = {
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
 * each end a number of days ago / ahead (`offset`) or a rolling day
 * (`relative` token). Not stored: it is read from the ends (`entryModeOf`).
 */
export type DateEntryMode = 'calendar' | 'relative'

/** What a Relative end's number counts. */
export type DayCount = 'ago' | 'ahead'

/**
 * One end as the Relative row shows it: no end; a number (0 or more, never
 * signed) and what it counts; a rolling day; or — a saved mix — a calendar
 * date, shown as its own choice (`on Oct 1`) while it is the value.
 */
export type RelativeEnd =
  | { kind: 'none' }
  | { kind: 'count'; days: number; count: DayCount }
  | { kind: 'rolling'; token: RelativeDateToken }
  | { kind: 'date'; iso: string }

/**
 * A stored end as the Relative row shows it. An offset of 0 has no sign of
 * its own: it counts `zeroCount` (what was picked last; `days ago` by
 * default) — it reads today either way, as the `today` token does.
 */
export function relativeEndOf(a: DateAnchor | null, zeroCount: DayCount = 'ago'): RelativeEnd {
  if (a == null) return { kind: 'none' }
  switch (a.kind) {
    case 'fixed': return { kind: 'date', iso: a.iso }
    case 'relative': return { kind: 'rolling', token: a.token }
    case 'offset': return { kind: 'count', days: Math.abs(a.days), count: a.days < 0 ? 'ago' : a.days > 0 ? 'ahead' : zeroCount }
  }
}

/** The stored end for a Relative row's number and count: `7` `days ago` → `{ kind: 'offset', days: -7 }`. */
export function countAnchor(days: number, count: DayCount): DateAnchor {
  const n = Math.abs(Math.trunc(days))
  return { kind: 'offset', days: count === 'ago' && n !== 0 ? -n : n }
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

/** An end in `mode`: to Calendar, its day today as a date; to Relative, a date as days from today (today itself: the `today` rolling day). */
export function convertAnchor(a: DateAnchor | null, mode: DateEntryMode, today: Date, weekStartsOn: WeekStart): DateAnchor | null {
  if (a == null) return null
  if (mode === 'calendar') return a.kind === 'fixed' ? a : fixedAnchorOn(resolveDateAnchor(a, today, weekStartsOn))
  if (a.kind !== 'fixed') return a
  const days = daysUntil(new Date(a.iso), today) ?? 0
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

/** A named number of days (a month is 30): Relative's Fill in items, Calendar's Set to… offsets. */
export interface DayPreset {
  days: number
  label: string
}

/** The named day counts, past then future. */
export const DAY_PRESETS: readonly DayPreset[] = [
  { days: -7, label: '1 week ago' },
  { days: -14, label: '2 weeks ago' },
  { days: -30, label: '1 month ago' },
  { days: 7, label: 'In 1 week' },
  { days: 14, label: 'In 2 weeks' },
  { days: 30, label: 'In 1 month' },
]

/**
 * The rolling days each end's Relative list offers, in order: a range starts
 * at the start of a week or month and ends at its end. Any other token a
 * stored filter holds is listed with them while it is the value.
 */
export const ROLLING_DAYS: Record<DateAnchorSide, readonly RelativeDateToken[]> = {
  from: ['today', 'start-of-week', 'start-of-month'],
  to: ['today', 'end-of-week', 'end-of-month'],
}

/** A Calendar end's Set to… item: picking it fills the date with its day today. */
export interface CalendarPreset {
  label: string
  day: (today: Date, weekStartsOn: WeekStart) => Date
}

function tokenDay(token: RelativeDateToken): CalendarPreset['day'] {
  return (today, weekStartsOn) => resolveRelativeToken(token, today, weekStartsOn)
}

function offsetPresets(past: boolean): CalendarPreset[] {
  return DAY_PRESETS.filter((p) => (p.days < 0) === past)
    .map((p) => ({ label: p.label, day: (today: Date) => addDays(startOfDay(today), p.days) }))
}

/** Each end's Set to… items in groups (a separator between): the named days, then the day counts (From: past; To: future). */
export const CALENDAR_PRESETS: Record<DateAnchorSide, readonly (readonly CalendarPreset[])[]> = {
  from: [
    [
      { label: 'Today', day: tokenDay('today') },
      { label: 'Start of this week', day: tokenDay('start-of-week') },
      { label: 'Start of this month', day: tokenDay('start-of-month') },
      { label: 'Start of last month', day: (today) => new Date(today.getFullYear(), today.getMonth() - 1, 1) },
    ],
    offsetPresets(true),
  ],
  to: [
    [
      { label: 'Today', day: tokenDay('today') },
      { label: 'End of this week', day: tokenDay('end-of-week') },
      { label: 'End of this month', day: tokenDay('end-of-month') },
      { label: 'End of next month', day: tokenDay('end-of-next-month') },
    ],
    offsetPresets(false),
  ],
}

/**
 * The line under a Relative end: its day today (`Mon 26 Oct`), and with the
 * other end open, which way the range runs from it (`Mon 26 Oct and
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
  const words = formatFollowupDate(resolveDateAnchor(a, today, weekStartsOn), today)
  if (other != null) return words
  return side === 'to' ? `${words} and earlier` : `${words} and later`
}
