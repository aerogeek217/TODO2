import { describe, it, expect } from 'vitest'
import { emptyPredicate } from '../../models'
import type { PersistedListDefinition } from '../../models/list-definition'
import { changedListFields, defsEqual } from '../../utils/list-def-equal'

function def(over: Partial<PersistedListDefinition> = {}): PersistedListDefinition {
  return {
    id: 1, name: 'List', sortOrder: 0, sort: 'deadline', grouping: 'none',
    membership: { kind: 'custom', predicate: emptyPredicate() },
    ...over,
  }
}

describe('list definition equality — sort direction', () => {
  it('a descending list differs from the same list in its natural order', () => {
    expect(defsEqual(def(), def({ sortDirection: 'desc' }))).toBe(false)
    expect([...changedListFields(def({ sortDirection: 'desc' }), def())]).toEqual(['sort'])
  })

  it('no direction and asc are the same order', () => {
    expect(defsEqual(def(), def({ sortDirection: 'asc' }))).toBe(true)
    expect(changedListFields(def({ sortDirection: 'asc' }), def()).size).toBe(0)
  })

  it('a manual list has no direction: a stored one makes no difference', () => {
    expect(defsEqual(def({ sort: 'manual' }), def({ sort: 'manual', sortDirection: 'desc' }))).toBe(true)
    expect(changedListFields(def({ sort: 'manual', sortDirection: 'desc' }), def({ sort: 'manual' })).size).toBe(0)
  })
})
