import { describe, it, expect } from 'vitest'
import { Priority } from '../../models'
import type { PersistedTodoItem, Person, Tag, Project } from '../../models'
import {
  buildPrioritySections,
  buildDueSections,
  buildPeopleSections,
  buildTagSections,
  buildProjectSections,
  addGhostParents,
} from '../../views/ListView'

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

describe('buildPrioritySections', () => {
  it('groups by priority level', () => {
    const todos = [
      makeTodo({ id: 1, priority: Priority.High }),
      makeTodo({ id: 2, priority: Priority.Medium }),
      makeTodo({ id: 3, priority: Priority.Normal }),
      makeTodo({ id: 4, priority: Priority.High }),
    ]
    const sections = buildPrioritySections(todos)
    expect(sections).toHaveLength(3)
    expect(sections[0].key).toBe('high')
    expect(sections[0].todos).toHaveLength(2)
    expect(sections[1].key).toBe('medium')
    expect(sections[1].todos).toHaveLength(1)
    expect(sections[2].key).toBe('normal')
    expect(sections[2].todos).toHaveLength(1)
  })

  it('omits empty sections', () => {
    const todos = [makeTodo({ id: 1, priority: Priority.High })]
    const sections = buildPrioritySections(todos)
    expect(sections).toHaveLength(1)
    expect(sections[0].key).toBe('high')
  })

  it('returns empty array for no todos', () => {
    expect(buildPrioritySections([])).toHaveLength(0)
  })
})

describe('buildDueSections', () => {
  it('groups into overdue, today, this week, later, no due date', () => {
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
      makeTodo({ id: 5 }), // no due date
    ]
    const sections = buildDueSections(todos)
    expect(sections.map((s) => s.key)).toEqual(['overdue', 'today', 'week', 'later', 'none'])
    expect(sections[0].todos).toHaveLength(1) // overdue
    expect(sections[1].todos).toHaveLength(1) // today
    expect(sections[2].todos).toHaveLength(1) // this week
    expect(sections[3].todos).toHaveLength(1) // later
    expect(sections[4].todos).toHaveLength(1) // no due date
  })

  it('sorts hard deadlines ahead of soft deadlines within a section, then by due date', () => {
    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const inTwoDays = new Date(today.getTime() + 2 * 86400000)
    const inThreeDays = new Date(today.getTime() + 3 * 86400000)
    const inFourDays = new Date(today.getTime() + 4 * 86400000)

    const todos = [
      makeTodo({ id: 1, dueDate: inTwoDays }), // soft, earliest
      makeTodo({ id: 2, dueDate: inFourDays, isHardDeadline: true }), // hard, latest
      makeTodo({ id: 3, dueDate: inThreeDays, isHardDeadline: true }), // hard, middle
      makeTodo({ id: 4, dueDate: inFourDays }), // soft, latest
    ]
    const sections = buildDueSections(todos)
    const week = sections.find((s) => s.key === 'week')!
    expect(week.todos.map((t) => t.id)).toEqual([3, 2, 1, 4])
  })
})

describe('buildPeopleSections', () => {
  it('groups by assigned person with unassigned fallback', () => {
    const people: Person[] = [
      { id: 1, name: 'Alice', initials: 'A', color: '#f00' },
      { id: 2, name: 'Bob', initials: 'B', color: '#00f' },
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
      { id: 1, name: 'Alice', initials: 'A', color: '#f00' },
      { id: 2, name: 'Bob', initials: 'B', color: '#00f' },
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
  it('groups by tag with untagged fallback', () => {
    const tags: Tag[] = [
      { id: 1, name: 'Bug', color: '#f00' },
      { id: 2, name: 'Feature', color: '#0f0' },
    ]
    const todos = [
      makeTodo({ id: 10 }),
      makeTodo({ id: 11 }),
      makeTodo({ id: 12 }),
    ]
    const assignedTagsMap = new Map<number, Tag[]>([
      [10, [tags[0]]],
      [11, [tags[1]]],
    ])

    const sections = buildTagSections(todos, tags, assignedTagsMap)
    expect(sections).toHaveLength(3)
    expect(sections[0].label).toBe('Bug')
    expect(sections[1].label).toBe('Feature')
    expect(sections[2].label).toBe('No Tags')
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

describe('addGhostParents', () => {
  it('adds missing parents as ghosts for hierarchy context', () => {
    const parent = makeTodo({ id: 1, title: 'Parent' })
    const child = makeTodo({ id: 2, title: 'Child', parentId: 1 })
    const allTodos = [parent, child]

    // Section only contains the child
    const { todos, ghostIds } = addGhostParents([child], allTodos)
    expect(todos).toHaveLength(2)
    expect(ghostIds.has(1)).toBe(true)
    expect(ghostIds.has(2)).toBe(false)
  })

  it('does not duplicate parents already in section', () => {
    const parent = makeTodo({ id: 1, title: 'Parent' })
    const child = makeTodo({ id: 2, title: 'Child', parentId: 1 })
    const allTodos = [parent, child]

    const { todos, ghostIds } = addGhostParents([parent, child], allTodos)
    expect(todos).toHaveLength(2)
    expect(ghostIds.size).toBe(0)
  })

  it('returns empty ghostIds when no parents are missing', () => {
    const todo = makeTodo({ id: 1 })
    const { todos, ghostIds } = addGhostParents([todo], [todo])
    expect(todos).toHaveLength(1)
    expect(ghostIds.size).toBe(0)
  })
})
