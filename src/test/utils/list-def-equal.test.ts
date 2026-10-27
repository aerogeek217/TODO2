import { describe, it, expect } from 'vitest'
import { emptyFilterClauses, emptyPredicate, type FilterClauses, type TodoPredicate } from '../../models'
import type { PersistedListDefinition } from '../../models/list-definition'
import { changedListFields, defsEqual, predicatesEqual } from '../../utils/list-def-equal'

function def(over: Partial<PersistedListDefinition> = {}): PersistedListDefinition {
  return {
    id: 1, name: 'List', sortOrder: 0, sort: 'deadline', grouping: 'none',
    membership: { kind: 'custom', predicate: emptyPredicate() },
    ...over,
  }
}

describe('list definition equality — Priority Yes / No', () => {
  const withMarkers = (markers: TodoPredicate['markers']) => def({ membership: { kind: 'custom', predicate: { ...emptyPredicate(), markers } } })

  it('Yes and No on a marker are different filters', () => {
    expect(defsEqual(withMarkers({ urgent: true }), withMarkers({ urgent: false }))).toBe(false)
    expect([...changedListFields(withMarkers({ urgent: false }), withMarkers({ urgent: true }))]).toEqual(['filters'])
  })

  it('no markers and an empty set are the same; key order doesn’t matter', () => {
    expect(defsEqual(withMarkers(null), withMarkers({}))).toBe(true)
    expect(defsEqual(withMarkers({ urgent: true, important: false }), withMarkers({ important: false, urgent: true }))).toBe(true)
  })
})

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

describe('list definition equality — filter line and Priority grouping', () => {
  it('a hidden filter line differs from a shown one; absent = shown', () => {
    expect(defsEqual(def(), def({ showFilterLine: false }))).toBe(false)
    expect([...changedListFields(def({ showFilterLine: false }), def())]).toEqual(['filterLine'])
    // A stray `true` (never stored) reads as shown.
    expect(defsEqual(def(), def({ showFilterLine: true as unknown as false }))).toBe(true)
  })

  it('grouping by Priority is a group change', () => {
    expect(defsEqual(def(), def({ grouping: 'priority' }))).toBe(false)
    expect([...changedListFields(def({ grouping: 'priority' }), def())]).toEqual(['group'])
  })
})

describe('list definition equality — or groups', () => {
  const hot: FilterClauses = { ...emptyFilterClauses(), markers: 'hot' }
  const mine: FilterClauses = { ...emptyFilterClauses(), personIds: [1, 2] }
  const withGroups = (orGroups: FilterClauses[] | undefined, extra: Partial<TodoPredicate> = {}) =>
    def({ membership: { kind: 'custom', predicate: { ...emptyPredicate(), ...extra, ...(orGroups ? { orGroups } : {}) } } })

  it('an or group is part of the filters', () => {
    expect(predicatesEqual({ ...emptyPredicate(), orGroups: [hot] }, emptyPredicate())).toBe(false)
    expect([...changedListFields(withGroups([hot]), withGroups(undefined))]).toEqual(['filters'])
    expect([...changedListFields(withGroups([hot, mine]), withGroups([hot, { ...mine, negate: { personIds: true } }]))]).toEqual(['filters'])
  })

  it('or groups compare in order, each as the clauses compare (id lists as sets)', () => {
    expect(defsEqual(withGroups([hot, mine]), withGroups([hot, { ...mine, personIds: [2, 1] }]))).toBe(true)
    expect(defsEqual(withGroups([hot, mine]), withGroups([mine, hot]))).toBe(false)
    expect(defsEqual(withGroups([hot]), withGroups([hot, mine]))).toBe(false)
  })

  it('an or group that filters nothing, an empty list and no key are the same', () => {
    expect(defsEqual(withGroups([]), withGroups(undefined))).toBe(true)
    expect(defsEqual(withGroups([emptyFilterClauses(), hot]), withGroups([hot]))).toBe(true)
  })

  it('a clause inside an or group is not the same clause outside it', () => {
    expect(defsEqual(withGroups([hot]), withGroups(undefined, { markers: 'hot' }))).toBe(false)
  })
})
