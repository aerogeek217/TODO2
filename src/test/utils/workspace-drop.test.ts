import { describe, it, expect } from 'vitest'
import { createTab, type WorkspaceLayout } from '../../models/workspace-layout'
import {
  bodyZone,
  cellRectIn,
  dropChangesLayout,
  dropGhost,
  dropLabel,
  dropTargetForHit,
  fitRowHeights,
  hitTestWorkspace,
  numberStripHitAt,
  sameDropHit,
  tabBand,
  type CellGeometry,
  type Rect,
  type WorkspaceGeometry,
} from '../../utils/workspace-drop'
import { cell as spec, grid, type CellSpec, freshNumberTab, numberItem, numbersTab } from '../helpers/layout-builders'
import { numberViews } from '../../utils/number-views'
import { pairPercent } from '../../utils/workspace-resize'
import { FIT_TRACK_NOMINAL_PX } from '../../utils/workspace-table'

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

  it('a narrow edge cell keeps the inner half of its side zone for a split: the insert zone takes only the outer half (cr34 W10)', () => {
    // Two 72px Numbers at the layout's sides (one widget each: the card is the body), a wide cell between.
    const card = (id: string, x0: number, x1: number): CellGeometry => ({ id, rect: rect(x0, 6, x1, 76), header: null, body: rect(x0, 6, x1, 76), empty: false, tabs: [] })
    const g: WorkspaceGeometry = { area: rect(0, 0, 1006, 82), cells: [card('n1', 6, 78), card('mid', 84, 922), card('n2', 928, 1000)] }
    // A 72px body's side zone is 14.4px: its outer 7.2px insert a column, its inner 7.2px split it.
    expect(hitTestWorkspace(g, { x: 10, y: 41 })).toEqual({ kind: 'insert', edge: 'left' })
    expect(hitTestWorkspace(g, { x: 16, y: 41 })).toEqual({ kind: 'cell-body', cellId: 'n1', zone: 'left' })
    expect(hitTestWorkspace(g, { x: 22, y: 41 })).toEqual({ kind: 'cell-body', cellId: 'n1', zone: 'middle' })
    expect(hitTestWorkspace(g, { x: 996, y: 41 })).toEqual({ kind: 'insert', edge: 'right' })
    expect(hitTestWorkspace(g, { x: 990, y: 41 })).toEqual({ kind: 'cell-body', cellId: 'n2', zone: 'right' })
    // The padding beside it is the insert zone, as ever.
    expect(hitTestWorkspace(g, { x: 3, y: 41 })).toEqual({ kind: 'insert', edge: 'left' })
    // A body of 180px or more is unchanged: 24px in from the area's edge (18px of the cell).
    const wide: WorkspaceGeometry = { area: rect(0, 0, 1006, 82), cells: [card('w', 6, 186), card('rest', 192, 1000)] }
    expect(hitTestWorkspace(wide, { x: 24, y: 41 })).toEqual({ kind: 'insert', edge: 'left' })
    expect(hitTestWorkspace(wide, { x: 25, y: 41 })).toEqual({ kind: 'cell-body', cellId: 'w', zone: 'left' })
    // Over a strip (no side zones there) the insert zone keeps its 24px.
    const strip: WorkspaceGeometry = { area: rect(0, 0, 1006, 706), cells: [cellGeo('s', 6, 78, 6, 700, ['t1']), cellGeo('rest', 84, 1000, 6, 700, ['t2'])] }
    expect(hitTestWorkspace(strip, { x: 22, y: 20 })).toEqual({ kind: 'insert', edge: 'left' })
    expect(hitTestWorkspace(strip, { x: 16, y: 300 })).toEqual({ kind: 'cell-body', cellId: 's', zone: 'left' })
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

  it('a cell body → its sides (20% each way, at most 120px), or the middle', () => {
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

  it('a cell of one widget has no strip: its body is the whole card, its top a split above', () => {
    const h: CellGeometry = { id: 'n1', rect: rect(6, 6, 500, 76), header: null, body: rect(6, 6, 500, 76), empty: false, tabs: [] }
    const g: WorkspaceGeometry = { area: geo.area, cells: [h] }
    expect(hitTestWorkspace(g, { x: 250, y: 12 })).toEqual({ kind: 'cell-body', cellId: 'n1', zone: 'top' })
    expect(hitTestWorkspace(g, { x: 250, y: 40 })).toEqual({ kind: 'cell-body', cellId: 'n1', zone: 'middle' })
    expect(hitTestWorkspace(g, { x: 250, y: -10 })).toEqual({ kind: 'insert', edge: 'top' })
  })
})

describe('bodyZone', () => {
  const body = rect(0, 0, 500, 300)

  it('the outer 20% on every side splits that way; the rest joins', () => {
    expect(bodyZone(body, { x: 99, y: 150 })).toBe('left')
    expect(bodyZone(body, { x: 101, y: 150 })).toBe('middle')
    expect(bodyZone(body, { x: 401, y: 150 })).toBe('right')
    expect(bodyZone(body, { x: 250, y: 59 })).toBe('top')
    expect(bodyZone(body, { x: 250, y: 61 })).toBe('middle')
    expect(bodyZone(body, { x: 250, y: 241 })).toBe('bottom')
  })

  it('in a corner, the side the pointer is deeper into wins', () => {
    // 10px into a 100px side zone (0.9 deep), 30px into a 60px top zone (0.5 deep).
    expect(bodyZone(body, { x: 10, y: 30 })).toBe('left')
    // 90px into the side zone (0.1 deep), 6px into the top zone (0.9 deep).
    expect(bodyZone(body, { x: 90, y: 6 })).toBe('top')
  })

  it('a big body’s zones stop at 120px', () => {
    const big = rect(0, 0, 2000, 1000)
    expect(bodyZone(big, { x: 119, y: 500 })).toBe('left')
    expect(bodyZone(big, { x: 121, y: 500 })).toBe('middle')
    expect(bodyZone(big, { x: 1000, y: 119 })).toBe('top')
    expect(bodyZone(big, { x: 1000, y: 121 })).toBe('middle')
  })
})

describe('the drop ghost', () => {
  /** The table under `geometry()`: its content from (6, 6), 994 × 694, 6px gaps. */
  const table = { left: 6, top: 6, width: 994, height: 694, gap: 6, rowPx: {} }
  const geo: WorkspaceGeometry = { ...geometry(), cells: geometry().cells.map((c) => ({ ...c, title: c.id === 'b1' ? 'Late' : 'Notes' })), table }

  it('labels a split with the cell’s title and side, an insert with what it makes, a join with Add as tab', () => {
    expect(dropLabel(geo, { kind: 'split', cellId: 'b1', side: 'top' }, 1)).toBe('Split Late · above')
    expect(dropLabel(geo, { kind: 'split', cellId: 'b1', side: 'left' }, 1)).toBe('Split Late · left')
    expect(dropLabel(geo, { kind: 'insert', edge: 'bottom' }, 1)).toBe('Insert row · full width')
    expect(dropLabel(geo, { kind: 'insert', edge: 'right' }, 1)).toBe('Insert column · full height')
    expect(dropLabel(geo, { kind: 'cell', cellId: 'b1' }, 1)).toBe('Add as tab')
    expect(dropLabel(geo, { kind: 'cell', cellId: 'b1' }, 3)).toBe('Add 3 tabs')
  })

  it('places each cell where the view draws it, from the measured table', () => {
    const l = layout()
    for (const c of geometry().cells) {
      const r = cellRectIn(l, c.id, table)!
      expect(r.left).toBeCloseTo(c.rect.left)
      expect(r.right).toBeCloseTo(c.rect.right)
      expect(r.top).toBeCloseTo(c.rect.top)
      expect(r.bottom).toBeCloseTo(c.rect.bottom)
    }
  })

  it('a split above b1: the upper half of its place', () => {
    const ghost = dropGhost(layout(), geo, { type: 'tab', tabId: 't2' }, { kind: 'split', cellId: 'b1', side: 'top' }, ['t2'])!
    expect(ghost.label).toBe('Split Late · above')
    expect(ghost.rect.left).toBeCloseTo(506)
    expect(ghost.rect.right).toBeCloseTo(1000)
    expect(ghost.rect.top).toBeCloseTo(6)
    expect(ghost.rect.bottom).toBeCloseTo(350)
  })

  it('a move that closes its cell: the result as a whole (a2 goes, a1 takes its place, a new column at the right)', () => {
    const ghost = dropGhost(layout(), geo, { type: 'tab', tabId: 't3' }, { kind: 'insert', edge: 'right' }, ['t3'])!
    // Columns 1000 · 500 · 500 share 982px: 491 · 245.5 · 245.5.
    expect(ghost.rect.left).toBeCloseTo(6 + 491 + 6 + 245.5 + 6)
    expect(ghost.rect.right).toBeCloseTo(1000)
    expect(ghost.rect.top).toBeCloseTo(6)
    expect(ghost.rect.bottom).toBeCloseTo(700)
  })

  it('no ghost for a drop that changes nothing; the whole area when no table was measured', () => {
    expect(dropGhost(layout(), geo, { type: 'tab', tabId: 't3' }, { kind: 'cell', cellId: 'a2' }, ['t3'])).toBeNull()
    expect(dropGhost(layout(), { area: geo.area, cells: geo.cells }, { type: 'tab', tabId: 't2' }, { kind: 'cell', cellId: 'b1' }, ['t2'])?.rect).toEqual(geo.area)
  })

  it('a fit row keeps the height it was drawn at', () => {
    const n1 = spec('n1', [freshNumberTab('num1')])
    const n2 = spec('n2', [freshNumberTab('num2')])
    const big = cell('big', ['t9'])
    const fit: WorkspaceLayout = { sortOrder: 0, name: 'L', ...grid([[n1, n2], [big, big]]), createdAt: new Date(0), modifiedAt: new Date(0) }
    const r = cellRectIn(fit, 'big', { ...table, rowPx: { r1: 70 } })!
    expect(r.top).toBeCloseTo(6 + 70 + 6)
    expect(r.bottom).toBeCloseTo(700)
  })

  /** `[n1 n2] / [big big]`: a Numbers row (drawn 58px) over a cell — as the drags see it, each Number a tab (`number-views`). */
  function numbersOverBig(): WorkspaceLayout {
    const n1 = spec('n1', [freshNumberTab('num1')])
    const n2 = spec('n2', [freshNumberTab('num2')])
    return numberViews({ sortOrder: 0, name: 'L', ...grid([[n1, n2], [cell('big', ['t9']), cell('big', ['t9'])]]), createdAt: new Date(0), modifiedAt: new Date(0) })
  }

  it('a split below a fit row’s Number: the new fit row as tall as the row the Number came from, not a nominal height (widget feedback 2D)', () => {
    const l = numbersOverBig()
    const g: WorkspaceGeometry = { ...geo, table: { ...table, rowPx: { r1: 58, r2: 630 } } }
    const ghost = dropGhost(l, g, { type: 'tab', tabId: 'num1' }, { kind: 'split', cellId: 'n2', side: 'bottom' }, ['num1'])!
    expect(ghost.label).toMatch(/below/)
    expect(ghost.rect.top).toBeCloseTo(6 + 58 + 6)
    expect(ghost.rect.bottom - ghost.rect.top).toBeCloseTo(58)
  })

  it('a row a drop leaves holding only Numbers fits them: the other rows take the rest (widget feedback 2D)', () => {
    // [n1 x1] / [big big]: the first row isn't a fit row (x1 is Notes); drawn 344px.
    const n1 = spec('n1', [freshNumberTab('num1')])
    const x1 = cell('x1', ['tx'])
    const big = cell('big', ['t9'])
    const l: WorkspaceLayout = { sortOrder: 0, name: 'L', ...grid([[n1, x1], [big, big]]), createdAt: new Date(0), modifiedAt: new Date(0) }
    const g: WorkspaceGeometry = { ...geo, table: { ...table, rowPx: { r1: 344, r2: 344 } } }
    const ghost = dropGhost(l, g, { type: 'tab', tabId: 'tx' }, { kind: 'split', cellId: 'big', side: 'right' }, ['tx'])!
    // n1 alone is a fit row now: no fit row was drawn, so a Number's nominal height.
    expect(ghost.rect.top).toBeCloseTo(6 + FIT_TRACK_NOMINAL_PX + 6)
    expect(ghost.rect.bottom).toBeCloseTo(700)
  })

  it('fitRowHeights: a kept fit row its drawn height; a new one its cells’ origin row; none for weighted rows', () => {
    const l = numbersOverBig()
    const next: WorkspaceLayout = { ...l, ...grid([[spec('n1', [freshNumberTab('num1')])], [spec('n2', [freshNumberTab('num2')])], [cell('big', ['t9'])]]) }
    // The rows of `next` are r1, r2, r3: r1 was a fit row (kept), r2 is new (num2 came from r1), r3 weighted.
    expect(fitRowHeights(l, next, { r1: 62, r2: 630 })).toEqual({ r1: 62, r2: 62 })
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

describe('pairPercent', () => {
  it('rounds the first share', () => {
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

describe('a strip of Numbers (flair P10)', () => {
  const r = (left: number, top: number, right: number, bottom: number) => ({ left, top, right, bottom })
  // One cell of three Numbers, each slot 300px wide, no header.
  const strip: CellGeometry = {
    id: 'k', rect: r(0, 0, 900, 60), header: null, body: r(0, 0, 900, 60), empty: false, strip: true,
    tabs: [{ id: 'a', rect: r(0, 0, 300, 60) }, { id: 'b', rect: r(300, 0, 600, 60) }, { id: 'c', rect: r(600, 0, 900, 60) }],
  }
  const geo: WorkspaceGeometry = { area: r(-6, -6, 906, 66), cells: [strip] }
  // As the drags see it: each Number a tab of its own (`number-views`).
  const layout = numberViews({
    name: 'L', sortOrder: 0, createdAt: new Date(0), modifiedAt: new Date(0),
    grid: { columns: [{ id: 'c1', weight: 1000 }], rows: [{ id: 'r1', weight: 1000 }] },
    cells: [{ id: 'k', area: { col: 0, row: 0, colSpan: 1, rowSpan: 1 }, tabs: [numbersTab('s', [numberItem('a'), numberItem('b'), numberItem('c')])] }],
  } as WorkspaceLayout)

  it('its middle takes a drop between its slots, its sides still split', () => {
    expect(hitTestWorkspace(geo, { x: 470, y: 30 })).toEqual({ kind: 'tab-strip', cellId: 'k', index: 2, lineX: 599 })
    expect(hitTestWorkspace(geo, { x: 450, y: 2 })).toEqual({ kind: 'cell-body', cellId: 'k', zone: 'top' })
  })

  it('its ends keep room for a drop before the first Number and after the last: only an end slot’s outer quarter splits', () => {
    // A 900px strip's side zones would be 120px, past the first slot's middle (150): its outer quarter (75px) instead.
    expect(hitTestWorkspace(geo, { x: 100, y: 30 })).toEqual({ kind: 'tab-strip', cellId: 'k', index: 0, lineX: -1 })
    expect(hitTestWorkspace(geo, { x: 800, y: 30 })).toEqual({ kind: 'tab-strip', cellId: 'k', index: 3, lineX: 901 })
    expect(hitTestWorkspace(geo, { x: 40, y: 30 })).toEqual({ kind: 'cell-body', cellId: 'k', zone: 'left' })
    expect(hitTestWorkspace(geo, { x: 860, y: 30 })).toEqual({ kind: 'cell-body', cellId: 'k', zone: 'right' })
  })

  it('outside the mode (nothing splits) a point anywhere over it is a drop between its slots, its very edges too', () => {
    expect(numberStripHitAt(geo, { x: 2, y: 30 })).toEqual({ kind: 'tab-strip', cellId: 'k', index: 0, lineX: -1 })
    expect(numberStripHitAt(geo, { x: 898, y: 2 })).toEqual({ kind: 'tab-strip', cellId: 'k', index: 3, lineX: 901 })
    expect(numberStripHitAt(geo, { x: 450, y: 90 })).toBeNull()
    // Dragging the last Number to the start: index 0 among the others.
    const target = dropTargetForHit(layout, geo, numberStripHitAt(geo, { x: 2, y: 30 })!, { type: 'tab', tabId: 'c' })
    expect(target).toEqual({ kind: 'cell', cellId: 'k', index: 0 })
  })

  it('dragging a slot onto another place reorders it; the label says Add to strip', () => {
    const hit = hitTestWorkspace(geo, { x: 650, y: 30 })!
    const target = dropTargetForHit(layout, geo, hit, { type: 'tab', tabId: 'a' })
    // Before c's middle: between b and c — index 1 among the other tabs (b, c).
    expect(target).toEqual({ kind: 'cell', cellId: 'k', index: 1 })
    expect(dropLabel(geo, target!, 1)).toBe('Add to strip')
  })
})

describe('the layout edit mode: a card swaps on a middle, joins on a tab area', () => {
  /** b1 as the mode measures a one-widget card: no header, its whole card the body, its top band its tab area. */
  const oneWidget = (): CellGeometry => ({
    id: 'b1',
    title: 'Late',
    name: 'Late',
    rect: rect(506, 6, 1000, 700),
    header: null,
    body: rect(506, 6, 1000, 700),
    empty: false,
    tabs: [],
    band: tabBand(rect(506, 6, 1000, 700), 32),
  })
  const table = { left: 6, top: 6, width: 994, height: 694, gap: 6, rowPx: {} }
  const geo = (): WorkspaceGeometry => ({ ...geometry(), cells: [...geometry().cells.filter((c) => c.id !== 'b1'), oneWidget()], table })

  it('the tab band is a header’s height, at most 35 % of a short card', () => {
    expect(tabBand(rect(0, 100, 300, 500), 32)).toEqual(rect(0, 100, 300, 132))
    expect(tabBand(rect(0, 100, 300, 160), 32).bottom).toBeCloseTo(121)
  })

  it('the band joins after the tab; below it the top split zone, the middle as before', () => {
    expect(hitTestWorkspace(geo(), { x: 750, y: 20 })).toEqual({ kind: 'tab-strip', cellId: 'b1', index: 1, lineX: 510 })
    expect(hitTestWorkspace(geo(), { x: 750, y: 60 })).toEqual({ kind: 'cell-body', cellId: 'b1', zone: 'top' })
    expect(hitTestWorkspace(geo(), { x: 750, y: 350 })).toEqual({ kind: 'cell-body', cellId: 'b1', zone: 'middle' })
  })

  it('a whole card on a filled card’s middle swaps; a tab or a tray chip joins it; the band joins a card too', () => {
    const l = layout()
    const middle = { kind: 'cell-body' as const, cellId: 'b1', zone: 'middle' as const }
    expect(dropTargetForHit(l, geo(), middle, { type: 'panel', panelId: 'a2' })).toEqual({ kind: 'swap', cellId: 'b1' })
    expect(dropTargetForHit(l, geo(), middle, { type: 'tab', tabId: 't1' })).toEqual({ kind: 'cell', cellId: 'b1' })
    expect(dropTargetForHit(l, geo(), middle, { type: 'new', kind: 'notes' })).toEqual({ kind: 'cell', cellId: 'b1' })
    const band = hitTestWorkspace(geo(), { x: 750, y: 20 })!
    expect(dropTargetForHit(l, geo(), band, { type: 'panel', panelId: 'a2' })).toEqual({ kind: 'cell', cellId: 'b1', index: 1 })
  })

  it('the swap’s ghost is the other card’s place, named by it; the join’s says Add as tab', () => {
    const ghost = dropGhost(layout(), geo(), { type: 'panel', panelId: 'a2' }, { kind: 'swap', cellId: 'b1' }, ['t3'])!
    expect(ghost.label).toBe('Swap with “Late”')
    expect(ghost.rect.left).toBeCloseTo(506)
    expect(ghost.rect.right).toBeCloseTo(1000)
    expect(ghost.rect.top).toBeCloseTo(6)
    expect(ghost.rect.bottom).toBeCloseTo(700)
    expect(dropGhost(layout(), geo(), { type: 'panel', panelId: 'a2' }, { kind: 'cell', cellId: 'b1', index: 1 }, ['t3'])?.label).toBe('Add as tab')
    // A card swapped with itself changes nothing.
    expect(dropGhost(layout(), geo(), { type: 'panel', panelId: 'b1' }, { kind: 'swap', cellId: 'b1' }, ['t4'])).toBeNull()
  })
})

describe('the insert zones follow the frame (the layout edit mode’s room)', () => {
  /** The mode's table: cells start 26px in from the area's top and left, 14px from its right and bottom, 16px apart. */
  function framed(): WorkspaceGeometry {
    return {
      area: rect(0, 0, 1040, 740),
      frame: { left: 26, top: 26, right: 14, bottom: 14 },
      cells: [cellGeo('a1', 26, 510, 26, 360, ['t1', 't2']), cellGeo('b1', 526, 1026, 26, 726, ['t4']), cellGeo('a2', 26, 510, 376, 726, ['t3'])],
    }
  }

  it('reaches over the frame and 18px into the edge cells', () => {
    const geo = framed()
    // The header band is the left edge's zone; 18px past it too.
    expect(hitTestWorkspace(geo, { x: 10, y: 600 })).toEqual({ kind: 'insert', edge: 'left' })
    expect(hitTestWorkspace(geo, { x: 43, y: 600 })).toEqual({ kind: 'insert', edge: 'left' })
    expect(hitTestWorkspace(geo, { x: 46, y: 600 })).toMatchObject({ kind: 'cell-body', zone: 'left' })
    // The right margin is 14px: 32px in from the area's edge.
    expect(hitTestWorkspace(geo, { x: 1040 - 31, y: 600 })).toEqual({ kind: 'insert', edge: 'right' })
    expect(hitTestWorkspace(geo, { x: 1040 - 34, y: 600 })).toMatchObject({ kind: 'cell-body', zone: 'right' })
    // The top band (where the column headers are) inserts a row; a cell's strip under it still takes the tab.
    expect(hitTestWorkspace(geo, { x: 300, y: 12 })).toEqual({ kind: 'insert', edge: 'top' })
    expect(hitTestWorkspace(geo, { x: 300, y: 30 })).toMatchObject({ kind: 'tab-strip', cellId: 'a1' })
    // The 16px gap between cells is no zone of its own.
    expect(hitTestWorkspace(geo, { x: 518, y: 200 })).toBeNull()
  })

  it('outside the mode (no frame measured) the zones are 24px in from the edge, as the 6px gutter and 18px of the cell', () => {
    const geo = geometry()
    expect(hitTestWorkspace(geo, { x: 23, y: 600 })).toEqual({ kind: 'insert', edge: 'left' })
    expect(hitTestWorkspace(geo, { x: 26, y: 600 })).toMatchObject({ kind: 'cell-body' })
  })
})
