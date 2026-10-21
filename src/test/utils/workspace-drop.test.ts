import { describe, it, expect } from 'vitest'
import { createTab, type LayoutCell, type LayoutColumn, type WorkspaceLayout } from '../../models/workspace-layout'
import {
  columnEdgeXs,
  dropChangesLayout,
  dropTargetForHit,
  hitTestWorkspace,
  sameDropHit,
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
  return { area: rect(0, 0, 1006, 706), columnArea: rect(0, 6, 1006, 700), columns: [a, b], bands: [] }
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
    sortOrder: 0, name: 'L',
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
    expect(columnEdgeXs({ area: rect(0, 0, 100, 100), columnArea: rect(0, 0, 100, 100), columns: [], bands: [] })).toEqual([])
  })
})

describe('hitTestWorkspace', () => {
  const geo = geometry()

  it('outside the area or without columns → null', () => {
    expect(hitTestWorkspace(geo, { x: -5, y: 100 })).toBeNull()
    expect(hitTestWorkspace({ area: rect(0, 0, 100, 100), columnArea: rect(0, 0, 100, 100), columns: [], bands: [] }, { x: 50, y: 50 })).toBeNull()
  })

  it('within 16px of the gap between columns → new column at that gutter', () => {
    expect(hitTestWorkspace(geo, { x: 503, y: 400 })).toEqual({ kind: 'column-edge', gutter: 1, x: 503 })
    expect(hitTestWorkspace(geo, { x: 503 - 16, y: 400 })).toMatchObject({ kind: 'column-edge', gutter: 1 })
    expect(hitTestWorkspace(geo, { x: 503 + 16, y: 30 })).toMatchObject({ kind: 'column-edge', gutter: 1 })
    expect(hitTestWorkspace(geo, { x: 503 - 17, y: 400 })).not.toMatchObject({ kind: 'column-edge' })
  })

  it('within 24px of the outer edges → new first / last column', () => {
    expect(hitTestWorkspace(geo, { x: 24, y: 400 })).toEqual({ kind: 'column-edge', gutter: 0, x: 3 })
    expect(hitTestWorkspace(geo, { x: 1006 - 24, y: 400 })).toEqual({ kind: 'column-edge', gutter: 2, x: 1003 })
    expect(hitTestWorkspace(geo, { x: 25, y: 400 })).toMatchObject({ kind: 'cell-body' })
  })

  it('column edges win over the tab strip under them', () => {
    expect(hitTestWorkspace(geo, { x: 495, y: 30 })).toMatchObject({ kind: 'column-edge', gutter: 1 })
  })

  it('over a header → insert position from the tab midpoints', () => {
    // t1 spans 10..90 (mid 50), t2 90..170 (mid 130)
    expect(hitTestWorkspace(geo, { x: 40, y: 30 })).toEqual({ kind: 'tab-strip', cellId: 'a1', index: 0, lineX: 9 })
    expect(hitTestWorkspace(geo, { x: 60, y: 30 })).toEqual({ kind: 'tab-strip', cellId: 'a1', index: 1, lineX: 89 })
    expect(hitTestWorkspace(geo, { x: 300, y: 30 })).toEqual({ kind: 'tab-strip', cellId: 'a1', index: 2, lineX: 171 })
  })

  it('cell body → top quarter / middle half / bottom quarter', () => {
    // a2 body: 388..700 (height 312): top < 466, bottom > 622
    expect(hitTestWorkspace(geo, { x: 200, y: 400 })).toEqual({ kind: 'cell-body', cellId: 'a2', zone: 'top' })
    expect(hitTestWorkspace(geo, { x: 200, y: 540 })).toEqual({ kind: 'cell-body', cellId: 'a2', zone: 'middle' })
    expect(hitTestWorkspace(geo, { x: 200, y: 680 })).toEqual({ kind: 'cell-body', cellId: 'a2', zone: 'bottom' })
  })

  it('the gap between two cells is no target', () => {
    expect(hitTestWorkspace(geo, { x: 200, y: 353 })).toBeNull()
  })

  it('a collapsed cell only offers its tab strip; an empty cell is one target', () => {
    const g: WorkspaceGeometry = {
      area: rect(0, 0, 1006, 706),
      columnArea: rect(0, 6, 1006, 700),
      bands: [],
      columns: [
        { id: 'a', rect: rect(6, 6, 500, 700), cells: [cellGeo('a1', 6, 500, 6, 38, ['t1'], { collapsed: true }), cellGeo('a2', 6, 500, 44, 700, [], { empty: true })] },
        { id: 'b', rect: rect(506, 6, 1000, 700), cells: [cellGeo('b1', 506, 1000, 6, 700, ['t4'])] },
      ],
    }
    expect(hitTestWorkspace(g, { x: 200, y: 30 })).toMatchObject({ kind: 'tab-strip', cellId: 'a1' })
    expect(hitTestWorkspace(g, { x: 200, y: 300 })).toEqual({ kind: 'empty-cell', cellId: 'a2' })
  })
})

describe('dropTargetForHit', () => {
  const geo = geometry()
  const l = layout()

  it('gutters name the column to their right, the last one the last column', () => {
    expect(dropTargetForHit(l, geo, { kind: 'column-edge', gutter: 0, x: 3 }, { type: 'tab', tabId: 't4' })).toEqual({ kind: 'column-edge', columnId: 'a', edge: 'left' })
    expect(dropTargetForHit(l, geo, { kind: 'column-edge', gutter: 1, x: 503 }, { type: 'tab', tabId: 't4' })).toEqual({ kind: 'column-edge', columnId: 'b', edge: 'left' })
    expect(dropTargetForHit(l, geo, { kind: 'column-edge', gutter: 2, x: 1003 }, { type: 'tab', tabId: 't1' })).toEqual({ kind: 'column-edge', columnId: 'b', edge: 'right' })
  })

  it('a position in the own strip counts the other tabs', () => {
    expect(dropTargetForHit(l, geo, { kind: 'tab-strip', cellId: 'a1', index: 2, lineX: 0 }, { type: 'tab', tabId: 't1' })).toEqual({ kind: 'cell', cellId: 'a1', index: 1 })
    expect(dropTargetForHit(l, geo, { kind: 'tab-strip', cellId: 'a1', index: 0, lineX: 0 }, { type: 'tab', tabId: 't2' })).toEqual({ kind: 'cell', cellId: 'a1', index: 0 })
    expect(dropTargetForHit(l, geo, { kind: 'tab-strip', cellId: 'a1', index: 2, lineX: 0 }, { type: 'tab', tabId: 't4' })).toEqual({ kind: 'cell', cellId: 'a1', index: 2 })
  })

  it('with tabs folded into +N, a strip position counts the shown tabs: it maps to the layout tab it lands before (or after the last shown); a gap beside the dragged tab is no move', () => {
    // Layout a1: t1 t2 t5 t6 t7; shown: t1, then the active t7 pulled forward.
    const folded: WorkspaceLayout = { ...l, columns: [col('a', [{ ...cell('a1', ['t1', 't2', 't5', 't6', 't7']), activeTabId: 't7' }, cell('a2', ['t3'])]), col('b', [cell('b1', ['t4'])])] }
    const base = geometry()
    const [a, ...rest] = base.columns
    const g: WorkspaceGeometry = { ...base, columns: [{ ...a!, cells: [cellGeo('a1', 6, 500, 6, 350, ['t1', 't7']), ...a!.cells.slice(1)] }, ...rest] }
    const hit = (index: number) => ({ kind: 'tab-strip' as const, cellId: 'a1', index, lineX: 0 })
    // The gaps either side of t1 (shown t1 | t7, t2 t5 t6 folded between): t1 stays where it is.
    expect(dropTargetForHit(folded, g, hit(0), { type: 'tab', tabId: 't1' })).toEqual({ kind: 'cell', cellId: 'a1', index: 0 })
    expect(dropTargetForHit(folded, g, hit(1), { type: 'tab', tabId: 't1' })).toEqual({ kind: 'cell', cellId: 'a1', index: 0 })
    // After the last shown (t7, layout index 4): t1 goes to the end — index 4 among the others.
    expect(dropTargetForHit(folded, g, hit(2), { type: 'tab', tabId: 't1' })).toEqual({ kind: 'cell', cellId: 'a1', index: 4 })
    // t7 (pulled forward) dropped beside itself: no move.
    expect(dropTargetForHit(folded, g, hit(1), { type: 'tab', tabId: 't7' })).toEqual({ kind: 'cell', cellId: 'a1', index: 4 })
    expect(dropTargetForHit(folded, g, hit(2), { type: 'tab', tabId: 't7' })).toEqual({ kind: 'cell', cellId: 'a1', index: 4 })
    // t7 dropped before t1: the front.
    expect(dropTargetForHit(folded, g, hit(0), { type: 'tab', tabId: 't7' })).toEqual({ kind: 'cell', cellId: 'a1', index: 0 })
    // From another cell: before t7 is index 4; after the last shown, the end.
    expect(dropTargetForHit(folded, g, hit(1), { type: 'tab', tabId: 't4' })).toEqual({ kind: 'cell', cellId: 'a1', index: 4 })
    expect(dropTargetForHit(folded, g, hit(2), { type: 'tab', tabId: 't4' })).toEqual({ kind: 'cell', cellId: 'a1', index: 5 })
    expect(dropTargetForHit(folded, g, hit(0), { type: 'tab', tabId: 't4' })).toEqual({ kind: 'cell', cellId: 'a1', index: 0 })
  })

  it('body zones map to cell edges / joining the cell', () => {
    expect(dropTargetForHit(l, geo, { kind: 'cell-body', cellId: 'a2', zone: 'top' }, { type: 'tab', tabId: 't4' })).toEqual({ kind: 'cell-edge', cellId: 'a2', edge: 'top' })
    expect(dropTargetForHit(l, geo, { kind: 'cell-body', cellId: 'a2', zone: 'bottom' }, { type: 'tab', tabId: 't4' })).toEqual({ kind: 'cell-edge', cellId: 'a2', edge: 'bottom' })
    expect(dropTargetForHit(l, geo, { kind: 'cell-body', cellId: 'a2', zone: 'middle' }, { type: 'tab', tabId: 't4' })).toEqual({ kind: 'cell', cellId: 'a2' })
    expect(dropTargetForHit(l, geo, { kind: 'empty-cell', cellId: 'a2' }, { type: 'tab', tabId: 't4' })).toEqual({ kind: 'cell', cellId: 'a2' })
  })
})

describe('dropChangesLayout', () => {
  const l = layout()

  it('the own cell middle and the own edges of a single-tab cell are no-ops', () => {
    expect(dropChangesLayout(l, { type: 'tab', tabId: 't3' }, { kind: 'cell', cellId: 'a2' })).toBe(false)
    expect(dropChangesLayout(l, { type: 'tab', tabId: 't3' }, { kind: 'cell-edge', cellId: 'a2', edge: 'top' })).toBe(false)
    expect(dropChangesLayout(l, { type: 'tab', tabId: 't4' }, { kind: 'column-edge', columnId: 'b', edge: 'right' })).toBe(false)
  })

  it('real moves change the layout', () => {
    expect(dropChangesLayout(l, { type: 'tab', tabId: 't1' }, { kind: 'cell-edge', cellId: 'a1', edge: 'bottom' })).toBe(true)
    expect(dropChangesLayout(l, { type: 'tab', tabId: 't4' }, { kind: 'cell', cellId: 'a1' })).toBe(true)
    expect(dropChangesLayout(l, { type: 'tab', tabId: 't1' }, { kind: 'column-edge', columnId: 'a', edge: 'left' })).toBe(true)
  })
})

/**
 * `geometry()` with a top band (6..166, header 6..38) over the columns,
 * which then span 172..700: column a = cells a1 172..400, a2 406..700.
 */
function geometryWithTopBand(): WorkspaceGeometry {
  const a: ColumnGeometry = {
    id: 'a',
    rect: rect(6, 172, 500, 700),
    cells: [cellGeo('a1', 6, 500, 172, 400, ['t1', 't2']), cellGeo('a2', 6, 500, 406, 700, ['t3'])],
  }
  const b: ColumnGeometry = { id: 'b', rect: rect(506, 172, 1000, 700), cells: [cellGeo('b1', 506, 1000, 172, 700, ['t4'])] }
  const top = { ...cellGeo('tb', 6, 1000, 6, 166, ['t5']), edge: 'top' as const }
  return { area: rect(0, 0, 1006, 706), columnArea: rect(0, 172, 1006, 700), columns: [a, b], bands: [top] }
}

function layoutWithTopBand(): WorkspaceLayout {
  const l = layout()
  return {
    ...l,
    columns: l.columns.map((c) => ({ ...c })),
    top: { id: 'tb', height: 160, tabs: [createTab('notes', 't5')], activeTabId: 't5' },
  }
}

describe('bands in the hit test', () => {
  it('the top / bottom 24px of the workspace offer a new band while there is none — where no tab strip is', () => {
    const geo = geometry()
    // The workspace's top padding, above the panels.
    expect(hitTestWorkspace(geo, { x: 300, y: 3 })).toEqual({ kind: 'new-band', edge: 'top' })
    expect(hitTestWorkspace(geo, { x: 4, y: 4 })).toEqual({ kind: 'new-band', edge: 'top' })
    // The gap between two columns, near the top.
    expect(hitTestWorkspace(geo, { x: 503, y: 20 })).toEqual({ kind: 'new-band', edge: 'top' })
    // Bodies near the bottom edge are no strips: the bottom band zone.
    expect(hitTestWorkspace(geo, { x: 300, y: 706 - 24 })).toEqual({ kind: 'new-band', edge: 'bottom' })
  })

  it('a tab strip always wins over the band edge', () => {
    const geo = geometry()
    // a1's header spans 6..38: all of it inserts, even its top part.
    expect(hitTestWorkspace(geo, { x: 300, y: 7 })).toMatchObject({ kind: 'tab-strip', cellId: 'a1' })
    expect(hitTestWorkspace(geo, { x: 300, y: 20 })).toMatchObject({ kind: 'tab-strip', cellId: 'a1' })
    expect(hitTestWorkspace(geo, { x: 700, y: 24 })).toMatchObject({ kind: 'tab-strip', cellId: 'b1' })
    // A collapsed last cell's header at the bottom edge: its strip too.
    const g: WorkspaceGeometry = {
      ...geo,
      columns: [geo.columns[0]!, { id: 'b', rect: rect(506, 6, 1000, 700), cells: [cellGeo('b1', 506, 1000, 6, 662, ['t4']), cellGeo('b2', 506, 1000, 668, 700, ['t6'], { collapsed: true })] }],
    }
    expect(hitTestWorkspace(g, { x: 700, y: 690 })).toMatchObject({ kind: 'tab-strip', cellId: 'b2' })
  })

  it('the top band zone reaches 16px above the workspace (over the top bar’s lower edge)', () => {
    const geo = geometry()
    expect(hitTestWorkspace(geo, { x: 300, y: -10 })).toEqual({ kind: 'new-band', edge: 'top' })
    expect(hitTestWorkspace(geo, { x: 300, y: -16 })).toEqual({ kind: 'new-band', edge: 'top' })
    expect(hitTestWorkspace(geo, { x: 300, y: -17 })).toBeNull()
    expect(hitTestWorkspace(geometryWithTopBand(), { x: 300, y: -10 })).toBeNull()
  })

  it('an edge with a band offers that band: its strip, then its body as one zone', () => {
    const geo = geometryWithTopBand()
    expect(hitTestWorkspace(geo, { x: 300, y: 10 })).toMatchObject({ kind: 'tab-strip', cellId: 'tb', index: 1 })
    expect(hitTestWorkspace(geo, { x: 30, y: 30 })).toMatchObject({ kind: 'tab-strip', cellId: 'tb', index: 0 })
    expect(hitTestWorkspace(geo, { x: 300, y: 100 })).toEqual({ kind: 'band-body', edge: 'top' })
    // The bottom edge is still free.
    expect(hitTestWorkspace(geo, { x: 300, y: 700 })).toEqual({ kind: 'new-band', edge: 'bottom' })
  })

  it('column-edge zones span the column area only, not the bands', () => {
    const geo = geometryWithTopBand()
    expect(hitTestWorkspace(geo, { x: 503, y: 100 })).toEqual({ kind: 'band-body', edge: 'top' })
    expect(hitTestWorkspace(geo, { x: 503, y: 300 })).toMatchObject({ kind: 'column-edge', gutter: 1 })
    expect(hitTestWorkspace(geo, { x: 10, y: 100 })).toEqual({ kind: 'band-body', edge: 'top' })
  })

  it('only bands, no columns: the column area is one target (a first column)', () => {
    const geo: WorkspaceGeometry = { ...geometryWithTopBand(), columns: [] }
    expect(hitTestWorkspace(geo, { x: 300, y: 400 })).toEqual({ kind: 'empty-columns' })
  })

  it('scrolled columns: edges come from the visible column area', () => {
    // Column a scrolled 200px out of view on the left.
    const geo = geometry()
    const shifted: WorkspaceGeometry = {
      ...geo,
      columns: geo.columns.map((c) => ({ ...c, rect: { ...c.rect, left: c.rect.left - 200, right: c.rect.right - 200 } })),
    }
    expect(hitTestWorkspace(shifted, { x: 303, y: 400 })).toEqual({ kind: 'column-edge', gutter: 1, x: 303 })
    expect(hitTestWorkspace(shifted, { x: 10, y: 400 })).toMatchObject({ kind: 'column-edge', gutter: 0 })
  })

  it('band hits map to band targets, a strip to the band panel, the empty column area to a new column', () => {
    const l = layoutWithTopBand()
    const geo = geometryWithTopBand()
    const tab = { type: 'tab', tabId: 't1' } as const
    expect(dropTargetForHit(l, geo, { kind: 'new-band', edge: 'bottom' }, tab)).toEqual({ kind: 'new-band', edge: 'bottom' })
    expect(dropTargetForHit(l, geo, { kind: 'band-body', edge: 'top' }, tab)).toEqual({ kind: 'band', edge: 'top' })
    expect(dropTargetForHit(l, geo, { kind: 'tab-strip', cellId: 'tb', index: 1, lineX: 0 }, tab)).toEqual({ kind: 'cell', cellId: 'tb', index: 1 })
    expect(dropTargetForHit(l, geo, { kind: 'empty-columns' }, tab)).toEqual({ kind: 'layout' })
    // A panel drag never adjusts a strip index (its own strip is a no-op).
    expect(dropTargetForHit(l, geo, { kind: 'tab-strip', cellId: 'a1', index: 2, lineX: 0 }, { type: 'panel', panelId: 'a1' })).toEqual({ kind: 'cell', cellId: 'a1', index: 2 })
  })

  it('panel drags: own body, own strip and own band are no-ops; a merge and a new band change the layout', () => {
    const l = layoutWithTopBand()
    const a1 = { type: 'panel', panelId: 'a1' } as const
    expect(dropChangesLayout(l, a1, { kind: 'cell', cellId: 'a1' })).toBe(false)
    expect(dropChangesLayout(l, a1, { kind: 'cell', cellId: 'a1', index: 0 })).toBe(false)
    expect(dropChangesLayout(l, a1, { kind: 'cell-edge', cellId: 'a2', edge: 'top' })).toBe(false)
    expect(dropChangesLayout(l, { type: 'panel', panelId: 'tb' }, { kind: 'band', edge: 'top' })).toBe(false)
    expect(dropChangesLayout(l, { type: 'panel', panelId: 'tb' }, { kind: 'new-band', edge: 'top' })).toBe(false)
    expect(dropChangesLayout(l, a1, { kind: 'cell', cellId: 'b1' })).toBe(true)
    expect(dropChangesLayout(l, a1, { kind: 'new-band', edge: 'bottom' })).toBe(true)
    expect(dropChangesLayout(l, a1, { kind: 'band', edge: 'top' })).toBe(true)
    expect(dropChangesLayout(l, { type: 'tab', tabId: 't5' }, { kind: 'band', edge: 'top' })).toBe(false)
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

describe('sameDropHit', () => {
  it('compares every field of the same kind; other kinds and null differ', () => {
    expect(sameDropHit(null, null)).toBe(true)
    expect(sameDropHit(null, { kind: 'empty-cell', cellId: 'a' })).toBe(false)
    expect(sameDropHit({ kind: 'empty-cell', cellId: 'a' }, { kind: 'empty-cell', cellId: 'a' })).toBe(true)
    expect(sameDropHit({ kind: 'empty-cell', cellId: 'a' }, { kind: 'cell-body', cellId: 'a', zone: 'top' })).toBe(false)
    expect(sameDropHit({ kind: 'cell-body', cellId: 'a', zone: 'top' }, { kind: 'cell-body', cellId: 'a', zone: 'bottom' })).toBe(false)
    expect(sameDropHit({ kind: 'column-edge', gutter: 1, x: 10 }, { kind: 'column-edge', gutter: 1, x: 10 })).toBe(true)
    expect(sameDropHit({ kind: 'column-edge', gutter: 1, x: 10 }, { kind: 'column-edge', gutter: 1, x: 11 })).toBe(false)
    expect(sameDropHit({ kind: 'tab-strip', cellId: 'a', index: 2, lineX: 40 }, { kind: 'tab-strip', cellId: 'a', index: 2, lineX: 40 })).toBe(true)
    expect(sameDropHit({ kind: 'tab-strip', cellId: 'a', index: 2, lineX: 40 }, { kind: 'tab-strip', cellId: 'a', index: 3, lineX: 40 })).toBe(false)
  })
})
