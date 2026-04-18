import { describe, it, expect, beforeEach } from 'vitest'
import { useFilterStore, matchesFilter, applyFilter } from '../../stores/filter-store'
import type { PersistedTodoItem } from '../../models'

function makeTodo(overrides: Partial<PersistedTodoItem> & { id: number }): PersistedTodoItem {
  return {
    title: 'Test',
    isCompleted: false,
    createdAt: new Date(),
    modifiedAt: new Date(),
    sortOrder: 0,
    ...overrides,
  }
}

/** Short-hand: current active filter state from the store. */
const f = () => useFilterStore.getState().filters

beforeEach(() => {
  useFilterStore.getState().clearAll()
})

describe('useFilterStore', () => {
  it('showCompleted false hides completed tasks', () => {
    // Default is showCompleted: false
    expect(matchesFilter(f(), makeTodo({ id: 1, isCompleted: true }))).toBe(false)
    expect(matchesFilter(f(), makeTodo({ id: 2, isCompleted: false }))).toBe(true)
  })

  it('showCompleted true shows completed tasks', () => {
    useFilterStore.getState().setShowCompleted(true)

    expect(matchesFilter(f(), makeTodo({ id: 1, isCompleted: true }))).toBe(true)
    expect(matchesFilter(f(), makeTodo({ id: 2, isCompleted: false }))).toBe(true)
  })

  it('showHiddenStatuses false hides tasks with hideByDefault statuses', () => {
    const statuses = [{ id: 5, name: 'Hidden', color: '#000', sortOrder: 0, hideByDefault: true }]

    expect(matchesFilter(f(), makeTodo({ id: 1, statusId: 5 }), undefined, undefined, undefined, undefined, undefined, statuses)).toBe(false)
    expect(matchesFilter(f(), makeTodo({ id: 2 }), undefined, undefined, undefined, undefined, undefined, statuses)).toBe(true)
  })

  it('showHiddenStatuses true shows tasks with hideByDefault statuses', () => {
    useFilterStore.getState().setShowHiddenStatuses(true)
    const statuses = [{ id: 5, name: 'Hidden', color: '#000', sortOrder: 0, hideByDefault: true }]

    expect(matchesFilter(f(), makeTodo({ id: 1, statusId: 5 }), undefined, undefined, undefined, undefined, undefined, statuses)).toBe(true)
  })

  it('matchesFilter checks person assignment', () => {
    useFilterStore.getState().setPersonIds(new Set([5]))

    expect(matchesFilter(f(), makeTodo({ id: 1 }), [5])).toBe(true)
    expect(matchesFilter(f(), makeTodo({ id: 2 }), [3])).toBe(false)
    // unassigned tasks filtered out when "None" (0) not in set
    expect(matchesFilter(f(), makeTodo({ id: 3 }))).toBe(false)
    expect(matchesFilter(f(), makeTodo({ id: 4 }), [])).toBe(false)
  })

  it('matchesFilter shows unassigned tasks when None (0) is in personIds', () => {
    useFilterStore.getState().setPersonIds(new Set([0, 5]))

    expect(matchesFilter(f(), makeTodo({ id: 1 }), [5])).toBe(true)
    expect(matchesFilter(f(), makeTodo({ id: 2 }), [3])).toBe(false)
    expect(matchesFilter(f(), makeTodo({ id: 3 }))).toBe(true)
    expect(matchesFilter(f(), makeTodo({ id: 4 }), [])).toBe(true)
  })

  it('matchesFilter checks tag assignment', () => {
    useFilterStore.getState().setTagIds(new Set([10]))

    expect(matchesFilter(f(), makeTodo({ id: 1 }), [], [10])).toBe(true)
    expect(matchesFilter(f(), makeTodo({ id: 2 }), [], [20])).toBe(false)
    // unassigned tasks filtered out when "None" (0) not in set
    expect(matchesFilter(f(), makeTodo({ id: 3 }), [])).toBe(false)
    expect(matchesFilter(f(), makeTodo({ id: 4 }), [], [])).toBe(false)
  })

  it('matchesFilter shows untagged tasks when None (0) is in tagIds', () => {
    useFilterStore.getState().setTagIds(new Set([0, 10]))

    expect(matchesFilter(f(), makeTodo({ id: 1 }), [], [10])).toBe(true)
    expect(matchesFilter(f(), makeTodo({ id: 2 }), [], [20])).toBe(false)
    expect(matchesFilter(f(), makeTodo({ id: 3 }), [])).toBe(true)
    expect(matchesFilter(f(), makeTodo({ id: 4 }), [], [])).toBe(true)
  })

  it('clearAll resets all filters', () => {
    useFilterStore.getState().setTagIds(new Set([1]))
    useFilterStore.getState().setShowCompleted(true)
    useFilterStore.getState().clearAll()

    const { filters, isActive } = useFilterStore.getState()
    expect(filters.tagIds).toBe(null)
    expect(filters.personIds).toBe(null)
    expect(filters.showCompleted).toBe(false)
    expect(filters.showHiddenStatuses).toBe(false)
    expect(isActive).toBe(false)
  })

  it('setOrgIds filters by direct org assignment', () => {
    useFilterStore.getState().setOrgIds(new Set([10]))

    // Task with direct org 10
    expect(matchesFilter(f(), makeTodo({ id: 1 }), [], [], [], [10])).toBe(true)
    // Task with direct org 20
    expect(matchesFilter(f(), makeTodo({ id: 2 }), [], [], [], [20])).toBe(false)
  })

  it('setOrgIds filters by person org (assignedPersonOrgIds)', () => {
    useFilterStore.getState().setOrgIds(new Set([10]))

    // Task whose assigned person belongs to org 10
    expect(matchesFilter(f(), makeTodo({ id: 1 }), [1], [], [10], [])).toBe(true)
    // Task whose assigned person belongs to org 20
    expect(matchesFilter(f(), makeTodo({ id: 2 }), [1], [], [20], [])).toBe(false)
  })

  it('setOrgIds with 0 (None): tasks with no org assignment pass', () => {
    useFilterStore.getState().setOrgIds(new Set([0]))

    // Task with no org at all
    expect(matchesFilter(f(), makeTodo({ id: 1 }), [], [], [], [])).toBe(true)
    // Task with no assigned people/orgs
    expect(matchesFilter(f(), makeTodo({ id: 2 }))).toBe(true)
    // Task with an org should NOT match when only 0 is in set
    expect(matchesFilter(f(), makeTodo({ id: 3 }), [1], [], [10], [10])).toBe(false)
  })

  it('combined person-org and direct-org: either match passes', () => {
    useFilterStore.getState().setOrgIds(new Set([10, 20]))

    // Only person-org match
    expect(matchesFilter(f(), makeTodo({ id: 1 }), [1], [], [10], [])).toBe(true)
    // Only direct-org match
    expect(matchesFilter(f(), makeTodo({ id: 2 }), [], [], [], [20])).toBe(true)
    // Neither match
    expect(matchesFilter(f(), makeTodo({ id: 3 }), [1], [], [30], [30])).toBe(false)
  })

  it('setStatusIds filters by statusId', () => {
    useFilterStore.getState().setStatusIds(new Set([5]))

    expect(matchesFilter(f(), makeTodo({ id: 1, statusId: 5 }))).toBe(true)
    expect(matchesFilter(f(), makeTodo({ id: 2, statusId: 3 }))).toBe(false)
    // No status filtered out when 0 not in set
    expect(matchesFilter(f(), makeTodo({ id: 3 }))).toBe(false)
  })

  it('setStatusIds with 0 (None): tasks with no status pass', () => {
    useFilterStore.getState().setStatusIds(new Set([0, 5]))

    expect(matchesFilter(f(), makeTodo({ id: 1, statusId: 5 }))).toBe(true)
    expect(matchesFilter(f(), makeTodo({ id: 2 }))).toBe(true)
    expect(matchesFilter(f(), makeTodo({ id: 3, statusId: 99 }))).toBe(false)
  })

  it('null statusIds means no filter', () => {
    useFilterStore.getState().setStatusIds(null)

    expect(matchesFilter(f(), makeTodo({ id: 1, statusId: 5 }))).toBe(true)
    expect(matchesFilter(f(), makeTodo({ id: 2 }))).toBe(true)
  })

  it('dateField defaults to date', () => {
    expect(useFilterStore.getState().filters.dateField).toBe('date')
  })

  it('setDateField changes the date field', () => {
    useFilterStore.getState().setDateField('created')
    expect(useFilterStore.getState().filters.dateField).toBe('created')

    useFilterStore.getState().setDateField('modified')
    expect(useFilterStore.getState().filters.dateField).toBe('modified')

    useFilterStore.getState().setDateField('scheduled')
    expect(useFilterStore.getState().filters.dateField).toBe('scheduled')

    useFilterStore.getState().setDateField('deadline')
    expect(useFilterStore.getState().filters.dateField).toBe('deadline')
  })

  it('date range filters by effectiveDate when dateField is date', () => {
    useFilterStore.getState().setDateRange(new Date('2025-03-01'), new Date('2025-03-31'))

    expect(matchesFilter(f(), makeTodo({ id: 1, dueDate: new Date('2025-03-15') }))).toBe(true)
    expect(matchesFilter(f(), makeTodo({ id: 2, dueDate: new Date('2025-04-15') }))).toBe(false)
    // No date excluded by default
    expect(matchesFilter(f(), makeTodo({ id: 3 }))).toBe(false)
  })

  it('date range filters by createdAt when dateField is created', () => {
    useFilterStore.getState().setDateField('created')
    useFilterStore.getState().setDateRange(new Date('2025-03-01'), new Date('2025-03-31'))

    expect(matchesFilter(f(), makeTodo({ id: 1, createdAt: new Date('2025-03-15') }))).toBe(true)
    expect(matchesFilter(f(), makeTodo({ id: 2, createdAt: new Date('2025-04-15') }))).toBe(false)
  })

  it('date range filters by modifiedAt when dateField is modified', () => {
    useFilterStore.getState().setDateField('modified')
    useFilterStore.getState().setDateRange(new Date('2025-06-01'), new Date('2025-06-30'))

    expect(matchesFilter(f(), makeTodo({ id: 1, modifiedAt: new Date('2025-06-15') }))).toBe(true)
    expect(matchesFilter(f(), makeTodo({ id: 2, modifiedAt: new Date('2025-05-15') }))).toBe(false)
  })

  it('date range filters by scheduledDate when dateField is scheduled', () => {
    useFilterStore.getState().setDateField('scheduled')
    useFilterStore.getState().setDateRange(new Date('2025-03-01'), new Date('2025-03-31'))

    // In-range precise scheduled
    expect(matchesFilter(f(), makeTodo({
      id: 1, scheduledDate: { kind: 'date', value: new Date('2025-03-15') },
    }))).toBe(true)
    // Out of range
    expect(matchesFilter(f(), makeTodo({
      id: 2, scheduledDate: { kind: 'date', value: new Date('2025-04-15') },
    }))).toBe(false)
    // Deadline-only task should NOT pass when dateField is scheduled
    expect(matchesFilter(f(), makeTodo({ id: 3, dueDate: new Date('2025-03-15') }))).toBe(false)
  })

  it('date range filters by dueDate when dateField is deadline', () => {
    useFilterStore.getState().setDateField('deadline')
    useFilterStore.getState().setDateRange(new Date('2025-03-01'), new Date('2025-03-31'))

    expect(matchesFilter(f(), makeTodo({ id: 1, dueDate: new Date('2025-03-15') }))).toBe(true)
    expect(matchesFilter(f(), makeTodo({ id: 2, dueDate: new Date('2025-04-15') }))).toBe(false)
    // Scheduled-only task does NOT pass the deadline filter
    expect(matchesFilter(f(), makeTodo({
      id: 3, scheduledDate: { kind: 'date', value: new Date('2025-03-15') },
    }))).toBe(false)
  })

  it('includeNoDate works with date dateField', () => {
    useFilterStore.getState().setDateRange(new Date('2025-03-01'), new Date('2025-03-31'))
    useFilterStore.getState().setDateRangeIncludeNoDate(true)

    // No date included
    expect(matchesFilter(f(), makeTodo({ id: 1 }))).toBe(true)
  })

  it('clearAll resets dateField to date', () => {
    useFilterStore.getState().setDateField('modified')
    useFilterStore.getState().clearAll()
    expect(useFilterStore.getState().filters.dateField).toBe('date')
  })

  it('clearAll resets orgFilterMode to include-people', () => {
    useFilterStore.getState().setOrgFilterMode('direct-only')
    useFilterStore.getState().clearAll()
    expect(useFilterStore.getState().filters.orgFilterMode).toBe('include-people')
  })

  describe('orgFilterMode direct-only', () => {
    it('include-people matches person-org and direct-org (default)', () => {
      useFilterStore.getState().setOrgIds(new Set([10]))

      // Person-org match
      expect(matchesFilter(f(), makeTodo({ id: 1 }), [1], [], [10], [])).toBe(true)
      // Direct-org match
      expect(matchesFilter(f(), makeTodo({ id: 2 }), [], [], [], [10])).toBe(true)
    })

    it('direct-only ignores person-org, matches only direct-org', () => {
      useFilterStore.getState().setOrgIds(new Set([10]))
      useFilterStore.getState().setOrgFilterMode('direct-only')

      // Person-org only — should be excluded
      expect(matchesFilter(f(), makeTodo({ id: 1 }), [1], [], [10], [])).toBe(false)
      // Direct-org match
      expect(matchesFilter(f(), makeTodo({ id: 2 }), [], [], [], [10])).toBe(true)
    })

    it('direct-only with task having both person-org and direct-org matches on direct', () => {
      useFilterStore.getState().setOrgIds(new Set([10]))
      useFilterStore.getState().setOrgFilterMode('direct-only')

      expect(matchesFilter(f(), makeTodo({ id: 1 }), [1], [], [10], [10])).toBe(true)
    })

    it('direct-only with None (0): no direct org passes', () => {
      useFilterStore.getState().setOrgIds(new Set([0]))
      useFilterStore.getState().setOrgFilterMode('direct-only')

      // No direct org, but has person-org — should still pass (no direct org = None)
      expect(matchesFilter(f(), makeTodo({ id: 1 }), [1], [], [10], [])).toBe(true)
      // No org at all
      expect(matchesFilter(f(), makeTodo({ id: 2 }), [], [], [], [])).toBe(true)
    })

    it('undefined orgFilterMode defaults to include-people', () => {
      useFilterStore.getState().setOrgIds(new Set([10]))

      expect(matchesFilter(f(), makeTodo({ id: 1 }), [1], [], [10], [])).toBe(true)
    })
  })

  describe('applyFilter integration with direct-only org mode', () => {
    it('direct-only filters out tasks matching only via person-org', () => {
      useFilterStore.getState().setOrgIds(new Set([10]))
      useFilterStore.getState().setOrgFilterMode('direct-only')
      useFilterStore.getState().setShowCompleted(true)

      const todos = [
        makeTodo({ id: 1 }), // person belongs to org 10 but no direct org
        makeTodo({ id: 2 }), // has direct org 10
        makeTodo({ id: 3 }), // no org at all
      ]
      const assignedPeopleMap = new Map([
        [1, [{ id: 1, name: 'Alice', initials: 'A', color: '#000' }]],
      ])
      const personOrgMap = new Map([[1, [10]]]) // person 1 belongs to org 10
      const assignedOrgsMap = new Map([
        [2, [{ id: 10, name: 'Org' }]],
      ]) as Map<number, { id: number; name: string }[]>

      const result = applyFilter(
        f(),
        todos,
        assignedPeopleMap as never,
        undefined,
        personOrgMap,
        assignedOrgsMap as never,
      )

      // Only task 2 (direct org match) should pass; task 1 (person-org only) excluded
      expect(result.map(t => t.id)).toEqual([2])
    })

    it('include-people mode includes tasks matching via person-org', () => {
      useFilterStore.getState().setOrgIds(new Set([10]))
      useFilterStore.getState().setOrgFilterMode('include-people')
      useFilterStore.getState().setShowCompleted(true)

      const todos = [
        makeTodo({ id: 1 }), // person belongs to org 10
        makeTodo({ id: 2 }), // has direct org 10
      ]
      const assignedPeopleMap = new Map([
        [1, [{ id: 1, name: 'Alice', initials: 'A', color: '#000' }]],
      ])
      const personOrgMap = new Map([[1, [10]]])
      const assignedOrgsMap = new Map([
        [2, [{ id: 10, name: 'Org' }]],
      ]) as Map<number, { id: number; name: string }[]>

      const result = applyFilter(
        f(),
        todos,
        assignedPeopleMap as never,
        undefined,
        personOrgMap,
        assignedOrgsMap as never,
      )

      // Both should pass: task 1 via person-org, task 2 via direct org
      expect(result.map(t => t.id)).toEqual([1, 2])
    })
  })

  describe('personFilterMode include-orgs', () => {
    it('default direct person match still passes without filterPersonOrgIds', () => {
      useFilterStore.getState().setPersonIds(new Set([5]))
      // No filterPersonOrgIds supplied — direct match only
      expect(matchesFilter(f(), makeTodo({ id: 1 }), [5])).toBe(true)
      expect(matchesFilter(f(), makeTodo({ id: 2 }), [3])).toBe(false)
    })

    it('include-orgs matches tasks with direct orgs that filter person belongs to', () => {
      useFilterStore.getState().setPersonIds(new Set([5]))
      // include-orgs is the default
      // Person 5 belongs to org 10; task has direct org 10 but no direct person
      const filterPersonOrgIds = new Set([10])
      expect(matchesFilter(f(), makeTodo({ id: 1 }), [], [], [], [10], filterPersonOrgIds)).toBe(true)
      // Task with unrelated org is excluded
      expect(matchesFilter(f(), makeTodo({ id: 2 }), [], [], [], [20], filterPersonOrgIds)).toBe(false)
    })

    it('direct-only ignores filter-person-org expansion', () => {
      useFilterStore.getState().setPersonIds(new Set([5]))
      useFilterStore.getState().setPersonFilterMode('direct-only')
      const filterPersonOrgIds = new Set([10])
      // Even with filterPersonOrgIds supplied, direct-only only matches direct person
      expect(matchesFilter(f(), makeTodo({ id: 1 }), [], [], [], [10], filterPersonOrgIds)).toBe(false)
      expect(matchesFilter(f(), makeTodo({ id: 2 }), [5], [], [], [], filterPersonOrgIds)).toBe(true)
    })

    it('clearAll resets personFilterMode to include-orgs', () => {
      useFilterStore.getState().setPersonFilterMode('direct-only')
      useFilterStore.getState().clearAll()
      expect(useFilterStore.getState().filters.personFilterMode).toBe('include-orgs')
    })
  })

  describe('applyFilter integration with personFilterMode', () => {
    it('include-orgs includes tasks with org matching filter-person membership', () => {
      useFilterStore.getState().setPersonIds(new Set([5]))
      useFilterStore.getState().setShowCompleted(true)

      const todos = [
        makeTodo({ id: 1 }), // no direct person, has direct org 10 (person 5's org)
        makeTodo({ id: 2 }), // direct person 5
        makeTodo({ id: 3 }), // direct person 99 (not filtered)
      ]
      const assignedPeopleMap = new Map([
        [2, [{ id: 5, name: 'Alice', initials: 'A', color: '#000' }]],
        [3, [{ id: 99, name: 'Bob', initials: 'B', color: '#000' }]],
      ])
      const personOrgMap = new Map([[5, [10]]])
      const assignedOrgsMap = new Map([
        [1, [{ id: 10, name: 'Org' }]],
      ]) as Map<number, { id: number; name: string }[]>

      const result = applyFilter(
        f(),
        todos,
        assignedPeopleMap as never,
        undefined,
        personOrgMap,
        assignedOrgsMap as never,
      )

      expect(result.map(t => t.id).sort()).toEqual([1, 2])
    })

    it('direct-only excludes tasks matching only via filter-person org', () => {
      useFilterStore.getState().setPersonIds(new Set([5]))
      useFilterStore.getState().setPersonFilterMode('direct-only')
      useFilterStore.getState().setShowCompleted(true)

      const todos = [
        makeTodo({ id: 1 }), // no direct person, direct org 10
        makeTodo({ id: 2 }), // direct person 5
      ]
      const assignedPeopleMap = new Map([
        [2, [{ id: 5, name: 'Alice', initials: 'A', color: '#000' }]],
      ])
      const personOrgMap = new Map([[5, [10]]])
      const assignedOrgsMap = new Map([
        [1, [{ id: 10, name: 'Org' }]],
      ]) as Map<number, { id: number; name: string }[]>

      const result = applyFilter(
        f(),
        todos,
        assignedPeopleMap as never,
        undefined,
        personOrgMap,
        assignedOrgsMap as never,
      )

      expect(result.map(t => t.id)).toEqual([2])
    })
  })
})

describe('criteriaToPredicate / predicateToCriteria round-trip', () => {
  it('converts Sets to arrays and Dates to ISO strings and back', async () => {
    const { criteriaToPredicate, predicateToCriteria } = await import('../../stores/filter-store')
    const original = {
      showCompleted: true,
      showHiddenStatuses: false,
      personIds: new Set([5, 10]),
      personFilterMode: 'direct-only' as const,
      tagIds: new Set([1]),
      orgIds: null,
      orgFilterMode: 'include-people' as const,
      statusIds: new Set([0, 3]),
      searchText: 'x',
      dateField: 'deadline' as const,
      dateRangeStart: new Date('2025-03-01T00:00:00Z'),
      dateRangeEnd: new Date('2025-03-31T00:00:00Z'),
      dateRangeIncludeNoDate: true,
    }

    const serialized = criteriaToPredicate(original)
    expect(Array.isArray(serialized.personIds)).toBe(true)
    expect(serialized.personIds).toEqual([5, 10])
    expect(typeof serialized.dateRangeStart).toBe('string')

    const runtime = predicateToCriteria(serialized)
    expect(runtime.personIds instanceof Set).toBe(true)
    expect([...runtime.personIds!].sort((a, b) => a - b)).toEqual([5, 10])
    expect(runtime.dateField).toBe('deadline')
    expect(runtime.dateRangeStart?.toISOString()).toBe(original.dateRangeStart.toISOString())
  })
})
