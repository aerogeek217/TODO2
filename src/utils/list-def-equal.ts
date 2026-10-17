import type { PersistedListDefinition } from '../models/list-definition'
import type { TodoPredicate } from '../models'
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

export function defsEqual(a: PersistedListDefinition, b: PersistedListDefinition): boolean {
  // Ignore `sortOrder` (reorder is saved independently).
  if (a.name !== b.name) return false
  if (JSON.stringify(a.sort) !== JSON.stringify(b.sort)) return false
  if (JSON.stringify(a.grouping) !== JSON.stringify(b.grouping)) return false
  if (JSON.stringify(a.runtimeFilter ?? null) !== JSON.stringify(b.runtimeFilter ?? null)) return false
  if (a.membership.kind !== b.membership.kind) return false
  if (a.membership.kind === 'custom' && b.membership.kind === 'custom') {
    if (!predicatesEqual(a.membership.predicate, b.membership.predicate)) return false
  }
  return true
}
