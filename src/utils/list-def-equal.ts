import type { PersistedListDefinition } from '../models/list-definition'
import type { TodoPredicate } from '../models'
import { effectiveSortDirection } from '../models'
import { dateFiltersEqual } from './date-filters'
import { markersEqual } from './markers'

function idArraysEqualAsSet(a: number[] | null | undefined, b: number[] | null | undefined): boolean {
  if (a == null && b == null) return true
  if (a == null || b == null) return false
  if (a.length !== b.length) return false
  const set = new Set(a)
  for (const x of b) if (!set.has(x)) return false
  return true
}

function predicatesEqual(a: TodoPredicate, b: TodoPredicate): boolean {
  return (
    a.showCompleted === b.showCompleted &&
    a.searchText === b.searchText &&
    dateFiltersEqual(a.dates, b.dates) &&
    markersEqual(a.markers, b.markers) &&
    idArraysEqualAsSet(a.personIds, b.personIds) &&
    idArraysEqualAsSet(a.statusIds, b.statusIds) &&
    idArraysEqualAsSet(a.tags, b.tags)
  )
}

/**
 * Whether two lists sort the same: the same sort, in the same effective
 * direction (no direction = `asc`; Manual has none).
 */
function sortsEqual(a: PersistedListDefinition, b: PersistedListDefinition): boolean {
  return JSON.stringify(a.sort) === JSON.stringify(b.sort)
    && effectiveSortDirection(a.sort, a.sortDirection) === effectiveSortDirection(b.sort, b.sortDirection)
}

export function defsEqual(a: PersistedListDefinition, b: PersistedListDefinition): boolean {
  // Ignore `sortOrder` (reorder is saved independently).
  if (a.name !== b.name) return false
  if (!sortsEqual(a, b)) return false
  if (JSON.stringify(a.grouping) !== JSON.stringify(b.grouping)) return false
  if (JSON.stringify(a.runtimeFilter ?? null) !== JSON.stringify(b.runtimeFilter ?? null)) return false
  if (a.membership.kind !== b.membership.kind) return false
  if (a.membership.kind === 'custom' && b.membership.kind === 'custom') {
    if (!predicatesEqual(a.membership.predicate, b.membership.predicate)) return false
  }
  return true
}

/** A part of a list definition the list editor shows as one row. */
export type ListDefField = 'name' | 'filters' | 'group' | 'sort' | 'prompt'

/**
 * The editor rows whose value differs between `a` and `b` (e.g. a draft and
 * the saved list). Show completed counts as part of the filters and the sort
 * direction as part of the sort; `sortOrder` is never compared.
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
  return out
}
