import { describe, it, expect } from 'vitest'
import { buildHierarchy } from '../../utils/hierarchy'
import { Priority } from '../../models'
import type { PersistedTodoItem } from '../../models'

function makeTodo(overrides: Partial<PersistedTodoItem> & { id: number; title: string }): PersistedTodoItem {
  return {
    priority: Priority.Normal,
    isCompleted: false,
    isStarred: false,
    createdAt: new Date(),
    modifiedAt: new Date(),
    sortOrder: 0,
    ...overrides,
  }
}

describe('buildHierarchy', () => {
  it('returns empty array for empty input', () => {
    expect(buildHierarchy([])).toEqual([])
  })

  it('treats all root todos as parents with no children', () => {
    const todos = [
      makeTodo({ id: 1, title: 'A', sortOrder: 1 }),
      makeTodo({ id: 2, title: 'B', sortOrder: 2 }),
    ]
    const result = buildHierarchy(todos)
    expect(result).toHaveLength(2)
    expect(result[0].parent.title).toBe('A')
    expect(result[0].children).toHaveLength(0)
    expect(result[1].parent.title).toBe('B')
    expect(result[1].children).toHaveLength(0)
  })

  it('groups children under their parent', () => {
    const todos = [
      makeTodo({ id: 1, title: 'Parent', sortOrder: 1 }),
      makeTodo({ id: 2, title: 'Child 1', parentId: 1, sortOrder: 2 }),
      makeTodo({ id: 3, title: 'Child 2', parentId: 1, sortOrder: 1 }),
    ]
    const result = buildHierarchy(todos)
    expect(result).toHaveLength(1)
    expect(result[0].parent.title).toBe('Parent')
    expect(result[0].children).toHaveLength(2)
    // Children sorted by sortOrder
    expect(result[0].children[0].title).toBe('Child 2')
    expect(result[0].children[1].title).toBe('Child 1')
  })

  it('promotes orphaned children to root level', () => {
    const todos = [
      makeTodo({ id: 10, title: 'Orphan', parentId: 999, sortOrder: 1 }),
      makeTodo({ id: 11, title: 'Root', sortOrder: 2 }),
    ]
    const result = buildHierarchy(todos)
    expect(result).toHaveLength(2)
    expect(result[0].parent.title).toBe('Orphan')
    expect(result[1].parent.title).toBe('Root')
  })

  it('handles multiple parents with children', () => {
    const todos = [
      makeTodo({ id: 1, title: 'Parent A', sortOrder: 1 }),
      makeTodo({ id: 2, title: 'Parent B', sortOrder: 2 }),
      makeTodo({ id: 3, title: 'Child of A', parentId: 1, sortOrder: 1 }),
      makeTodo({ id: 4, title: 'Child of B', parentId: 2, sortOrder: 1 }),
    ]
    const result = buildHierarchy(todos)
    expect(result).toHaveLength(2)
    expect(result[0].children).toHaveLength(1)
    expect(result[0].children[0].title).toBe('Child of A')
    expect(result[1].children).toHaveLength(1)
    expect(result[1].children[0].title).toBe('Child of B')
  })

  it('promotes grandchildren to children of the root ancestor', () => {
    const todos = [
      makeTodo({ id: 1, title: 'Root', sortOrder: 1 }),
      makeTodo({ id: 2, title: 'Child', parentId: 1, sortOrder: 1 }),
      makeTodo({ id: 3, title: 'Grandchild', parentId: 2, sortOrder: 1 }),
    ]
    const result = buildHierarchy(todos)
    expect(result).toHaveLength(1)
    expect(result[0].parent.title).toBe('Root')
    // Grandchild promoted to be a child of Root (not lost)
    expect(result[0].children).toHaveLength(2)
    const childTitles = result[0].children.map(c => c.title)
    expect(childTitles).toContain('Child')
    expect(childTitles).toContain('Grandchild')
  })

  it('promotes great-grandchildren to children of root ancestor', () => {
    const todos = [
      makeTodo({ id: 1, title: 'Root', sortOrder: 1 }),
      makeTodo({ id: 2, title: 'Child', parentId: 1, sortOrder: 1 }),
      makeTodo({ id: 3, title: 'Grandchild', parentId: 2, sortOrder: 1 }),
      makeTodo({ id: 4, title: 'GreatGrandchild', parentId: 3, sortOrder: 1 }),
    ]
    const result = buildHierarchy(todos)
    expect(result).toHaveLength(1)
    expect(result[0].children).toHaveLength(3)
    const childTitles = result[0].children.map(c => c.title)
    expect(childTitles).toContain('Child')
    expect(childTitles).toContain('Grandchild')
    expect(childTitles).toContain('GreatGrandchild')
  })
})
