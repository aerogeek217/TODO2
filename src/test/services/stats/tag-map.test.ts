import { describe, expect, it } from 'vitest'
import type { Tag } from '../../../models'
import { computeTagMap, lateShare } from '../../../services/stats/tag-map'
import { squarify } from '../../../utils/treemap'
import { makeTodo } from '../../helpers'

const today = new Date(2026, 9, 10)
const day = (n: number) => new Date(2026, 9, 10 + n)
const atlas: Tag & { id: number } = { id: 1, name: 'Atlas', color: '#111' }
const ops: Tag & { id: number } = { id: 2, name: 'Ops', color: '#222' }

const tasks = [
  makeTodo({ id: 1, dueDate: day(-2) }),
  makeTodo({ id: 2, dueDate: day(1) }),
  makeTodo({ id: 3, dueDate: day(-1) }),
  makeTodo({ id: 4 }),
  makeTodo({ id: 5, isCompleted: true, dueDate: day(-5) }),
]
const ctx = { today, assignedTagsMap: new Map([[1, [atlas]], [2, [atlas, ops]], [3, [ops]], [5, [atlas]]]) }

describe('computeTagMap (D26 P8)', () => {
  it('a tile per tag on an open task, and No tags; sized by open tasks, the late ones apart; largest first', () => {
    const tiles = computeTagMap(tasks, ctx)
    expect(tiles.map((t) => [t.label, t.ids, t.lateIds])).toEqual([
      ['Atlas', [1, 2], [1]],
      ['Ops', [3, 2], [3]],
      ['No tags', [4], []],
    ])
    expect(tiles.map(lateShare)).toEqual([0.5, 0.5, 0])
  })

  it('picked tags only (no No tags); a tag on no open task has no tile', () => {
    expect(computeTagMap(tasks, ctx, [2]).map((t) => t.key)).toEqual(['tag-2'])
    expect(computeTagMap(tasks, ctx, [9])).toEqual([])
  })
})

describe('squarify', () => {
  const area = (r: { w: number; h: number }) => r.w * r.h

  it('each rectangle’s area is its share of the whole, inside the box, without overlap', () => {
    const values = [6, 6, 4, 3, 2, 2, 1]
    const rects = squarify(values, { x: 0, y: 0, w: 600, h: 400 })
    const total = values.reduce((a, b) => a + b, 0)
    rects.forEach((r, i) => {
      expect(area(r)).toBeCloseTo((values[i]! / total) * 600 * 400, 3)
      expect(r.x).toBeGreaterThanOrEqual(-1e-9)
      expect(r.y).toBeGreaterThanOrEqual(-1e-9)
      expect(r.x + r.w).toBeLessThanOrEqual(600 + 1e-6)
      expect(r.y + r.h).toBeLessThanOrEqual(400 + 1e-6)
    })
    for (const [i, a] of rects.entries()) {
      for (const b of rects.slice(i + 1)) {
        const overlap = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y))
        expect(overlap).toBeLessThan(1e-6)
      }
    }
  })

  it('nothing to lay out, or no room: empty rectangles', () => {
    expect(squarify([], { x: 0, y: 0, w: 10, h: 10 })).toEqual([])
    expect(squarify([1, 2], { x: 0, y: 0, w: 0, h: 10 }).every((r) => r.w === 0 && r.h === 0)).toBe(true)
  })
})
