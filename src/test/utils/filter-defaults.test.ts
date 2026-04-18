import { describe, it, expect } from 'vitest'
import { getFilterDefaults } from '../../utils/filter-defaults'
import type { FilterCriteria } from '../../stores/filter-store'

function makeFilters(overrides: Partial<FilterCriteria> = {}): FilterCriteria {
  return {
    showCompleted: false,
    showHiddenStatuses: false,
    personIds: null,
    personFilterMode: 'include-orgs',
    tagIds: null,
    orgIds: null,
    orgFilterMode: 'include-people',
    statusIds: null,
    searchText: '',
    dateField: 'date',
    dateRangeStart: null,
    dateRangeEnd: null,
    dateRangeIncludeNoDate: false,
    hasScheduled: null,
    hasDeadline: null,
    ...overrides,
  }
}

describe('getFilterDefaults', () => {
  it('returns empty defaults when no filters active', () => {
    const result = getFilterDefaults(makeFilters())
    expect(result.personIds).toEqual([])
    expect(result.tagIds).toEqual([])
    expect(result.orgIds).toEqual([])
    expect(result.statusId).toBeUndefined()
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

  it('strips 0 from tagIds', () => {
    const result = getFilterDefaults(makeFilters({ tagIds: new Set([0, 10]) }))
    expect(result.tagIds).toEqual([10])
  })

  it('strips 0 from orgIds', () => {
    const result = getFilterDefaults(makeFilters({ orgIds: new Set([0, 20]) }))
    expect(result.orgIds).toEqual([20])
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
      tagIds: new Set([20]),
      orgIds: new Set([0, 30]),
      statusIds: new Set([7]),
    }))
    expect(result.personIds).toHaveLength(2)
    expect(result.tagIds).toEqual([20])
    expect(result.orgIds).toEqual([30])
    expect(result.statusId).toBe(7)
  })
})
