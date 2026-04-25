import { describe, it, expect } from 'vitest'
import type { PersistedTodoItem } from '../../models'
import { sortProjectTasks, GROUP_OPTIONS } from '../../components/canvas/ProjectNode'

function makeTodo(overrides: Partial<PersistedTodoItem> & { id: number }): PersistedTodoItem {
  return {
    title: `Task ${overrides.id}`,
    isCompleted: false,
    createdAt: new Date(2026, 3, 1),
    modifiedAt: new Date(),
    sortOrder: overrides.id,
    ...overrides,
  }
}

describe('sortProjectTasks', () => {
  it('sorts by date ascending', () => {
    const earlier = new Date(2026, 3, 1)
    const later = new Date(2026, 3, 10)
    const todos = [
      makeTodo({ id: 1, dueDate: later }),
      makeTodo({ id: 2, dueDate: earlier }),
      makeTodo({ id: 3, dueDate: later }),
      makeTodo({ id: 4, dueDate: earlier }),
    ]
    const sorted = sortProjectTasks(todos, 'date', true)
    expect(sorted.map((t) => t.id).slice(0, 2).sort()).toEqual([2, 4])
    expect(sorted.map((t) => t.id).slice(2).sort()).toEqual([1, 3])
  })

  it('sorts by name ascending', () => {
    const todos = [
      makeTodo({ id: 1, title: 'Beta' }),
      makeTodo({ id: 2, title: 'Bravo' }),
      makeTodo({ id: 3, title: 'Alpha' }),
      makeTodo({ id: 4, title: 'Apple' }),
    ]
    const sorted = sortProjectTasks(todos, 'name', true)
    expect(sorted.map((t) => t.title)).toEqual(['Alpha', 'Apple', 'Beta', 'Bravo'])
  })

  it('respects descending direction', () => {
    const todos = [
      makeTodo({ id: 1, title: 'A' }),
      makeTodo({ id: 2, title: 'B' }),
      makeTodo({ id: 3, title: 'X' }),
      makeTodo({ id: 4, title: 'Y' }),
    ]
    const sorted = sortProjectTasks(todos, 'name', false)
    expect(sorted.map((t) => t.title)).toEqual(['Y', 'X', 'B', 'A'])
  })
})

describe('GROUP_OPTIONS', () => {
  it('exposes Tag as a grouping dimension', () => {
    expect(GROUP_OPTIONS).toContainEqual({ value: 'tag', label: 'Tag' })
  })
})
