import type { FilterClauses } from '../models/filter-predicate'
import { hasDateFilters, normalizeDateFilters } from './date-filters'
import { withNormalizedNegation } from './filter-negation'
import { hasMarkers, normalizeMarkersFilter } from './markers'

/** A predicate's clauses in their stored form, and whether any filters. */

/**
 * Whether any clause of `c` filters: an id filter that is set (even with
 * nothing ticked — it then keeps no task), a text filter (not spaces alone),
 * a date clause or a Priority filter.
 */
export function hasFilterClause(c: FilterClauses): boolean {
  return c.personIds != null
    || c.statusIds != null
    || c.tags != null
    || (c.searchText ?? '').trim() !== ''
    || hasDateFilters(c.dates)
    || hasMarkers(c.markers)
}

/**
 * `c`'s narrowing clauses alone (anything else — Show completed, an
 * expression — left out), in their stored form: every field present (`null` / `''` /
 * `{}` = no filter), a text of spaces alone as `''` (it matches every task),
 * the date clauses and
 * the Priority filter normalised, the "is not" switches normalised
 * (`withNormalizedNegation`).
 */
export function normalizeClauses(c: FilterClauses): FilterClauses {
  const out: FilterClauses = {
    personIds: c.personIds ?? null,
    statusIds: c.statusIds ?? null,
    searchText: c.searchText.trim() === '' ? '' : c.searchText,
    dates: normalizeDateFilters(c.dates),
    markers: normalizeMarkersFilter(c.markers),
    tags: c.tags ?? null,
  }
  if (c.negate) out.negate = { ...c.negate }
  return withNormalizedNegation(out)
}
