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
    a.searchText === b.searchText &&
    a.dateField === b.dateField &&
    a.dateRangeIncludeNoDate === b.dateRangeIncludeNoDate &&
    a.hasDeadline === b.hasDeadline &&
    (a.hasFollowup ?? null) === (b.hasFollowup ?? null) &&
    (a.focus ?? null) === (b.focus ?? null) &&
    idArraysEqualAsSet(a.personIds, b.personIds) &&
    idArraysEqualAsSet(a.projectIds, b.projectIds) &&
    idArraysEqualAsSet(a.statusIds, b.statusIds) &&
    idArraysEqualAsSet(a.tags, b.tags) &&
    anchorsEqual(a.dateRangeStart, b.dateRangeStart) &&
    anchorsEqual(a.dateRangeEnd, b.dateRangeEnd)
  )
}

export function defsEqual(a: PersistedListDefinition, b: PersistedListDefinition): boolean {
  // Ignore `sortOrder` (reorder is saved independently).
  if (a.name !== b.name) return false
  if (a.pinnedToDashboard !== b.pinnedToDashboard) return false
  if ((a.maxTasks ?? null) !== (b.maxTasks ?? null)) return false
  if ((a.limitMode ?? 'hard') !== (b.limitMode ?? 'hard')) return false
  if (JSON.stringify(a.sort) !== JSON.stringify(b.sort)) return false
  if (JSON.stringify(a.grouping) !== JSON.stringify(b.grouping)) return false
  if (JSON.stringify(a.runtimeFilter ?? null) !== JSON.stringify(b.runtimeFilter ?? null)) return false
  if (a.membership.kind !== b.membership.kind) return false
  if (a.membership.kind === 'custom' && b.membership.kind === 'custom') {
    if (!predicatesEqual(a.membership.predicate, b.membership.predicate)) return false
  }
  return true
}
