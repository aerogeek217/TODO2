import type { DateField } from '../models/app-view'
import { NEGATABLE_FIELDS, OR_GROUPS_MAX, emptyFilterClauses, type FilterClauses, type TodoPredicate } from '../models/filter-predicate'
import { hasDateFilters, normalizeDateFilters } from './date-filters'
import { withNormalizedNegation } from './filter-negation'
import { hasMarkers, normalizeMarkersFilter } from './markers'

/**
 * A predicate's or groups (`TodoPredicate.orGroups`): each is a set of
 * clauses of which a task must pass at least one. These helpers keep them in
 * their stored form — every or group's clauses normalised as the
 * predicate's own are, an or group with no clause left out (it filters
 * nothing), at most `OR_GROUPS_MAX`, and the `orGroups` key absent when
 * there is none — so two predicates that filter the same compare equal.
 * Every writer runs `withNormalizedOrGroups` (or `withOrGroupClauses`).
 */

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
 * `c`'s narrowing clauses alone (anything else — Show completed, or groups —
 * left out), in their stored form: every field present (`null` / `''` /
 * `{}` = no filter), a text of spaces alone as `''` (it matches every task,
 * which in an or group would let every task through), the date clauses and
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

/** Or groups in their stored form (see the module comment); `[]` when none is left. */
export function normalizeOrGroups(groups: readonly FilterClauses[] | null | undefined): FilterClauses[] {
  if (!groups) return []
  return groups.map(normalizeClauses).filter(hasFilterClause).slice(0, OR_GROUPS_MAX)
}

/** `p` with its or groups in their stored form: the `orGroups` key only while one is left. Returns `p` itself when it has none. */
export function withNormalizedOrGroups<T extends { orGroups?: FilterClauses[] }>(p: T): T {
  if (p.orGroups === undefined) return p
  const groups = normalizeOrGroups(p.orGroups)
  const next = { ...p }
  if (groups.length > 0) next.orGroups = groups
  else delete next.orGroups
  return next
}

/** Whether `p` has an or group that filters. */
export function hasOrGroups(p: { orGroups?: readonly FilterClauses[] }): boolean {
  return (p.orGroups ?? []).some(hasFilterClause)
}

/**
 * `p` with or group `index`'s clauses replaced by `edit` of them, the or
 * groups normalised (an or group left with no clause goes). An `index` one
 * past the last adds an or group (`edit` of empty clauses) — unless
 * `OR_GROUPS_MAX` are there; any other index leaves `p` unchanged.
 */
export function withOrGroupClauses<T extends { orGroups?: FilterClauses[] }>(
  p: T,
  index: number,
  edit: (clauses: FilterClauses) => FilterClauses,
): T {
  const groups = p.orGroups ?? []
  if (!Number.isInteger(index) || index < 0 || index > groups.length) return p
  if (index === groups.length && groups.length >= OR_GROUPS_MAX) return p
  const current = groups[index] ?? emptyFilterClauses()
  const next = [...groups]
  next[index] = edit(current)
  return withNormalizedOrGroups({ ...p, orGroups: next })
}

/** How many clauses of `c` filter (a date type each): a chip each. */
function clauseCount(c: FilterClauses): number {
  return (c.personIds != null ? 1 : 0)
    + (c.statusIds != null ? 1 : 0)
    + (c.tags != null ? 1 : 0)
    + ((c.searchText ?? '').trim() !== '' ? 1 : 0)
    + (hasMarkers(c.markers) ? 1 : 0)
    + Object.keys(normalizeDateFilters(c.dates)).length
}

/** `own` with the one clause of `group` moved in; null when `own` already filters on it. */
function withClauseMoved<T extends FilterClauses>(own: T, group: FilterClauses): T | null {
  const dates = normalizeDateFilters(group.dates)
  const dateFields = Object.keys(dates) as DateField[]
  const [dateField] = dateFields
  if (dateField) {
    if (normalizeDateFilters(own.dates)[dateField]) return null
    return { ...own, dates: { ...own.dates, ...dates } }
  }
  if (hasMarkers(group.markers)) return hasMarkers(own.markers) ? null : { ...own, markers: group.markers }
  if ((group.searchText ?? '').trim() !== '') return (own.searchText ?? '').trim() !== '' ? null : { ...own, searchText: group.searchText }
  for (const key of NEGATABLE_FIELDS) {
    if (group[key] == null) continue
    if (own[key] != null) return null
    const moved = { ...own, [key]: group[key] }
    return group.negate?.[key] ? withNormalizedNegation({ ...moved, negate: { ...own.negate, [key]: true } }) : moved
  }
  return null
}

/**
 * `p` with each or group of one clause gone and that clause among `p`'s own:
 * with nothing to be an alternative to, it filters the same. A group whose
 * clause `p` already filters on stays (one clause per field; it can't move).
 * `dissolved`: the indexes of the groups that went. Returns `p` itself when
 * none did.
 */
export function dissolveSingleOrGroups<T extends TodoPredicate>(p: T): { predicate: T; dissolved: number[] } {
  const groups = p.orGroups ?? []
  let own: T = p
  const dissolved: number[] = []
  groups.forEach((group, index) => {
    if (clauseCount(group) !== 1) return
    const moved = withClauseMoved(own, group)
    if (!moved) return
    own = moved
    dissolved.push(index)
  })
  if (dissolved.length === 0) return { predicate: p, dissolved }
  const kept = groups.filter((_, index) => !dissolved.includes(index))
  return { predicate: withNormalizedOrGroups({ ...own, orGroups: kept }), dissolved }
}

/** `p` without or group `index` (any other index leaves `p` unchanged). */
export function withoutOrGroup<T extends { orGroups?: FilterClauses[] }>(p: T, index: number): T {
  const groups = p.orGroups ?? []
  if (!Number.isInteger(index) || index < 0 || index >= groups.length) return p
  return withNormalizedOrGroups({ ...p, orGroups: groups.filter((_, i) => i !== index) })
}
