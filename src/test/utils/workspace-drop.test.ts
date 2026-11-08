import { describe, it, expect } from 'vitest'
import { createTab, type WorkspaceLayout } from '../../models/workspace-layout'
import {
  dropChangesLayout,
  dropTargetForHit,
  hitTestWorkspace,
  sameDropHit,
  type CellGeometry,
  type Rect,
  type WorkspaceGeometry,
} from '../../utils/workspace-drop'
import { cell as spec, grid, type CellSpec } from '../helpers/layout-builders'
import { evenPair, pairPercent, resizePair } from '../../utils/workspace-resize'

function rect(left: number, top: number, right: number, bottom: number): Rect {
  return { left, top, right, bottom }
}

/** A cell card x0..x1 × y0..y1: a 32px header, `tabs` 80px wide each. */
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
 * Area 0..1006 × 0..706: cells a1 (6..500 × 6..350), a2 (6..500 × 356..700)
 * and b1 (506..1000 × 6..700) — the table `a1 b1 / a2 b1`.
 */
function geometry(): WorkspaceGeometry {
  return {
    area: rect(0, 0, 1006, 706),
    cells: [cellGeo('a1', 6, 500, 6, 350, ['t1', 't2']), cellGeo('b1', 506, 1000, 6, 700, ['t4']), cellGeo('a2', 6, 500, 356, 700, ['t3'])],
  }
}

function cell(id: string, tabIds: string[], activeTabId = tabIds[0]): CellSpec {
  return spec(id, tabIds.map((t) => createTab('notes', t)), activeTabId ? { activeTabId } : {})
}

function layout(a1 = cell('a1', ['t1', 't2'])): WorkspaceLayout {
  const b1 = cell('b1', ['t4'])
  const a2 = cell('a2', ['t3'])
  return { sortOrder: 0, name: 'L', ...grid([[a1, b1], [a2, b1]]), createdAt: new Date(0), modifiedAt: new Date(0) }
}

describe('hitTestWorkspace', () => {
  const geo = geometry()

  it('outside the area → null; a layout with no cells is one target', () => {
    expect(hitTestWorkspace(geo, { x: 2000, y: 300 })).toBeNull()
    expect(hitTestWorkspace({ area: geo.area, cells: [] }, { x: 300, y: 300 })).toEqual({ kind: 'empty-layout' })
  })

  it('within 24px of the left / right edge → insert a column', () => {
    expect(hitTestWorkspace(geo, { x: 10, y: 300 })).toEqual({ kind: 'insert', edge: 'left' })
    expect(hitTestWorkspace(geo, { x: 990, y: 300 })).toEqual({ kind: 'insert', edge: 'right' })
  })

  it('within the top / bottom zone, where no cell is → insert a row (reaching 16px past the edge)', () => {
    expect(hitTestWorkspace(geo, { x: 300, y: 3 })).toEqual({ kind: 'insert', edge: 'top' })
    expect(hitTestWorkspace(geo, { x: 300, y: -10 })).toEqual({ kind: 'insert', edge: 'top' })
    expect(hitTestWorkspace(geo, { x: 300, y: 703 })).toEqual({ kind: 'insert', edge: 'bottom' })
    // Over a cell's strip the strip wins.
    expect(hitTestWorkspace(geo, { x: 50, y: 20 })).toMatchObject({ kind: 'tab-strip', cellId: 'a1' })
  })

  it('over a header → an insert position from the tab midpoints', () => {
    expect(hitTestWorkspace(geo, { x: 40, y: 20 })).toEqual({ kind: 'tab-strip', cellId: 'a1', index: 0, lineX: 9 })
    expect(hitTestWorkspace(geo, { x: 60, y: 20 })).toEqual({ kind: 'tab-strip', cellId: 'a1', index: 1, lineX: 89 })
    expect(hitTestWorkspace(geo, { x: 300, y: 20 })).toEqual({ kind: 'tab-strip', cellId: 'a1', index: 2, lineX: 171 })
  })

  it('a cell body → its sides (20%, at most 120px), top / bottom quarter, or the middle', () => {
    expect(hitTestWorkspace(geo, { x: 60, y: 200 })).toEqual({ kind: 'cell-body', cellId: 'a1', zone: 'left' })
    expect(hitTestWorkspace(geo, { x: 450, y: 200 })).toEqual({ kind: 'cell-body', cellId: 'a1', zone: 'right' })
    expect(hitTestWorkspace(geo, { x: 250, y: 40 })).toEqual({ kind: 'cell-body', cellId: 'a1', zone: 'top' })
    expect(hitTestWorkspace(geo, { x: 250, y: 340 })).toEqual({ kind: 'cell-body', cellId: 'a1', zone: 'bottom' })
    expect(hitTestWorkspace(geo, { x: 250, y: 200 })).toEqual({ kind: 'cell-body', cellId: 'a1', zone: 'middle' })
    // b1 is 494 wide: 98.8px sides.
    expect(hitTestWorkspace(geo, { x: 600, y: 400 })).toEqual({ kind: 'cell-body', cellId: 'b1', zone: 'left' })
    expect(hitTestWorkspace(geo, { x: 610, y: 400 })).toEqual({ kind: 'cell-body', cellId: 'b1', zone: 'middle' })
  })

  it('the gap between cells is no target; a collapsed cell offers only its strip; an empty cell is one target', () => {
    expect(hitTestWorkspace(geo, { x: 503, y: 300 })).toBeNull()
    const g: WorkspaceGeometry = { area: geo.area, cells: [cellGeo('a1', 6, 500, 6, 38, ['t1'], { collapsed: true }), cellGeo('e', 6, 500, 44, 700, [], { empty: true })] }
    expect(hitTestWorkspace(g, { x: 300, y: 20 })).toMatchObject({ kind: 'tab-strip', cellId: 'a1' })
    expect(hitTestWorkspace(g, { x: 300, y: 300 })).toEqual({ kind: 'empty-cell', cellId: 'e' })
  })

  it('a headless cell’s strip, measured out of view, is no target: its body is the whole card', () => {
    const h: CellGeometry = { id: 'n1', rect: rect(6, 6, 500, 76), header: rect(6, -18, 500, 6), headless: true, body: rect(6, 6, 500, 76), empty: false, tabs: [{ id: 'num', rect: rect(10, -16, 90, 6) }] }
    const g: WorkspaceGeometry = { area: geo.area, cells: [h] }
    expect(hitTestWorkspace(g, { x: 250, y: 12 })).toEqual({ kind: 'cell-body', cellId: 'n1', zone: 'top' })
    expect(hitTestWorkspace(g, { x: 250, y: -10 })).toEqual({ kind: 'insert', edge: 'top' })
  })
})

describe('dropTargetForHit', () => {
  const l = layout()
  const geo = geometry()

  it('maps inserts, body zones and empty targets', () => {
    expect(dropTargetForHit(l, geo, { kind: 'insert', edge: 'left' }, { type: 'tab', tabId: 't1' })).toEqual({ kind: 'insert', edge: 'left' })
    expect(dropTargetForHit(l, geo, { kind: 'cell-body', cellId: 'b1', zone: 'top' }, { type: 'tab', tabId: 't1' })).toEqual({ kind: 'split', cellId: 'b1', side: 'top' })
    expect(dropTargetForHit(l, geo, { kind: 'cell-body', cellId: 'b1', zone: 'middle' }, { type: 'tab', tabId: 't1' })).toEqual({ kind: 'cell', cellId: 'b1' })
    expect(dropTargetForHit(l, geo, { kind: 'empty-cell', cellId: 'e' }, { type: 'tab', tabId: 't1' })).toEqual({ kind: 'cell', cellId: 'e' })
    expect(dropTargetForHit(l, geo, { kind: 'empty-layout' }, { type: 'tab', tabId: 't1' })).toEqual({ kind: 'layout' })
  })

  it('a position in the own strip counts the other tabs', () => {
    expect(dropTargetForHit(l, geo, { kind: 'tab-strip', cellId: 'a1', index: 2, lineX: 0 }, { type: 'tab', tabId: 't1' })).toEqual({ kind: 'cell', cellId: 'a1', index: 1 })
    expect(dropTargetForHit(l, geo, { kind: 'tab-strip', cellId: 'a1', index: 0, lineX: 0 }, { type: 'tab', tabId: 't2' })).toEqual({ kind: 'cell', cellId: 'a1', index: 0 })
    expect(dropTargetForHit(l, geo, { kind: 'tab-strip', cellId: 'a1', index: 2, lineX: 0 }, { type: 'tab', tabId: 't4' })).toEqual({ kind: 'cell', cellId: 'a1', index: 2 })
  })

  it('with tabs folded into +N, a strip position counts the shown tabs; a gap beside the dragged tab is no move', () => {
    // Layout a1: t1 t2 t5 t6 t7; shown: t1, then the active t7 pulled forward.
    const folded = layout(cell('a1', ['t1', 't2', 't5', 't6', 't7'], 't7'))
    const g: WorkspaceGeometry = { ...geo, cells: geo.cells.map((c) => (c.id === 'a1' ? cellGeo('a1', 6, 500, 6, 350, ['t1', 't7']) : c)) }
    const hit = (index: number) => ({ kind: 'tab-strip' as const, cellId: 'a1', index, lineX: 0 })
    expect(dropTargetForHit(folded, g, hit(0), { type: 'tab', tabId: 't1' })).toEqual({ kind: 'cell', cellId: 'a1', index: 0 })
    expect(dropTargetForHit(folded, g, hit(1), { type: 'tab', tabId: 't1' })).toEqual({ kind: 'cell', cellId: 'a1', index: 0 })
    expect(dropTargetForHit(folded, g, hit(2), { type: 'tab', tabId: 't1' })).toEqual({ kind: 'cell', cellId: 'a1', index: 4 })
    expect(dropTargetForHit(folded, g, hit(1), { type: 'tab', tabId: 't7' })).toEqual({ kind: 'cell', cellId: 'a1', index: 4 })
    expect(dropTargetForHit(folded, g, hit(0), { type: 'tab', tabId: 't7' })).toEqual({ kind: 'cell', cellId: 'a1', index: 0 })
    expect(dropTargetForHit(folded, g, hit(1), { type: 'tab', tabId: 't4' })).toEqual({ kind: 'cell', cellId: 'a1', index: 4 })
    expect(dropTargetForHit(folded, g, hit(2), { type: 'tab', tabId: 't4' })).toEqual({ kind: 'cell', cellId: 'a1', index: 5 })
  })
})

describe('dropChangesLayout', () => {
  const l = layout()

  it('the own cell middle, the own sides of a single-tab cell, and a drop back in place are no-ops', () => {
    expect(dropChangesLayout(l, { type: 'tab', tabId: 't3' }, { kind: 'cell', cellId: 'a2' })).toBe(false)
    expect(dropChangesLayout(l, { type: 'tab', tabId: 't3' }, { kind: 'split', cellId: 'a2', side: 'left' })).toBe(false)
    // a2 is a1's whole lower neighbour: moved below a1 it lands where it was.
    expect(dropChangesLayout(l, { type: 'tab', tabId: 't3' }, { kind: 'split', cellId: 'a1', side: 'bottom' })).toBe(false)
    expect(dropChangesLayout(l, { type: 'panel', panelId: 'b1' }, { kind: 'insert', edge: 'right' })).toBe(false)
    expect(dropChangesLayout(l, { type: 'panel', panelId: 'a1' }, { kind: 'cell', cellId: 'a1' })).toBe(false)
  })

  it('real moves change the layout', () => {
    expect(dropChangesLayout(l, { type: 'tab', tabId: 't1' }, { kind: 'split', cellId: 'a1', side: 'left' })).toBe(true)
    expect(dropChangesLayout(l, { type: 'tab', tabId: 't3' }, { kind: 'split', cellId: 'b1', side: 'bottom' })).toBe(true)
    expect(dropChangesLayout(l, { type: 'panel', panelId: 'b1' }, { kind: 'insert', edge: 'top' })).toBe(true)
    expect(dropChangesLayout(l, { type: 'panel', panelId: 'a2' }, { kind: 'cell', cellId: 'b1' })).toBe(true)
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

  it('each neighbour keeps its own minimum (`minB`); both scale down when the pair can’t hold them', () => {
    const r = resizePair({ sizeA: 200, sizeB: 200, weightA: 1, weightB: 1, delta: -180, min: 64, minB: 112 })
    expect(r.sizeA).toBe(64)
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
    const body = { kind: 'cell-body', cellId: 'a' } as const
    expect(sameDropHit({ kind: 'empty-cell', cellId: 'a' }, { ...body, zone: 'top' })).toBe(false)
    expect(sameDropHit({ ...body, zone: 'top' }, { ...body, zone: 'bottom' })).toBe(false)
    expect(sameDropHit({ ...body, zone: 'left' }, { ...body, zone: 'left' })).toBe(true)
    expect(sameDropHit({ kind: 'insert', edge: 'top' }, { kind: 'insert', edge: 'top' })).toBe(true)
    expect(sameDropHit({ kind: 'insert', edge: 'top' }, { kind: 'insert', edge: 'left' })).toBe(false)
    expect(sameDropHit({ kind: 'empty-layout' }, { kind: 'empty-layout' })).toBe(true)
    expect(sameDropHit({ kind: 'tab-strip', cellId: 'a', index: 2, lineX: 40 }, { kind: 'tab-strip', cellId: 'a', index: 2, lineX: 40 })).toBe(true)
    expect(sameDropHit({ kind: 'tab-strip', cellId: 'a', index: 2, lineX: 40 }, { kind: 'tab-strip', cellId: 'a', index: 3, lineX: 40 })).toBe(false)
  })
})
