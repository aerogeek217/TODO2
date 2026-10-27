import type { PersistedListDefinition } from '../models/list-definition'
import type { FilterClauses, TodoPredicate } from '../models'
import { effectiveSortDirection } from '../models'
import { dateFiltersEqual } from './date-filters'
import { hasFilterClause } from './or-groups'
import { markersEqual } from './markers'
import { negationEqual } from './filter-negation'

function idArraysEqualAsSet(a: number[] | null | undefined, b: number[] | null | undefined): boolean {
  if (a == null && b == null) return true
  if (a == null || b == null) return false
  if (a.length !== b.length) return false
  const set = new Set(a)
  for (const x of b) if (!set.has(x)) return false
  return true
}

/** Whether two sets of clauses filter the same (id lists as sets, the "is not" switches included). */
function clausesEqual(a: FilterClauses, b: FilterClauses): boolean {
  return (
    a.searchText === b.searchText &&
    dateFiltersEqual(a.dates, b.dates) &&
    markersEqual(a.markers, b.markers) &&
    idArraysEqualAsSet(a.personIds, b.personIds) &&
    idArraysEqualAsSet(a.statusIds, b.statusIds) &&
    idArraysEqualAsSet(a.tags, b.tags) &&
    negationEqual(a, b)
  )
}

/**
 * Whether two predicates filter the same: Show completed, their clauses
 * (id lists as sets, the "is not" switches included) and their or groups
 * in order, each compared as the clauses are (one that filters nothing
 * doesn't count).
 */
export function predicatesEqual(a: TodoPredicate, b: TodoPredicate): boolean {
  if (a.showCompleted !== b.showCompleted || !clausesEqual(a, b)) return false
  const x = (a.orGroups ?? []).filter(hasFilterClause)
  const y = (b.orGroups ?? []).filter(hasFilterClause)
  return x.length === y.length && x.every((group, i) => {
    const other = y[i]
    return other !== undefined && clausesEqual(group, other)
  })
}

/**
 * Whether two lists sort the same: the same sort, in the same effective
 * direction (no direction = `asc`; Manual has none).
 */
function sortsEqual(a: PersistedListDefinition, b: PersistedListDefinition): boolean {
  return JSON.stringify(a.sort) === JSON.stringify(b.sort)
    && effectiveSortDirection(a.sort, a.sortDirection) === effectiveSortDirection(b.sort, b.sortDirection)
}

/** Whether the list shows its filter line (absent = shown). */
function filterLineShown(def: PersistedListDefinition): boolean {
  return def.showFilterLine !== false
}

export function defsEqual(a: PersistedListDefinition, b: PersistedListDefinition): boolean {
  // Ignore `sortOrder` (reorder is saved independently).
  if (a.name !== b.name) return false
  if (!sortsEqual(a, b)) return false
  if (JSON.stringify(a.grouping) !== JSON.stringify(b.grouping)) return false
  if (JSON.stringify(a.runtimeFilter ?? null) !== JSON.stringify(b.runtimeFilter ?? null)) return false
  if (filterLineShown(a) !== filterLineShown(b)) return false
  if (a.membership.kind !== b.membership.kind) return false
  if (a.membership.kind === 'custom' && b.membership.kind === 'custom') {
    if (!predicatesEqual(a.membership.predicate, b.membership.predicate)) return false
  }
  return true
}

/** A part of a list definition the list editor shows as one row. */
export type ListDefField = 'name' | 'filters' | 'group' | 'sort' | 'prompt' | 'filterLine'

/**
 * The editor rows whose value differs between `a` and `b` (e.g. a draft and
 * the saved list). Show completed, the "is not" switches and the or groups
 * count as part of the filters and the sort direction as part of the sort;
 * Show filter line is its own row; `sortOrder` is never compared.
 */
export function changedListFields(a: PersistedListDefinition, b: PersistedListDefinition): ReadonlySet<ListDefField> {
  const out = new Set<ListDefField>()
  if (a.name !== b.name) out.add('name')
  if (a.membership.kind !== b.membership.kind
    || (a.membership.kind === 'custom' && b.membership.kind === 'custom' && !predicatesEqual(a.membership.predicate, b.membership.predicate))) {
    out.add('filters')
  }
  if (JSON.stringify(a.grouping) !== JSON.stringify(b.grouping)) out.add('group')
  if (!sortsEqual(a, b)) out.add('sort')
  if (JSON.stringify(a.runtimeFilter ?? null) !== JSON.stringify(b.runtimeFilter ?? null)) out.add('prompt')
  if (filterLineShown(a) !== filterLineShown(b)) out.add('filterLine')
  return out
}
