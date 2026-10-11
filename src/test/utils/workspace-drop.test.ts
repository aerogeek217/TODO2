import { describe, it, expect } from 'vitest'
import { createTab, type LayoutCell, type LayoutColumn, type WorkspaceLayout } from '../../models/workspace-layout'
import {
  columnEdgeXs,
  dropChangesLayout,
  dropTargetForHit,
  hitTestWorkspace,
  type CellGeometry,
  type ColumnGeometry,
  type Rect,
  type WorkspaceGeometry,
} from '../../utils/workspace-drop'
import { evenPair, pairPercent, resizePair } from '../../utils/workspace-resize'

function rect(left: number, top: number, right: number, bottom: number): Rect {
  return { left, top, right, bottom }
}

/** Cell from y0 to y1 inside a column spanning x0..x1, 32px header, `tabs` 80px wide. */
function cellGeo(id: string, x0: number, x1: number, y0: number, y1: number, tabs: string[], opts: { collapsed?: boolean; empty?: boolean } = {}): CellGeometry {
  if (opts.empty) return { id, rect: rect(x0, y0, x1, y1), header: null, body: null, empty: true, tabs: [] }
  return {
    id,
    rect: rect(x0, y0, x1, y1),
    header: rect(x0, y0, x1, y0 + 32),
    body: opts.collapsed ? null : rect(x0, y0 + 32, x1, y1),
    empty: false,
    tabs: tabs.map((t, i) => ({ id: t, rect: rect(x0 + 4 + i * 80, y0 + 6, x0 + 4 + (i + 1) * 80, y0 + 32) })),
  }
}

/**
 * Area 0..1006 × 0..706 with 6px padding and gaps: column a = 6..500 (cells
 * a1 6..350, a2 356..700), column b = 506..1000 (cell b1 6..700).
 */
function geometry(): WorkspaceGeometry {
  const a: ColumnGeometry = {
    id: 'a',
    rect: rect(6, 6, 500, 700),
    cells: [cellGeo('a1', 6, 500, 6, 350, ['t1', 't2']), cellGeo('a2', 6, 500, 356, 700, ['t3'])],
  }
  const b: ColumnGeometry = { id: 'b', rect: rect(506, 6, 1000, 700), cells: [cellGeo('b1', 506, 1000, 6, 700, ['t4'])] }
  return { area: rect(0, 0, 1006, 706), columns: [a, b] }
}

function cell(id: string, tabIds: string[]): LayoutCell {
  const tabs = tabIds.map((t) => createTab('notes', t))
  return { id, weight: 1, tabs, ...(tabs[0] ? { activeTabId: tabs[0].id } : {}) }
}

function col(id: string, cells: LayoutCell[]): LayoutColumn {
  return { id, weight: 1, cells }
}

function layout(): WorkspaceLayout {
  return {
    name: 'L',
    columns: [col('a', [cell('a1', ['t1', 't2']), cell('a2', ['t3'])]), col('b', [cell('b1', ['t4'])])],
    createdAt: new Date(0),
    modifiedAt: new Date(0),
  }
}

describe('columnEdgeXs', () => {
  it('lists the outer edges and the gap centres', () => {
    expect(columnEdgeXs(geometry())).toEqual([3, 503, 1003])
  })

  it('is empty without columns', () => {
    expect(columnEdgeXs({ area: rect(0, 0, 100, 100), columns: [] })).toEqual([])
  })
})

describe('hitTestWorkspace', () => {
  const geo = geometry()

  it('outside the area or without columns → null', () => {
    expect(hitTestWorkspace(geo, { x: -5, y: 100 })).toBeNull()
    expect(hitTestWorkspace({ area: rect(0, 0, 100, 100), columns: [] }, { x: 50, y: 50 })).toBeNull()
  })

  it('within 16px of the gap between columns → new column at that gutter', () => {
    expect(hitTestWorkspace(geo, { x: 503, y: 400 })).toEqual({ kind: 'column-edge', gutter: 1, x: 503 })
    expect(hitTestWorkspace(geo, { x: 503 - 16, y: 400 })).toMatchObject({ kind: 'column-edge', gutter: 1 })
    expect(hitTestWorkspace(geo, { x: 503 + 16, y: 20 })).toMatchObject({ kind: 'column-edge', gutter: 1 })
    expect(hitTestWorkspace(geo, { x: 503 - 17, y: 400 })).not.toMatchObject({ kind: 'column-edge' })
  })

  it('within 24px of the outer edges → new first / last column', () => {
    expect(hitTestWorkspace(geo, { x: 24, y: 400 })).toEqual({ kind: 'column-edge', gutter: 0, x: 3 })
    expect(hitTestWorkspace(geo, { x: 1006 - 24, y: 400 })).toEqual({ kind: 'column-edge', gutter: 2, x: 1003 })
    expect(hitTestWorkspace(geo, { x: 25, y: 400 })).toMatchObject({ kind: 'cell-body' })
  })

  it('column edges win over the tab strip under them', () => {
    expect(hitTestWorkspace(geo, { x: 495, y: 20 })).toMatchObject({ kind: 'column-edge', gutter: 1 })
  })

  it('over a header → insert position from the tab midpoints', () => {
    // t1 spans 10..90 (mid 50), t2 90..170 (mid 130)
    expect(hitTestWorkspace(geo, { x: 40, y: 20 })).toEqual({ kind: 'tab-strip', cellId: 'a1', index: 0, lineX: 9 })
    expect(hitTestWorkspace(geo, { x: 60, y: 20 })).toEqual({ kind: 'tab-strip', cellId: 'a1', index: 1, lineX: 89 })
    expect(hitTestWorkspace(geo, { x: 300, y: 20 })).toEqual({ kind: 'tab-strip', cellId: 'a1', index: 2, lineX: 171 })
  })

  it('cell body → top quarter / middle half / bottom quarter', () => {
    // a2 body: 388..700 (height 312): top < 466, bottom > 622
    expect(hitTestWorkspace(geo, { x: 200, y: 400 })).toEqual({ kind: 'cell-body', cellId: 'a2', zone: 'top' })
    expect(hitTestWorkspace(geo, { x: 200, y: 540 })).toEqual({ kind: 'cell-body', cellId: 'a2', zone: 'middle' })
    expect(hitTestWorkspace(geo, { x: 200, y: 690 })).toEqual({ kind: 'cell-body', cellId: 'a2', zone: 'bottom' })
  })

  it('the gap between two cells is no target', () => {
    expect(hitTestWorkspace(geo, { x: 200, y: 353 })).toBeNull()
  })

  it('a collapsed cell only offers its tab strip; an empty cell is one target', () => {
    const g: WorkspaceGeometry = {
      area: rect(0, 0, 1006, 706),
      columns: [
        { id: 'a', rect: rect(6, 6, 500, 700), cells: [cellGeo('a1', 6, 500, 6, 38, ['t1'], { collapsed: true }), cellGeo('a2', 6, 500, 44, 700, [], { empty: true })] },
        { id: 'b', rect: rect(506, 6, 1000, 700), cells: [cellGeo('b1', 506, 1000, 6, 700, ['t4'])] },
      ],
    }
    expect(hitTestWorkspace(g, { x: 200, y: 20 })).toMatchObject({ kind: 'tab-strip', cellId: 'a1' })
    expect(hitTestWorkspace(g, { x: 200, y: 300 })).toEqual({ kind: 'empty-cell', cellId: 'a2' })
  })
})

describe('dropTargetForHit', () => {
  const geo = geometry()
  const l = layout()

  it('gutters name the column to their right, the last one the last column', () => {
    expect(dropTargetForHit(l, geo, { kind: 'column-edge', gutter: 0, x: 3 }, 't4')).toEqual({ kind: 'column-edge', columnId: 'a', edge: 'left' })
    expect(dropTargetForHit(l, geo, { kind: 'column-edge', gutter: 1, x: 503 }, 't4')).toEqual({ kind: 'column-edge', columnId: 'b', edge: 'left' })
    expect(dropTargetForHit(l, geo, { kind: 'column-edge', gutter: 2, x: 1003 }, 't1')).toEqual({ kind: 'column-edge', columnId: 'b', edge: 'right' })
  })

  it('a position in the own strip counts the other tabs', () => {
    expect(dropTargetForHit(l, geo, { kind: 'tab-strip', cellId: 'a1', index: 2, lineX: 0 }, 't1')).toEqual({ kind: 'cell', cellId: 'a1', index: 1 })
    expect(dropTargetForHit(l, geo, { kind: 'tab-strip', cellId: 'a1', index: 0, lineX: 0 }, 't2')).toEqual({ kind: 'cell', cellId: 'a1', index: 0 })
    expect(dropTargetForHit(l, geo, { kind: 'tab-strip', cellId: 'a1', index: 2, lineX: 0 }, 't4')).toEqual({ kind: 'cell', cellId: 'a1', index: 2 })
  })

  it('body zones map to cell edges / joining the cell', () => {
    expect(dropTargetForHit(l, geo, { kind: 'cell-body', cellId: 'a2', zone: 'top' }, 't4')).toEqual({ kind: 'cell-edge', cellId: 'a2', edge: 'top' })
    expect(dropTargetForHit(l, geo, { kind: 'cell-body', cellId: 'a2', zone: 'bottom' }, 't4')).toEqual({ kind: 'cell-edge', cellId: 'a2', edge: 'bottom' })
    expect(dropTargetForHit(l, geo, { kind: 'cell-body', cellId: 'a2', zone: 'middle' }, 't4')).toEqual({ kind: 'cell', cellId: 'a2' })
    expect(dropTargetForHit(l, geo, { kind: 'empty-cell', cellId: 'a2' }, 't4')).toEqual({ kind: 'cell', cellId: 'a2' })
  })
})

describe('dropChangesLayout', () => {
  const l = layout()

  it('the own cell middle and the own edges of a single-tab cell are no-ops', () => {
    expect(dropChangesLayout(l, 't3', { kind: 'cell', cellId: 'a2' })).toBe(false)
    expect(dropChangesLayout(l, 't3', { kind: 'cell-edge', cellId: 'a2', edge: 'top' })).toBe(false)
    expect(dropChangesLayout(l, 't4', { kind: 'column-edge', columnId: 'b', edge: 'right' })).toBe(false)
  })

  it('real moves change the layout', () => {
    expect(dropChangesLayout(l, 't1', { kind: 'cell-edge', cellId: 'a1', edge: 'bottom' })).toBe(true)
    expect(dropChangesLayout(l, 't4', { kind: 'cell', cellId: 'a1' })).toBe(true)
    expect(dropChangesLayout(l, 't1', { kind: 'column-edge', columnId: 'a', edge: 'left' })).toBe(true)
  })
})

describe('resizePair', () => {
  it('splits the pair weight by the new pixel sizes, leaving the total alone', () => {
    const r = resizePair({ sizeA: 400, sizeB: 400, weightA: 1, weightB: 3, delta: 100, min: 280 })
    expect(r.sizeA).toBe(500)
    expect(r.sizeB).toBe(300)
    expect(r.weightA + r.weightB).toBeCloseTo(4)
    expect(r.weightA / r.weightB).toBeCloseTo(500 / 300)
  })

  it('clamps at the minimum and reports how far past it the pointer went', () => {
    const r = resizePair({ sizeA: 400, sizeB: 400, weightA: 1, weightB: 1, delta: 200, min: 280 })
    expect(r.sizeB).toBe(280)
    expect(r.rawB).toBe(200)
  })

  it('a pair narrower than two minimums splits evenly at most', () => {
    const r = resizePair({ sizeA: 200, sizeB: 200, weightA: 1, weightB: 1, delta: 50, min: 280 })
    expect(r.sizeA).toBe(200)
  })

  it('double-click evens the pair; percent rounds the first share', () => {
    expect(evenPair(1, 3)).toEqual({ weightA: 2, weightB: 2 })
    expect(pairPercent(300, 100)).toBe(75)
    expect(pairPercent(0, 0)).toBe(50)
  })
})
