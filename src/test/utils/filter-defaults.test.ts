import { describe, it, expect } from 'vitest'
import { getFilterDefaults, predicateToFilterDefaults } from '../../utils/filter-defaults'
import type { FilterCriteria } from '../../utils/filter-criteria'
import type { TodoPredicate } from '../../models'

function makeFilters(overrides: Partial<FilterCriteria> = {}): FilterCriteria {
  return {
    showCompleted: false,
    personIds: null,
    statusIds: null,
    searchText: '',
    dates: {},
    markers: null,
    tags: null,
    ...overrides,
  }
}

describe('getFilterDefaults', () => {
  it('returns empty defaults when no filters active', () => {
    const result = getFilterDefaults(makeFilters())
    expect(result.personIds).toEqual([])
    expect(result.tagIds).toEqual([])
    expect(result.statusId).toBeUndefined()
  })

  it('returns all tag ids when filter has tag clause', () => {
    const result = getFilterDefaults(makeFilters({ tags: new Set([4, 8]) }))
    expect(result.tagIds).toHaveLength(2)
    expect(result.tagIds).toContain(4)
    expect(result.tagIds).toContain(8)
  })

  it('returns single person filter', () => {
    const result = getFilterDefaults(makeFilters({ personIds: new Set([5]) }))
    expect(result.personIds).toEqual([5])
  })

  it('returns multiple person filters', () => {
    const result = getFilterDefaults(makeFilters({ personIds: new Set([5, 10]) }))
    expect(result.personIds).toHaveLength(2)
    expect(result.personIds).toContain(5)
    expect(result.personIds).toContain(10)
  })

  it('strips 0 (None) from personIds', () => {
    const result = getFilterDefaults(makeFilters({ personIds: new Set([0, 5]) }))
    expect(result.personIds).toEqual([5])
  })

  it('returns all-zero set as empty', () => {
    const result = getFilterDefaults(makeFilters({ personIds: new Set([0]) }))
    expect(result.personIds).toEqual([])
  })

  it('single status returns that status', () => {
    const result = getFilterDefaults(makeFilters({ statusIds: new Set([3]) }))
    expect(result.statusId).toBe(3)
  })

  it('single status 0 returns undefined', () => {
    const result = getFilterDefaults(makeFilters({ statusIds: new Set([0]) }))
    expect(result.statusId).toBeUndefined()
  })

  it('multiple statuses returns undefined', () => {
    const result = getFilterDefaults(makeFilters({ statusIds: new Set([3, 5]) }))
    expect(result.statusId).toBeUndefined()
  })

  it('combination of multiple filter types', () => {
    const result = getFilterDefaults(makeFilters({
      personIds: new Set([5, 10]),
      statusIds: new Set([7]),
      tags: new Set([1, 2]),
    }))
    expect(result.personIds).toHaveLength(2)
    expect(result.statusId).toBe(7)
    expect(result.tagIds).toHaveLength(2)
  })
})

function makePredicate(overrides: Partial<TodoPredicate> = {}): TodoPredicate {
  return {
    showCompleted: false,
    personIds: null,
    statusIds: null,
    searchText: '',
    dates: {},
    tags: null,
    ...overrides,
  }
}

describe('getFilterDefaults — Priority Yes / No', () => {
  it('seeds each Yes on and each No off; Hot seeds nothing', () => {
    expect(getFilterDefaults(makeFilters({ markers: { urgent: true, important: false } })).markers).toEqual({ urgent: true, important: false })
    expect(getFilterDefaults(makeFilters({ markers: { focus: false } })).markers).toEqual({ focus: false })
    expect(getFilterDefaults(makeFilters({ markers: 'hot' })).markers).toBeUndefined()
  })
})

describe('predicateToFilterDefaults', () => {
  it('mirrors getFilterDefaults for a populated predicate', () => {
    const result = predicateToFilterDefaults(makePredicate({
      personIds: [5, 10],
      statusIds: [7],
      tags: [1, 2],
    }))
    expect(result.personIds).toHaveLength(2)
    expect(result.statusId).toBe(7)
    expect(result.tagIds).toHaveLength(2)
  })

  it('empty predicate yields empty defaults', () => {
    const result = predicateToFilterDefaults(makePredicate())
    expect(result.personIds).toEqual([])
    expect(result.tagIds).toEqual([])
    expect(result.statusId).toBeUndefined()
  })
})
