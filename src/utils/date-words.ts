import type { DateAnchor, DateMatch } from '../models/filter-predicate'
import type { DateField } from '../models/app-view'
import { rollingDayLabel } from './date-anchor'
import { unitWord } from './interval'

/**
 * A date clause in words, as a Graphical date chip says it (`within the
 * next 14 days`, `7+ days ago`, `on or before Oct 31, or none`) — shared
 * by the chips (`filter-chips`) and an expression read back in words
 * (`filter-expression/words`), so a date reads the same in both.
 */

function dayLabel(n: number): string {
  return `${n} ${n === 1 ? 'day' : 'days'}`
}

/** An offset counted in weeks, months or years (typed intervals: `+2w`), as its signed count and unit; null for others. */
function unitOffset(a: DateAnchor | null): { n: number; unit: 'w' | 'm' | 'y' } | null {
  return a?.kind === 'offset' && a.unit != null ? { n: a.days, unit: a.unit } : null
}

/** `2 weeks`, `1 month`. */
function unitLabel(n: number, unit: 'w' | 'm' | 'y'): string {
  return `${n} ${unitWord(unit, n)}`
}

/**
 * One endpoint in words: `Oct 15`, `today`, `end of week`, `in 3 days`, `2
 * days ago`, `in 2 weeks`, `1 month ago` — one day either way as its name
 * (`yesterday`, `tomorrow`), as the tokens read.
 */
export function describeAnchor(anchor: DateAnchor): string {
  switch (anchor.kind) {
    case 'fixed':
      return new Date(anchor.iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    case 'relative':
      return rollingDayLabel(anchor.token)
    case 'offset':
      if (anchor.days === 0) return 'today'
      if (anchor.unit != null) {
        const label = unitLabel(Math.abs(anchor.days), anchor.unit)
        return anchor.days > 0 ? `in ${label}` : `${label} ago`
      }
      if (anchor.days === 1) return 'tomorrow'
      if (anchor.days === -1) return 'yesterday'
      return anchor.days > 0 ? `in ${dayLabel(anchor.days)}` : `${dayLabel(-anchor.days)} ago`
  }
}

/**
 * An anchor that names a day by its distance from today — a day offset, or
 * `yesterday` / `today` / `tomorrow` — as that distance; `null` for a fixed
 * date, a week or month token, an offset in weeks, months or years, or no
 * anchor.
 */
function dayOffset(a: DateAnchor | null): number | null {
  if (a == null || a.kind === 'fixed') return null
  if (a.kind === 'offset') return a.unit == null || a.days === 0 ? a.days : null
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
 * An offset in weeks, months or years reads in its unit the same way:
 * `within the next 2 weeks`, `within the last 3 months`, `2+ weeks ago`,
 * `in 1 month or earlier`, `1+ years ahead`, `1 month ago or later`.
 * Never `up to`, `by` or a bare `from`.
 */
export function describeRange(start: DateAnchor | null, end: DateAnchor | null): string {
  const s = dayOffset(start)
  const e = dayOffset(end)
  const su = unitOffset(start)
  const eu = unitOffset(end)
  if (start && end) {
    if (JSON.stringify(start) === JSON.stringify(end) || (s != null && s === e)) return describeAnchor(start)
    if (s === 0 && e != null && e > 0) return e === 1 ? 'today or tomorrow' : `within the next ${dayLabel(e)}`
    if (e === 0 && s != null && s < 0) return s === -1 ? 'yesterday or today' : `within the last ${dayLabel(-s)}`
    if (s === 0 && eu && eu.n > 0) return `within the next ${unitLabel(eu.n, eu.unit)}`
    if (e === 0 && su && su.n < 0) return `within the last ${unitLabel(-su.n, su.unit)}`
    return `${describeAnchor(start)} – ${describeAnchor(end)}`
  }
  if (end) {
    if (eu) return eu.n < 0 ? `${-eu.n}+ ${unitWord(eu.unit, 2)} ago` : `${describeAnchor(end)} or earlier`
    if (e == null) return `on or before ${describeAnchor(end)}`
    if (e === -1) return 'before today'
    if (e < -1) return `${-e}+ days ago`
    return `${describeAnchor(end)} or earlier`
  }
  if (start) {
    if (su) return su.n > 0 ? `${su.n}+ ${unitWord(su.unit, 2)} ahead` : `${describeAnchor(start)} or later`
    if (s == null) return `on or after ${describeAnchor(start)}`
    if (s === 1) return 'after today'
    if (s > 1) return `${s}+ days ahead`
    return `${describeAnchor(start)} or later`
  }
  return ''
}

/** A task held in the Planner's Unplanned tray, in words (Planned's `held`). */
export const HELD_WORDS = 'held in Unplanned'

/** How a type's clause names its tasks without the date: never followed up; no due date / next follow-up. */
function noDateWord(field: DateField): string {
  return field === 'lastFollowup' ? 'never' : 'none'
}

/**
 * One `field` clause in words: `within the next 14 days`, `on or before Oct
 * 31, or none` (Last follow-up: `, or never`); Show Any `any date`, None
 * `none` (Last follow-up: `never`); Planned's `held` `held in Unplanned`; an "is not" range with `not` (`not
 * within the next 14 days`, `not within the last 7 days`).
 */
export function describeDateMatch(m: DateMatch, field: DateField): string {
  if (m.match === 'set') return 'any date'
  if (m.match === 'unset') return noDateWord(field)
  if (m.match === 'held') return HELD_WORDS
  const range = describeRange(m.start, m.end)
  if (m.not === true) return `not ${range}`
  return m.includeNoDate === true ? `${range}, or ${noDateWord(field)}` : range
}
