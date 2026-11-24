import { describe, it, expect } from 'vitest'
import { createTab, type LayoutBody, type WorkspaceLayout } from '../../models/workspace-layout'
import { isNormalized, validateTiling } from '../../utils/workspace-grid'
import { isFitTrack } from '../../utils/workspace-rows'
import { trackSizing } from '../../utils/workspace-table'
import { cellAreaFits, setCellArea, swapCells } from '../../utils/workspace-layout-ops'
import { cell as spec, freshNumberTab, grid, picture, type CellSpec } from '../helpers/layout-builders'

/**
 * The layout edit mode's card ops (E3): `setCellArea` (a card's corner,
 * Stretch right / down, Shift+arrow) and `swapCells` (Swap with ▸,
 * Alt+arrow onto a card).
 */

function cell(id: string, kind: 'notes' | 'number' = 'notes'): CellSpec {
  const tab = kind === 'number' ? freshNumberTab(`${id}-t`) : createTab(kind, `${id}-t`)
  return spec(id, [tab], { activeTabId: tab.id })
}

function empty(id: string): CellSpec {
  return spec(id, [])
}

function layout(body: LayoutBody): WorkspaceLayout {
  return { sortOrder: 0, name: 'L', ...body, createdAt: new Date(0), modifiedAt: new Date(0) }
}

function ids(prefix = 'n') {
  let n = 0
  return () => `${prefix}${++n}`
}

function expectValid(body: LayoutBody): void {
  expect(validateTiling(body)).toBe(true)
  expect(isNormalized(body)).toBe(true)
}

const allTabs = (body: LayoutBody) => body.cells.flatMap((c) => c.tabs.map((t) => t.id)).sort()

const a = cell('a')
const b = cell('b')
const c = cell('c')
const d = cell('d')

describe('setCellArea', () => {
  it('stretches a card right over an empty cell, which goes', () => {
    const base = layout(grid([[a, empty('e')], [b, c]]))
    const out = setCellArea(base, 'a', { col: 0, row: 0, colSpan: 2, rowSpan: 1 }, ids())
    expect(picture(out)).toEqual(['a a', 'b c'])
    expect(out.cells.some((x) => x.id === 'e')).toBe(false)
    expect(allTabs(out)).toEqual(allTabs(base))
    expectValid(out)
  })

  it('covers part of an empty cell: what is left of it keeps its id', () => {
    const e = empty('e')
    const base = layout(grid([[a, e], [b, e]]))
    const out = setCellArea(base, 'a', { col: 0, row: 0, colSpan: 2, rowSpan: 1 }, ids())
    expect(picture(out)).toEqual(['a a', 'b e'])
    expectValid(out)
  })

  it('cuts what is left of an empty cell into rectangles', () => {
    const e = empty('e')
    const base = layout(grid([[a, e, e], [b, e, e], [c, e, e]]))
    // a takes e's top-left place: e is left as its right column (keeping its id) and the rest of its middle one.
    const out = setCellArea(base, 'a', { col: 0, row: 0, colSpan: 2, rowSpan: 1 }, ids())
    expect(picture(out)).toEqual(['a a e', 'b n2 e', 'c n2 e'])
    expect(out.cells.find((x) => x.id === 'n2')?.tabs).toEqual([])
    expectValid(out)
    // b is filled: an area over it isn't allowed.
    expect(cellAreaFits(base, 'a', { col: 0, row: 0, colSpan: 2, rowSpan: 2 })).toBe(false)
  })

  it('shrinking leaves an empty cell behind', () => {
    const base = layout(grid([[a, a], [b, c]]))
    const out = setCellArea(base, 'a', { col: 0, row: 0, colSpan: 1, rowSpan: 1 }, ids())
    expect(picture(out)).toEqual(['a n1', 'b c'])
    expect(out.cells.find((x) => x.id === 'n1')?.tabs).toEqual([])
    expectValid(out)
  })

  it('an L of places left is cut into rectangles, the first keeping the new id', () => {
    const base = layout(grid([[a, a], [a, a], [b, c]]))
    const out = setCellArea(base, 'a', { col: 0, row: 0, colSpan: 1, rowSpan: 1 }, ids())
    expect(picture(out)).toEqual(['a n1', 'n2 n1', 'b c'])
    expectValid(out)
  })

  it('moves a card over empty cells only: its old place becomes an empty cell', () => {
    const base = layout(grid([[a, empty('e')], [b, c]]))
    const out = setCellArea(base, 'a', { col: 1, row: 0, colSpan: 1, rowSpan: 1 }, ids())
    expect(picture(out)).toEqual(['n1 a', 'b c'])
    expectValid(out)
  })

  it('refuses an area over a filled cell, outside the grid, of no tracks or not whole tracks', () => {
    const base = layout(grid([[a, b], [c, d]]))
    const genId = ids()
    expect(setCellArea(base, 'a', { col: 0, row: 0, colSpan: 2, rowSpan: 1 }, genId)).toBe(base)
    expect(setCellArea(base, 'a', { col: 0, row: 0, colSpan: 3, rowSpan: 1 }, genId)).toBe(base)
    expect(setCellArea(base, 'a', { col: -1, row: 0, colSpan: 1, rowSpan: 1 }, genId)).toBe(base)
    expect(setCellArea(base, 'a', { col: 0, row: 0, colSpan: 0, rowSpan: 1 }, genId)).toBe(base)
    expect(setCellArea(base, 'a', { col: 0, row: 0, colSpan: 1.5, rowSpan: 1 }, genId)).toBe(base)
    expect(setCellArea(base, 'zz', { col: 0, row: 0, colSpan: 1, rowSpan: 1 }, genId)).toBe(base)
  })

  it('the area it has already: the same layout', () => {
    const base = layout(grid([[a, b]]))
    expect(setCellArea(base, 'a', { col: 0, row: 0, colSpan: 1, rowSpan: 1 }, ids())).toBe(base)
  })

  it('down over an empty cell beside a collapsed row: the row it reaches keeps its fold for the cell lying only in it', () => {
    const base = layout(grid([[a, b], [empty('e'), c]], { rows: [1000, { weight: 1000, collapsed: true }] }))
    const out = setCellArea(base, 'a', { col: 0, row: 0, colSpan: 1, rowSpan: 2 }, ids())
    expect(picture(out)).toEqual(['a b', 'a c'])
    expect(out.grid.rows[1]?.collapsed).toBe(true)
    expectValid(out)
  })

  it('shrinking out of a collapsed row: the empty cell left there doesn’t hold the fold', () => {
    const base = layout(grid([[a, b], [a, c]], { rows: [1000, { weight: 1000, collapsed: true }] }))
    const out = setCellArea(base, 'a', { col: 0, row: 0, colSpan: 1, rowSpan: 1 }, ids())
    expect(picture(out)).toEqual(['a b', 'n1 c'])
    // c still lies only in it: it stays folded.
    expect(out.grid.rows[1]?.collapsed).toBe(true)
    expectValid(out)
  })

  it('a Number stretched along its fit row keeps the row fitting', () => {
    const n = cell('n', 'number')
    const base = layout(grid([[n, empty('e')], [a, a]]))
    const out = setCellArea(base, 'n', { col: 0, row: 0, colSpan: 2, rowSpan: 1 }, ids())
    expect(picture(out)).toEqual(['n', 'a'])
    expect(isFitTrack(out, 0)).toBe(true)
    expectValid(out)
  })

  it('spans a fixed (px) row and a weighted one', () => {
    const base = layout(grid([[a, b], [empty('e'), c]], { rows: [{ px: 120 }, 1000] }))
    const out = setCellArea(base, 'a', { col: 0, row: 0, colSpan: 1, rowSpan: 2 }, ids())
    expect(picture(out)).toEqual(['a b', 'a c'])
    expect(trackSizing(out, 'rows', 0).kind).toBe('fixed')
    expectValid(out)
  })
})

describe('swapCells', () => {
  it('two cards of different sizes swap places, each keeping its id and tabs', () => {
    const base = layout(grid([[a, a, b], [c, d, d]]))
    const out = swapCells(base, 'a', 'b')
    expect(picture(out)).toEqual(['b b a', 'c d d'])
    expect(out.cells.find((x) => x.id === 'a')?.tabs.map((t) => t.id)).toEqual(['a-t'])
    expectValid(out)
  })

  it('swaps with an empty cell', () => {
    const base = layout(grid([[a, empty('e')], [b, b]]))
    const out = swapCells(base, 'a', 'e')
    expect(picture(out)).toEqual(['e a', 'b b'])
    expectValid(out)
  })

  it('a cell with itself, or an unknown one: the same layout', () => {
    const base = layout(grid([[a, b]]))
    expect(swapCells(base, 'a', 'a')).toBe(base)
    expect(swapCells(base, 'a', 'zz')).toBe(base)
  })

  it('into a collapsed row and out: a fold nothing holds any more expands', () => {
    const base = layout(grid([[a, a], [empty('e'), b]], { rows: [1000, { weight: 1000, collapsed: true }] }))
    const out = swapCells(base, 'b', 'e')
    expect(picture(out)).toEqual(['a a', 'b e'])
    expect(out.grid.rows[1]?.collapsed).toBe(true)
    const back = swapCells(layout(grid([[a, b], [c, empty('e')]], { rows: [1000, { weight: 1000, collapsed: true }] })), 'c', 'a')
    // c (folded) to the top row, a into the folded row: a lies only in it, so the fold holds.
    expect(picture(back)).toEqual(['c b', 'a e'])
    expectValid(back)
  })
})
