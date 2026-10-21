import { DATE_FIELD_VALUES, type DateField } from '../models/app-view'
import {
  OPTIONAL_DATE_FIELDS,
  type DateAnchor,
  type DateFilters,
  type DateMatch,
} from '../models/filter-predicate'
import { readDateAnchor } from './date-anchor'

/**
 * The date filters (`DateFilters`): one clause per date type, a task must
 * pass every clause. These helpers keep the map in its stored form — only
 * clauses that filter, `includeNoDate` only when true and only on the due
 * date / follow-up, `set` / `unset` only on those two — so two maps that
 * filter the same compare equal.
 */

/** Whether a clause filters: Has a date / No date always, a range only with an end. */
export function isDateMatchOn(m: DateMatch | null | undefined): m is DateMatch {
  if (!m) return false
  if (m.match !== 'range') return true
  return m.start != null || m.end != null
}

/** Whether `field` offers Has a date / No date and "also tasks with no date" (due date, follow-up). */
export function isOptionalDateField(field: DateField): boolean {
  return OPTIONAL_DATE_FIELDS.includes(field)
}

/** The date types that filter, in `DATE_FIELD_VALUES` order (Due · Follow-up · Created · Modified). */
export function activeDateFields(dates: DateFilters | null | undefined): DateField[] {
  if (!dates) return []
  return DATE_FIELD_VALUES.filter((f) => isDateMatchOn(dates[f]))
}

/** Whether any date type filters. */
export function hasDateFilters(dates: DateFilters | null | undefined): boolean {
  return activeDateFields(dates).length > 0
}

/**
 * A clause as stored for `field`, or `null` when it doesn't filter or
 * doesn't apply there (Has a date / No date on Created / Modified).
 */
export function normalizeDateMatch(field: DateField, m: DateMatch | null | undefined): DateMatch | null {
  if (!isDateMatchOn(m)) return null
  const optional = isOptionalDateField(field)
  if (m.match !== 'range') return optional ? { match: m.match } : null
  return {
    match: 'range',
    start: m.start,
    end: m.end,
    ...(optional && m.includeNoDate === true ? { includeNoDate: true } : {}),
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

/** A clause's range (open ends when it isn't a range). */
export function dateRangeOf(m: DateMatch | null | undefined): { start: DateAnchor | null; end: DateAnchor | null; includeNoDate: boolean } {
  if (m?.match !== 'range') return { start: null, end: null, includeNoDate: false }
  return { start: m.start, end: m.end, includeNoDate: m.includeNoDate === true }
}

function anchorsEqual(a: DateAnchor | null, b: DateAnchor | null): boolean {
  if (a == null || b == null) return a == null && b == null
  if (a.kind === 'fixed' && b.kind === 'fixed') return a.iso === b.iso
  if (a.kind === 'relative' && b.kind === 'relative') return a.token === b.token
  if (a.kind === 'offset' && b.kind === 'offset') return a.days === b.days
  return false
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
    return anchorsEqual(p.start, q.start) && anchorsEqual(p.end, q.end) && (p.includeNoDate === true) === (q.includeNoDate === true)
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
