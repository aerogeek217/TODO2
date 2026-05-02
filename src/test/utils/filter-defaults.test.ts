import { describe, it, expect } from 'vitest'
import { getFilterDefaults, predicateToFilterDefaults, supplementWithFilterDefaults } from '../../utils/filter-defaults'
import type { FilterCriteria } from '../../stores/filter-store'
import type { ResolvedInput } from '../../services/nlp-resolver'
import type { TodoPredicate } from '../../models'

function makeFilters(overrides: Partial<FilterCriteria> = {}): FilterCriteria {
  return {
    showCompleted: false,
    showHiddenStatuses: false,
    personIds: null,
    personFilterMode: 'include-orgs',
    orgIds: null,
    orgFilterMode: 'include-people',
    projectIds: null,
    statusIds: null,
    searchText: '',
    dateField: 'date',
    dateRangeStart: null,
    dateRangeEnd: null,
    dateRangeIncludeNoDate: false,
    hasScheduled: null,
    hasDeadline: null,
    tags: null,
    ...overrides,
  }
}

describe('getFilterDefaults', () => {
  it('returns empty defaults when no filters active', () => {
    const result = getFilterDefaults(makeFilters())
    expect(result.personIds).toEqual([])
    expect(result.orgIds).toEqual([])
    expect(result.tagIds).toEqual([])
    expect(result.statusId).toBeUndefined()
    expect(result.projectId).toBeUndefined()
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
      orgIds: new Set([0, 30]),
      statusIds: new Set([7]),
      projectIds: new Set([42]),
      tags: new Set([1, 2]),
    }))
    expect(result.personIds).toHaveLength(2)
    expect(result.orgIds).toEqual([30])
    expect(result.statusId).toBe(7)
    expect(result.projectId).toBe(42)
    expect(result.tagIds).toHaveLength(2)
  })

  it('single project returns that project', () => {
    const result = getFilterDefaults(makeFilters({ projectIds: new Set([9]) }))
    expect(result.projectId).toBe(9)
  })

  it('single project 0 returns undefined', () => {
    const result = getFilterDefaults(makeFilters({ projectIds: new Set([0]) }))
    expect(result.projectId).toBeUndefined()
  })

  it('multiple projects returns undefined', () => {
    const result = getFilterDefaults(makeFilters({ projectIds: new Set([3, 5]) }))
    expect(result.projectId).toBeUndefined()
  })
})

function makeResolved(overrides: Partial<ResolvedInput> = {}): ResolvedInput {
  return {
    title: 'test',
    personIds: [],
    orgIds: [],
    unmatchedPersons: [],
    unmatchedProjects: [],
    tags: [],
    unmatchedStatuses: [],
    ...overrides,
  }
}

describe('supplementWithFilterDefaults', () => {
  it('fills empty person/org from filter defaults', () => {
    const resolved = makeResolved()
    supplementWithFilterDefaults(resolved, { personIds: [1, 2], orgIds: [3], tagIds: [], statusId: undefined, projectId: undefined })
    expect(resolved.personIds).toEqual([1, 2])
    expect(resolved.orgIds).toEqual([3])
  })

  it('does not overwrite NLP-resolved people', () => {
    const resolved = makeResolved({ personIds: [99] })
    supplementWithFilterDefaults(resolved, { personIds: [1, 2], orgIds: [], tagIds: [], statusId: undefined, projectId: undefined })
    expect(resolved.personIds).toEqual([99])
  })

  it('fills undefined projectId from filter default', () => {
    const resolved = makeResolved()
    supplementWithFilterDefaults(resolved, { personIds: [], orgIds: [], tagIds: [], statusId: undefined, projectId: 7 })
    expect(resolved.projectId).toBe(7)
  })

  it('does not overwrite NLP-resolved projectId', () => {
    const resolved = makeResolved({ projectId: 55 })
    supplementWithFilterDefaults(resolved, { personIds: [], orgIds: [], tagIds: [], statusId: undefined, projectId: 7 })
    expect(resolved.projectId).toBe(55)
  })

  it('fills undefined statusId from filter default', () => {
    const resolved = makeResolved()
    supplementWithFilterDefaults(resolved, { personIds: [], orgIds: [], tagIds: [], statusId: 4, projectId: undefined })
    expect(resolved.statusId).toBe(4)
  })

  it('does not overwrite NLP-resolved statusId', () => {
    const resolved = makeResolved({ statusId: 99 })
    supplementWithFilterDefaults(resolved, { personIds: [], orgIds: [], tagIds: [], statusId: 4, projectId: undefined })
    expect(resolved.statusId).toBe(99)
  })
})

function makePredicate(overrides: Partial<TodoPredicate> = {}): TodoPredicate {
  return {
    showCompleted: false,
    showHiddenStatuses: false,
    personIds: null,
    personFilterMode: 'include-orgs',
    orgIds: null,
    orgFilterMode: 'include-people',
    projectIds: null,
    statusIds: null,
    searchText: '',
    dateField: 'date',
    dateRangeStart: null,
    dateRangeEnd: null,
    dateRangeIncludeNoDate: false,
    hasScheduled: null,
    hasDeadline: null,
    tags: null,
    ...overrides,
  }
}

describe('predicateToFilterDefaults', () => {
  it('mirrors getFilterDefaults for a populated predicate', () => {
    const result = predicateToFilterDefaults(makePredicate({
      personIds: [5, 10],
      orgIds: [0, 30],
      statusIds: [7],
      projectIds: [42],
      tags: [1, 2],
    }))
    expect(result.personIds).toHaveLength(2)
    expect(result.orgIds).toEqual([30])
    expect(result.statusId).toBe(7)
    expect(result.projectId).toBe(42)
    expect(result.tagIds).toHaveLength(2)
  })

  it('empty predicate yields empty defaults', () => {
    const result = predicateToFilterDefaults(makePredicate())
    expect(result.personIds).toEqual([])
    expect(result.orgIds).toEqual([])
    expect(result.tagIds).toEqual([])
    expect(result.statusId).toBeUndefined()
    expect(result.projectId).toBeUndefined()
  })
})
