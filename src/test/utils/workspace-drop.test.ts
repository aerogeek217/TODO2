import { describe, it, expect } from 'vitest'
import { createTab, type LayoutCell, type LayoutColumn, type WorkspaceLayout } from '../../models/workspace-layout'
import {
  columnEdgeXs,
  dropChangesLayout,
  dropTargetForHit,
  hitTestWorkspace,
  sameDropHit,
  type CellGeometry,
  type BandGeometry,
  type ColumnGeometry,
  type Rect,
  type RowGeometry,
  type WorkspaceGeometry,
} from '../../utils/workspace-drop'
import { rowOf } from '../helpers/layout-builders'
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

/** A column of one-cell rows (each row `<cell>-r`, its box the cell's). */
function colGeo(id: string, r: Rect, cells: CellGeometry[]): ColumnGeometry {
  return { id, rect: r, rows: cells.map((c): RowGeometry => ({ id: `${c.id}-r`, rect: c.rect, cells: [c] })) }
}

/** The cells of a column's rows. */
function cellsOf(c: ColumnGeometry): CellGeometry[] {
  return c.rows.flatMap((r) => r.cells)
}

/**
 * Area 0..1006 × 0..706 with 6px padding and gaps: column a = 6..500 (cells
 * a1 6..350, a2 356..700), column b = 506..1000 (cell b1 6..700).
 */
function geometry(): WorkspaceGeometry {
  const a = colGeo('a', rect(6, 6, 500, 700), [cellGeo('a1', 6, 500, 6, 350, ['t1', 't2']), cellGeo('a2', 6, 500, 356, 700, ['t3'])])
  const b = colGeo('b', rect(506, 6, 1000, 700), [cellGeo('b1', 506, 1000, 6, 700, ['t4'])])
  return { area: rect(0, 0, 1006, 706), columnArea: rect(0, 6, 1006, 700), columns: [a, b], bands: [] }
}

function cell(id: string, tabIds: string[]): LayoutCell {
  const tabs = tabIds.map((t) => createTab('notes', t))
  return { id, weight: 1, tabs, ...(tabs[0] ? { activeTabId: tabs[0].id } : {}) }
}

/** A column of one-cell rows. */
function col(id: string, cells: LayoutCell[]): LayoutColumn {
  return { id, weight: 1, rows: cells.map((c) => rowOf(c)) }
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

  it('cell body → top quarter / middle half / bottom quarter, between the side zones', () => {
    // a2 body: 388..700 (height 312): top < 466, bottom > 622
    const a2 = { kind: 'cell-body', cellId: 'a2', rowId: 'a2-r', multi: false } as const
    expect(hitTestWorkspace(geo, { x: 200, y: 400 })).toEqual({ ...a2, zone: 'top' })
    expect(hitTestWorkspace(geo, { x: 200, y: 540 })).toEqual({ ...a2, zone: 'middle' })
    expect(hitTestWorkspace(geo, { x: 200, y: 680 })).toEqual({ ...a2, zone: 'bottom' })
  })

  it('cell body → the outer 20% left / right, full height, beside the cell', () => {
    // a2 body: 6..500 (width 494): sides 98.8px → left < 104.8, right > 401.2
    const a2 = { kind: 'cell-body', cellId: 'a2', rowId: 'a2-r', multi: false } as const
    expect(hitTestWorkspace(geo, { x: 104, y: 540 })).toEqual({ ...a2, zone: 'left' })
    expect(hitTestWorkspace(geo, { x: 104, y: 392 })).toEqual({ ...a2, zone: 'left' })
    expect(hitTestWorkspace(geo, { x: 106, y: 540 })).toEqual({ ...a2, zone: 'middle' })
    expect(hitTestWorkspace(geo, { x: 402, y: 600 })).toEqual({ ...a2, zone: 'right' })
    expect(hitTestWorkspace(geo, { x: 400, y: 540 })).toEqual({ ...a2, zone: 'middle' })
  })

  it('a wide cell’s side zones stop at 120px', () => {
    const g: WorkspaceGeometry = {
      area: rect(0, 0, 2006, 706),
      columnArea: rect(0, 6, 2006, 700),
      bands: [],
      columns: [colGeo('w', rect(6, 6, 2000, 700), [cellGeo('w1', 6, 2000, 6, 700, ['t1'])])],
    }
    expect(hitTestWorkspace(g, { x: 6 + 119, y: 400 })).toMatchObject({ zone: 'left' })
    expect(hitTestWorkspace(g, { x: 6 + 121, y: 400 })).toMatchObject({ zone: 'middle' })
    expect(hitTestWorkspace(g, { x: 2000 - 119, y: 400 })).toMatchObject({ zone: 'right' })
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
        colGeo('a', rect(6, 6, 500, 700), [cellGeo('a1', 6, 500, 6, 38, ['t1'], { collapsed: true }), cellGeo('a2', 6, 500, 44, 700, [], { empty: true })]),
        colGeo('b', rect(506, 6, 1000, 700), [cellGeo('b1', 506, 1000, 6, 700, ['t4'])]),
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
    const g: WorkspaceGeometry = { ...base, columns: [colGeo('a', a!.rect, [cellGeo('a1', 6, 500, 6, 350, ['t1', 't7']), ...cellsOf(a!).slice(1)]), ...rest] }
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
    const a2 = { kind: 'cell-body', cellId: 'a2', rowId: 'a2-r', multi: false } as const
    const t4 = { type: 'tab', tabId: 't4' } as const
    expect(dropTargetForHit(l, geo, { ...a2, zone: 'top' }, t4)).toEqual({ kind: 'cell-edge', cellId: 'a2', edge: 'top' })
    expect(dropTargetForHit(l, geo, { ...a2, zone: 'bottom' }, t4)).toEqual({ kind: 'cell-edge', cellId: 'a2', edge: 'bottom' })
    expect(dropTargetForHit(l, geo, { ...a2, zone: 'left' }, t4)).toEqual({ kind: 'cell-edge', cellId: 'a2', edge: 'left' })
    expect(dropTargetForHit(l, geo, { ...a2, zone: 'right' }, t4)).toEqual({ kind: 'cell-edge', cellId: 'a2', edge: 'right' })
    expect(dropTargetForHit(l, geo, { ...a2, zone: 'middle' }, t4)).toEqual({ kind: 'cell', cellId: 'a2' })
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
  const a = colGeo('a', rect(6, 172, 500, 700), [cellGeo('a1', 6, 500, 172, 400, ['t1', 't2']), cellGeo('a2', 6, 500, 406, 700, ['t3'])])
  const b = colGeo('b', rect(506, 172, 1000, 700), [cellGeo('b1', 506, 1000, 172, 700, ['t4'])])
  const top: BandGeometry = { id: 'top', edge: 'top', rect: rect(6, 6, 1000, 166), cells: [cellGeo('tb', 6, 1000, 6, 166, ['t5'])] }
  return { area: rect(0, 0, 1006, 706), columnArea: rect(0, 172, 1006, 700), columns: [a, b], bands: [top] }
}

function layoutWithTopBand(): WorkspaceLayout {
  const l = layout()
  return {
    ...l,
    columns: l.columns.map((c) => ({ ...c })),
    top: { id: 'top', height: 160, cells: [{ id: 'tb', weight: 1, tabs: [createTab('notes', 't5')], activeTabId: 't5' }] },
  }
}

describe('bands in the hit test', () => {
  it('the top / bottom 24px of the workspace offer a new band while there is none — where no cell is', () => {
    const geo = geometry()
    // The workspace's top padding, above the panels.
    expect(hitTestWorkspace(geo, { x: 300, y: 3 })).toEqual({ kind: 'new-band', edge: 'top' })
    expect(hitTestWorkspace(geo, { x: 4, y: 4 })).toEqual({ kind: 'new-band', edge: 'top' })
    // The gap between two columns, near the top.
    expect(hitTestWorkspace(geo, { x: 503, y: 20 })).toEqual({ kind: 'new-band', edge: 'top' })
    // The bottom padding, below the panels; and a little past the bottom edge.
    expect(hitTestWorkspace(geo, { x: 300, y: 703 })).toEqual({ kind: 'new-band', edge: 'bottom' })
    expect(hitTestWorkspace(geo, { x: 300, y: 706 + 16 })).toEqual({ kind: 'new-band', edge: 'bottom' })
    expect(hitTestWorkspace(geo, { x: 300, y: 706 + 17 })).toBeNull()
  })

  it('a body near the bottom edge keeps its bottom zone: a new row below, not a band (cr33 M9)', () => {
    const geo = geometry()
    // a2's body 388..700: its bottom quarter is > 622, the old band zone 682..706.
    for (const y of [682, 690, 699]) {
      expect(hitTestWorkspace(geo, { x: 300, y })).toEqual({ kind: 'cell-body', cellId: 'a2', rowId: 'a2-r', multi: false, zone: 'bottom' })
    }
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
      columns: [geo.columns[0]!, colGeo('b', rect(506, 6, 1000, 700), [cellGeo('b1', 506, 1000, 6, 662, ['t4']), cellGeo('b2', 506, 1000, 668, 700, ['t6'], { collapsed: true })])],
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
    expect(hitTestWorkspace(geo, { x: 300, y: 100 })).toEqual({ kind: 'band-body', edge: 'top', cellId: 'tb', zone: 'middle' })
    // The bottom edge is still free (its padding, below the cells).
    expect(hitTestWorkspace(geo, { x: 300, y: 703 })).toEqual({ kind: 'new-band', edge: 'bottom' })
  })

  it('column-edge zones span the column area only, not the bands', () => {
    const geo = geometryWithTopBand()
    expect(hitTestWorkspace(geo, { x: 503, y: 100 })).toEqual({ kind: 'band-body', edge: 'top', cellId: 'tb', zone: 'middle' })
    expect(hitTestWorkspace(geo, { x: 503, y: 300 })).toMatchObject({ kind: 'column-edge', gutter: 1 })
    expect(hitTestWorkspace(geo, { x: 10, y: 100 })).toEqual({ kind: 'band-body', edge: 'top', cellId: 'tb', zone: 'left' })
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

  it('band hits map to their cell, a strip to the band cell, the empty column area to a new column', () => {
    const l = layoutWithTopBand()
    const geo = geometryWithTopBand()
    const tab = { type: 'tab', tabId: 't1' } as const
    expect(dropTargetForHit(l, geo, { kind: 'new-band', edge: 'bottom' }, tab)).toEqual({ kind: 'new-band', edge: 'bottom' })
    expect(dropTargetForHit(l, geo, { kind: 'band-body', edge: 'top', cellId: 'tb', zone: 'middle' }, tab)).toEqual({ kind: 'cell', cellId: 'tb' })
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

/**
 * Column a = a row `r1` of two cells side by side (c1 6..250, c2 256..500;
 * 6..350) over a2's row (356..700); column b as in `geometry()`; a top band
 * `top` of two cells (tb1 6..500, tb2 506..1000; 6..166) when `withBand`.
 */
function multiGeometry(withBand = false): WorkspaceGeometry {
  const y0 = withBand ? 172 : 6
  const c1 = cellGeo('c1', 6, 250, y0, 350, ['t1'])
  const c2 = cellGeo('c2', 256, 500, y0, 350, ['t2'])
  const a: ColumnGeometry = {
    id: 'a',
    rect: rect(6, y0, 500, 700),
    rows: [{ id: 'r1', rect: rect(6, y0, 500, 350), cells: [c1, c2] }, { id: 'a2-r', rect: rect(6, 356, 500, 700), cells: [cellGeo('a2', 6, 500, 356, 700, ['t3'])] }],
  }
  const b = colGeo('b', rect(506, y0, 1000, 700), [cellGeo('b1', 506, 1000, y0, 700, ['t4'])])
  const bands: BandGeometry[] = withBand
    ? [{ id: 'top', edge: 'top', rect: rect(6, 6, 1000, 166), cells: [cellGeo('tb1', 6, 500, 6, 166, ['t5']), cellGeo('tb2', 506, 1000, 6, 166, ['t6'])] }]
    : []
  return { area: rect(0, 0, 1006, 706), columnArea: rect(0, y0, 1006, 700), columns: [a, b], bands }
}

function multiLayout(): WorkspaceLayout {
  return {
    sortOrder: 0, name: 'L',
    columns: [
      { id: 'a', weight: 1, rows: [{ id: 'r1', weight: 1, cells: [cell('c1', ['t1']), cell('c2', ['t2'])] }, rowOf(cell('a2', ['t3']))] },
      col('b', [cell('b1', ['t4'])]),
    ],
    top: { id: 'top', height: 160, cells: [cell('tb1', ['t5']), cell('tb2', ['t6'])] },
    createdAt: new Date(0),
    modifiedAt: new Date(0),
  }
}

describe('rows of several cells in the hit test', () => {
  const geo = multiGeometry()
  const c1 = { kind: 'cell-body', cellId: 'c1', rowId: 'r1', multi: true } as const
  const c2 = { kind: 'cell-body', cellId: 'c2', rowId: 'r1', multi: true } as const

  it('each cell of the row has its own zones: sides, then top / middle / bottom', () => {
    // c1 body 6..250 × 38..350 (244 wide: sides 48.8px; 312 tall: top < 116, bottom > 272)
    expect(hitTestWorkspace(geo, { x: 54, y: 200 })).toEqual({ ...c1, zone: 'left' })
    expect(hitTestWorkspace(geo, { x: 202, y: 200 })).toEqual({ ...c1, zone: 'right' })
    expect(hitTestWorkspace(geo, { x: 128, y: 60 })).toEqual({ ...c1, zone: 'top' })
    expect(hitTestWorkspace(geo, { x: 128, y: 200 })).toEqual({ ...c1, zone: 'middle' })
    expect(hitTestWorkspace(geo, { x: 128, y: 330 })).toEqual({ ...c1, zone: 'bottom' })
    // c2 body 256..500
    expect(hitTestWorkspace(geo, { x: 300, y: 200 })).toEqual({ ...c2, zone: 'left' })
    expect(hitTestWorkspace(geo, { x: 378, y: 200 })).toEqual({ ...c2, zone: 'middle' })
  })

  it('a strip of a cell in the row inserts into that cell', () => {
    expect(hitTestWorkspace(geo, { x: 300, y: 20 })).toMatchObject({ kind: 'tab-strip', cellId: 'c2' })
  })

  it('the divider between the row’s cells is no target', () => {
    expect(hitTestWorkspace(geo, { x: 253, y: 200 })).toBeNull()
  })

  it('a one-cell row under it keeps its own zones, named as that cell', () => {
    expect(hitTestWorkspace(geo, { x: 250, y: 400 })).toEqual({ kind: 'cell-body', cellId: 'a2', rowId: 'a2-r', multi: false, zone: 'top' })
  })

  it('top / bottom of a multi-cell row name the row; sides a new cell beside', () => {
    const l = multiLayout()
    const t4 = { type: 'tab', tabId: 't4' } as const
    expect(dropTargetForHit(l, geo, { ...c1, zone: 'top' }, t4)).toEqual({ kind: 'row-edge', rowId: 'r1', edge: 'top' })
    expect(dropTargetForHit(l, geo, { ...c2, zone: 'bottom' }, t4)).toEqual({ kind: 'row-edge', rowId: 'r1', edge: 'bottom' })
    expect(dropTargetForHit(l, geo, { ...c1, zone: 'right' }, t4)).toEqual({ kind: 'cell-edge', cellId: 'c1', edge: 'right' })
    expect(dropTargetForHit(l, geo, { ...c2, zone: 'left' }, t4)).toEqual({ kind: 'cell-edge', cellId: 'c2', edge: 'left' })
    expect(dropTargetForHit(l, geo, { ...c2, zone: 'middle' }, t4)).toEqual({ kind: 'cell', cellId: 'c2' })
  })

  it('panel drags: beside its own neighbour is no move; a row above, or another row’s side, is', () => {
    const l = multiLayout()
    const p1 = { type: 'panel', panelId: 'c1' } as const
    // c2's left edge is the gutter c1 already sits at.
    expect(dropChangesLayout(l, p1, { kind: 'cell-edge', cellId: 'c2', edge: 'left' })).toBe(false)
    expect(dropChangesLayout(l, p1, { kind: 'cell-edge', cellId: 'c2', edge: 'right' })).toBe(true)
    expect(dropChangesLayout(l, p1, { kind: 'row-edge', rowId: 'r1', edge: 'top' })).toBe(true)
    expect(dropChangesLayout(l, p1, { kind: 'cell-edge', cellId: 'a2', edge: 'right' })).toBe(true)
    expect(dropChangesLayout(l, { type: 'panel', panelId: 'a2' }, { kind: 'cell-edge', cellId: 'c2', edge: 'right' })).toBe(true)
  })
})

describe('a band of several cells in the hit test', () => {
  const geo = multiGeometry(true)

  it('one band geometry holds its cells; each cell’s body is left / middle / right', () => {
    expect(geo.bands).toHaveLength(1)
    // tb1 body 6..500 × 38..166: sides 98.8px
    expect(hitTestWorkspace(geo, { x: 100, y: 100 })).toEqual({ kind: 'band-body', edge: 'top', cellId: 'tb1', zone: 'left' })
    expect(hitTestWorkspace(geo, { x: 250, y: 50 })).toEqual({ kind: 'band-body', edge: 'top', cellId: 'tb1', zone: 'middle' })
    expect(hitTestWorkspace(geo, { x: 250, y: 160 })).toEqual({ kind: 'band-body', edge: 'top', cellId: 'tb1', zone: 'middle' })
    expect(hitTestWorkspace(geo, { x: 450, y: 100 })).toEqual({ kind: 'band-body', edge: 'top', cellId: 'tb1', zone: 'right' })
    expect(hitTestWorkspace(geo, { x: 600, y: 100 })).toEqual({ kind: 'band-body', edge: 'top', cellId: 'tb2', zone: 'left' })
    expect(hitTestWorkspace(geo, { x: 800, y: 100 })).toEqual({ kind: 'band-body', edge: 'top', cellId: 'tb2', zone: 'middle' })
  })

  it('the second cell’s strip is its own; the gap between the cells is no target', () => {
    expect(hitTestWorkspace(geo, { x: 530, y: 20 })).toEqual({ kind: 'tab-strip', cellId: 'tb2', index: 0, lineX: 509 })
    expect(hitTestWorkspace(geo, { x: 503, y: 100 })).toBeNull()
  })

  it('an empty band cell is one target', () => {
    const g: WorkspaceGeometry = { ...geo, bands: [{ ...geo.bands[0]!, cells: [cellGeo('tb1', 6, 500, 6, 166, ['t5']), cellGeo('tb2', 506, 1000, 6, 166, [], { empty: true })] }] }
    expect(hitTestWorkspace(g, { x: 800, y: 100 })).toEqual({ kind: 'empty-cell', cellId: 'tb2' })
  })

  it('a band’s sides make a new cell beside, in the band; its middle joins the cell', () => {
    const l = multiLayout()
    const t1 = { type: 'tab', tabId: 't1' } as const
    expect(dropTargetForHit(l, geo, { kind: 'band-body', edge: 'top', cellId: 'tb2', zone: 'right' }, t1)).toEqual({ kind: 'cell-edge', cellId: 'tb2', edge: 'right' })
    expect(dropTargetForHit(l, geo, { kind: 'band-body', edge: 'top', cellId: 'tb1', zone: 'left' }, t1)).toEqual({ kind: 'cell-edge', cellId: 'tb1', edge: 'left' })
    expect(dropTargetForHit(l, geo, { kind: 'band-body', edge: 'top', cellId: 'tb2', zone: 'middle' }, t1)).toEqual({ kind: 'cell', cellId: 'tb2' })
    expect(dropChangesLayout(l, t1, { kind: 'cell-edge', cellId: 'tb2', edge: 'right' })).toBe(true)
    expect(dropChangesLayout(l, { type: 'panel', panelId: 'tb1' }, { kind: 'cell-edge', cellId: 'tb2', edge: 'left' })).toBe(false)
  })
})

describe('a headless cell (no header measured)', () => {
  it('its body — the whole card — takes the zones, its top quarter included', () => {
    const base = geometry()
    const h: CellGeometry = { id: 'b1', rect: rect(506, 6, 1000, 700), header: null, body: rect(506, 6, 1000, 700), empty: false, tabs: [] }
    const g: WorkspaceGeometry = { ...base, columns: [base.columns[0]!, colGeo('b', rect(506, 6, 1000, 700), [h])] }
    expect(hitTestWorkspace(g, { x: 750, y: 30 })).toMatchObject({ kind: 'cell-body', cellId: 'b1', zone: 'top' })
    expect(hitTestWorkspace(g, { x: 750, y: 300 })).toMatchObject({ kind: 'cell-body', cellId: 'b1', zone: 'middle' })
  })

  /**
   * Column a's first row a fit row of one headless Number (6..76, its strip
   * measured out of view above it, -18..6), then a2 (82..700); column b as in
   * `geometry()`.
   */
  function headlessFirstRow(): WorkspaceGeometry {
    const base = geometry()
    const n: CellGeometry = { id: 'n1', rect: rect(6, 6, 500, 76), header: rect(6, -18, 500, 6), headless: true, body: rect(6, 6, 500, 76), empty: false, tabs: [{ id: 'num', rect: rect(10, -16, 90, 6) }] }
    const a: ColumnGeometry = { id: 'a', rect: rect(6, 6, 500, 700), rows: [{ id: 'n1-r', rect: n.rect, cells: [n] }, { id: 'a2-r', rect: rect(6, 82, 500, 700), cells: [cellGeo('a2', 6, 500, 82, 700, ['t3'])] }] }
    return { ...base, columns: [a, base.columns[1]!] }
  }

  it('a headless cell’s strip, measured out of view, is no target: the point above it is the band zone (`headless`)', () => {
    const g = headlessFirstRow()
    expect(hitTestWorkspace(g, { x: 50, y: 0 })).toEqual({ kind: 'new-band', edge: 'top' })
    expect(hitTestWorkspace(g, { x: 50, y: -10 })).toEqual({ kind: 'new-band', edge: 'top' })
  })

  it('a headless first-row cell keeps its whole top quarter: New row above, not a band (cr33 M9)', () => {
    const g = headlessFirstRow()
    // n1's body 6..76: its top quarter is < 23.5 — all of it inside the old band zone (..24).
    for (const y of [6, 12, 18, 23]) {
      expect(hitTestWorkspace(g, { x: 250, y })).toEqual({ kind: 'cell-body', cellId: 'n1', rowId: 'n1-r', multi: false, zone: 'top' })
    }
    expect(hitTestWorkspace(g, { x: 250, y: 3 })).toEqual({ kind: 'new-band', edge: 'top' })
    expect(dropTargetForHit(layout(), g, { kind: 'cell-body', cellId: 'n1', rowId: 'n1-r', multi: false, zone: 'top' }, { type: 'tab', tabId: 't4' })).toEqual({ kind: 'cell-edge', cellId: 'n1', edge: 'top' })
  })

  it('a headed cell’s strip still wins where it is measured', () => {
    const g = headlessFirstRow()
    const shown: WorkspaceGeometry = { ...g, columns: [{ ...g.columns[0]!, rows: g.columns[0]!.rows.map((r) => ({ ...r, cells: r.cells.map((c) => (c.id === 'n1' ? { ...c, headless: false, header: rect(6, 6, 500, 30), tabs: [{ id: 'num', rect: rect(10, 8, 90, 30) }] } : c)) })) }, g.columns[1]!] }
    expect(hitTestWorkspace(shown, { x: 50, y: 20 })).toMatchObject({ kind: 'tab-strip', cellId: 'n1' })
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

  it('each neighbour keeps its own minimum (`minB`); both scale down when the pair can’t hold them', () => {
    // A 64px glance row above a 112px row: the glance row may shrink to 64.
    const r = resizePair({ sizeA: 200, sizeB: 200, weightA: 1, weightB: 1, delta: -180, min: 64, minB: 112 })
    expect(r.sizeA).toBe(64)
    const s = resizePair({ sizeA: 200, sizeB: 200, weightA: 1, weightB: 1, delta: 180, min: 64, minB: 112 })
    expect(s.sizeB).toBe(112)
    // 100px can't hold 64 + 112: the floors are their shares of it.
    const t = resizePair({ sizeA: 50, sizeB: 50, weightA: 1, weightB: 1, delta: -40, min: 64, minB: 112 })
    expect(t.sizeA).toBeCloseTo(100 * 64 / 176)
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
    const body = { kind: 'cell-body', cellId: 'a', rowId: 'r', multi: false } as const
    expect(sameDropHit({ kind: 'empty-cell', cellId: 'a' }, { ...body, zone: 'top' })).toBe(false)
    expect(sameDropHit({ ...body, zone: 'top' }, { ...body, zone: 'bottom' })).toBe(false)
    expect(sameDropHit({ ...body, zone: 'top' }, { ...body, multi: true, zone: 'top' })).toBe(false)
    expect(sameDropHit({ ...body, zone: 'left' }, { ...body, zone: 'left' })).toBe(true)
    const bandBody = { kind: 'band-body', edge: 'top', cellId: 'a' } as const
    expect(sameDropHit({ ...bandBody, zone: 'left' }, { ...bandBody, zone: 'middle' })).toBe(false)
    expect(sameDropHit({ kind: 'column-edge', gutter: 1, x: 10 }, { kind: 'column-edge', gutter: 1, x: 10 })).toBe(true)
    expect(sameDropHit({ kind: 'column-edge', gutter: 1, x: 10 }, { kind: 'column-edge', gutter: 1, x: 11 })).toBe(false)
    expect(sameDropHit({ kind: 'tab-strip', cellId: 'a', index: 2, lineX: 40 }, { kind: 'tab-strip', cellId: 'a', index: 2, lineX: 40 })).toBe(true)
    expect(sameDropHit({ kind: 'tab-strip', cellId: 'a', index: 2, lineX: 40 }, { kind: 'tab-strip', cellId: 'a', index: 3, lineX: 40 })).toBe(false)
  })
})
