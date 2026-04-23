import { describe, it, expect } from 'vitest'
import type { PersistedTodoItem, Person, Project } from '../../models'
import {
  buildDateSections,
  buildFlatSection,
  buildPeopleSections,
  buildProjectSections,
  buildTagSections,
  itemSortComparator,
  encodeGroupSort,
  truncateSections,
  type Section,
} from '../../views/ListView'

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

describe('buildDateSections', () => {
  it('groups into overdue, today, this week, later, no date', () => {
    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const yesterday = new Date(today.getTime() - 86400000)
    const inThreeDays = new Date(today.getTime() + 3 * 86400000)
    const inTenDays = new Date(today.getTime() + 10 * 86400000)

    const todos = [
      makeTodo({ id: 1, dueDate: yesterday }),
      makeTodo({ id: 2, dueDate: today }),
      makeTodo({ id: 3, dueDate: inThreeDays }),
      makeTodo({ id: 4, dueDate: inTenDays }),
      makeTodo({ id: 5 }), // no dates
    ]
    const sections = buildDateSections(todos)
    expect(sections.map((s) => s.key)).toEqual(['overdue', 'today', 'week', 'later', 'none'])
    expect(sections[0].todos).toHaveLength(1) // overdue
    expect(sections[1].todos).toHaveLength(1) // today
    expect(sections[2].todos).toHaveLength(1) // this week
    expect(sections[3].todos).toHaveLength(1) // later
    expect(sections[4].todos).toHaveLength(1) // no date
  })

  it('preserves input order within a bucket (caller sorts upstream)', () => {
    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const inThreeDays = new Date(today.getTime() + 3 * 86400000)
    const inFourDays = new Date(today.getTime() + 4 * 86400000)

    const todos = [
      makeTodo({ id: 1, dueDate: inThreeDays, sortOrder: 30 }),
      makeTodo({ id: 2, dueDate: inFourDays, sortOrder: 5 }),
      makeTodo({ id: 3, dueDate: inThreeDays, sortOrder: 10 }),
      makeTodo({ id: 4, dueDate: inFourDays, sortOrder: 20 }),
    ]
    const sections = buildDateSections(todos)
    const week = sections.find((s) => s.key === 'week')!
    expect(week.todos.map((t) => t.id)).toEqual([1, 2, 3, 4])
  })

  it('uses scheduledDate when dueDate is absent', () => {
    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const inThreeDays = new Date(today.getTime() + 3 * 86400000)

    const todos = [
      makeTodo({ id: 1, scheduledDate: { kind: 'date', value: inThreeDays } }),
    ]
    const sections = buildDateSections(todos)
    const week = sections.find((s) => s.key === 'week')!
    expect(week.todos.map((t) => t.id)).toEqual([1])
  })

})

describe('buildPeopleSections', () => {
  it('groups by assigned person with unassigned fallback', () => {
    const people: Person[] = [
      { id: 1, name: 'Alice', initials: 'A' },
      { id: 2, name: 'Bob', initials: 'B' },
    ]
    const todos = [
      makeTodo({ id: 10 }),
      makeTodo({ id: 11 }),
      makeTodo({ id: 12 }),
    ]
    const assignedPeopleMap = new Map<number, Person[]>([
      [10, [people[0]]],
      [11, [people[1]]],
      // 12 is unassigned
    ])

    const sections = buildPeopleSections(todos, people, assignedPeopleMap)
    expect(sections).toHaveLength(3)
    expect(sections[0].label).toBe('Alice')
    expect(sections[0].todos).toHaveLength(1)
    expect(sections[1].label).toBe('Bob')
    expect(sections[2].label).toBe('Unassigned')
    expect(sections[2].todos).toHaveLength(1)
  })

  it('shows todo in multiple sections when assigned to multiple people', () => {
    const people: Person[] = [
      { id: 1, name: 'Alice', initials: 'A' },
      { id: 2, name: 'Bob', initials: 'B' },
    ]
    const todos = [makeTodo({ id: 10 })]
    const assignedPeopleMap = new Map<number, Person[]>([
      [10, [people[0], people[1]]],
    ])

    const sections = buildPeopleSections(todos, people, assignedPeopleMap)
    expect(sections).toHaveLength(2)
    expect(sections[0].todos).toHaveLength(1)
    expect(sections[1].todos).toHaveLength(1)
  })
})

describe('buildTagSections', () => {
  it('explodes a two-tag todo into both buckets', () => {
    const todos = [
      { ...makeTodo({ id: 1 }), tags: ['urgent', 'work'] },
    ]
    const sections = buildTagSections(todos)
    expect(sections.map((s) => s.key)).toEqual(['tag-urgent', 'tag-work'])
    expect(sections[0].todos.map((t) => t.id)).toEqual([1])
    expect(sections[1].todos.map((t) => t.id)).toEqual([1])
  })

  it('sorts tag buckets alphabetically', () => {
    const todos = [
      { ...makeTodo({ id: 1 }), tags: ['zeta'] },
      { ...makeTodo({ id: 2 }), tags: ['alpha'] },
      { ...makeTodo({ id: 3 }), tags: ['mu'] },
    ]
    const sections = buildTagSections(todos)
    expect(sections.map((s) => s.key)).toEqual(['tag-alpha', 'tag-mu', 'tag-zeta'])
  })

  it('routes untagged todos into a trailing "No tag" bucket', () => {
    const todos = [
      { ...makeTodo({ id: 1 }), tags: ['urgent'] },
      makeTodo({ id: 2 }),
      { ...makeTodo({ id: 3 }), tags: [] as string[] },
    ]
    const sections = buildTagSections(todos)
    expect(sections.map((s) => s.key)).toEqual(['tag-urgent', 'no-tag'])
    const noTag = sections[1]
    expect(noTag.label).toBe('No tag')
    expect(noTag.todos.map((t) => t.id).sort()).toEqual([2, 3])
  })

  it('dedupes repeated tag values on a single todo', () => {
    const todos = [
      { ...makeTodo({ id: 1 }), tags: ['urgent', 'URGENT', 'urgent'] },
    ]
    const sections = buildTagSections(todos)
    expect(sections).toHaveLength(1)
    expect(sections[0].key).toBe('tag-urgent')
    expect(sections[0].todos).toHaveLength(1)
  })

  it('renders an empty result when no todos have tags and none are untagged', () => {
    expect(buildTagSections([])).toEqual([])
  })
})

describe('buildProjectSections', () => {
  it('groups by project with no-project fallback', () => {
    const projects: Project[] = [
      { id: 1, name: 'Alpha', canvasId: 1, positionX: 0, positionY: 0, isCollapsed: false, sortOrder: 0, createdAt: new Date() },
      { id: 2, name: 'Beta', canvasId: 1, positionX: 0, positionY: 0, isCollapsed: false, sortOrder: 1, createdAt: new Date() },
    ]
    const todos = [
      makeTodo({ id: 10, projectId: 1 }),
      makeTodo({ id: 11, projectId: 2 }),
      makeTodo({ id: 12 }), // no project
    ]

    const sections = buildProjectSections(todos, projects)
    expect(sections).toHaveLength(3)
    expect(sections[0].label).toBe('Alpha')
    expect(sections[1].label).toBe('Beta')
    expect(sections[2].label).toBe('No Project')
  })
})

describe('buildFlatSection', () => {
  it('returns single "all" section with every todo', () => {
    const todos = [makeTodo({ id: 1 }), makeTodo({ id: 2 }), makeTodo({ id: 3 })]
    const sections = buildFlatSection(todos)
    expect(sections).toHaveLength(1)
    expect(sections[0].key).toBe('all')
    expect(sections[0].todos).toHaveLength(3)
  })

  it('returns empty when no todos so the "empty state" message shows', () => {
    expect(buildFlatSection([])).toEqual([])
  })
})

describe('itemSortComparator', () => {
  const today = new Date(2026, 0, 15)

  it('returns undefined for manual sort so the caller keeps the upstream sortOrder order', () => {
    expect(itemSortComparator('manual')).toBeUndefined()
  })

  it('sorts deadline ascending, nulls last', () => {
    const a = makeTodo({ id: 1, dueDate: new Date(2026, 0, 20), sortOrder: 10 })
    const b = makeTodo({ id: 2, dueDate: new Date(2026, 0, 18), sortOrder: 1 })
    const c = makeTodo({ id: 3, sortOrder: 5 }) // no deadline
    const cmp = itemSortComparator('deadline', today)!
    const sorted = [a, b, c].sort(cmp)
    expect(sorted.map((t) => t.id)).toEqual([2, 1, 3])
  })

  it('breaks ties with sortOrder', () => {
    const d = new Date(2026, 0, 20)
    const a = makeTodo({ id: 1, dueDate: d, sortOrder: 10 })
    const b = makeTodo({ id: 2, dueDate: d, sortOrder: 5 })
    const cmp = itemSortComparator('deadline', today)!
    expect([a, b].sort(cmp).map((t) => t.id)).toEqual([2, 1])
  })
})

describe('encodeGroupSort', () => {
  it('ungrouped + manual → grouping=none, sort=sort-order', () => {
    const { sort, grouping } = encodeGroupSort('none', 'manual')
    expect(grouping).toEqual({ kind: 'none' })
    expect(sort).toEqual({ kind: 'sort-order' })
  })

  it('coupled groupBy === itemSortBy → grouping=by-sortBy', () => {
    const { sort, grouping } = encodeGroupSort('date', 'date')
    expect(grouping).toEqual({ kind: 'by-sortBy' })
    expect(sort).toEqual({ kind: 'sortBy', by: 'date' })
  })

  it('decoupled groupBy / itemSortBy → grouping=by-field', () => {
    const { sort, grouping } = encodeGroupSort('project', 'deadline')
    expect(grouping).toEqual({ kind: 'by-field', by: 'project' })
    expect(sort).toEqual({ kind: 'sortBy', by: 'deadline' })
  })

  it('grouped by categorical + manual sort → grouping=by-field, sort=sort-order', () => {
    const { sort, grouping } = encodeGroupSort('project', 'manual')
    expect(grouping).toEqual({ kind: 'by-field', by: 'project' })
    expect(sort).toEqual({ kind: 'sort-order' })
  })

  it("grouped by tag serializes as its own `by-tag` kind, not `by-field`", () => {
    const { sort, grouping } = encodeGroupSort('tag', 'date')
    expect(grouping).toEqual({ kind: 'by-tag' })
    expect(sort).toEqual({ kind: 'sortBy', by: 'date' })
  })
})

describe('truncateSections', () => {
  const mkSection = (key: string, ids: number[]): Section => ({
    key,
    label: key,
    todos: ids.map((id) => makeTodo({ id })),
  })

  it('returns all sections when the limit exceeds total count', () => {
    const sections = [mkSection('a', [1, 2]), mkSection('b', [3])]
    const { displaySections, truncatedCount } = truncateSections(sections, 10)
    expect(truncatedCount).toBe(0)
    expect(displaySections).toHaveLength(2)
    expect(displaySections[0].todos).toHaveLength(2)
    expect(displaySections[1].todos).toHaveLength(1)
  })

  it('slices the section that straddles the cap', () => {
    const sections = [mkSection('a', [1, 2, 3]), mkSection('b', [4, 5, 6])]
    const { displaySections, truncatedCount } = truncateSections(sections, 4)
    expect(truncatedCount).toBe(2)
    expect(displaySections).toHaveLength(2)
    expect(displaySections[0].todos.map((t) => t.id)).toEqual([1, 2, 3])
    expect(displaySections[1].todos.map((t) => t.id)).toEqual([4])
  })

  it('drops entire tail sections after the cap', () => {
    const sections = [mkSection('a', [1, 2]), mkSection('b', [3, 4]), mkSection('c', [5, 6])]
    const { displaySections, truncatedCount } = truncateSections(sections, 2)
    expect(truncatedCount).toBe(4)
    expect(displaySections).toHaveLength(1)
    expect(displaySections[0].todos.map((t) => t.id)).toEqual([1, 2])
  })

  it('preserves label, key, and accentColor on the sliced section', () => {
    const sections: Section[] = [{
      key: 'a',
      label: 'Alpha',
      accentColor: '#abc',
      todos: [makeTodo({ id: 1 }), makeTodo({ id: 2 })],
    }]
    const { displaySections } = truncateSections(sections, 1)
    expect(displaySections[0].key).toBe('a')
    expect(displaySections[0].label).toBe('Alpha')
    expect(displaySections[0].accentColor).toBe('#abc')
    expect(displaySections[0].todos).toHaveLength(1)
  })

  it('cap of 0 drops everything', () => {
    const sections = [mkSection('a', [1, 2]), mkSection('b', [3])]
    const { displaySections, truncatedCount } = truncateSections(sections, 0)
    expect(displaySections).toHaveLength(0)
    expect(truncatedCount).toBe(3)
  })
})
