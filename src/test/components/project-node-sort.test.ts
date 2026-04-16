import { describe, it, expect } from 'vitest'
import { Priority } from '../../models'
import type { PersistedTodoItem } from '../../models'
import { sortProjectTasks } from '../../components/canvas/ProjectNode'

function makeTodo(overrides: Partial<PersistedTodoItem> & { id: number }): PersistedTodoItem {
  return {
    title: `Task ${overrides.id}`,
    priority: Priority.Normal,
    isCompleted: false,
    createdAt: new Date(2026, 3, 1),
    modifiedAt: new Date(),
    sortOrder: overrides.id,
    ...overrides,
  }
}

describe('sortProjectTasks', () => {
  it('keeps children grouped under their parent after sorting by due date', () => {
    const earlier = new Date(2026, 3, 1)
    const later = new Date(2026, 3, 10)
    const todos = [
      makeTodo({ id: 1, title: 'Late parent', dueDate: later }),
      makeTodo({ id: 2, title: 'Late child A', parentId: 1, dueDate: earlier }),
      makeTodo({ id: 3, title: 'Late child B', parentId: 1, dueDate: later }),
      makeTodo({ id: 4, title: 'Early parent', dueDate: earlier }),
      makeTodo({ id: 5, title: 'Early child', parentId: 4, dueDate: later }),
    ]
    const sorted = sortProjectTasks(todos, 'due', true)
    // Early parent (id 4) comes first with its child, then Late parent (id 1) with its children.
    // Within Late parent's children, child A (earlier date) comes before child B (later date).
    expect(sorted.map((t) => t.id)).toEqual([4, 5, 1, 2, 3])
  })

  it('sorts roots and children consistently by name', () => {
    const todos = [
      makeTodo({ id: 1, title: 'Beta' }),
      makeTodo({ id: 2, title: 'Bravo', parentId: 1 }),
      makeTodo({ id: 3, title: 'Alpha', parentId: 1 }),
      makeTodo({ id: 4, title: 'Apple' }),
    ]
    const sorted = sortProjectTasks(todos, 'name', true)
    expect(sorted.map((t) => t.title)).toEqual(['Apple', 'Beta', 'Alpha', 'Bravo'])
  })

  it('respects descending direction for both roots and children', () => {
    const todos = [
      makeTodo({ id: 1, title: 'A' }),
      makeTodo({ id: 2, title: 'B' }),
      makeTodo({ id: 3, title: 'X', parentId: 2 }),
      makeTodo({ id: 4, title: 'Y', parentId: 2 }),
    ]
    const sorted = sortProjectTasks(todos, 'name', false)
    // Roots descending: B then A. B's children descending: Y then X.
    expect(sorted.map((t) => t.title)).toEqual(['B', 'Y', 'X', 'A'])
  })
})
