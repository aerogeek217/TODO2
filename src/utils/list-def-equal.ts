import type { PersistedListDefinition } from '../models/list-definition'
import type { TodoPredicate } from '../models'
import type { DateAnchor } from '../models/filter-predicate'

function idArraysEqualAsSet(a: number[] | null | undefined, b: number[] | null | undefined): boolean {
  if (a == null && b == null) return true
  if (a == null || b == null) return false
  if (a.length !== b.length) return false
  const set = new Set(a)
  for (const x of b) if (!set.has(x)) return false
  return true
}

function anchorsEqual(a: DateAnchor | null, b: DateAnchor | null): boolean {
  if (a == null && b == null) return true
  if (a == null || b == null) return false
  if (a.kind !== b.kind) return false
  if (a.kind === 'fixed' && b.kind === 'fixed') return a.iso === b.iso
  if (a.kind === 'relative' && b.kind === 'relative') return a.token === b.token
  if (a.kind === 'offset' && b.kind === 'offset') return a.days === b.days
  return false
}

function predicatesEqual(a: TodoPredicate, b: TodoPredicate): boolean {
  return (
    a.showCompleted === b.showCompleted &&
    a.showHiddenStatuses === b.showHiddenStatuses &&
    a.personFilterMode === b.personFilterMode &&
    a.orgFilterMode === b.orgFilterMode &&
    a.searchText === b.searchText &&
    a.dateField === b.dateField &&
    a.dateRangeIncludeNoDate === b.dateRangeIncludeNoDate &&
    a.hasScheduled === b.hasScheduled &&
    a.hasDeadline === b.hasDeadline &&
    idArraysEqualAsSet(a.personIds, b.personIds) &&
    idArraysEqualAsSet(a.orgIds, b.orgIds) &&
    idArraysEqualAsSet(a.projectIds, b.projectIds) &&
    idArraysEqualAsSet(a.statusIds, b.statusIds) &&
    idArraysEqualAsSet(a.tags, b.tags) &&
    anchorsEqual(a.dateRangeStart, b.dateRangeStart) &&
    anchorsEqual(a.dateRangeEnd, b.dateRangeEnd)
  )
}

export function defsEqual(a: PersistedListDefinition, b: PersistedListDefinition): boolean {
  // Ignore `sortOrder` (reorder is saved independently) and `favorited`
  // (toggled immediately from the dialog header — never part of the draft).
  if (a.name !== b.name) return false
  if (a.pinnedToDashboard !== b.pinnedToDashboard) return false
  if (JSON.stringify(a.sort) !== JSON.stringify(b.sort)) return false
  if (JSON.stringify(a.grouping) !== JSON.stringify(b.grouping)) return false
  if (JSON.stringify(a.runtimeFilter ?? null) !== JSON.stringify(b.runtimeFilter ?? null)) return false
  if (a.membership.kind !== b.membership.kind) return false
  if (a.membership.kind === 'custom' && b.membership.kind === 'custom') {
    if (!predicatesEqual(a.membership.predicate, b.membership.predicate)) return false
  }
  return true
}
