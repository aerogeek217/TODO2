import { describe, it, expect } from 'vitest'
import { createTab, type LayoutBody, type LayoutTab, type WorkspaceLayout } from '../../models/workspace-layout'
import { edgeBetween, edgeStretches, isNormalized, lineCrossings, validateTiling, wholeLine, type Side } from '../../utils/workspace-grid'
import { findTab, getTab, layoutIds, layoutStructureEqual, layoutStructureKey, panelOfTab } from '../../utils/workspace-layout-queries'
import { countListTabs } from '../../utils/workspace-layout-lists'
import { copySizes, setTrackSizes, trackAxes, withoutTrackFitPx } from '../../utils/workspace-layout-sizes'
import { rowDrawsFitFaces, trackSizing } from '../../utils/workspace-table'
import {
  addTab,
  closeCell,
  closeTab,
  edgeSnap,
  edgeSnapLine,
  evenStretchDelta,
  insertTrack,
  isCellCollapsed,
  mergeCells,
  moveEdge,
  movePanel,
  moveTab,
  patchTabConfig,
  patchTabViewState,
  replaceTab,
  setActiveTab,
  setTrackCollapsed,
  splitCell,
  type LayoutDropTarget,
} from '../../utils/workspace-layout-ops'
import { cell as spec, emptyBody, grid, picture, type CellSpec } from '../helpers/layout-builders'

/** A cell of notes tabs (`<id>-t` unless named), its first tab active. */
function cell(id: string, tabIds: string[] = [`${id}-t`]): CellSpec {
  const tabs = tabIds.map((t) => createTab('notes', t))
  return spec(id, tabs, tabs[0] ? { activeTabId: tabs[0].id } : {})
}

function layout(body: LayoutBody): WorkspaceLayout {
  return { sortOrder: 0, name: 'L', ...body, createdAt: new Date(0), modifiedAt: new Date(0) }
}

/** Ids `n1`, `n2`, … */
function ids(prefix = 'n') {
  let n = 0
  return () => `${prefix}${++n}`
}

/** Holds the table's invariants: an exact tiling in normal form, unique ids. */
function expectValid(body: LayoutBody): void {
  expect(validateTiling(body)).toBe(true)
  expect(isNormalized(body)).toBe(true)
  const all = [
    ...body.grid.columns.map((t) => t.id),
    ...body.grid.rows.map((t) => t.id),
    ...body.cells.flatMap((c) => [c.id, ...c.tabs.map((t) => t.id)]),
  ]
  expect(new Set(all).size).toBe(all.length)
}

const tabIdsOf = (body: LayoutBody, cellId: string) => body.cells.find((c) => c.id === cellId)?.tabs.map((t) => t.id)

describe('splitCell', () => {
  it('splits a one-track cell on each side: its track halves, the cells crossing it span both halves', () => {
    const a = cell('a')
    const b = cell('b')
    const base = layout(grid([[a], [b]], { cols: [1000], rows: [600, 400] }))
    const right = splitCell(base, 'a', 'right', ids())
    expect(picture(right.layout)).toEqual(['a n2', 'b b'])
    expect(right.cellId).toBe('n2')
    expect(right.layout.grid.columns.map((t) => t.weight)).toEqual([500, 500])
    expectValid(right.layout)

    const left = splitCell(base, 'a', 'left', ids())
    expect(picture(left.layout)).toEqual(['n2 a', 'b b'])

    const below = splitCell(base, 'b', 'bottom', ids())
    expect(picture(below.layout)).toEqual(['a', 'b', 'n2'])
    expect(below.layout.grid.rows.map((t) => t.weight)).toEqual([600, 200, 200])

    const above = splitCell(base, 'b', 'top', ids())
    expect(picture(above.layout)).toEqual(['a', 'n2', 'b'])
    expectValid(above.layout)
  })

  it('a cell spanning an even number of tracks splits on its middle line; an odd number splits its middle track', () => {
    const a = cell('a')
    const b = cell('b')
    const c = cell('c')
    const even = layout(grid([[a, a], [b, c]]))
    expect(picture(splitCell(even, 'a', 'right', ids()).layout)).toEqual(['a n1', 'b c'])
    const odd = layout(grid([[a, a, a], [b, c, c]]))
    const out = splitCell(odd, 'a', 'right', ids())
    // The middle track (1) splits in two: `a` keeps 1.5 tracks, the new cell the other 1.5; the line
    // between the second half and the last track is no cell's edge any more, so they merge.
    expect(picture(out.layout)).toEqual(['a a n2', 'b c c'])
    expect(out.layout.grid.columns.map((t) => t.weight)).toEqual([1000, 500, 1500])
    expectValid(out.layout)
  })

  it('a fixed track splits into two fixed halves; an unknown cell changes nothing', () => {
    const a = cell('a')
    const base = layout(grid([[a]], { rows: [{ px: 160 }] }))
    const out = splitCell(base, 'a', 'bottom', ids())
    expect(out.layout.grid.rows.map((t) => t.px)).toEqual([80, 80])
    expect(splitCell(base, 'zz', 'right', ids())).toEqual({ layout: base, cellId: null })
  })

  it('the new cell never comes out collapsed: a collapsed cell split below or above keeps its own collapse', () => {
    const a = cell('a')
    const b = cell('b')
    const base = layout(grid([[a, b]], { rows: [{ weight: 1000, collapsed: true }] }))
    const below = splitCell(base, 'a', 'bottom', ids())
    expect(picture(below.layout)).toEqual(['a b', 'n2 b'])
    expect(isCellCollapsed(below.layout, 'n2')).toBe(false)
    expect(isCellCollapsed(below.layout, 'a')).toBe(true)
    expectValid(below.layout)
    const above = splitCell(base, 'a', 'top', ids())
    expect(picture(above.layout)).toEqual(['n2 b', 'a b'])
    expect(isCellCollapsed(above.layout, 'n2')).toBe(false)
    expect(isCellCollapsed(above.layout, 'a')).toBe(true)
    // Two collapsed tracks: the split lands on the middle line, the new cell's track expands.
    const two = layout(grid([[a], [a]], { rows: [{ weight: 1000, collapsed: true }, { weight: 1000, collapsed: true }] }))
    const evenOut = splitCell(two, 'a', 'bottom', ids())
    expect(isCellCollapsed(evenOut.layout, 'n1')).toBe(false)
    expect(isCellCollapsed(evenOut.layout, 'a')).toBe(true)
    // Beside it, in the same collapsed row: the row expands (collapse is the row's).
    const right = splitCell(base, 'a', 'right', ids())
    expect(isCellCollapsed(right.layout, 'n2')).toBe(false)
  })
})

describe('insertTrack', () => {
  const a = cell('a')
  const b = cell('b')

  it('adds a full-width row or full-height column at the layout edge, taking half of the nearest weighted track', () => {
    const base = layout(grid([[a, b]], { cols: [600, 400] }))
    const right = insertTrack(base, 'right', ids())
    expect(picture(right.layout)).toEqual(['a b n2'])
    expect(right.layout.grid.columns.map((t) => t.weight)).toEqual([600, 200, 200])
    const top = insertTrack(base, 'top', ids())
    expect(picture(top.layout)).toEqual(['n2 n2', 'a b'])
    expect(top.layout.grid.rows.map((t) => t.weight)).toEqual([500, 500])
    expectValid(top.layout)
  })

  it('skips fixed tracks for the weight it takes', () => {
    const base = layout(grid([[a], [b]], { rows: [800, { px: 160 }] }))
    const out = insertTrack(base, 'bottom', ids())
    expect(out.layout.grid.rows).toEqual([{ id: 'r1', weight: 400 }, { id: 'r2', px: 160 }, { id: 'n1', weight: 400 }])
  })

  it('a new column across collapsed rows expands them: its cell never comes out collapsed', () => {
    const base = layout(grid([[a, b]], { rows: [{ weight: 1000, collapsed: true }] }))
    const out = insertTrack(base, 'right', ids())
    expect(isCellCollapsed(out.layout, out.cellId)).toBe(false)
    expect(isCellCollapsed(insertTrack(base, 'bottom', ids()).layout, 'a')).toBe(true)
  })

  it('an empty layout gets its first cell', () => {
    const out = insertTrack(layout(emptyBody()), 'left', ids())
    expect(picture(out.layout)).toEqual(['n1'])
    expectValid(out.layout)
  })
})

describe('mergeCells', () => {
  it('merges two cells making a rectangle; the tabs join, the first cell’s active tab stays', () => {
    const a = cell('a', ['t1', 't2'])
    const b = cell('b', ['t3'])
    const c = cell('c')
    const base = layout(grid([[a, b], [c, c]]))
    const out = mergeCells(base, 'a', 'b')
    expect(picture(out)).toEqual(['a', 'c'])
    expect(tabIdsOf(out, 'a')).toEqual(['t1', 't2', 't3'])
    expect(out.cells.find((x) => x.id === 'a')?.activeTabId).toBe('t1')
    expect(out.grid.columns).toEqual([{ id: 'c1', weight: 2000 }])
    expectValid(out)
  })

  it('refuses anything but a rectangle', () => {
    const a = cell('a')
    const b = cell('b')
    const c = cell('c')
    const base = layout(grid([[a, a], [b, c]]))
    expect(mergeCells(base, 'a', 'b')).toBe(base)
    expect(mergeCells(base, 'a', 'a')).toBe(base)
    expect(mergeCells(base, 'a', 'zz')).toBe(base)
  })
})

describe('closeCell (the absorb rule)', () => {
  it('gives its space to a neighbour sharing the whole edge: left first, then above, right, below', () => {
    const a = cell('a')
    const b = cell('b')
    const c = cell('c')
    const d = cell('d')
    // a b
    // c d
    const base = layout(grid([[a, b], [c, d]]))
    expect(picture(closeCell(base, 'd'))).toEqual(['a b', 'c c'])
    expect(picture(closeCell(base, 'a'))).toEqual(['b b', 'c d'])
    expect(picture(closeCell(base, 'b'))).toEqual(['a a', 'c d'])
    // b shares no whole edge on its left (a is taller), none above or right: c, below, takes it — and the row line goes.
    const tall = layout(grid([[a, b], [a, c]]))
    expect(picture(closeCell(tall, 'b'))).toEqual(['a c'])
  })

  it('with no taker the cell stays as an empty cell; closing that again changes nothing', () => {
    const a = cell('a')
    const b = cell('b')
    const c = cell('c')
    const d = cell('d')
    // a a b      Closing `e`: no neighbour shares a whole edge.
    // c e b
    // c d d
    const e = cell('e')
    const base = layout(grid([[a, a, b], [c, e, b], [c, d, d]]))
    const out = closeCell(base, 'e')
    expect(out.cells.find((x) => x.id === 'e')).toEqual({ id: 'e', area: { col: 1, row: 1, colSpan: 1, rowSpan: 1 }, tabs: [] })
    expect(closeCell(out, 'e')).toBe(out)
    // The lone cell of a layout stays as an empty cell.
    const lone = layout(grid([[a]]))
    expect(closeCell(lone, 'a').cells).toEqual([{ id: 'a', area: { col: 0, row: 0, colSpan: 1, rowSpan: 1 }, tabs: [] }])
  })

  it('with no single whole-edge neighbour, the neighbours along a side that cover its whole edge together grow across it', () => {
    const a = cell('a')
    const b = cell('b')
    const c = cell('c')
    const d = cell('d')
    // a b      Closing `b`: a and c together cover its left edge (each part of it).
    // c b
    const tall = layout(grid([[a, b], [c, b]]))
    expect(picture(closeCell(tall, 'b'))).toEqual(['a', 'c'])
    // a b      Closing `a`: no whole-edge neighbour; on its right b and d together cover it.
    // a d
    const left = layout(grid([[a, b], [a, d]]))
    expect(picture(closeCell(left, 'a'))).toEqual(['b', 'd'])
    // x a b    Closing `e`: on its left x sticks out past it (taller), and f below is wider;
    // x e e    above, a and b together cover its top edge: both grow down (the row line goes).
    // f f f
    const x = cell('x')
    const e = cell('e')
    const f = cell('f')
    const out = closeCell(layout(grid([[x, a, b], [x, e, e], [f, f, f]])), 'e')
    expect(picture(out)).toEqual(['x a b', 'f f f'])
    expectValid(out)
    // A single whole-edge neighbour still comes first: closing `e`, h below takes it alone
    //   c d d     (above, c and d wouldn't: d sticks out past e's right end).
    //   e e g
    //   h h g
    const g = cell('g')
    const h = cell('h')
    const out2 = closeCell(layout(grid([[c, d, d], [e, e, g], [h, h, g]])), 'e')
    expect(picture(out2)).toEqual(['c d d', 'h h g'])
  })

  it('a merge drops the line no cell edge lies on any more, adding the weights', () => {
    const a = cell('a')
    const b = cell('b')
    const base = layout(grid([[a, b]], { cols: [300, 700] }))
    const out = closeCell(base, 'b')
    expect(out.grid.columns).toEqual([{ id: 'c1', weight: 1000 }])
    expectValid(out)
  })
})

describe('closeTab / extractTab', () => {
  it('closing the active tab activates the left neighbour, then the right; the last tab closes the cell', () => {
    const a = cell('a', ['t1', 't2', 't3'])
    const b = cell('b')
    const base = layout(grid([[a, b]]))
    const one = closeTab(setActiveTab(base, 't2'), 't2')
    expect(one.cells[0]?.activeTabId).toBe('t1')
    expect(closeTab(base, 't1').cells[0]?.activeTabId).toBe('t2')
    expect(picture(closeTab(base, 'b-t'))).toEqual(['a'])
  })
})

describe('moveTab', () => {
  const a = cell('a', ['t1', 't2'])
  const b = cell('b', ['t3'])
  const base = layout(grid([[a, b]]))

  it('reorders within its own cell by an index among the other tabs; no index is a no-op', () => {
    expect(tabIdsOf(moveTab(base, 't1', { kind: 'cell', cellId: 'a', index: 1 }, ids()), 'a')).toEqual(['t2', 't1'])
    expect(moveTab(base, 't1', { kind: 'cell', cellId: 'a' }, ids())).toBe(base)
    expect(moveTab(base, 't1', { kind: 'cell', cellId: 'a', index: 0 }, ids())).toBe(base)
  })

  it('joins another cell and becomes its active tab; the source re-picks its active tab', () => {
    const out = moveTab(base, 't1', { kind: 'cell', cellId: 'b' }, ids())
    expect(tabIdsOf(out, 'b')).toEqual(['t3', 't1'])
    expect(out.cells.find((c) => c.id === 'b')?.activeTabId).toBe('t1')
    expect(out.cells.find((c) => c.id === 'a')?.activeTabId).toBe('t2')
  })

  it('moving a cell’s only tab closes the cell by the absorb rule', () => {
    const out = moveTab(base, 't3', { kind: 'cell', cellId: 'a' }, ids())
    expect(picture(out)).toEqual(['a'])
    expectValid(out)
  })

  it('split and insert targets make a new cell for it', () => {
    const split = moveTab(base, 't2', { kind: 'split', cellId: 'b', side: 'bottom' }, ids())
    expect(picture(split)).toEqual(['a b', 'a n2'])
    expect(tabIdsOf(split, 'n2')).toEqual(['t2'])
    const inserted = moveTab(base, 't2', { kind: 'insert', edge: 'top' }, ids())
    expect(picture(inserted)).toEqual(['n2 n2', 'a b'])
    expectValid(inserted)
  })

  it('no-ops: its only tab onto its own side, or onto a place that puts it back where it was', () => {
    expect(moveTab(base, 't3', { kind: 'split', cellId: 'b', side: 'left' }, ids())).toBe(base)
    // b's only tab to a's right: b closes (a takes its place), a splits right → b's arrangement again.
    expect(moveTab(base, 't3', { kind: 'split', cellId: 'a', side: 'right' }, ids())).toBe(base)
    expect(moveTab(base, 't3', { kind: 'insert', edge: 'right' }, ids())).toBe(base)
    // Elsewhere it moves.
    expect(picture(moveTab(base, 't3', { kind: 'split', cellId: 'a', side: 'left' }, ids()))).toEqual(['n2 a'])
  })

  it('unknown tab or target → same layout', () => {
    expect(moveTab(base, 'zz', { kind: 'cell', cellId: 'b' }, ids())).toBe(base)
    expect(moveTab(base, 't1', { kind: 'cell', cellId: 'zz' }, ids())).toBe(base)
    expect(moveTab(base, 't1', { kind: 'split', cellId: 'zz', side: 'left' }, ids())).toBe(base)
  })
})

describe('movePanel', () => {
  const a = cell('a', ['t1', 't2'])
  const b = cell('b', ['t3'])
  const c = cell('c', ['t4'])

  it('merges its tabs into another cell, the first moved tab active; its place closes', () => {
    const base = layout(grid([[a, b], [c, c]]))
    const out = movePanel(base, 'a', { kind: 'cell', cellId: 'c' }, ids())
    expect(picture(out)).toEqual(['b', 'c'])
    expect(tabIdsOf(out, 'c')).toEqual(['t4', 't1', 't2'])
    expect(out.cells.find((x) => x.id === 'c')?.activeTabId).toBe('t1')
  })

  it('a split or insert makes a new cell keeping its active tab', () => {
    const base = layout(grid([[setActiveTab(layout(grid([[a]])), 't2').cells[0]!, b]]))
    const out = movePanel(base, 'a', { kind: 'insert', edge: 'bottom' }, ids())
    expect(picture(out)).toEqual(['b', 'n2'])
    expect(out.cells.find((x) => x.id === 'n2')?.activeTabId).toBe('t2')
    expectValid(out)
  })

  it('no-ops: onto itself, back where it is, an empty cell', () => {
    const base = layout(grid([[a, b]]))
    expect(movePanel(base, 'a', { kind: 'cell', cellId: 'a' }, ids())).toBe(base)
    expect(movePanel(base, 'a', { kind: 'split', cellId: 'a', side: 'top' }, ids())).toBe(base)
    expect(movePanel(base, 'b', { kind: 'split', cellId: 'a', side: 'right' }, ids())).toBe(base)
    const empty = closeCell(layout(grid([[a]])), 'a')
    expect(movePanel(empty, 'a', { kind: 'insert', edge: 'top' }, ids())).toBe(empty)
  })
})

describe('addTab', () => {
  it('joins a cell, splits one, inserts a track, or starts an empty layout', () => {
    const a = cell('a')
    const base = layout(grid([[a]]))
    const tab = createTab('notes', 'x')
    expect(tabIdsOf(addTab(base, tab, { kind: 'cell', cellId: 'a', index: 0 }, ids()), 'a')).toEqual(['x', 'a-t'])
    expect(picture(addTab(base, tab, { kind: 'split', cellId: 'a', side: 'right' }, ids()))).toEqual(['a n2'])
    expect(picture(addTab(layout(emptyBody()), tab, { kind: 'layout' }, ids()))).toEqual(['n1'])
    expect(addTab(base, createTab('notes', 'a-t'), { kind: 'cell', cellId: 'a' }, ids())).toBe(base)
  })
})

describe('moveEdge', () => {
  const a = cell('a')
  const b = cell('b')
  const c = cell('c')
  const d = cell('d')

  it('a whole line between its neighbouring lines reweights the two tracks (view state)', () => {
    const base = layout(grid([[a, b], [c, d]], { cols: [500, 500] }))
    const stretch = wholeLine(base, 'columns', 1)
    const out = moveEdge(base, stretch, 100, { sizes: [400, 400] }, ids())
    expect(out.grid.columns.map((t) => t.weight)).toEqual([625, 375])
    expect(layoutStructureEqual(out, base)).toBe(true)
  })

  it('a stretch holding every edge on its line reweights too, though cells cross the line elsewhere', () => {
    // a b
    // c c — a|b is the only edge on its line
    const parted = layout(grid([[a, b], [c, c]], { cols: [500, 500] }))
    const stretch = edgeBetween(parted, 'a', 'b')!
    expect(stretch).toEqual({ axis: 'columns', line: 1, from: 0, to: 1 })
    const out = moveEdge(parted, stretch, 200, { sizes: [400, 400] }, ids())
    expect(picture(out)).toEqual(['a b', 'c c'])
    expect(out.grid.columns.map((t) => t.weight)).toEqual([750, 250])
    expect(layoutStructureEqual(out, parted)).toBe(true)
  })

  it('part of a line splits the line: a new track, the cells crossing it gain a span', () => {
    // a b
    // c d — moving a|b right by 200 of 400 + 400 px leaves c|d where it is
    const base = layout(grid([[a, b], [c, d]], { cols: [500, 500] }))
    const stretch = { ...edgeBetween(base, 'a', 'b')!, to: 1 }
    const out = moveEdge(base, stretch, 200, { sizes: [400, 400] }, ids())
    expect(picture(out)).toEqual(['a a b', 'c d d'])
    expect(out.grid.columns.map((t) => t.weight)).toEqual([500, 250, 250])
    expect(layoutStructureEqual(out, base)).toBe(false)
    expectValid(out)
  })

  it('snaps onto another line within 8px; a part line snaps back onto its own line (no change)', () => {
    // a a b
    // c d d — moving a|b (cols 2) left by 195 of 3 × 200px snaps onto line 1 (c|d)
    const base = layout(grid([[a, a, b], [c, d, d]]))
    const stretch = edgeBetween(base, 'a', 'b')!
    const out = moveEdge(base, stretch, -195, { sizes: [200, 200, 200], minPx: () => 50 }, ids())
    expect(picture(out)).toEqual(['a b', 'c d'])
    expectValid(out)
    // A small move of a line holding only this stretch's edges is a reweight.
    const nudged = moveEdge(base, stretch, 5, { sizes: [200, 200, 200], minPx: () => 50 }, ids())
    expect(layoutStructureEqual(nudged, base)).toBe(true)
    expect(nudged.grid.columns.map((t) => t.weight)).toEqual([1000, 1025, 975])
    // A part line among other edges snaps back onto itself: no change.
    const e = cell('e')
    // a b b
    // c e e — line 1 holds a|b and c|e: a|b alone is part of it.
    const shared = layout(grid([[a, b, b], [c, e, e]]))
    const part = { ...edgeBetween(shared, 'a', 'b')!, to: 1 }
    expect(moveEdge(shared, part, 5, { sizes: [200, 200, 200], minPx: () => 50 }, ids())).toBe(shared)
  })

  it('keeps every cell on either side at its minimum', () => {
    const base = layout(grid([[a, b]]))
    const stretch = edgeBetween(base, 'a', 'b')!
    const out = moveEdge(base, stretch, 1000, { sizes: [400, 400] }, ids())
    // b keeps its 120px: a is 680 of 800.
    expect(out.grid.columns.map((t) => Math.round(t.weight ?? 0))).toEqual([1700, 300])
  })

  it('a fixed track keeps px; a bad stretch or no move changes nothing', () => {
    const base = layout(grid([[a], [b]], { rows: [1000, { px: 200 }] }))
    const stretch = edgeBetween(base, 'a', 'b')!
    const out = moveEdge(base, stretch, -50, { sizes: [500, 200], minPx: () => 64 }, ids())
    expect(out.grid.rows).toEqual([{ id: 'r1', weight: 1000 }, { id: 'r2', px: 250 }])
    expect(moveEdge(base, stretch, 0, { sizes: [500, 200] }, ids())).toBe(base)
    expect(moveEdge(base, { axis: 'rows', line: 5, from: 0, to: 1 }, 10, { sizes: [500, 200] }, ids())).toBe(base)
    expect(moveEdge(base, stretch, 10, { sizes: [500] }, ids())).toBe(base)
  })
})

describe('snapping and the "+" (D26 follow-ups, board BE)', () => {
  const a = cell('a')
  const b = cell('b')
  const c = cell('c')
  const d = cell('d')
  const minPx = () => 40
  // a c
  // a d   — the left column's line at 300px (b below a), the right's at 400px
  // b d
  const staggered = layout({
    ...grid([[a, c], [a, d], [b, d]], { cols: [500, 500], rows: [300, 100, 400] }),
  })
  const rowSizes = [300, 100, 400]

  it('a piece snaps onto a line only other cells lie on (another column\'s), within 8px, and re-joins it', () => {
    // c | d sits on row line 1 (300px); a | b on row line 2 (400px). Drag c | d down by 95px: within 8 of 400.
    const piece = edgeBetween(staggered, 'c', 'd')!
    expect(piece).toEqual({ axis: 'rows', line: 1, from: 1, to: 2 })
    expect(edgeSnap(staggered, piece, 95, { sizes: rowSizes, minPx })).toBe(2)
    expect(edgeSnapLine(staggered, piece, 95, { sizes: rowSizes, minPx })).toBe(2)
    const out = moveEdge(staggered, piece, 95, { sizes: rowSizes, minPx }, ids())
    // One row line again, through both columns: the two pieces meet at a "+".
    expect(picture(out)).toEqual(['a c', 'b d'])
    expect(lineCrossings(out)).toEqual([{ col: 1, row: 1 }])
    expectValid(out)
  })

  it('out of reach it doesn\'t snap: the piece makes a new line where it stops', () => {
    const piece = edgeBetween(staggered, 'c', 'd')!
    expect(edgeSnap(staggered, piece, 60, { sizes: rowSizes, minPx })).toBeNull()
    expect(edgeSnapLine(staggered, piece, 60, { sizes: rowSizes, minPx })).toBeNull()
    expect(moveEdge(staggered, piece, 60, { sizes: rowSizes, minPx }, ids()).grid.rows).toHaveLength(3)
  })

  it('part of a line snaps back onto its own line (no change); the guide only once it has moved', () => {
    const Q = layout(grid([[a, b], [c, d]]))
    const piece = edgeBetween(Q, 'a', 'c')!
    expect(piece).toEqual({ axis: 'rows', line: 1, from: 0, to: 1 })
    expect(moveEdge(Q, piece, 5, { sizes: [400, 400], minPx }, ids())).toBe(Q)
    expect(edgeSnapLine(Q, piece, 5, { sizes: [400, 400], minPx })).toBe(1)
    expect(edgeSnapLine(Q, piece, 0, { sizes: [400, 400], minPx })).toBeNull()
  })

  it('the crossing\'s lines move whole and snap home: a few px off stays put, a real move reweights', () => {
    const Q = layout(grid([[a, b], [c, d]], { cols: [500, 500], rows: [500, 500] }))
    const opts = { sizes: [400, 400], minPx, snapHome: true }
    const upright = wholeLine(Q, 'columns', 1)
    expect(moveEdge(Q, upright, 6, opts, ids())).toBe(Q)
    expect(edgeSnap(Q, upright, 6, opts)).toBe(1)
    const moved = moveEdge(Q, upright, 100, opts, ids())
    expect(moved.grid.columns.map((t) => t.weight)).toEqual([625, 375])
    expect(layoutStructureEqual(moved, Q)).toBe(true)
    // Without snapHome a whole line moves by any amount.
    expect(moveEdge(Q, upright, 6, { sizes: [400, 400], minPx }, ids()).grid.columns.map((t) => t.weight)).toEqual([507.5, 492.5])
  })
})

describe('a Numbers-only (fit) row\'s divider', () => {
  const n1 = spec('n1', [createTab('number', 'num1')])
  const n2 = spec('n2', [createTab('number', 'num2')])
  const l = cell('l')
  // n1 n2
  // l  l
  const body = layout(grid([[n1, n2], [l, l]], { rows: [1000, 1000] }))
  const sized = () => moveEdge(body, wholeLine(body, 'rows', 1), 40, { sizes: [76, 600] }, ids())

  it('dragging its line gives the fit row a height of its own (`fitPx`, view state), its weight kept, no px', () => {
    const out = sized()
    expect(out.grid.rows[0]).toEqual({ id: 'r1', weight: 1000, fitPx: 116 })
    expect(out.grid.rows[1]).toEqual({ id: 'r2', weight: 1000 })
    expect(layoutStructureEqual(out, body)).toBe(true)
    expect(trackSizing(out, 'rows', 0)).toEqual({ kind: 'fixed', px: 116 })
    expect(trackSizing(body, 'rows', 0)).toEqual({ kind: 'fit' })
    // Again from there: from its height, not the drawn size.
    const again = moveEdge(out, wholeLine(out, 'rows', 1), -20, { sizes: [116, 560] }, ids())
    expect(again.grid.rows[0]).toEqual({ id: 'r1', weight: 1000, fitPx: 96 })
  })

  it('clearing its height lets it fit again', () => {
    const cleared = withoutTrackFitPx(sized(), 'r1')
    expect(cleared.grid.rows[0]).toEqual({ id: 'r1', weight: 1000 })
    expect(trackSizing(cleared, 'rows', 0)).toEqual({ kind: 'fit' })
    expect(withoutTrackFitPx(cleared, 'r1')).toBe(cleared)
  })

  it('a split’s halves don’t inherit it: two weighted halves, never two tiny fixed rows', () => {
    const { layout: split } = splitCell(sized(), 'n1', 'bottom', ids())
    expect(split.grid.rows).toHaveLength(3)
    expect(split.grid.rows.slice(0, 2).map((t) => [t.weight, t.px, t.fitPx])).toEqual([[500, undefined, undefined], [500, undefined, undefined]])
    expect(trackSizing(split, 'rows', 1).kind).toBe('weighted')
  })

  it('a row that stops being Numbers-only ignores it: weighted by its own weight; Numbers-only again, its height is back', () => {
    const out = sized()
    const list = replaceTab(out, 'num1', createTab('notes', 'num1'))
    expect(list.grid.rows[0]).toEqual({ id: 'r1', weight: 1000, fitPx: 116 })
    expect(trackSizing(list, 'rows', 0)).toEqual({ kind: 'weighted', weight: 1000 })
    const joined = addTab(out, createTab('notes', 'x1'), { kind: 'cell', cellId: 'n2' }, ids())
    expect(trackSizing(joined, 'rows', 0)).toEqual({ kind: 'weighted', weight: 1000 })
    expect(trackSizing(replaceTab(list, 'num1', createTab('number', 'num1')), 'rows', 0)).toEqual({ kind: 'fixed', px: 116 })
  })

  it('draws its cells at their small face while it fits, collapsed too; given a height, by their size', () => {
    expect(rowDrawsFitFaces(body, 0)).toBe(true)
    expect(rowDrawsFitFaces(setTrackCollapsed(body, 'r1', true), 0)).toBe(true)
    expect(rowDrawsFitFaces(setTrackCollapsed(sized(), 'r1', true), 0)).toBe(true)
    expect(rowDrawsFitFaces(sized(), 0)).toBe(false)
    expect(rowDrawsFitFaces(body, 1)).toBe(false)
    expect(rowDrawsFitFaces(setTrackCollapsed(body, 'r2', true), 1)).toBe(false)
  })

  it('a former band (a px row) of Numbers keeps its px: a drag sizes the px, no fitPx', () => {
    const band = layout(grid([[n1, n2], [l, l]], { rows: [{ px: 90 }, 1000] }))
    const out = moveEdge(band, wholeLine(band, 'rows', 1), 30, { sizes: [90, 600] }, ids())
    expect(out.grid.rows[0]).toEqual({ id: 'r1', px: 120 })
  })

  it('copySizes carries it as a size: onto the same tracks, and onto the same row among changed ones (set or cleared)', () => {
    const out = sized()
    expect(copySizes(body, out, ['rows']).grid.rows[0]).toEqual({ id: 'r1', weight: 1000, fitPx: 116 })
    // The source has a row the target hasn't (an unsaved insert): r1 is the same track in both.
    const inserted = insertTrack(out, 'bottom', ids()).layout
    expect(copySizes(body, inserted, ['rows']).grid.rows[0]).toEqual({ id: 'r1', weight: 1000, fitPx: 116 })
    expect(copySizes(out, withoutTrackFitPx(inserted, 'r1'), ['rows']).grid.rows[0]).toEqual({ id: 'r1', weight: 1000 })
  })
})

describe('evenStretchDelta (a divider double-click)', () => {
  it('part of a line goes midway between its own cells; a whole line has none', () => {
    const [a, b, e, c, d] = ['a', 'b', 'e', 'c', 'd'].map((id) => cell(id)) as [CellSpec, CellSpec, CellSpec, CellSpec, CellSpec]
    const body = layout(grid([[a, b], [e, e], [c, d]], { cols: [600, 400] }))
    const ab = edgeBetween(body, 'a', 'b')!
    expect(evenStretchDelta(body, ab, [600, 400])).toBe(-100)
    const moved = moveEdge(body, ab, -100, { sizes: [600, 400] }, ids())
    expect(picture(moved)).toEqual(['a b b', 'e e e', 'c c d'])
    expect(evenStretchDelta(body, ab, [600])).toBeNull()
    const whole = layout(grid([[a, b]]))
    expect(evenStretchDelta(whole, edgeBetween(whole, 'a', 'b')!, [500, 500])).toBeNull()
  })
})

describe('view state, config and sizes', () => {
  const a = cell('a', ['t1', 't2'])
  const b = cell('b')
  const base = layout(grid([[a], [b]]))

  it('collapses row tracks only; a cell is collapsed when every row track it covers is', () => {
    const out = setTrackCollapsed(base, 'r1', true)
    expect(out.grid.rows[0]).toEqual({ id: 'r1', weight: 1000, collapsed: true })
    expect(isCellCollapsed(out, 'a')).toBe(true)
    expect(isCellCollapsed(out, 'b')).toBe(false)
    expect(setTrackCollapsed(out, 'r1', true)).toBe(out)
    expect(setTrackCollapsed(base, 'c1', true)).toBe(base)
    expect(setTrackCollapsed(out, 'r1', false).grid.rows[0]).toEqual({ id: 'r1', weight: 1000 })
  })

  it('sets the active tab; batched track sizes in their own unit; ignores bad sizes', () => {
    expect(setActiveTab(base, 't2').cells[0]?.activeTabId).toBe('t2')
    expect(setActiveTab(base, 't1')).toBe(base)
    const fixed = layout(grid([[a], [b]], { rows: [1000, { px: 160 }] }))
    const out = setTrackSizes(fixed, { r1: 700, r2: 199.6, c1: -1, zz: 5 })
    expect(out.grid.rows).toEqual([{ id: 'r1', weight: 700 }, { id: 'r2', px: 200 }])
    expect(setTrackSizes(fixed, { r1: 1000 })).toBe(fixed)
    expect(trackAxes(fixed, ['r2', 'c1'])).toEqual(['columns', 'rows'])
  })

  it('copies an axis’s sizes only where both have the same tracks', () => {
    const sized = setTrackSizes(base, { r1: 300, r2: 700, c1: 50 })
    const split = splitCell(base, 'a', 'right', ids()).layout
    const out = copySizes(split, sized, 'all')
    expect(out.grid.rows.map((t) => t.weight)).toEqual([300, 700])
    expect(out.grid.columns.map((t) => t.weight)).toEqual([500, 500])
    expect(copySizes(sized, sized, 'all')).toBe(sized)
  })

  it('patches a tab’s config / view state only for its kind; replaces a tab in place', () => {
    const cal = createTab('calendar', 'k')
    const withCal = layout(grid([[spec('a', [cal])]]))
    const patched = patchTabViewState(withCal, 'k', 'calendar', { view: 'month' })
    expect(getTab(patched, 'k')?.viewState).toEqual({ view: 'month' })
    expect(patchTabViewState(withCal, 'k', 'lens', { zoom: 'lines' })).toBe(withCal)
    expect(getTab(patchTabConfig(withCal, 'k', 'calendar', { dateTypes: { due: false, followup: true } }), 'k')?.config).toEqual({ dateTypes: { due: false, followup: true } })
    const swapped = replaceTab(base, 't1', createTab('calendar', 't1'))
    expect(getTab(swapped, 't1')?.kind).toBe('calendar')
    expect(replaceTab(base, 't1', createTab('calendar', 'b-t'))).toBe(base)
  })

  it('counts the tabs showing a list', () => {
    const lens: LayoutTab = { id: 'l', kind: 'lens', config: { listDefinitionId: 7 } }
    const other: LayoutTab = { id: 'o', kind: 'lens', config: { listDefinitionId: 7 } }
    const notes: LayoutTab = { id: 'n', kind: 'notes', config: {} }
    const body = layout(grid([[spec('a', [lens, other, notes])]]))
    expect(countListTabs(body, 7)).toBe(2)
    expect(countListTabs(body, 8)).toBe(0)
    expect(countListTabs(body, 7, new Set(['o']))).toBe(1)
  })
})

describe('queries and the structure key', () => {
  const a = cell('a', ['t1'])
  const b = cell('b', ['t2'])
  const base = layout(grid([[a, b]]))

  it('finds tabs and cells; every id is in layoutIds', () => {
    expect(findTab(base, 't2')).toEqual({ cellId: 'b', cellIdx: 1, tabIdx: 0 })
    expect(panelOfTab(base, 't2')?.id).toBe('b')
    expect([...layoutIds(base)].sort()).toEqual(['a', 'b', 'c1', 'c2', 'r1', 't1', 't2'])
  })

  it('ignores view state (sizes, collapse, active tab) but sees tracks, areas and tabs', () => {
    expect(layoutStructureEqual(base, setTrackSizes(base, { c1: 10 }))).toBe(true)
    expect(layoutStructureEqual(base, setTrackCollapsed(base, 'r1', true))).toBe(true)
    expect(layoutStructureEqual(base, mergeCells(base, 'a', 'b'))).toBe(false)
    expect(layoutStructureKey(base)).toBe(layoutStructureKey({ ...base, cells: [...base.cells] }))
  })
})

describe('random op sequences keep the table valid', () => {
  /** A deterministic generator (mulberry32). */
  function rng(seed: number): () => number {
    let s = seed >>> 0
    return () => {
      s = (s + 0x6d2b79f5) >>> 0
      let t = s
      t = Math.imul(t ^ (t >>> 15), t | 1)
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }
  const SIDES: Side[] = ['left', 'top', 'right', 'bottom']

  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]) {
    it(`seed ${seed}`, () => {
      const rand = rng(seed)
      const pick = <T,>(xs: readonly T[]): T | undefined => xs[Math.floor(rand() * xs.length)]
      const genId = ids(`s${seed}-`)
      let tabN = 0
      let body: WorkspaceLayout = layout(grid([[cell('start', ['x0'])]]))
      for (let step = 0; step < 150; step++) {
        const cellIds = body.cells.map((c) => c.id)
        const tabIds = body.cells.flatMap((c) => c.tabs.map((t) => t.id))
        const target = (): LayoutDropTarget => {
          const r = rand()
          const id = pick(cellIds) ?? 'none'
          if (r < 0.4) return { kind: 'split', cellId: id, side: pick(SIDES) ?? 'right' }
          if (r < 0.6) return { kind: 'insert', edge: pick(SIDES) ?? 'right' }
          if (r < 0.9) return { kind: 'cell', cellId: id, index: Math.floor(rand() * 3) }
          return { kind: 'layout' }
        }
        const op = Math.floor(rand() * 9)
        const before = body
        switch (op) {
          case 0: body = splitCell(body, pick(cellIds) ?? '', pick(SIDES) ?? 'right', genId).layout; break
          case 1: body = insertTrack(body, pick(SIDES) ?? 'top', genId).layout; break
          case 2: body = mergeCells(body, pick(cellIds) ?? '', pick(cellIds) ?? ''); break
          case 3: body = closeCell(body, pick(cellIds) ?? ''); break
          case 4: body = moveTab(body, pick(tabIds) ?? '', target(), genId); break
          case 5: body = movePanel(body, pick(cellIds) ?? '', target(), genId); break
          case 6: body = addTab(body, createTab('notes', `x${++tabN}`), target(), genId); break
          case 7: {
            const stretch = pick(edgeStretches(body))
            if (stretch) {
              const sizes = body.grid[stretch.axis].map(() => 100 + Math.floor(rand() * 200))
              body = moveEdge(body, stretch, (rand() - 0.5) * 400, { sizes, minPx: () => 20 }, genId)
            }
            break
          }
          case 8: body = closeTab(body, pick(tabIds) ?? ''); break
        }
        expectValid(body)
        // A close leaves an empty cell only where no side can take its space (a pinwheel's centre).
        if (op === 3 || op === 8) {
          for (const c of body.cells) {
            if (c.tabs.length > 0 || before.cells.some((p) => p.id === c.id && p.tabs.length === 0)) continue
            // Emptied by this close: closing it again finds no taker either.
            expect(closeCell(body, c.id)).toBe(body)
          }
        }
        // Every tab survives every op but a close.
        if (op !== 8 && op !== 3) {
          expect(body.cells.flatMap((c) => c.tabs.map((t) => t.id)).sort()).toEqual(
            [...before.cells.flatMap((c) => c.tabs.map((t) => t.id)), ...(op === 6 && body !== before ? [`x${tabN}`] : [])].sort(),
          )
        }
      }
    })
  }
})
