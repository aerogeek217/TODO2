import { describe, expect, it } from 'vitest'
import { findRow, withoutRows, withRows } from '../../stores/task-child-rows'

interface Row { id: number; todoId: number; order: number }
const byOrder = (a: Row, b: Row) => a.order - b.order
const rows = (...list: Row[]) => list

describe('task-child-rows', () => {
  it('withRows adds rows to their tasks, each task sorted', () => {
    const map = withRows(new Map(), rows({ id: 2, todoId: 1, order: 2 }, { id: 1, todoId: 1, order: 1 }, { id: 3, todoId: 5, order: 0 }), byOrder)
    expect(map.get(1)?.map((r) => r.id)).toEqual([1, 2])
    expect(map.get(5)?.map((r) => r.id)).toEqual([3])
  })

  it('withRows replaces a row by id, and one that changed task leaves its old one', () => {
    const start = withRows(new Map(), rows({ id: 1, todoId: 1, order: 1 }, { id: 2, todoId: 1, order: 2 }), byOrder)
    const replaced = withRows(start, rows({ id: 1, todoId: 1, order: 3 }), byOrder)
    expect(replaced.get(1)?.map((r) => r.id)).toEqual([2, 1])
    const moved = withRows(replaced, rows({ id: 2, todoId: 9, order: 0 }), byOrder)
    expect(moved.get(1)?.map((r) => r.id)).toEqual([1])
    expect(moved.get(9)?.map((r) => r.id)).toEqual([2])
    const emptied = withRows(moved, rows({ id: 1, todoId: 9, order: 5 }), byOrder)
    expect(emptied.has(1)).toBe(false)
    expect(emptied.get(9)?.map((r) => r.id)).toEqual([2, 1])
  })

  it('withoutRows drops rows by id, and a task left with none', () => {
    const start = withRows(new Map(), rows({ id: 1, todoId: 1, order: 1 }, { id: 2, todoId: 2, order: 1 }, { id: 3, todoId: 2, order: 2 }), byOrder)
    const next = withoutRows(start, new Set([1, 3]))
    expect(next.has(1)).toBe(false)
    expect(next.get(2)?.map((r) => r.id)).toEqual([2])
    expect(findRow(next, 2)?.todoId).toBe(2)
    expect(findRow(next, 3)).toBeUndefined()
  })
})
