import { describe, it, expect } from 'vitest'
import { Priority } from '../../models'
import type { PersistedTodoItem } from '../../models'
import {
  computeInsertionSort,
  placeTaskAt,
  placeMultipleAt,
  indentTasks,
  outdentTasks,
  findOrphans,
  normalizeSortOrders,
  shouldNormalize,
  moveTasksInDirection,
} from '../../services/task-placement'

function makeTodo(overrides: Partial<PersistedTodoItem> & { id: number }): PersistedTodoItem {
  return {
    title: `Task ${overrides.id}`,
    priority: Priority.Normal,
    isCompleted: false,
    isStarred: false,
    createdAt: new Date(),
    modifiedAt: new Date(),
    sortOrder: overrides.id, // default sortOrder = id for easy testing
    ...overrides,
  }
}

describe('computeInsertionSort', () => {
  it('returns 1 for empty siblings', () => {
    expect(computeInsertionSort([], null)).toBe(1)
  })

  it('appends after last sibling when beforeId is null', () => {
    const siblings = [makeTodo({ id: 1, sortOrder: 3 }), makeTodo({ id: 2, sortOrder: 7 })]
    expect(computeInsertionSort(siblings, null)).toBe(8)
  })

  it('inserts before first sibling', () => {
    const siblings = [makeTodo({ id: 1, sortOrder: 4 }), makeTodo({ id: 2, sortOrder: 8 })]
    expect(computeInsertionSort(siblings, 1)).toBe(3) // 4 - 1
  })

  it('uses midpoint between two siblings', () => {
    const siblings = [makeTodo({ id: 1, sortOrder: 2 }), makeTodo({ id: 2, sortOrder: 10 })]
    expect(computeInsertionSort(siblings, 2)).toBe(6) // (2 + 10) / 2
  })

  it('appends when beforeId not found', () => {
    const siblings = [makeTodo({ id: 1, sortOrder: 5 })]
    expect(computeInsertionSort(siblings, 999)).toBe(6)
  })
})

describe('placeTaskAt', () => {
  it('places task at end of project', () => {
    const todos = [
      makeTodo({ id: 1, sortOrder: 1, projectId: 10 }),
      makeTodo({ id: 2, sortOrder: 2, projectId: 10 }),
    ]
    const task = makeTodo({ id: 3, sortOrder: 1, projectId: 20 })
    const mutations = placeTaskAt(todos, task, {
      projectId: 10,
      parentId: undefined,
      beforeTodoId: null,
    })
    expect(mutations).toHaveLength(1)
    expect(mutations[0].todoId).toBe(3)
    expect(mutations[0].changes.sortOrder).toBe(3)
    expect(mutations[0].changes.projectId).toBe(10)
  })

  it('places task before a specific task', () => {
    const todos = [
      makeTodo({ id: 1, sortOrder: 2, projectId: 10 }),
      makeTodo({ id: 2, sortOrder: 4, projectId: 10 }),
    ]
    const task = makeTodo({ id: 3, sortOrder: 1, projectId: 10 })
    const mutations = placeTaskAt(todos, task, {
      projectId: 10,
      parentId: undefined,
      beforeTodoId: 2,
    })
    expect(mutations).toHaveLength(1)
    expect(mutations[0].changes.sortOrder).toBe(3) // midpoint of 2 and 4
  })

  it('orphans children when moving cross-project', () => {
    const todos = [
      makeTodo({ id: 1, sortOrder: 1, projectId: 10 }),
      makeTodo({ id: 2, sortOrder: 2, projectId: 10, parentId: 1 }),
      makeTodo({ id: 3, sortOrder: 3, projectId: 10, parentId: 1 }),
    ]
    const task = todos[0]
    const mutations = placeTaskAt(todos, task, {
      projectId: 20,
      parentId: undefined,
      beforeTodoId: null,
    })
    // Task move + 2 orphan clears
    expect(mutations).toHaveLength(3)
    expect(mutations[1].todoId).toBe(2)
    expect(mutations[1].changes.parentId).toBeUndefined()
    expect(mutations[2].todoId).toBe(3)
    expect(mutations[2].changes.parentId).toBeUndefined()
  })

  it('same-project move does not set projectId', () => {
    const todos = [
      makeTodo({ id: 1, sortOrder: 1, projectId: 10 }),
      makeTodo({ id: 2, sortOrder: 2, projectId: 10 }),
    ]
    const mutations = placeTaskAt(todos, todos[1], {
      projectId: 10,
      parentId: undefined,
      beforeTodoId: 1,
    })
    expect(mutations[0].changes.projectId).toBeUndefined()
  })
})

describe('placeMultipleAt', () => {
  it('places multiple tasks at end of project', () => {
    const todos = [
      makeTodo({ id: 1, sortOrder: 1, projectId: 10 }),
      makeTodo({ id: 2, sortOrder: 2, projectId: 10 }),
      makeTodo({ id: 3, sortOrder: 1, projectId: 20 }),
      makeTodo({ id: 4, sortOrder: 2, projectId: 20 }),
    ]
    const mutations = placeMultipleAt(todos, new Set([3, 4]), {
      projectId: 10,
      parentId: undefined,
      beforeTodoId: null,
    })
    expect(mutations.length).toBeGreaterThanOrEqual(2)
    const m3 = mutations.find(m => m.todoId === 3)!
    const m4 = mutations.find(m => m.todoId === 4)!
    expect(m3.changes.projectId).toBe(10)
    expect(m4.changes.projectId).toBe(10)
    expect(m3.changes.sortOrder!).toBeLessThan(m4.changes.sortOrder!)
  })

  it('preserves internal parent-child at root level', () => {
    const todos = [
      makeTodo({ id: 1, sortOrder: 1, projectId: 20 }),
      makeTodo({ id: 2, sortOrder: 2, projectId: 20, parentId: 1 }),
    ]
    const mutations = placeMultipleAt(todos, new Set([1, 2]), {
      projectId: 10,
      parentId: undefined,
      beforeTodoId: null,
    })
    const m2 = mutations.find(m => m.todoId === 2)!
    // parentId should be preserved (parent is in the drag set)
    expect(m2.changes.parentId).toBeUndefined() // not changed since kept
  })

  it('flattens under target parent at child level', () => {
    const todos = [
      makeTodo({ id: 1, sortOrder: 1, projectId: 10 }),
      makeTodo({ id: 2, sortOrder: 2, projectId: 10 }),
      makeTodo({ id: 3, sortOrder: 3, projectId: 10 }),
    ]
    const mutations = placeMultipleAt(todos, new Set([2, 3]), {
      projectId: 10,
      parentId: 1,
      beforeTodoId: null,
    })
    const m2 = mutations.find(m => m.todoId === 2)!
    const m3 = mutations.find(m => m.todoId === 3)!
    expect(m2.changes.parentId).toBe(1)
    expect(m3.changes.parentId).toBe(1)
  })
})

describe('indentTasks', () => {
  it('indents root tasks under the task above', () => {
    const todos = [
      makeTodo({ id: 1, sortOrder: 1, projectId: 10 }),
      makeTodo({ id: 2, sortOrder: 2, projectId: 10 }),
      makeTodo({ id: 3, sortOrder: 3, projectId: 10 }),
    ]
    const mutations = indentTasks(todos, new Set([2, 3]))
    expect(mutations).toHaveLength(2)
    expect(mutations[0].todoId).toBe(2)
    expect(mutations[0].changes.parentId).toBe(1)
    expect(mutations[1].todoId).toBe(3)
    expect(mutations[1].changes.parentId).toBe(1)
    // sortOrders should be sequential after parent
    expect(mutations[0].changes.sortOrder!).toBeLessThan(mutations[1].changes.sortOrder!)
  })

  it('returns empty when tasks are already children', () => {
    const todos = [
      makeTodo({ id: 1, sortOrder: 1, projectId: 10 }),
      makeTodo({ id: 2, sortOrder: 2, projectId: 10, parentId: 1 }),
    ]
    const mutations = indentTasks(todos, new Set([2]))
    expect(mutations).toHaveLength(0)
  })

  it('returns empty when first task has no root above', () => {
    const todos = [
      makeTodo({ id: 1, sortOrder: 1, projectId: 10 }),
    ]
    const mutations = indentTasks(todos, new Set([1]))
    expect(mutations).toHaveLength(0)
  })

  it('blocks indent when task has children (would create >2 levels)', () => {
    const todos = [
      makeTodo({ id: 1, sortOrder: 1, projectId: 10 }),
      makeTodo({ id: 2, sortOrder: 2, projectId: 10 }),
      makeTodo({ id: 3, sortOrder: 3, projectId: 10, parentId: 2 }),
    ]
    const mutations = indentTasks(todos, new Set([2]))
    expect(mutations).toHaveLength(0)
  })

  it('appends after existing children of the parent', () => {
    const todos = [
      makeTodo({ id: 1, sortOrder: 1, projectId: 10 }),
      makeTodo({ id: 5, sortOrder: 2, projectId: 10, parentId: 1 }),
      makeTodo({ id: 2, sortOrder: 3, projectId: 10 }),
    ]
    const mutations = indentTasks(todos, new Set([2]))
    expect(mutations).toHaveLength(1)
    expect(mutations[0].changes.parentId).toBe(1)
    expect(mutations[0].changes.sortOrder!).toBeGreaterThan(2) // after existing child sortOrder
  })
})

describe('outdentTasks', () => {
  it('promotes children to root after parent group', () => {
    const todos = [
      makeTodo({ id: 1, sortOrder: 1, projectId: 10 }),
      makeTodo({ id: 2, sortOrder: 2, projectId: 10, parentId: 1 }),
      makeTodo({ id: 3, sortOrder: 3, projectId: 10, parentId: 1 }),
      makeTodo({ id: 4, sortOrder: 4, projectId: 10 }),
    ]
    const mutations = outdentTasks(todos, new Set([2, 3]))
    expect(mutations).toHaveLength(2)
    expect(mutations[0].changes.parentId).toBeUndefined()
    expect(mutations[1].changes.parentId).toBeUndefined()
    // Should be placed between parent group and next root
    expect(mutations[0].changes.sortOrder!).toBeGreaterThan(1) // after parent
    expect(mutations[1].changes.sortOrder!).toBeLessThan(4) // before next root
  })

  it('returns empty when no children selected', () => {
    const todos = [
      makeTodo({ id: 1, sortOrder: 1, projectId: 10 }),
    ]
    const mutations = outdentTasks(todos, new Set([1]))
    expect(mutations).toHaveLength(0)
  })

  it('handles children from different parents', () => {
    const todos = [
      makeTodo({ id: 1, sortOrder: 1, projectId: 10 }),
      makeTodo({ id: 2, sortOrder: 2, projectId: 10, parentId: 1 }),
      makeTodo({ id: 3, sortOrder: 3, projectId: 10 }),
      makeTodo({ id: 4, sortOrder: 4, projectId: 10, parentId: 3 }),
    ]
    const mutations = outdentTasks(todos, new Set([2, 4]))
    expect(mutations).toHaveLength(2)
    expect(mutations.every(m => m.changes.parentId === undefined)).toBe(true)
  })
})

describe('findOrphans', () => {
  it('finds children left behind', () => {
    const todos = [
      makeTodo({ id: 1, sortOrder: 1, projectId: 10 }),
      makeTodo({ id: 2, sortOrder: 2, projectId: 10, parentId: 1 }),
      makeTodo({ id: 3, sortOrder: 3, projectId: 10, parentId: 1 }),
    ]
    const mutations = findOrphans(todos, 1, 10, new Set([1]))
    expect(mutations).toHaveLength(2)
    expect(mutations[0].todoId).toBe(2)
    expect(mutations[0].changes.parentId).toBeUndefined()
  })

  it('excludes tasks in the exclude set', () => {
    const todos = [
      makeTodo({ id: 1, sortOrder: 1, projectId: 10 }),
      makeTodo({ id: 2, sortOrder: 2, projectId: 10, parentId: 1 }),
      makeTodo({ id: 3, sortOrder: 3, projectId: 10, parentId: 1 }),
    ]
    const mutations = findOrphans(todos, 1, 10, new Set([1, 2]))
    expect(mutations).toHaveLength(1)
    expect(mutations[0].todoId).toBe(3)
  })
})

describe('normalizeSortOrders', () => {
  it('renumbers to clean integers', () => {
    const todos = [
      makeTodo({ id: 1, sortOrder: 0.5, projectId: 10 }),
      makeTodo({ id: 2, sortOrder: 1.5, projectId: 10 }),
      makeTodo({ id: 3, sortOrder: 3.7, projectId: 10 }),
    ]
    const mutations = normalizeSortOrders(todos)
    expect(mutations).toHaveLength(3)
    expect(mutations[0]).toEqual({ todoId: 1, changes: { sortOrder: 1 } })
    expect(mutations[1]).toEqual({ todoId: 2, changes: { sortOrder: 2 } })
    expect(mutations[2]).toEqual({ todoId: 3, changes: { sortOrder: 3 } })
  })

  it('skips items already at correct sortOrder', () => {
    const todos = [
      makeTodo({ id: 1, sortOrder: 1, projectId: 10 }),
      makeTodo({ id: 2, sortOrder: 2, projectId: 10 }),
    ]
    const mutations = normalizeSortOrders(todos)
    expect(mutations).toHaveLength(0)
  })

  it('includes children in visual order', () => {
    const todos = [
      makeTodo({ id: 1, sortOrder: 1, projectId: 10 }),
      makeTodo({ id: 2, sortOrder: 2, projectId: 10, parentId: 1 }),
      makeTodo({ id: 3, sortOrder: 10, projectId: 10 }),
    ]
    const mutations = normalizeSortOrders(todos)
    // Visual order: 1, 2, 3 → sortOrders 1, 2, 3
    const m3 = mutations.find(m => m.todoId === 3)!
    expect(m3.changes.sortOrder).toBe(3)
  })
})

describe('shouldNormalize', () => {
  it('returns false for empty list', () => {
    expect(shouldNormalize([])).toBe(false)
  })

  it('returns true when fractional sortOrders exist', () => {
    const todos = [makeTodo({ id: 1, sortOrder: 1.5 })]
    expect(shouldNormalize(todos)).toBe(true)
  })

  it('returns false for clean sequential integers', () => {
    const todos = [
      makeTodo({ id: 1, sortOrder: 1 }),
      makeTodo({ id: 2, sortOrder: 2 }),
    ]
    expect(shouldNormalize(todos)).toBe(false)
  })

  it('returns true when gaps are excessive', () => {
    const todos = [
      makeTodo({ id: 1, sortOrder: 1 }),
      makeTodo({ id: 2, sortOrder: 100 }),
    ]
    expect(shouldNormalize(todos)).toBe(true)
  })
})

describe('moveTasksInDirection', () => {
  // Helper: extract the new sortOrder for a given task id from the mutations,
  // falling back to the task's original sortOrder if no mutation was emitted.
  function resolvedOrder(
    todos: PersistedTodoItem[],
    mutations: ReturnType<typeof moveTasksInDirection>,
    id: number
  ): number {
    const m = mutations.find(m => m.todoId === id)
    if (m?.changes.sortOrder !== undefined) return m.changes.sortOrder
    return todos.find(t => t.id === id)!.sortOrder
  }

  describe('single root task up', () => {
    it('moveTasksInDirection_secondRootMovedUp_swapsWithFirstRoot', () => {
      // Arrange
      const todos = [
        makeTodo({ id: 1, sortOrder: 1, projectId: 10 }),
        makeTodo({ id: 2, sortOrder: 2, projectId: 10 }),
        makeTodo({ id: 3, sortOrder: 3, projectId: 10 }),
      ]

      // Act
      const mutations = moveTasksInDirection(todos, new Set([2]), 'up')

      // Assert: task 2 should now come before task 1
      const ord1 = resolvedOrder(todos, mutations, 1)
      const ord2 = resolvedOrder(todos, mutations, 2)
      expect(ord2).toBeLessThan(ord1)
    })

    it('moveTasksInDirection_secondRootMovedUp_task3SortOrderUnchanged', () => {
      // Arrange
      const todos = [
        makeTodo({ id: 1, sortOrder: 1, projectId: 10 }),
        makeTodo({ id: 2, sortOrder: 2, projectId: 10 }),
        makeTodo({ id: 3, sortOrder: 3, projectId: 10 }),
      ]

      // Act
      const mutations = moveTasksInDirection(todos, new Set([2]), 'up')

      // Assert: task 3 is last and its relative position to the others is preserved
      const ord2 = resolvedOrder(todos, mutations, 2)
      const ord3 = resolvedOrder(todos, mutations, 3)
      expect(ord3).toBeGreaterThan(ord2)
    })
  })

  describe('single root task down', () => {
    it('moveTasksInDirection_secondRootMovedDown_swapsWithThirdRoot', () => {
      // Arrange
      const todos = [
        makeTodo({ id: 1, sortOrder: 1, projectId: 10 }),
        makeTodo({ id: 2, sortOrder: 2, projectId: 10 }),
        makeTodo({ id: 3, sortOrder: 3, projectId: 10 }),
      ]

      // Act
      const mutations = moveTasksInDirection(todos, new Set([2]), 'down')

      // Assert: task 2 should now come after task 3
      const ord2 = resolvedOrder(todos, mutations, 2)
      const ord3 = resolvedOrder(todos, mutations, 3)
      expect(ord2).toBeGreaterThan(ord3)
    })

    it('moveTasksInDirection_secondRootMovedDown_task1SortOrderUnchanged', () => {
      // Arrange
      const todos = [
        makeTodo({ id: 1, sortOrder: 1, projectId: 10 }),
        makeTodo({ id: 2, sortOrder: 2, projectId: 10 }),
        makeTodo({ id: 3, sortOrder: 3, projectId: 10 }),
      ]

      // Act
      const mutations = moveTasksInDirection(todos, new Set([2]), 'down')

      // Assert: task 1 remains first
      const ord1 = resolvedOrder(todos, mutations, 1)
      const ord2 = resolvedOrder(todos, mutations, 2)
      expect(ord1).toBeLessThan(ord2)
    })
  })

  describe('boundary conditions', () => {
    it('moveTasksInDirection_firstTaskMovedUp_returnsEmpty', () => {
      // Arrange
      const todos = [
        makeTodo({ id: 1, sortOrder: 1, projectId: 10 }),
        makeTodo({ id: 2, sortOrder: 2, projectId: 10 }),
      ]

      // Act
      const mutations = moveTasksInDirection(todos, new Set([1]), 'up')

      // Assert
      expect(mutations).toHaveLength(0)
    })

    it('moveTasksInDirection_lastTaskMovedDown_returnsEmpty', () => {
      // Arrange
      const todos = [
        makeTodo({ id: 1, sortOrder: 1, projectId: 10 }),
        makeTodo({ id: 2, sortOrder: 2, projectId: 10 }),
      ]

      // Act
      const mutations = moveTasksInDirection(todos, new Set([2]), 'down')

      // Assert
      expect(mutations).toHaveLength(0)
    })

    it('moveTasksInDirection_emptyList_returnsEmpty', () => {
      // Act
      const mutations = moveTasksInDirection([], new Set([1]), 'up')

      // Assert
      expect(mutations).toHaveLength(0)
    })

    it('moveTasksInDirection_singleTask_upReturnsEmpty', () => {
      // Arrange
      const todos = [makeTodo({ id: 1, sortOrder: 1, projectId: 10 })]

      // Act
      const mutations = moveTasksInDirection(todos, new Set([1]), 'up')

      // Assert
      expect(mutations).toHaveLength(0)
    })

    it('moveTasksInDirection_singleTask_downReturnsEmpty', () => {
      // Arrange
      const todos = [makeTodo({ id: 1, sortOrder: 1, projectId: 10 })]

      // Act
      const mutations = moveTasksInDirection(todos, new Set([1]), 'down')

      // Assert
      expect(mutations).toHaveLength(0)
    })
  })

  describe('parent task moves with its children', () => {
    it('moveTasksInDirection_parentWithChildrenMovedDown_entireGroupMovesBelow', () => {
      // Arrange — visual order: A(root), A1(child), A2(child), B(root)
      const todos = [
        makeTodo({ id: 1, sortOrder: 1, projectId: 10 }),             // A
        makeTodo({ id: 2, sortOrder: 2, projectId: 10, parentId: 1 }), // A1
        makeTodo({ id: 3, sortOrder: 3, projectId: 10, parentId: 1 }), // A2
        makeTodo({ id: 4, sortOrder: 4, projectId: 10 }),             // B
      ]

      // Act: select only the parent
      const mutations = moveTasksInDirection(todos, new Set([1]), 'down')

      // Assert: A (and its children) appear after B
      const ordA  = resolvedOrder(todos, mutations, 1)
      const ordA1 = resolvedOrder(todos, mutations, 2)
      const ordA2 = resolvedOrder(todos, mutations, 3)
      const ordB  = resolvedOrder(todos, mutations, 4)
      expect(ordB).toBeLessThan(ordA)
      expect(ordA).toBeLessThan(ordA1)
      expect(ordA1).toBeLessThan(ordA2)
    })

    it('moveTasksInDirection_parentWithChildrenMovedUp_entireGroupMovesAbove', () => {
      // Arrange — visual order: A(root), B(root), B1(child)
      const todos = [
        makeTodo({ id: 1, sortOrder: 1, projectId: 10 }),             // A
        makeTodo({ id: 2, sortOrder: 2, projectId: 10 }),             // B
        makeTodo({ id: 3, sortOrder: 3, projectId: 10, parentId: 2 }), // B1
      ]

      // Act: move B (parent) up — should jump above A
      const mutations = moveTasksInDirection(todos, new Set([2]), 'up')

      // Assert: B comes before A; B1 still follows B
      const ordA  = resolvedOrder(todos, mutations, 1)
      const ordB  = resolvedOrder(todos, mutations, 2)
      const ordB1 = resolvedOrder(todos, mutations, 3)
      expect(ordB).toBeLessThan(ordA)
      expect(ordB).toBeLessThan(ordB1)
    })

    it('moveTasksInDirection_firstParentWithChildrenMovedUp_returnsEmpty', () => {
      // Arrange — visual order: A(root), A1(child), B(root)
      const todos = [
        makeTodo({ id: 1, sortOrder: 1, projectId: 10 }),             // A
        makeTodo({ id: 2, sortOrder: 2, projectId: 10, parentId: 1 }), // A1
        makeTodo({ id: 3, sortOrder: 3, projectId: 10 }),             // B
      ]

      // Act: A is already first — cannot go up
      const mutations = moveTasksInDirection(todos, new Set([1]), 'up')

      // Assert
      expect(mutations).toHaveLength(0)
    })
  })

  describe('child task moves within its parent group', () => {
    it('moveTasksInDirection_secondChildMovedUp_swapsWithFirstChild', () => {
      // Arrange — visual order: A, A1, A2
      const todos = [
        makeTodo({ id: 1, sortOrder: 1, projectId: 10 }),             // A
        makeTodo({ id: 2, sortOrder: 2, projectId: 10, parentId: 1 }), // A1
        makeTodo({ id: 3, sortOrder: 3, projectId: 10, parentId: 1 }), // A2
      ]

      // Act
      const mutations = moveTasksInDirection(todos, new Set([3]), 'up')

      // Assert: A2 now before A1
      const ordA1 = resolvedOrder(todos, mutations, 2)
      const ordA2 = resolvedOrder(todos, mutations, 3)
      expect(ordA2).toBeLessThan(ordA1)
    })

    it('moveTasksInDirection_firstChildMovedUp_jumpsAboveParentGroup', () => {
      // Arrange — visual order: A, A1, B
      // Moving the only/first child A1 up passes the boundary of its parent group.
      const todos = [
        makeTodo({ id: 1, sortOrder: 1, projectId: 10 }),             // A
        makeTodo({ id: 2, sortOrder: 2, projectId: 10, parentId: 1 }), // A1
        makeTodo({ id: 3, sortOrder: 3, projectId: 10 }),             // B
      ]

      // Act
      const mutations = moveTasksInDirection(todos, new Set([2]), 'up')

      // Assert: A1 is now before A in the visual order
      const ordA  = resolvedOrder(todos, mutations, 1)
      const ordA1 = resolvedOrder(todos, mutations, 2)
      expect(ordA1).toBeLessThan(ordA)
    })

    it('moveTasksInDirection_lastChildMovedDown_jumpsBelow', () => {
      // Arrange — visual order: A, A1, B
      const todos = [
        makeTodo({ id: 1, sortOrder: 1, projectId: 10 }),             // A
        makeTodo({ id: 2, sortOrder: 2, projectId: 10, parentId: 1 }), // A1
        makeTodo({ id: 3, sortOrder: 3, projectId: 10 }),             // B
      ]

      // Act: A1 is the last item in the visual list — cannot go down
      const mutations = moveTasksInDirection(todos, new Set([2]), 'down')

      // Assert: A1 moves after B
      const ordA1 = resolvedOrder(todos, mutations, 2)
      const ordB  = resolvedOrder(todos, mutations, 3)
      expect(ordA1).toBeGreaterThan(ordB)
    })
  })

  describe('multiple tasks selected', () => {
    it('moveTasksInDirection_multipleRootsMovedUp_groupSwapsAbovePrecedingTask', () => {
      // Arrange — visual order: A, B, C, D
      const todos = [
        makeTodo({ id: 1, sortOrder: 1, projectId: 10 }), // A
        makeTodo({ id: 2, sortOrder: 2, projectId: 10 }), // B
        makeTodo({ id: 3, sortOrder: 3, projectId: 10 }), // C
        makeTodo({ id: 4, sortOrder: 4, projectId: 10 }), // D
      ]

      // Act: move C and D up together
      const mutations = moveTasksInDirection(todos, new Set([3, 4]), 'up')

      // Assert: C and D appear before B; A stays first
      const ordA = resolvedOrder(todos, mutations, 1)
      const ordB = resolvedOrder(todos, mutations, 2)
      const ordC = resolvedOrder(todos, mutations, 3)
      const ordD = resolvedOrder(todos, mutations, 4)
      expect(ordA).toBeLessThan(ordC)
      expect(ordC).toBeLessThan(ordD)
      expect(ordD).toBeLessThan(ordB)
    })

    it('moveTasksInDirection_multipleRootsMovedDown_groupSwapsBelowSucceedingTask', () => {
      // Arrange — visual order: A, B, C, D
      const todos = [
        makeTodo({ id: 1, sortOrder: 1, projectId: 10 }), // A
        makeTodo({ id: 2, sortOrder: 2, projectId: 10 }), // B
        makeTodo({ id: 3, sortOrder: 3, projectId: 10 }), // C
        makeTodo({ id: 4, sortOrder: 4, projectId: 10 }), // D
      ]

      // Act: move A and B down together
      const mutations = moveTasksInDirection(todos, new Set([1, 2]), 'down')

      // Assert: C comes first, then A and B, then D
      const ordA = resolvedOrder(todos, mutations, 1)
      const ordB = resolvedOrder(todos, mutations, 2)
      const ordC = resolvedOrder(todos, mutations, 3)
      const ordD = resolvedOrder(todos, mutations, 4)
      expect(ordC).toBeLessThan(ordA)
      expect(ordA).toBeLessThan(ordB)
      expect(ordB).toBeLessThan(ordD)
    })

    it('moveTasksInDirection_firstTwoTasksMovedUp_returnsEmpty', () => {
      // Arrange
      const todos = [
        makeTodo({ id: 1, sortOrder: 1, projectId: 10 }),
        makeTodo({ id: 2, sortOrder: 2, projectId: 10 }),
        makeTodo({ id: 3, sortOrder: 3, projectId: 10 }),
      ]

      // Act: tasks 1 and 2 are the leading tasks — cannot move up
      const mutations = moveTasksInDirection(todos, new Set([1, 2]), 'up')

      // Assert
      expect(mutations).toHaveLength(0)
    })

    it('moveTasksInDirection_lastTwoTasksMovedDown_returnsEmpty', () => {
      // Arrange
      const todos = [
        makeTodo({ id: 1, sortOrder: 1, projectId: 10 }),
        makeTodo({ id: 2, sortOrder: 2, projectId: 10 }),
        makeTodo({ id: 3, sortOrder: 3, projectId: 10 }),
      ]

      // Act: tasks 2 and 3 are the trailing tasks — cannot move down
      const mutations = moveTasksInDirection(todos, new Set([2, 3]), 'down')

      // Assert
      expect(mutations).toHaveLength(0)
    })
  })
})
