import type { TodoItem } from '../models/todo-item'
import { parseDatePhrase } from '../services/natural-language-parser'
import { MS_PER_DAY, startOfDay } from './date'

/**
 * Follow-up dates. `nextFollowupAt` is a calendar day stored at local
 * midnight; intervals (`3d`, `2w`, `1m`, `1y`) count from today. The
 * Settings default interval is stored as the compact string form (`1m`).
 */

export type FollowupUnit = 'd' | 'w' | 'm' | 'y'

export interface FollowupInterval {
  count: number
  unit: FollowupUnit
}

export const DEFAULT_FOLLOWUP_INTERVAL: FollowupInterval = { count: 1, unit: 'm' }

/** The quick intervals offered next to every next-follow-up input. */
export const QUICK_FOLLOWUP_INTERVALS: readonly FollowupInterval[] = [
  { count: 1, unit: 'w' },
  { count: 2, unit: 'w' },
  { count: 1, unit: 'm' },
  { count: 3, unit: 'm' },
]

/** Largest count accepted in an interval (`999d` … `999y`). */
export const MAX_FOLLOWUP_INTERVAL_COUNT = 999

const INTERVAL_PATTERN = /^\s*(\d{1,3})\s*([dwmy])\s*$/i

/** `3d` / `2w` / `1m` / `1y` (case-insensitive, count 1–999) → interval, else null. */
export function parseFollowupInterval(text: string): FollowupInterval | null {
  const m = text.match(INTERVAL_PATTERN)
  if (!m || m[1] == null || m[2] == null) return null
  const count = parseInt(m[1], 10)
  if (count < 1 || count > MAX_FOLLOWUP_INTERVAL_COUNT) return null
  return { count, unit: m[2].toLowerCase() as FollowupUnit }
}

/** Compact form used for storage: `{1, 'm'}` → `1m`. */
export function formatFollowupInterval(i: FollowupInterval): string {
  return `${i.count}${i.unit}`
}

const UNIT_WORDS: Record<FollowupUnit, string> = { d: 'day', w: 'week', m: 'month', y: 'year' }

/** Human form: `{2, 'w'}` → `2 weeks`. */
export function describeFollowupInterval(i: FollowupInterval): string {
  const word = UNIT_WORDS[i.unit]
  return `${i.count} ${word}${i.count === 1 ? '' : 's'}`
}

/** Calendar months, clamped to the target month's last day (Jan 31 + 1m → Feb 28/29). */
function addMonths(d: Date, months: number): Date {
  const y = d.getFullYear()
  const m = d.getMonth() + months
  const lastDay = new Date(y, m + 1, 0).getDate()
  return new Date(y, m, Math.min(d.getDate(), lastDay))
}

/** The day `interval` after `from`'s day, at local midnight. */
export function addFollowupInterval(from: Date, interval: FollowupInterval): Date {
  const base = startOfDay(from)
  switch (interval.unit) {
    case 'd': return startOfDay(new Date(base.getFullYear(), base.getMonth(), base.getDate() + interval.count))
    case 'w': return startOfDay(new Date(base.getFullYear(), base.getMonth(), base.getDate() + interval.count * 7))
    case 'm': return addMonths(base, interval.count)
    case 'y': return addMonths(base, interval.count * 12)
  }
}

const MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
]

/** Month index for a name or a prefix of at least 3 letters (`oct`, `sept`, `october`), else -1. */
function monthIndex(word: string): number {
  const w = word.toLowerCase()
  if (w.length < 3) return -1
  return MONTHS.findIndex((m) => m.startsWith(w))
}

function buildDate(year: number, month: number, day: number): Date | null {
  const d = new Date(year, month, day)
  return d.getMonth() === month && d.getDate() === day ? d : null
}

/** Which way a year-less date resolves: the next occurrence, or the latest one up to today. */
export type FollowupDateDirection = 'future' | 'past'

function resolveYearless(month: number, day: number, today: Date, direction: FollowupDateDirection): Date | null {
  const base = startOfDay(today)
  const thisYear = buildDate(base.getFullYear(), month, day)
  if (direction === 'future') {
    if (thisYear && thisYear.getTime() >= base.getTime()) return thisYear
    return buildDate(base.getFullYear() + 1, month, day)
  }
  if (thisYear && thisYear.getTime() <= base.getTime()) return thisYear
  return buildDate(base.getFullYear() - 1, month, day)
}

/**
 * Day + month-name dates (`24 Oct`, `Oct 24`, `24 October 2026`), numeric
 * `MM/DD[/YY[YY]]` and ISO `YYYY-MM-DD`. A leading weekday (`Tue 13 Oct`, the
 * inputs' own display form) is ignored. Without a year the date resolves in
 * `direction`.
 */
function parseCalendarDate(text: string, today: Date, direction: FollowupDateDirection): Date | null {
  const t = text.trim().replace(/^(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?,?\s+(?=[\dA-Za-z])/i, '')
  const iso = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (iso && iso[1] && iso[2] && iso[3]) {
    return buildDate(parseInt(iso[1], 10), parseInt(iso[2], 10) - 1, parseInt(iso[3], 10))
  }
  const numeric = t.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?$/)
  if (numeric && numeric[1] && numeric[2]) {
    const month = parseInt(numeric[1], 10) - 1
    const dayOfMonth = parseInt(numeric[2], 10)
    const y = numeric[3]
    if (y) return buildDate(y.length === 2 ? 2000 + parseInt(y, 10) : parseInt(y, 10), month, dayOfMonth)
    return resolveYearless(month, dayOfMonth, today, direction)
  }
  const dayFirst = t.match(/^(\d{1,2})\s+([A-Za-z]+)\.?(?:,?\s+(\d{4}))?$/)
  const monthFirst = t.match(/^([A-Za-z]+)\.?\s+(\d{1,2})(?:,?\s+(\d{4}))?$/)
  let dayOfMonth: number | null = null
  let month = -1
  let yearRaw: string | undefined
  if (dayFirst && dayFirst[1] && dayFirst[2]) {
    dayOfMonth = parseInt(dayFirst[1], 10)
    month = monthIndex(dayFirst[2])
    yearRaw = dayFirst[3]
  } else if (monthFirst && monthFirst[1] && monthFirst[2]) {
    month = monthIndex(monthFirst[1])
    dayOfMonth = parseInt(monthFirst[2], 10)
    yearRaw = monthFirst[3]
  }
  if (dayOfMonth == null || month < 0) return null
  if (yearRaw) return buildDate(parseInt(yearRaw, 10), month, dayOfMonth)
  return resolveYearless(month, dayOfMonth, today, direction)
}

export type FollowupInputResult =
  | { kind: 'empty' }
  | { kind: 'invalid' }
  | { kind: 'date'; date: Date; interval?: FollowupInterval }

/**
 * Parse what the user typed into a follow-up input: an interval relative to
 * `today` (`3d`, `2w`, `1m`, `1y`) or a date in the app's date grammar
 * (`today`, `fri`, `next mon`, `in 3 days`, `10/24`, `24 Oct`, `2026-10-24`).
 * Dates resolve to local midnight. Year-less dates resolve forward (next
 * follow-up) or backward (`direction: 'past'`, last follow-up).
 */
export function parseFollowupInput(
  text: string,
  today: Date,
  direction: FollowupDateDirection = 'future',
): FollowupInputResult {
  if (!text.trim()) return { kind: 'empty' }
  const interval = parseFollowupInterval(text)
  if (interval) return { kind: 'date', date: addFollowupInterval(today, interval), interval }
  const calendar = parseCalendarDate(text, today, direction)
  if (calendar) return { kind: 'date', date: startOfDay(calendar) }
  const phrase = parseDatePhrase(text, today)
  if (phrase) return { kind: 'date', date: startOfDay(phrase) }
  return { kind: 'invalid' }
}

/** Whole days from `today` to `d` (negative = past). */
function dayDiff(d: Date, today: Date): number {
  return Math.round((startOfDay(d).getTime() - startOfDay(today).getTime()) / MS_PER_DAY)
}

/** True when the task's next follow-up day is before today. Completed tasks are never overdue. */
export function isFollowupOverdue(
  t: Pick<TodoItem, 'nextFollowupAt' | 'isCompleted'>,
  today: Date,
): boolean {
  if (!t.nextFollowupAt || t.isCompleted) return false
  return dayDiff(t.nextFollowupAt, today) < 0
}

const weekday = (d: Date) => d.toLocaleDateString('en-US', { weekday: 'short' })
const monthShort = (d: Date) => d.toLocaleDateString('en-US', { month: 'short' })

/** `Tue 13` (this month) / `Tue 10 Nov` (other month) / `Tue 10 Nov 2027` (other year). */
export function formatFollowupDay(date: Date, today: Date): string {
  const d = new Date(date)
  const base = `${weekday(d)} ${d.getDate()}`
  if (d.getFullYear() !== today.getFullYear()) return `${base} ${monthShort(d)} ${d.getFullYear()}`
  if (d.getMonth() !== today.getMonth()) return `${base} ${monthShort(d)}`
  return base
}

/** `Tue 13 Oct` — always with the month (year when not this year). */
export function formatFollowupDate(date: Date, today: Date): string {
  const d = new Date(date)
  const base = `${weekday(d)} ${d.getDate()} ${monthShort(d)}`
  return d.getFullYear() !== today.getFullYear() ? `${base} ${d.getFullYear()}` : base
}

/** Row pill label: `Today`, `Tue 13`, or (overdue) `Fri 9 · 1d late`. */
export function followupPillLabel(
  t: Pick<TodoItem, 'nextFollowupAt' | 'isCompleted'>,
  today: Date,
): string {
  if (!t.nextFollowupAt) return ''
  const diff = dayDiff(t.nextFollowupAt, today)
  if (diff === 0 && !t.isCompleted) return 'Today'
  const day = formatFollowupDay(t.nextFollowupAt, today)
  if (isFollowupOverdue(t, today)) return `${day} · ${-diff}d late`
  return day
}

/**
 * Relative distance in words: `today`, `tomorrow`, `yesterday`, `in 3 days`,
 * `in 2 weeks`, `in 1 month`, `4 weeks ago`, `2 months ago`.
 */
export function relativeDayPhrase(date: Date, today: Date): string {
  const diff = dayDiff(date, today)
  if (diff === 0) return 'today'
  if (diff === 1) return 'tomorrow'
  if (diff === -1) return 'yesterday'
  const abs = Math.abs(diff)
  let amount: string
  if (abs < 14) amount = `${abs} days`
  else if (abs < 28) {
    const w = Math.round(abs / 7)
    amount = `${w} week${w === 1 ? '' : 's'}`
  } else if (abs < 730) {
    const m = Math.round(abs / 30.44)
    amount = `${m} month${m === 1 ? '' : 's'}`
  } else {
    const y = Math.round(abs / 365.25)
    amount = `${y} year${y === 1 ? '' : 's'}`
  }
  return diff > 0 ? `in ${amount}` : `${amount} ago`
}

/** Two-line tooltip for the row pill (next, then last follow-up). */
export function followupTooltip(
  t: Pick<TodoItem, 'nextFollowupAt' | 'lastFollowupAt' | 'isCompleted'>,
  today: Date,
): string {
  const lines: string[] = []
  if (t.nextFollowupAt) {
    const date = formatFollowupDate(t.nextFollowupAt, today)
    lines.push(isFollowupOverdue(t, today) ? `Follow-up overdue · ${date}` : `Next follow-up · ${date}`)
  }
  lines.push(lastFollowupLine(t.lastFollowupAt, today))
  return lines.join('\n')
}

/** `Last followed up Sun 13 Sep, 4 weeks ago` / `Never followed up`. */
export function lastFollowupLine(last: Date | undefined, today: Date): string {
  if (!last) return 'Never followed up'
  return `Last followed up ${formatFollowupDate(last, today)}, ${relativeDayPhrase(last, today)}`
}

/** True when `d` falls on a day after today (last follow-up can't be in the future). */
export function isFutureDay(d: Date, today: Date): boolean {
  return dayDiff(d, today) > 0
}

/**
 * True when the task was already followed up today — "Followed up" then only
 * moves the next follow-up, so its controls render dimmed.
 */
export function isFollowedUpToday(t: Pick<TodoItem, 'lastFollowupAt'>, today: Date): boolean {
  return !!t.lastFollowupAt && dayDiff(t.lastFollowupAt, today) === 0
}
