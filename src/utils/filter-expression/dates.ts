import type { DateField } from '../../models/app-view'
import type { DateAnchor, DateMatch, RelativeDateToken } from '../../models/filter-predicate'
import { addDays, startOfDay } from '../date'
import { dateAnchorsEqual } from '../date-anchor'

/**
 * The date words of a filter expression, both ways: what a date type is
 * called (`due`, `followed`), how an anchor reads (`today`, `+3d`, `-30d`,
 * `start of week`, `11/30/2026`) and which ranges have a name (`this week`,
 * `overdue`). The parser and the printer share them, so what one writes the
 * other reads back as the same clause.
 */

/** The word that names each date type, as typed and as printed. */
export const DATE_WORD: Record<DateField, string> = {
  deadline: 'due',
  followup: 'followup',
  lastFollowup: 'followed',
  created: 'created',
  modified: 'modified',
  completed: 'completed',
}

/** Typed words for the date types (`follow-up` as well as `followup`). */
export const DATE_WORDS: ReadonlyMap<string, DateField> = new Map([
  ['due', 'deadline'],
  ['followup', 'followup'],
  ['follow-up', 'followup'],
  ['followed', 'lastFollowup'],
  ['created', 'created'],
  ['modified', 'modified'],
  ['completed', 'completed'],
])

/** The date types a task may lack: they take `any` / `none` (`due any`, `no due`, `never followed`). */
export function dateTypeIsOptional(field: DateField): boolean {
  return field === 'deadline' || field === 'followup' || field === 'lastFollowup'
}

/** The date types that look back (a period on them runs to today, not from it; a bare weekday is the last one). */
export function looksBack(field: DateField): boolean {
  return field === 'lastFollowup' || field === 'created' || field === 'modified' || field === 'completed'
}

const rel = (token: RelativeDateToken): DateAnchor => ({ kind: 'relative', token })
export const range = (start: DateAnchor | null, end: DateAnchor | null): DateMatch => ({ match: 'range', start, end })

/** Before today: `overdue`, `followup late`. */
export const BEFORE_TODAY: DateMatch = range(null, rel('yesterday'))

export type PeriodWord = 'this week' | 'next week' | 'last week' | 'this month' | 'next month' | 'last month'
export const PERIOD_WORDS: readonly PeriodWord[] = ['this week', 'next week', 'last week', 'this month', 'next month', 'last month']

/**
 * The range a named period is on `field`. `this week` / `this month` run
 * from today to the period's end on the due date and the next follow-up (as
 * the search box's do), and from its start to today on the dates that look
 * back; the others are the whole period.
 */
export function periodRange(period: PeriodWord, field: DateField): DateMatch {
  switch (period) {
    case 'this week': return looksBack(field) ? range(rel('start-of-week'), rel('today')) : range(rel('today'), rel('end-of-week'))
    case 'this month': return looksBack(field) ? range(rel('start-of-month'), rel('today')) : range(rel('today'), rel('end-of-month'))
    case 'next week': return range(rel('start-of-next-week'), rel('end-of-next-week'))
    case 'last week': return range(rel('start-of-last-week'), rel('end-of-last-week'))
    case 'next month': return range(rel('start-of-next-month'), rel('end-of-next-month'))
    case 'last month': return range(rel('start-of-last-month'), rel('end-of-last-month'))
  }
}

/** The named period `m` is on `field`, if it is one. */
export function periodOf(m: DateMatch, field: DateField): PeriodWord | null {
  if (m.match !== 'range') return null
  return PERIOD_WORDS.find((p) => {
    const r = periodRange(p, field)
    return r.match === 'range' && dateAnchorsEqual(r.start, m.start) && dateAnchorsEqual(r.end, m.end)
  }) ?? null
}

/** How the week and month anchors read (`start of week`); the day ones read as days. */
const TOKEN_WORDS: Partial<Record<RelativeDateToken, string>> = {
  'start-of-week': 'start of week',
  'end-of-week': 'end of week',
  'start-of-next-week': 'start of next week',
  'end-of-next-week': 'end of next week',
  'start-of-last-week': 'start of last week',
  'end-of-last-week': 'end of last week',
  'start-of-month': 'start of month',
  'end-of-month': 'end of month',
  'start-of-next-month': 'start of next month',
  'end-of-next-month': 'end of next month',
  'start-of-last-month': 'start of last month',
  'end-of-last-month': 'end of last month',
  'end-of-month-plus-3': 'end of month + 3',
}

/** The anchor a week / month phrase names (`start of next week`), or null. */
export function tokenOfWords(words: string): RelativeDateToken | null {
  const found = Object.entries(TOKEN_WORDS).find(([, w]) => w === words)
  return found ? found[0] as RelativeDateToken : null
}

/** A day's distance from today, for the anchors that name one (`yesterday`, `in 3 days`); null for others. */
export function dayOffsetOf(a: DateAnchor): number | null {
  if (a.kind === 'offset') return a.days
  if (a.kind === 'relative') {
    if (a.token === 'yesterday') return -1
    if (a.token === 'today') return 0
    if (a.token === 'tomorrow') return 1
  }
  return null
}

/** The anchor for a day `n` days from today: `yesterday` / `today` / `tomorrow` by name, any other as an offset. */
export function dayAnchor(n: number): DateAnchor {
  if (n === -1) return rel('yesterday')
  if (n === 0) return rel('today')
  if (n === 1) return rel('tomorrow')
  return { kind: 'offset', days: n }
}

/** A fixed date's local day. */
function fixedDay(iso: string): Date {
  return startOfDay(new Date(iso))
}

/** A fixed anchor for a local day. */
export function fixedAnchorOf(day: Date): DateAnchor {
  return { kind: 'fixed', iso: startOfDay(day).toISOString() }
}

/**
 * The week / month anchors one day apart, whatever day the week starts on
 * (`utils/effective-date.resolveRelativeToken` counts both ends of a week
 * from the same start): the day before a period's start is the end of the
 * one before it. The others have no named neighbour (the day before the
 * start of last week, the day after the end of next month).
 */
const DAY_AFTER: Partial<Record<RelativeDateToken, RelativeDateToken>> = {
  'end-of-last-week': 'start-of-week',
  'end-of-week': 'start-of-next-week',
  'end-of-last-month': 'start-of-month',
  'end-of-month': 'start-of-next-month',
}
const DAY_BEFORE: Partial<Record<RelativeDateToken, RelativeDateToken>> = Object.fromEntries(
  Object.entries(DAY_AFTER).map(([before, after]) => [after, before]),
)

/**
 * `a` moved by `delta` days (`before fri` / `< fri` is `by` / `<=` the day
 * before), exactly: a day or a fixed date by the days; a week / month
 * anchor by one day onto its named neighbour (`< start of week` is `<= end
 * of last week`). Null when the day it lands on has no anchor of its kind
 * (`< start of last week`, `> end of month + 3`).
 */
export function shiftAnchor(a: DateAnchor, delta: number): DateAnchor | null {
  if (a.kind === 'fixed') return fixedAnchorOf(addDays(fixedDay(a.iso), delta))
  const n = dayOffsetOf(a)
  if (n != null) return dayAnchor(n + delta)
  if (a.kind !== 'relative' || Math.abs(delta) !== 1) return null
  const token = (delta > 0 ? DAY_AFTER : DAY_BEFORE)[a.token]
  return token ? rel(token) : null
}

/** A relative day as typed: `+3d`, `-30d`, `+0d` (signed, whole days), or null. */
export function relativeDayOf(word: string): number | null {
  const m = /^([+-])(\d{1,4})d$/i.exec(word)
  if (!m) return null
  const n = parseInt(m[2] ?? '', 10)
  if (n > 3660) return null
  return m[1] === '-' ? -n : n
}

/**
 * An anchor as the expression writes it: `today`, `tomorrow`, `yesterday`,
 * any other day from today compact and signed (`+3d`, `-30d`), `start of
 * week`, `11/30/2026`.
 */
export function anchorWords(a: DateAnchor): string {
  if (a.kind === 'fixed') {
    const d = fixedDay(a.iso)
    return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`
  }
  const n = dayOffsetOf(a)
  if (n != null) {
    if (n === 0) return 'today'
    if (n === 1) return 'tomorrow'
    if (n === -1) return 'yesterday'
    return n > 0 ? `+${n}d` : `${n}d`
  }
  return a.kind === 'relative' ? TOKEN_WORDS[a.token] ?? a.token : ''
}

/** How `field` says it has no date: `no due`, `no followup`, `never followed`. */
export function noDateWords(field: DateField): string {
  return field === 'lastFollowup' ? 'never followed' : `no ${DATE_WORD[field]}`
}

/**
 * One date clause as the expression writes it (the date type's word
 * first): `due any`, `no due`, `overdue`, `followup late`, `due this week`,
 * `due today`, `due within 3 days`, `created within last 7 days`, `due +3d`,
 * `due -3d..+7d`, `due 11/1/2026..11/30/2026`, and a range open at one end
 * as a comparison — `due <= 11/13/2026`, `followup >= +7d`, `modified <=
 * -30d` (its end is included, so `<=` / `>=`; `<` / `>` read as the day
 * before / after). A range with neither end matches every task and is
 * written `due any or no due` (only an unnormalised clause has one).
 */
export function dateClauseWords(field: DateField, m: DateMatch): string {
  const word = DATE_WORD[field]
  if (m.match === 'set') return `${word} any`
  if (m.match === 'unset') return noDateWords(field)
  const { start, end } = m
  if (start == null && end != null && dateAnchorsEqual(end, rel('yesterday'))) {
    if (field === 'deadline') return 'overdue'
    if (field === 'followup') return 'followup late'
  }
  const period = periodOf(m, field)
  if (period) return `${word} ${period}`
  if (start != null && end != null) {
    const s = dayOffsetOf(start)
    const e = dayOffsetOf(end)
    if (dateAnchorsEqual(start, end) || (s != null && s === e)) return `${word} ${anchorWords(start)}`
    if (s === 0 && e != null && e > 0) return `${word} within ${e} ${e === 1 ? 'day' : 'days'}`
    if (e === 0 && s != null && s < 0) return `${word} within last ${-s} ${s === -1 ? 'day' : 'days'}`
    return `${word} ${anchorWords(start)}..${anchorWords(end)}`
  }
  if (end != null) return `${word} <= ${anchorWords(end)}`
  if (start != null) return `${word} >= ${anchorWords(start)}`
  return `(${word} any or ${noDateWords(field)})`
}
