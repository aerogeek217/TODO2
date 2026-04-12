import { describe, it, expect, beforeEach } from 'vitest'
import { useFilterStore } from '../../stores/filter-store'
import { Priority } from '../../models'
import type { PersistedTodoItem } from '../../models'

function makeTodo(overrides: Partial<PersistedTodoItem> & { id: number }): PersistedTodoItem {
  return {
    title: 'Test',
    priority: Priority.Normal,
    isCompleted: false,
    isStarred: false,
    createdAt: new Date(),
    modifiedAt: new Date(),
    sortOrder: 0,
    ...overrides,
  }
}

beforeEach(() => {
  useFilterStore.getState().clearAll()
})

describe('useFilterStore', () => {
  it('setPriorities filters by priority', () => {
    useFilterStore.getState().setPriorities(new Set([Priority.High]))
    expect(useFilterStore.getState().isActive).toBe(true)

    const { matchesFilter } = useFilterStore.getState()
    expect(matchesFilter(makeTodo({ id: 1, priority: Priority.High }))).toBe(true)
    expect(matchesFilter(makeTodo({ id: 2, priority: Priority.Normal }))).toBe(false)
  })

  it('null priorities means no filter', () => {
    useFilterStore.getState().setPriorities(null)
    const { matchesFilter } = useFilterStore.getState()

    expect(matchesFilter(makeTodo({ id: 1, priority: Priority.High }))).toBe(true)
    expect(matchesFilter(makeTodo({ id: 2, priority: Priority.Normal }))).toBe(true)
    expect(useFilterStore.getState().isActive).toBe(false)
  })

  it('empty set priorities matches nothing', () => {
    useFilterStore.getState().setPriorities(new Set())
    const { matchesFilter } = useFilterStore.getState()

    expect(matchesFilter(makeTodo({ id: 1, priority: Priority.High }))).toBe(false)
    expect(matchesFilter(makeTodo({ id: 2, priority: Priority.Normal }))).toBe(false)
  })

  it('followupFilter followup shows only starred', () => {
    useFilterStore.getState().setFollowupFilter('followup')
    const { matchesFilter } = useFilterStore.getState()

    expect(matchesFilter(makeTodo({ id: 1, isStarred: true }))).toBe(true)
    expect(matchesFilter(makeTodo({ id: 2, isStarred: false }))).toBe(false)
  })

  it('followupFilter no-followup hides starred', () => {
    useFilterStore.getState().setFollowupFilter('no-followup')
    const { matchesFilter } = useFilterStore.getState()

    expect(matchesFilter(makeTodo({ id: 1, isStarred: true }))).toBe(false)
    expect(matchesFilter(makeTodo({ id: 2, isStarred: false }))).toBe(true)
  })

  it('completedFilter completed shows only completed', () => {
    useFilterStore.getState().setCompletedFilter('completed')
    const { matchesFilter } = useFilterStore.getState()

    expect(matchesFilter(makeTodo({ id: 1, isCompleted: true }))).toBe(true)
    expect(matchesFilter(makeTodo({ id: 2, isCompleted: false }))).toBe(false)
  })

  it('assignedFilter assigned shows only assigned', () => {
    useFilterStore.getState().setAssignedFilter('assigned')
    const { matchesFilter } = useFilterStore.getState()

    expect(matchesFilter(makeTodo({ id: 1, isAssigned: true }))).toBe(true)
    expect(matchesFilter(makeTodo({ id: 2, isAssigned: false }))).toBe(false)
  })

  it('matchesFilter checks person assignment', () => {
    useFilterStore.getState().setPersonIds(new Set([5]))
    const { matchesFilter } = useFilterStore.getState()

    expect(matchesFilter(makeTodo({ id: 1 }), [5])).toBe(true)
    expect(matchesFilter(makeTodo({ id: 2 }), [3])).toBe(false)
    // unassigned tasks filtered out when "None" (0) not in set
    expect(matchesFilter(makeTodo({ id: 3 }))).toBe(false)
    expect(matchesFilter(makeTodo({ id: 4 }), [])).toBe(false)
  })

  it('matchesFilter shows unassigned tasks when None (0) is in personIds', () => {
    useFilterStore.getState().setPersonIds(new Set([0, 5]))
    const { matchesFilter } = useFilterStore.getState()

    expect(matchesFilter(makeTodo({ id: 1 }), [5])).toBe(true)
    expect(matchesFilter(makeTodo({ id: 2 }), [3])).toBe(false)
    expect(matchesFilter(makeTodo({ id: 3 }))).toBe(true)
    expect(matchesFilter(makeTodo({ id: 4 }), [])).toBe(true)
  })

  it('matchesFilter checks tag assignment', () => {
    useFilterStore.getState().setTagIds(new Set([10]))
    const { matchesFilter } = useFilterStore.getState()

    expect(matchesFilter(makeTodo({ id: 1 }), [], [10])).toBe(true)
    expect(matchesFilter(makeTodo({ id: 2 }), [], [20])).toBe(false)
    // unassigned tasks filtered out when "None" (0) not in set
    expect(matchesFilter(makeTodo({ id: 3 }), [])).toBe(false)
    expect(matchesFilter(makeTodo({ id: 4 }), [], [])).toBe(false)
  })

  it('matchesFilter shows untagged tasks when None (0) is in tagIds', () => {
    useFilterStore.getState().setTagIds(new Set([0, 10]))
    const { matchesFilter } = useFilterStore.getState()

    expect(matchesFilter(makeTodo({ id: 1 }), [], [10])).toBe(true)
    expect(matchesFilter(makeTodo({ id: 2 }), [], [20])).toBe(false)
    expect(matchesFilter(makeTodo({ id: 3 }), [])).toBe(true)
    expect(matchesFilter(makeTodo({ id: 4 }), [], [])).toBe(true)
  })

  it('clearAll resets all filters', () => {
    useFilterStore.getState().setPriorities(new Set([Priority.High]))
    useFilterStore.getState().setTagIds(new Set([1]))
    useFilterStore.getState().setFollowupFilter('followup')
    useFilterStore.getState().clearAll()

    const { filters, isActive } = useFilterStore.getState()
    expect(filters.priorities).toBe(null)
    expect(filters.tagIds).toBe(null)
    expect(filters.personIds).toBe(null)
    expect(filters.followupFilter).toBe('all')
    expect(filters.completedFilter).toBe('incomplete-only')
    expect(filters.assignedFilter).toBe('unassigned-only')
    expect(isActive).toBe(false)
  })

  it('setOrgIds filters by direct org assignment', () => {
    useFilterStore.getState().setOrgIds(new Set([10]))
    const { matchesFilter } = useFilterStore.getState()

    // Task with direct org 10
    expect(matchesFilter(makeTodo({ id: 1 }), [], [], [], [10])).toBe(true)
    // Task with direct org 20
    expect(matchesFilter(makeTodo({ id: 2 }), [], [], [], [20])).toBe(false)
  })

  it('setOrgIds filters by person org (assignedPersonOrgIds)', () => {
    useFilterStore.getState().setOrgIds(new Set([10]))
    const { matchesFilter } = useFilterStore.getState()

    // Task whose assigned person belongs to org 10
    expect(matchesFilter(makeTodo({ id: 1 }), [1], [], [10], [])).toBe(true)
    // Task whose assigned person belongs to org 20
    expect(matchesFilter(makeTodo({ id: 2 }), [1], [], [20], [])).toBe(false)
  })

  it('setOrgIds with 0 (None): tasks with no org assignment pass', () => {
    useFilterStore.getState().setOrgIds(new Set([0]))
    const { matchesFilter } = useFilterStore.getState()

    // Task with no org at all
    expect(matchesFilter(makeTodo({ id: 1 }), [], [], [], [])).toBe(true)
    // Task with no assigned people/orgs
    expect(matchesFilter(makeTodo({ id: 2 }))).toBe(true)
    // Task with an org should NOT match when only 0 is in set
    expect(matchesFilter(makeTodo({ id: 3 }), [1], [], [10], [10])).toBe(false)
  })

  it('combined person-org and direct-org: either match passes', () => {
    useFilterStore.getState().setOrgIds(new Set([10, 20]))
    const { matchesFilter } = useFilterStore.getState()

    // Only person-org match
    expect(matchesFilter(makeTodo({ id: 1 }), [1], [], [10], [])).toBe(true)
    // Only direct-org match
    expect(matchesFilter(makeTodo({ id: 2 }), [], [], [], [20])).toBe(true)
    // Neither match
    expect(matchesFilter(makeTodo({ id: 3 }), [1], [], [30], [30])).toBe(false)
  })

  it('dateField defaults to due', () => {
    expect(useFilterStore.getState().filters.dateField).toBe('due')
  })

  it('setDateField changes the date field', () => {
    useFilterStore.getState().setDateField('created')
    expect(useFilterStore.getState().filters.dateField).toBe('created')

    useFilterStore.getState().setDateField('modified')
    expect(useFilterStore.getState().filters.dateField).toBe('modified')
  })

  it('date range filters by dueDate when dateField is due', () => {
    useFilterStore.getState().setDateRange(new Date('2025-03-01'), new Date('2025-03-31'))
    const { matchesFilter } = useFilterStore.getState()

    expect(matchesFilter(makeTodo({ id: 1, dueDate: new Date('2025-03-15') }))).toBe(true)
    expect(matchesFilter(makeTodo({ id: 2, dueDate: new Date('2025-04-15') }))).toBe(false)
    // No due date excluded by default
    expect(matchesFilter(makeTodo({ id: 3 }))).toBe(false)
  })

  it('date range filters by createdAt when dateField is created', () => {
    useFilterStore.getState().setDateField('created')
    useFilterStore.getState().setDateRange(new Date('2025-03-01'), new Date('2025-03-31'))
    const { matchesFilter } = useFilterStore.getState()

    expect(matchesFilter(makeTodo({ id: 1, createdAt: new Date('2025-03-15') }))).toBe(true)
    expect(matchesFilter(makeTodo({ id: 2, createdAt: new Date('2025-04-15') }))).toBe(false)
  })

  it('date range filters by modifiedAt when dateField is modified', () => {
    useFilterStore.getState().setDateField('modified')
    useFilterStore.getState().setDateRange(new Date('2025-06-01'), new Date('2025-06-30'))
    const { matchesFilter } = useFilterStore.getState()

    expect(matchesFilter(makeTodo({ id: 1, modifiedAt: new Date('2025-06-15') }))).toBe(true)
    expect(matchesFilter(makeTodo({ id: 2, modifiedAt: new Date('2025-05-15') }))).toBe(false)
  })

  it('includeNoDue works with due dateField', () => {
    useFilterStore.getState().setDateRange(new Date('2025-03-01'), new Date('2025-03-31'))
    useFilterStore.getState().setDateRangeIncludeNoDue(true)
    const { matchesFilter } = useFilterStore.getState()

    // No due date included
    expect(matchesFilter(makeTodo({ id: 1 }))).toBe(true)
  })

  it('clearAll resets dateField to due', () => {
    useFilterStore.getState().setDateField('modified')
    useFilterStore.getState().clearAll()
    expect(useFilterStore.getState().filters.dateField).toBe('due')
  })
})
