import { describe, expect, it } from 'vitest'
import { buildWallList, wallSquaresShown } from '../../utils/list-wall'

/** A List board tile's squares (`utils/list-wall`): the order, the counts, the cut. */
describe('list-wall', () => {
  it('orders the squares by state, keeping the list’s order within one; counts each state', () => {
    const tones = { a: 'stale', b: 'late', c: 'ontrack', d: 'late' } as const
    const l = buildWallList({ tabId: 't', name: 'L', showing: false, waiting: false }, ['a', 'b', 'c', 'd'], (k) => tones[k as keyof typeof tones])
    expect(l.squares.map((s) => s.task)).toEqual(['b', 'd', 'c', 'a'])
    expect(l.counts).toEqual({ late: 2, soon: 0, followup: 0, ontrack: 1, stale: 1 })
  })

  it('a big list stops at its rows, its last three squares giving way to +N', () => {
    const l = buildWallList({ tabId: 't', name: 'L', showing: false, waiting: false }, Array.from({ length: 100 }, (_, i) => i), () => 'ontrack')
    expect(wallSquaresShown(l, { columns: 20, rows: 3 })).toMatchObject({ more: 100 - 57 })
    expect(wallSquaresShown(l, { columns: 20, rows: 3 }).squares).toHaveLength(57)
    // Every square fits: no +N.
    expect(wallSquaresShown(l, { columns: 20, rows: 5 })).toMatchObject({ more: 0 })
  })
})
