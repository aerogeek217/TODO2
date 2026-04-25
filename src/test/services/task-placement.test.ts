import { describe, it, expect } from 'vitest'
import {
  computeInsertionSort,
  placeTaskAt,
  placeMultipleAt,
  normalizeSortOrders,
  shouldNormalize,
} from '../../services/task-placement'
import { makeTodo } from '../helpers'

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
    expect(computeInsertionSort(siblings, 1)).toBe(3)
  })

  it('uses midpoint between two siblings', () => {
    const siblings = [makeTodo({ id: 1, sortOrder: 2 }), makeTodo({ id: 2, sortOrder: 10 })]
    expect(computeInsertionSort(siblings, 2)).toBe(6)
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
      beforeTodoId: null,
    })
    expect(mutations).toHaveLength(1)
    expect(mutations[0]!.todoId).toBe(3)
    expect(mutations[0]!.changes.sortOrder).toBe(3)
    expect(mutations[0]!.changes.projectId).toBe(10)
  })

  it('places task before a specific task', () => {
    const todos = [
      makeTodo({ id: 1, sortOrder: 2, projectId: 10 }),
      makeTodo({ id: 2, sortOrder: 4, projectId: 10 }),
    ]
    const task = makeTodo({ id: 3, sortOrder: 1, projectId: 10 })
    const mutations = placeTaskAt(todos, task, {
      projectId: 10,
      beforeTodoId: 2,
    })
    expect(mutations).toHaveLength(1)
    expect(mutations[0]!.changes.sortOrder).toBe(3)
  })

  it('same-project move does not set projectId', () => {
    const todos = [
      makeTodo({ id: 1, sortOrder: 1, projectId: 10 }),
      makeTodo({ id: 2, sortOrder: 2, projectId: 10 }),
    ]
    const mutations = placeTaskAt(todos, todos[1]!, {
      projectId: 10,
      beforeTodoId: 1,
    })
    expect(mutations[0]!.changes.projectId).toBeUndefined()
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
      beforeTodoId: null,
    })
    expect(mutations.length).toBeGreaterThanOrEqual(2)
    const m3 = mutations.find(m => m.todoId === 3)!
    const m4 = mutations.find(m => m.todoId === 4)!
    expect(m3.changes.projectId).toBe(10)
    expect(m4.changes.projectId).toBe(10)
    expect(m3.changes.sortOrder!).toBeLessThan(m4.changes.sortOrder!)
  })

  it('inserts multiple between two targets preserving relative order', () => {
    const todos = [
      makeTodo({ id: 1, sortOrder: 1, projectId: 10 }),
      makeTodo({ id: 2, sortOrder: 10, projectId: 10 }),
      makeTodo({ id: 3, sortOrder: 2, projectId: 20 }),
      makeTodo({ id: 4, sortOrder: 3, projectId: 20 }),
    ]
    const mutations = placeMultipleAt(todos, new Set([3, 4]), {
      projectId: 10,
      beforeTodoId: 2,
    })
    const m3 = mutations.find(m => m.todoId === 3)!
    const m4 = mutations.find(m => m.todoId === 4)!
    expect(m3.changes.sortOrder!).toBeGreaterThan(1)
    expect(m4.changes.sortOrder!).toBeLessThan(10)
    expect(m3.changes.sortOrder!).toBeLessThan(m4.changes.sortOrder!)
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
