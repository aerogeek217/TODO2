import { describe, it, expect } from 'vitest'
import { createTab } from '../../models/workspace-layout'
import { moveEdge } from '../../utils/workspace-layout-ops'
import { edgeBetween } from '../../utils/workspace-grid'
import { previewedLayout, samePreviewBody } from '../../utils/workspace-preview'
import { cell, grid } from '../helpers/layout-builders'

/**
 * A structural resize drag's preview (layout feedback item 3): the working
 * copy drawn as the probe of the move — the probe's grid, each cell at its
 * area there, the cell objects and their order otherwise kept.
 */

const notes = (id: string) => cell(id, [createTab('notes', `${id}-t`)])
const ids = () => {
  let n = 0
  return () => `probe-${++n}`
}

const quad = grid([[notes('a'), notes('b')], [notes('c'), notes('d')]])

/** The quad's a|b piece moved `delta` px right: a new column line, structural. */
function movedAB(delta: number) {
  const stretch = edgeBetween(quad, 'a', 'b')
  if (!stretch) throw new Error('no a|b stretch')
  return moveEdge(quad, stretch, delta, { sizes: [500, 500] }, ids())
}

function quadMoved() {
  return { quad, next: movedAB(100) }
}

describe('previewedLayout', () => {
  it('draws the probe’s grid and areas, keeping the cells’ objects, order and tabs', () => {
    const { quad, next } = quadMoved()
    expect(next.grid.columns).toHaveLength(3)
    const shown = previewedLayout(quad, next)
    expect(shown.grid).toBe(next.grid)
    expect(shown.cells.map((c) => c.id)).toEqual(quad.cells.map((c) => c.id))
    const byId = new Map(next.cells.map((c) => [c.id, c.area]))
    for (const [i, c] of shown.cells.entries()) {
      const before = quad.cells[i]
      expect(c.area).toEqual(byId.get(c.id))
      expect(c.tabs).toBe(before?.tabs)
      // A cell whose area didn't change is the same object.
      if (before && JSON.stringify(before.area) === JSON.stringify(c.area)) expect(c).toBe(before)
    }
    expect(shown.cells.find((c) => c.id === 'a')?.area.colSpan).toBe(2)
  })

  it('the working copy as it is when the probe holds other cells', () => {
    const { quad, next } = quadMoved()
    const other = { ...next, cells: next.cells.map((c) => (c.id === 'd' ? { ...c, id: 'z' } : c)) }
    expect(previewedLayout(quad, other)).toBe(quad)
    expect(previewedLayout(quad, { ...next, cells: next.cells.slice(1) })).toBe(quad)
  })
})

describe('samePreviewBody', () => {
  it('the same tracks and areas read the same; a moved line or another area does not', () => {
    const next = movedAB(100)
    expect(samePreviewBody(next, movedAB(100))).toBe(true)
    expect(samePreviewBody(next, movedAB(140))).toBe(false)
    expect(samePreviewBody(next, quad)).toBe(false)
  })
})
