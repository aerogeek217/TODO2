import { describe, it, expect } from 'vitest'
import { Priority } from '../../models'
import type { PersistedTodoItem } from '../../models'
import { bySortOrder, buildChildMap, buildHierarchy, getFlatVisualOrder } from '../../utils/hierarchy'

function makeTodo(overrides: Partial<PersistedTodoItem> & { id: number }): PersistedTodoItem {
  return {
    title: `Task ${overrides.id}`,
    priority: Priority.Normal,
    isCompleted: false,
    isStarred: false,
    createdAt: new Date(),
    modifiedAt: new Date(),
    sortOrder: overrides.id,
    ...overrides,
  }
}

describe('bySortOrder', () => {
  it('sorts ascending by sortOrder', () => {
    const todos = [makeTodo({ id: 1, sortOrder: 30 }), makeTodo({ id: 2, sortOrder: 10 }), makeTodo({ id: 3, sortOrder: 20 })]
    const sorted = [...todos].sort(bySortOrder)
    expect(sorted.map((t) => t.id)).toEqual([2, 3, 1])
  })

  it('returns 0 for equal sortOrders', () => {
    const a = makeTodo({ id: 1, sortOrder: 5 })
    const b = makeTodo({ id: 2, sortOrder: 5 })
    expect(bySortOrder(a, b)).toBe(0)
  })

  it('returns negative when a comes before b', () => {
    const a = makeTodo({ id: 1, sortOrder: 1 })
    const b = makeTodo({ id: 2, sortOrder: 2 })
    expect(bySortOrder(a, b)).toBeLessThan(0)
  })
})

describe('buildChildMap', () => {
  it('returns empty map for todos with no parents', () => {
    const todos = [makeTodo({ id: 1 }), makeTodo({ id: 2 })]
    expect(buildChildMap(todos).size).toBe(0)
  })

  it('groups children under their parentId', () => {
    const todos = [
      makeTodo({ id: 1 }),
      makeTodo({ id: 2, parentId: 1 }),
      makeTodo({ id: 3, parentId: 1 }),
    ]
    const map = buildChildMap(todos)
    expect(map.get(1)?.map((t) => t.id)).toEqual([2, 3])
  })

  it('sorts children by sortOrder', () => {
    const todos = [
      makeTodo({ id: 1 }),
      makeTodo({ id: 2, parentId: 1, sortOrder: 20 }),
      makeTodo({ id: 3, parentId: 1, sortOrder: 10 }),
    ]
    const map = buildChildMap(todos)
    expect(map.get(1)?.map((t) => t.id)).toEqual([3, 2])
  })

  it('handles multiple parents independently', () => {
    const todos = [
      makeTodo({ id: 1 }),
      makeTodo({ id: 2 }),
      makeTodo({ id: 3, parentId: 1 }),
      makeTodo({ id: 4, parentId: 2 }),
    ]
    const map = buildChildMap(todos)
    expect(map.get(1)?.map((t) => t.id)).toEqual([3])
    expect(map.get(2)?.map((t) => t.id)).toEqual([4])
  })
})

describe('buildHierarchy', () => {
  it('returns roots with no children for a flat list', () => {
    const todos = [makeTodo({ id: 1, sortOrder: 1 }), makeTodo({ id: 2, sortOrder: 2 })]
    const result = buildHierarchy(todos)
    expect(result).toHaveLength(2)
    expect(result[0].parent.id).toBe(1)
    expect(result[0].children).toHaveLength(0)
  })

  it('nests children under their parent', () => {
    const todos = [
      makeTodo({ id: 1, sortOrder: 1 }),
      makeTodo({ id: 2, parentId: 1, sortOrder: 1 }),
      makeTodo({ id: 3, parentId: 1, sortOrder: 2 }),
    ]
    const result = buildHierarchy(todos)
    expect(result).toHaveLength(1)
    expect(result[0].children.map((c) => c.id)).toEqual([2, 3])
  })

  it('sorts roots by sortOrder', () => {
    const todos = [makeTodo({ id: 1, sortOrder: 30 }), makeTodo({ id: 2, sortOrder: 10 })]
    const result = buildHierarchy(todos)
    expect(result[0].parent.id).toBe(2)
    expect(result[1].parent.id).toBe(1)
  })

  it('honors a custom root comparator when provided', () => {
    const todos = [
      makeTodo({ id: 1, sortOrder: 1 }),
      makeTodo({ id: 2, sortOrder: 2 }),
      makeTodo({ id: 3, sortOrder: 3 }),
    ]
    const byIdDesc = (a: { id: number }, b: { id: number }) => b.id - a.id
    const result = buildHierarchy(todos, byIdDesc)
    expect(result.map((r) => r.parent.id)).toEqual([3, 2, 1])
  })

  it('promotes orphaned children (parent not in list) to root', () => {
    const todos = [
      makeTodo({ id: 2, parentId: 99, sortOrder: 1 }), // parentId 99 not in list
    ]
    const result = buildHierarchy(todos)
    expect(result).toHaveLength(1)
    expect(result[0].parent.id).toBe(2)
    expect(result[0].children).toHaveLength(0)
  })

  it('promotes grandchildren to root ancestor children (max 2 levels)', () => {
    const todos = [
      makeTodo({ id: 1, sortOrder: 1 }),
      makeTodo({ id: 2, parentId: 1, sortOrder: 1 }),
      makeTodo({ id: 3, parentId: 2, sortOrder: 1 }), // grandchild
    ]
    const result = buildHierarchy(todos)
    // grandchild 3 should be promoted to children of root 1
    expect(result).toHaveLength(1)
    const children = result[0].children.map((c) => c.id)
    expect(children).toContain(2)
    expect(children).toContain(3)
  })

  it('returns empty array for empty input', () => {
    expect(buildHierarchy([])).toEqual([])
  })
})

describe('getFlatVisualOrder', () => {
  it('returns flat list for tasks with no children', () => {
    const todos = [makeTodo({ id: 1, sortOrder: 1 }), makeTodo({ id: 2, sortOrder: 2 })]
    expect(getFlatVisualOrder(todos).map((t) => t.id)).toEqual([1, 2])
  })

  it('interleaves children after their parent', () => {
    const todos = [
      makeTodo({ id: 1, sortOrder: 1 }),
      makeTodo({ id: 2, sortOrder: 2 }),
      makeTodo({ id: 3, parentId: 1, sortOrder: 1 }),
      makeTodo({ id: 4, parentId: 1, sortOrder: 2 }),
    ]
    expect(getFlatVisualOrder(todos).map((t) => t.id)).toEqual([1, 3, 4, 2])
  })

  it('returns empty array for empty input', () => {
    expect(getFlatVisualOrder([])).toEqual([])
  })

  it('handles single task with no parent', () => {
    const todos = [makeTodo({ id: 1 })]
    expect(getFlatVisualOrder(todos).map((t) => t.id)).toEqual([1])
  })
})
