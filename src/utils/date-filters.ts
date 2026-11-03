import { DATE_FIELD_VALUES, type DateField } from '../models/app-view'
import {
  NEGATABLE_DATE_FIELDS,
  OPTIONAL_DATE_FIELDS,
  type DateAnchor,
  type DateFilters,
  type DateMatch,
} from '../models/filter-predicate'
import { dateAnchorsEqual, readDateAnchor } from './date-anchor'

/**
 * The date filters (`DateFilters`): one clause per date type, a task must
 * pass every clause. These helpers keep the map in its stored form — only
 * clauses that filter, `includeNoDate` only when true and only on the
 * optional types (`OPTIONAL_DATE_FIELDS`: the due date, the next and the
 * last follow-up), `set` / `unset` only on those, a range's "is not" (`not`)
 * only when true and never on Completed (`NEGATABLE_DATE_FIELDS`), with no
 * `includeNoDate` beside it (a negated range keeps undated tasks anyway) —
 * so two maps that filter the same compare equal.
 */

/** Whether a clause filters: Any / None (`set` / `unset`) always, a range only with an end. */
export function isDateMatchOn(m: DateMatch | null | undefined): m is DateMatch {
  if (!m) return false
  if (m.match !== 'range') return true
  return m.start != null || m.end != null
}

/** Whether `field` offers Any / None (`set` / `unset`) and "also tasks with no date" (due date, next / last follow-up). */
export function isOptionalDateField(field: DateField): boolean {
  return OPTIONAL_DATE_FIELDS.includes(field)
}

/** Whether `field`'s range offers "is not" (every type but Completed). */
export function isNegatableDateField(field: DateField): boolean {
  return NEGATABLE_DATE_FIELDS.includes(field)
}

/** The date types that filter, in `DATE_FIELD_VALUES` order (Due · Next follow-up · Last follow-up · Completed · Created · Modified). */
export function activeDateFields(dates: DateFilters | null | undefined): DateField[] {
  if (!dates) return []
  return DATE_FIELD_VALUES.filter((f) => isDateMatchOn(dates[f]))
}

/** Whether any date type filters. */
export function hasDateFilters(dates: DateFilters | null | undefined): boolean {
  return activeDateFields(dates).length > 0
}

/**
 * The date types a date panel offers, in its tabs' reading order: every
 * type but those its host leaves out (the check-in: Completed).
 */
export function offeredDateFields(omit?: readonly DateField[]): readonly DateField[] {
  return omit && omit.length > 0 ? DATE_FIELD_VALUES.filter((f) => !omit.includes(f)) : DATE_FIELD_VALUES
}

/**
 * The first of `offered` (the panel's tab order) that doesn't filter in
 * `dates` — where adding Dates to a scope opens, so it makes a new chip —
 * or `undefined` when every offered type filters there already.
 */
export function freeDateField(dates: DateFilters | null | undefined, offered: readonly DateField[] = DATE_FIELD_VALUES): DateField | undefined {
  return offered.find((f) => !isDateMatchOn(dates?.[f]))
}

/**
 * A clause as stored for `field`, or `null` when it doesn't filter or
 * doesn't apply there (Any / None — `set` / `unset` — on Completed / Created / Modified).
 */
export function normalizeDateMatch(field: DateField, m: DateMatch | null | undefined): DateMatch | null {
  if (!isDateMatchOn(m)) return null
  const optional = isOptionalDateField(field)
  if (m.match !== 'range') return optional ? { match: m.match } : null
  const not = m.not === true && isNegatableDateField(field)
  return {
    match: 'range',
    start: m.start,
    end: m.end,
    ...(not ? { not: true } : optional && m.includeNoDate === true ? { includeNoDate: true } : {}),
  }
}

/** Every clause in its stored form, in `DATE_FIELD_VALUES` order. */
export function normalizeDateFilters(dates: DateFilters | null | undefined): DateFilters {
  const out: DateFilters = {}
  if (!dates) return out
  for (const field of DATE_FIELD_VALUES) {
    const m = normalizeDateMatch(field, dates[field])
    if (m) out[field] = m
  }
  return out
}

/** `dates` with `field`'s clause replaced; `null` (or a clause that doesn't filter) removes it. */
export function withDateMatch(dates: DateFilters, field: DateField, m: DateMatch | null): DateFilters {
  return normalizeDateFilters({ ...dates, [field]: m ?? undefined })
}

/** A clause's range (open ends, "is", when it isn't a range). */
export function dateRangeOf(m: DateMatch | null | undefined): { start: DateAnchor | null; end: DateAnchor | null; includeNoDate: boolean; not: boolean } {
  if (m?.match !== 'range') return { start: null, end: null, includeNoDate: false, not: false }
  return { start: m.start, end: m.end, includeNoDate: m.includeNoDate === true, not: m.not === true }
}

/** Whether two date filter maps filter the same (clauses compared in their stored form). */
export function dateFiltersEqual(a: DateFilters | null | undefined, b: DateFilters | null | undefined): boolean {
  const x = normalizeDateFilters(a)
  const y = normalizeDateFilters(b)
  return DATE_FIELD_VALUES.every((field) => {
    const p = x[field]
    const q = y[field]
    if (!p || !q) return p === q
    if (p.match !== q.match) return false
    if (p.match !== 'range' || q.match !== 'range') return true
    return dateAnchorsEqual(p.start, q.start) && dateAnchorsEqual(p.end, q.end)
      && (p.includeNoDate === true) === (q.includeNoDate === true) && (p.not === true) === (q.not === true)
  })
}

/**
 * The date filters as the evaluators read them: anchors through
 * `readDateAnchor` (an anchor it can't read is an open end), in stored form.
 */
export function readDateFilters(dates: DateFilters | null | undefined): DateFilters {
  const out: DateFilters = {}
  if (!dates) return out
  for (const field of DATE_FIELD_VALUES) {
    const m = dates[field]
    const read = m?.match === 'range'
      ? normalizeDateMatch(field, { ...m, start: readDateAnchor(m.start), end: readDateAnchor(m.end) })
      : normalizeDateMatch(field, m)
    if (read) out[field] = read
  }
  return out
}
