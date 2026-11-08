import { describe, it, expect } from 'vitest'
import type { LayoutBody } from '../../models/workspace-layout'
import {
  canMerge,
  cellAtTrack,
  edgeBetween,
  edgeStretches,
  isCellEdge,
  isNormalized,
  isWholeLine,
  mergeTracks,
  neighbours,
  normalizeGrid,
  readingOrder,
  stretchCells,
  unionArea,
  validateTiling,
  wholeEdgeNeighbour,
} from '../../utils/workspace-grid'
import { cell, emptyBody, grid, picture } from '../helpers/layout-builders'

const a = cell('a')
const b = cell('b')
const c = cell('c')
const d = cell('d')
const e = cell('e')

/** a a b
 *  c d b */
const L = grid([[a, a, b], [c, d, b]])

describe('queries', () => {
  it('finds the cell at a track, in reading order', () => {
    expect(cellAtTrack(L, 1, 0)?.id).toBe('a')
    expect(cellAtTrack(L, 2, 1)?.id).toBe('b')
    expect(cellAtTrack(L, 3, 0)).toBeUndefined()
    expect(readingOrder(L).map((x) => x.id)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('lists the neighbours along an edge, and the one sharing the whole edge', () => {
    expect(neighbours(L, 'a', 'bottom').map((x) => x.id)).toEqual(['c', 'd'])
    expect(neighbours(L, 'b', 'left').map((x) => x.id)).toEqual(['a', 'd'])
    expect(neighbours(L, 'a', 'top')).toEqual([])
    expect(wholeEdgeNeighbour(L, 'a', 'bottom')).toBeUndefined()
    expect(wholeEdgeNeighbour(L, 'c', 'right')?.id).toBe('d')
    expect(wholeEdgeNeighbour(L, 'd', 'left')?.id).toBe('c')
  })

  it('merges two cells only into a rectangle', () => {
    expect(canMerge(L, 'c', 'd')).toBe(true)
    expect(canMerge(L, 'a', 'b')).toBe(false)
    expect(canMerge(L, 'a', 'c')).toBe(false)
    expect(unionArea({ col: 0, row: 1, colSpan: 1, rowSpan: 1 }, { col: 1, row: 1, colSpan: 1, rowSpan: 1 })).toEqual({ col: 0, row: 1, colSpan: 2, rowSpan: 1 })
  })

  it('knows which lines are cell edges', () => {
    expect(isCellEdge(L, 'columns', 1)).toBe(true)
    expect(isCellEdge(L, 'columns', 2)).toBe(true)
    expect(isCellEdge(L, 'rows', 1)).toBe(true)
  })
})

describe('validateTiling', () => {
  it('accepts an exact tiling and the empty layout', () => {
    expect(validateTiling(L)).toBe(true)
    expect(validateTiling(emptyBody())).toBe(true)
  })

  it('rejects gaps, overlaps, cells outside the grid, and tracks without cells', () => {
    const gap: LayoutBody = { ...L, cells: L.cells.filter((x) => x.id !== 'd') }
    expect(validateTiling(gap)).toBe('gaps in the grid')
    const overlap: LayoutBody = { ...L, cells: L.cells.map((x) => (x.id === 'c' ? { ...x, area: { ...x.area, colSpan: 2 } } : x)) }
    expect(validateTiling(overlap)).toMatch(/overlaps/)
    const outside: LayoutBody = { ...L, cells: L.cells.map((x) => (x.id === 'b' ? { ...x, area: { ...x.area, colSpan: 2 } } : x)) }
    expect(validateTiling(outside)).toMatch(/outside/)
    expect(validateTiling({ grid: L.grid, cells: [] })).toBe('tracks without cells')
  })
})

describe('normalizeGrid', () => {
  it('merges a line no cell edge lies on, adding the weights and keeping the first id', () => {
    const body: LayoutBody = {
      grid: { columns: [{ id: 'x', weight: 300 }, { id: 'y', weight: 200 }], rows: [{ id: 'r', weight: 1000 }] },
      cells: [{ id: 'a', area: { col: 0, row: 0, colSpan: 2, rowSpan: 1 }, tabs: [] }],
    }
    const out = normalizeGrid(body)
    expect(out.grid.columns).toEqual([{ id: 'x', weight: 500 }])
    expect(out.cells[0]?.area).toEqual({ col: 0, row: 0, colSpan: 1, rowSpan: 1 })
    expect(isNormalized(out)).toBe(true)
  })

  it('merges collapse only when both tracks were collapsed; px with px', () => {
    expect(mergeTracks({ id: 'a', px: 100, collapsed: true }, { id: 'b', px: 60, collapsed: true })).toEqual({ id: 'a', px: 160, collapsed: true })
    expect(mergeTracks({ id: 'a', weight: 100, collapsed: true }, { id: 'b', weight: 50 })).toEqual({ id: 'a', weight: 150 })
    expect(mergeTracks({ id: 'a', px: 100 }, { id: 'b', weight: 50 })).toEqual({ id: 'a', weight: 50 })
  })

  it('puts the cells in reading order; returns the same body when already normal', () => {
    expect(normalizeGrid(L)).toBe(L)
    const shuffled = { ...L, cells: [...L.cells].reverse() }
    expect(normalizeGrid(shuffled).cells.map((x) => x.id)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('drops every track of a body without cells', () => {
    expect(normalizeGrid({ grid: L.grid, cells: [] }).grid).toEqual({ columns: [], rows: [] })
  })
})

describe('edges', () => {
  /** a b
   *  c b
   *  d e */
  const M = grid([[a, b], [c, b], [d, e]])

  it('extends the edge between two cells along the line while both sides keep bordering it', () => {
    // a | b over rows 0–1: extends down through c | b, stops where d | e meet (still a border) → the whole line.
    expect(edgeBetween(M, 'a', 'b')).toEqual({ axis: 'columns', line: 1, from: 0, to: 3 })
    expect(edgeBetween(M, 'a', 'c')).toEqual({ axis: 'rows', line: 1, from: 0, to: 1 })
    expect(edgeBetween(M, 'a', 'e')).toBeNull()
  })

  it('a line a cell crosses splits into stretches', () => {
    /** a a
     *  b c
     *  d d */
    const N = grid([[a, a], [b, c], [d, d]])
    expect(edgeStretches(N)).toEqual([
      { axis: 'columns', line: 1, from: 1, to: 2 },
      { axis: 'rows', line: 1, from: 0, to: 2 },
      { axis: 'rows', line: 2, from: 0, to: 2 },
    ])
    const s = edgeBetween(N, 'b', 'c')
    expect(s && isWholeLine(N, s)).toBe(false)
    expect(s && stretchCells(N, s)).toEqual({ before: [N.cells[1]], after: [N.cells[2]] })
  })

  it('pictures a body', () => {
    expect(picture(L)).toEqual(['a a b', 'c d b'])
  })
})
