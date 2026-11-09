import type { DateAnchor, DateMatch } from '../models/filter-predicate'
import type { DateField } from '../models/app-view'
import { rollingDayLabel } from './date-anchor'

/**
 * A date clause in words, as a Graphical date chip says it (`within the
 * next 14 days`, `7+ days ago`, `on or before Oct 31, or none`) — shared
 * by the chips (`filter-chips`) and an expression read back in words
 * (`filter-expression/words`), so a date reads the same in both.
 */

function dayLabel(n: number): string {
  return `${n} ${n === 1 ? 'day' : 'days'}`
}

/**
 * One endpoint in words: `Oct 15`, `today`, `end of week`, `in 3 days`, `2
 * days ago` — one day either way as its name (`yesterday`, `tomorrow`), as
 * the tokens read.
 */
export function describeAnchor(anchor: DateAnchor): string {
  switch (anchor.kind) {
    case 'fixed':
      return new Date(anchor.iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    case 'relative':
      return rollingDayLabel(anchor.token)
    case 'offset':
      if (anchor.days === 0) return 'today'
      if (anchor.days === 1) return 'tomorrow'
      if (anchor.days === -1) return 'yesterday'
      return anchor.days > 0 ? `in ${dayLabel(anchor.days)}` : `${dayLabel(-anchor.days)} ago`
  }
}

/**
 * An anchor that names a day by its distance from today — a day offset, or
 * `yesterday` / `today` / `tomorrow` — as that distance; `null` for a fixed
 * date, a week or month token, or no anchor.
 */
function dayOffset(a: DateAnchor | null): number | null {
  if (a == null || a.kind === 'fixed') return null
  if (a.kind === 'offset') return a.days
  switch (a.token) {
    case 'yesterday': return -1
    case 'today': return 0
    case 'tomorrow': return 1
    default: return null
  }
}

/**
 * A date range in words that can't be misread (both ends are inclusive of
 * their whole day; an open end takes everything beyond):
 * - one day alone: `today`, `Oct 30`, `end of week`;
 * - today and a day offset: `within the next 14 days`, `within the last 7
 *   days` (`today or tomorrow`, `yesterday or today` for one day);
 * - a To alone: N or more days ago as `7+ days ago`, yesterday as `before
 *   today`, another day as `today or earlier` / `in 14 days or earlier`, a
 *   date or week / month token as `on or before Oct 26` / `on or before end
 *   of week`;
 * - a From alone: N or more days ahead as `7+ days ahead`, tomorrow as
 *   `after today`, another day as `today or later` / `30 days ago or later`,
 *   a date or token as `on or after Oct 26` / `on or after start of month`;
 * - two other ends: `Oct 1 – Oct 15`, `7 days ago – yesterday`.
 * Never `up to`, `by` or a bare `from`.
 */
export function describeRange(start: DateAnchor | null, end: DateAnchor | null): string {
  const s = dayOffset(start)
  const e = dayOffset(end)
  if (start && end) {
    if (JSON.stringify(start) === JSON.stringify(end) || (s != null && s === e)) return describeAnchor(start)
    if (s === 0 && e != null && e > 0) return e === 1 ? 'today or tomorrow' : `within the next ${dayLabel(e)}`
    if (e === 0 && s != null && s < 0) return s === -1 ? 'yesterday or today' : `within the last ${dayLabel(-s)}`
    return `${describeAnchor(start)} – ${describeAnchor(end)}`
  }
  if (end) {
    if (e == null) return `on or before ${describeAnchor(end)}`
    if (e === -1) return 'before today'
    if (e < -1) return `${-e}+ days ago`
    return `${describeAnchor(end)} or earlier`
  }
  if (start) {
    if (s == null) return `on or after ${describeAnchor(start)}`
    if (s === 1) return 'after today'
    if (s > 1) return `${s}+ days ahead`
    return `${describeAnchor(start)} or later`
  }
  return ''
}

/** How a type's clause names its tasks without the date: never followed up; no due date / next follow-up. */
function noDateWord(field: DateField): string {
  return field === 'lastFollowup' ? 'never' : 'none'
}

/**
 * One `field` clause in words: `within the next 14 days`, `on or before Oct
 * 31, or none` (Last follow-up: `, or never`); Show Any `any date`, None
 * `none` (Last follow-up: `never`); an "is not" range with `not` (`not
 * within the next 14 days`, `not within the last 7 days`).
 */
export function describeDateMatch(m: DateMatch, field: DateField): string {
  if (m.match === 'set') return 'any date'
  if (m.match === 'unset') return noDateWord(field)
  const range = describeRange(m.start, m.end)
  if (m.not === true) return `not ${range}`
  return m.includeNoDate === true ? `${range}, or ${noDateWord(field)}` : range
}
