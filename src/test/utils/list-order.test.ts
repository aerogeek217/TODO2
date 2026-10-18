import { describe, it, expect } from 'vitest'
import {
  manualOrderComparator,
  placeInOrder,
  planMove,
  rankBetween,
  seedRanks,
  type ListRanks,
  type RankWrite,
} from '../../utils/list-order'
import { makeTodo } from '../helpers'

function apply(ranks: ListRanks, writes: readonly RankWrite[]): Map<number, number> {
  const next = new Map(ranks)
  for (const w of writes) next.set(w.todoId, w.rank)
  return next
}

/** Ids in manual order under `ranks` (unranked after, by id here — equal createdAt). */
function ordered(ids: readonly number[], ranks: ListRanks): number[] {
  const at = new Date('2026-10-01T00:00:00Z')
  return ids.map((id) => makeTodo({ id, createdAt: at })).sort(manualOrderComparator(ranks)).map((t) => t.id)
}

describe('manualOrderComparator', () => {
  it('ranked first by rank, then unranked oldest first', () => {
    const todos = [
      makeTodo({ id: 1, createdAt: new Date('2026-10-03') }),
      makeTodo({ id: 2, createdAt: new Date('2026-10-01') }),
      makeTodo({ id: 3, createdAt: new Date('2026-10-02') }),
      makeTodo({ id: 4 }),
    ]
    const ranks = new Map([[4, 2], [3, 1]])
    expect(todos.sort(manualOrderComparator(ranks)).map((t) => t.id)).toEqual([3, 4, 2, 1])
  })
})

describe('rankBetween', () => {
  it('midpoint, one step past an end, null without room', () => {
    expect(rankBetween(1, 2)).toBe(1.5)
    expect(rankBetween(undefined, 2)).toBe(1)
    expect(rankBetween(3, undefined)).toBe(4)
    expect(rankBetween(1, 1)).toBeNull()
    expect(rankBetween(1, 1 + Number.EPSILON)).toBeNull()
  })
})

describe('placeInOrder', () => {
  it('after prev, else before next, else in place', () => {
    expect(placeInOrder([1, 2, 3, 4], { todoId: 4, prevId: 1, nextId: 2 })).toEqual([1, 4, 2, 3])
    expect(placeInOrder([1, 2, 3, 4], { todoId: 1, prevId: null, nextId: 4 })).toEqual([2, 3, 1, 4])
    expect(placeInOrder([1, 2, 3], { todoId: 2, prevId: null, nextId: null })).toEqual([1, 2, 3])
  })
})

describe('planMove', () => {
  it('writes only the moved task when its neighbours are ranked', () => {
    const ranks = new Map([[1, 1], [2, 2], [3, 3]])
    const writes = planMove([1, 2, 3], ranks, { todoId: 3, prevId: 1, nextId: 2 })
    expect(writes).toEqual([{ todoId: 3, rank: 1.5 }])
    expect(ordered([1, 2, 3], apply(ranks, writes))).toEqual([1, 3, 2])
  })

  it('to the top / bottom', () => {
    const ranks = new Map([[1, 1], [2, 2], [3, 3]])
    expect(planMove([1, 2, 3], ranks, { todoId: 3, prevId: null, nextId: 1 })).toEqual([{ todoId: 3, rank: 0 }])
    expect(planMove([1, 2, 3], ranks, { todoId: 1, prevId: 3, nextId: null })).toEqual([{ todoId: 1, rank: 4 }])
  })

  it('an unranked neighbour: ranks the unranked tail first, keeping what was shown', () => {
    // 1 and 2 ranked; 3, 4, 5 new (unranked, shown after). Move 5 between 3 and 4.
    const ranks = new Map([[1, 1], [2, 2]])
    const order = ordered([1, 2, 3, 4, 5], ranks)
    const writes = planMove(order, ranks, { todoId: 5, prevId: 3, nextId: 4 })
    expect(ordered([1, 2, 3, 4, 5], apply(ranks, writes))).toEqual([1, 2, 3, 5, 4])
    // 3 and 4 got ranks after the ranked ones; 1 and 2 untouched.
    expect(writes.map((w) => w.todoId).sort()).toEqual([3, 4, 5])
  })

  it('a list with no ranks at all', () => {
    const ranks = new Map<number, number>()
    const writes = planMove([1, 2, 3], ranks, { todoId: 3, prevId: null, nextId: 1 })
    expect(ordered([1, 2, 3], apply(ranks, writes))).toEqual([3, 1, 2])
  })

  it('no room left: re-spaces the list with the move applied', () => {
    const ranks = new Map([[1, 1], [2, 1 + Number.EPSILON], [3, 5]])
    const writes = planMove([1, 2, 3], ranks, { todoId: 3, prevId: 1, nextId: 2 })
    const next = apply(ranks, writes)
    expect(ordered([1, 2, 3], next)).toEqual([1, 3, 2])
    expect(new Set(next.values()).size).toBe(3)
  })

  it('repeated moves into the same gap keep working', () => {
    let ranks: Map<number, number> = new Map([[1, 1], [2, 2], [3, 3]])
    for (let i = 0; i < 80; i++) {
      const moved = i % 2 === 0 ? 3 : 2
      const other = moved === 3 ? 2 : 3
      const order = ordered([1, 2, 3], ranks)
      ranks = apply(ranks, planMove(order, ranks, { todoId: moved, prevId: 1, nextId: other }))
      expect(ordered([1, 2, 3], ranks)).toEqual([1, moved, other])
    }
  })

  it('grouped: placing between group neighbours leaves other groups’ order alone', () => {
    // Global order 1..6; group A = {1, 3, 5}, group B = {2, 4, 6}. Move 5 between 1 and 3 in A.
    const ranks = new Map([[1, 1], [2, 2], [3, 3], [4, 4], [5, 5], [6, 6]])
    const next = apply(ranks, planMove([1, 2, 3, 4, 5, 6], ranks, { todoId: 5, prevId: 1, nextId: 3 }))
    const all = ordered([1, 2, 3, 4, 5, 6], next)
    expect(all.filter((id) => id % 2 === 1)).toEqual([1, 5, 3])
    expect(all.filter((id) => id % 2 === 0)).toEqual([2, 4, 6])
  })
})

describe('seedRanks', () => {
  it('ranks the shown order with the move applied', () => {
    const writes = seedRanks([4, 1, 3, 2], { todoId: 2, prevId: 4, nextId: 1 })
    expect(ordered([1, 2, 3, 4], new Map(writes.map((w) => [w.todoId, w.rank])))).toEqual([4, 2, 1, 3])
  })
})
