import { describe, it, expect } from 'vitest'
import { BAND_DEFAULT_HEIGHT, createTab, type LayoutBand, type LayoutCell, type LayoutColumn, type LayoutRow, type WorkspaceLayout } from '../../models/workspace-layout'
import {
  addTab,
  closeCell,
  cellSizeGroups,
  closeTab,
  copySizes,
  countListTabs,
  findCell,
  findRow,
  findTab,
  getTab,
  layoutPanels,
  layoutRows,
  movePanel,
  panelOfTab,
  rowOfCell,
  rowSizeGroups,
  setBandHeight,
  layoutIds,
  layoutStructureEqual,
  moveTab,
  patchTabConfig,
  patchTabViewState,
  replaceTab,
  setActiveTab,
  setCellStripShown,
  setCellWeights,
  setColumnWeights,
  setRowCollapsed,
  setRowWeights,
  splitCell,
} from '../../utils/workspace-layout-ops'
import { row, rowOf } from '../helpers/layout-builders'

/** A cell of notes tabs, its first tab active. */
function cell(id: string, tabIds: string[], extra: Partial<LayoutCell> = {}): LayoutCell {
  const tabs = tabIds.map((t) => createTab('notes', t))
  return { id, weight: 1, tabs, ...(tabs[0] ? { activeTabId: tabs[0].id } : {}), ...extra }
}

/** A column of one-cell rows (`<cell>-r`). */
function col(id: string, cells: LayoutCell[], weight = 1): LayoutColumn {
  return { id, weight, rows: cells.map((c) => rowOf(c)) }
}

function layout(...columns: LayoutColumn[]): WorkspaceLayout {
  return { sortOrder: 0, name: 'L', columns, createdAt: new Date(0), modifiedAt: new Date(0) }
}

/** Tab ids per row per column; the cells of a multi-cell row are parted by `|`. */
function shape(l: WorkspaceLayout): string[][][] {
  return l.columns.map((c) => c.rows.map((r) => r.cells.flatMap((k, i) => [...(i > 0 ? ['|'] : []), ...k.tabs.map((t) => t.id)])))
}

/** Tab ids of a band's cells, parted by `|`. */
function bandShape(l: WorkspaceLayout, edge: 'top' | 'bottom'): string[] | undefined {
  return l[edge]?.cells.flatMap((k, i) => [...(i > 0 ? ['|'] : []), ...k.tabs.map((t) => t.id)])
}

/** The structural invariants every reducer keeps. */
function expectInvariants(l: WorkspaceLayout): void {
  for (const c of l.columns) {
    expect(c.rows.length, `column ${c.id} has rows`).toBeGreaterThan(0)
    for (const r of c.rows) expect(r.cells.length, `row ${r.id} has cells`).toBeGreaterThan(0)
  }
  for (const edge of ['top', 'bottom'] as const) {
    if (edge in l) expect(l[edge]?.cells.length, `${edge} band has cells`).toBeGreaterThan(0)
  }
  const ids = [
    ...l.columns.map((c) => c.id),
    ...layoutRows(l).map((r) => r.id),
    ...layoutPanels(l).flatMap((k) => [k.id, ...k.tabs.map((t) => t.id)]),
  ]
  expect(new Set(ids).size, 'ids are unique').toBe(ids.length)
}

function seqIds(): () => string {
  let n = 0
  return () => `n${++n}`
}

/** Three columns: [A: (a1 a2) (a3)] [B: (b1)] [C: (c1)] */
function base(): WorkspaceLayout {
  return layout(
    col('A', [cell('ka', ['a1', 'a2']), cell('kb', ['a3'])]),
    col('B', [cell('kc', ['b1'])]),
    col('C', [cell('kd', ['c1'])]),
  )
}

/** Column A's second row holds two cells: [A: (a1 a2) (a3 | a4)] [B: (b1)] */
function paired(): WorkspaceLayout {
  return layout(
    { id: 'A', weight: 1, rows: [rowOf(cell('ka', ['a1', 'a2'])), row('rp', [cell('kb', ['a3']), cell('ke', ['a4'])])] },
    col('B', [cell('kc', ['b1'])]),
  )
}

describe('addTab', () => {
  it('joins a cell at the end (or at an index) and becomes active', () => {
    const l = base()
    const end = addTab(l, createTab('calendar', 'x'), { kind: 'cell', cellId: 'ka' }, seqIds())
    expect(shape(end)[0]![0]).toEqual(['a1', 'a2', 'x'])
    expect(end.columns[0]!.rows[0]!.cells[0]!.activeTabId).toBe('x')
    const front = addTab(l, createTab('calendar', 'x'), { kind: 'cell', cellId: 'ka', index: 0 }, seqIds())
    expect(shape(front)[0]![0]).toEqual(['x', 'a1', 'a2'])
  })

  it('cell edge top / bottom: a new row above / below that splits the hovered row’s weight', () => {
    const l = base()
    const above = addTab(l, createTab('notes', 'x'), { kind: 'cell-edge', cellId: 'kb', edge: 'top' }, seqIds())
    expect(shape(above)[0]).toEqual([['a1', 'a2'], ['x'], ['a3']])
    expect(above.columns[0]!.rows.map((r) => r.weight)).toEqual([1, 0.5, 0.5])
    const below = addTab(l, createTab('notes', 'x'), { kind: 'cell-edge', cellId: 'kb', edge: 'bottom' }, seqIds())
    expect(shape(below)[0]).toEqual([['a1', 'a2'], ['a3'], ['x']])
    expect(below.columns[0]!.rows[2]).toEqual({ id: 'n1', weight: 0.5, cells: [{ id: 'n2', weight: 1, activeTabId: 'x', tabs: [createTab('notes', 'x')] }] })
    expectInvariants(below)
  })

  it('cell edge top / bottom of a cell in a multi-cell row: a new row above / below that row (no deeper split)', () => {
    const l = paired()
    const below = addTab(l, createTab('notes', 'x'), { kind: 'cell-edge', cellId: 'ke', edge: 'bottom' }, seqIds())
    expect(shape(below)[0]).toEqual([['a1', 'a2'], ['a3', '|', 'a4'], ['x']])
    const rowEdge = addTab(l, createTab('notes', 'x'), { kind: 'row-edge', rowId: 'rp', edge: 'top' }, seqIds())
    expect(shape(rowEdge)[0]).toEqual([['a1', 'a2'], ['x'], ['a3', '|', 'a4']])
    expect(rowEdge.columns[0]!.rows.map((r) => r.weight)).toEqual([1, 0.5, 0.5])
    expectInvariants(rowEdge)
  })

  it('cell edge left / right: a new cell beside it in its row, splitting the hovered cell’s width', () => {
    const l = base()
    const right = addTab(l, createTab('notes', 'x'), { kind: 'cell-edge', cellId: 'kb', edge: 'right' }, seqIds())
    expect(shape(right)[0]).toEqual([['a1', 'a2'], ['a3', '|', 'x']])
    expect(right.columns[0]!.rows[1]!.cells.map((c) => c.weight)).toEqual([0.5, 0.5])
    expect(right.columns[0]!.rows[1]!.weight).toBe(1)
    expect(right.columns[0]!.rows[1]!.cells[1]).toEqual({ id: 'n1', weight: 0.5, activeTabId: 'x', tabs: [createTab('notes', 'x')] })
    const left = addTab(paired(), createTab('notes', 'x'), { kind: 'cell-edge', cellId: 'ke', edge: 'left' }, seqIds())
    expect(shape(left)[0]![1]).toEqual(['a3', '|', 'x', '|', 'a4'])
    expectInvariants(left)
  })

  it('column edge: a new column taking half the narrower neighbour, split off both neighbours', () => {
    const l = setColumnWeights(base(), { A: 2, B: 1 })
    const mid = addTab(l, createTab('notes', 'x'), { kind: 'column-edge', columnId: 'A', edge: 'right' }, seqIds())
    expect(shape(mid)).toEqual([[['a1', 'a2'], ['a3']], [['x']], [['b1']], [['c1']]])
    expect(mid.columns.map((c) => c.weight)).toEqual([1.75, 0.5, 0.75, 1])
    // Same gutter named from the other side.
    const same = addTab(l, createTab('notes', 'x'), { kind: 'column-edge', columnId: 'B', edge: 'left' }, seqIds())
    expect(same.columns.map((c) => c.weight)).toEqual(mid.columns.map((c) => c.weight))
    // Outer edge: only one neighbour, which keeps half.
    const left = addTab(l, createTab('notes', 'x'), { kind: 'column-edge', columnId: 'A', edge: 'left' }, seqIds())
    expect(shape(left)[0]).toEqual([['x']])
    expect(left.columns.map((c) => c.weight)).toEqual([1, 1, 1, 1])
  })

  it('layout target appends a column of one row of one cell; an empty layout gets one at the default weight', () => {
    const empty = layout()
    const first = addTab(empty, createTab('lens', 'x', { listDefinitionId: 4 }), { kind: 'layout' }, seqIds())
    expect(first.columns).toEqual([{ id: 'n1', weight: 1, rows: [{ id: 'n2', weight: 1, cells: [{ id: 'n3', weight: 1, activeTabId: 'x', tabs: [{ id: 'x', kind: 'lens', config: { listDefinitionId: 4 } }] }] }] }])
    const last = addTab(base(), createTab('notes', 'x'), { kind: 'layout' }, seqIds())
    expect(shape(last).at(-1)).toEqual([['x']])
  })

  it('unknown target, a band’s top / bottom, or a taken tab id → same layout', () => {
    const l = { ...base(), top: { id: 'TB', height: 160, cells: [cell('tb', ['top1'])] } }
    expect(addTab(l, createTab('notes', 'x'), { kind: 'cell', cellId: 'nope' }, seqIds())).toBe(l)
    expect(addTab(l, createTab('notes', 'a1'), { kind: 'cell', cellId: 'ka' }, seqIds())).toBe(l)
    expect(addTab(l, createTab('notes', 'x'), { kind: 'cell-edge', cellId: 'tb', edge: 'bottom' }, seqIds())).toBe(l)
    expect(addTab(l, createTab('notes', 'x'), { kind: 'row-edge', rowId: 'TB', edge: 'top' }, seqIds())).toBe(l)
    expect(addTab(l, createTab('notes', 'x'), { kind: 'row-edge', rowId: 'nope', edge: 'top' }, seqIds())).toBe(l)
  })
})

describe('moveTab', () => {
  it('reorders within its own cell (index among the other tabs); no index = no-op', () => {
    const l = base()
    const moved = moveTab(l, 'a1', { kind: 'cell', cellId: 'ka', index: 1 }, seqIds())
    expect(shape(moved)[0]![0]).toEqual(['a2', 'a1'])
    expect(moved.columns[0]!.rows[0]!.cells[0]!.activeTabId).toBe('a1')
    expect(moveTab(l, 'a2', { kind: 'cell', cellId: 'ka' }, seqIds())).toBe(l)
    expect(moveTab(l, 'a1', { kind: 'cell', cellId: 'ka', index: 0 }, seqIds())).toBe(l)
  })

  it('joins another cell; the source cell keeps its other tabs and re-picks its active tab', () => {
    const moved = moveTab(base(), 'a1', { kind: 'cell', cellId: 'kc', index: 0 }, seqIds())
    expect(shape(moved)).toEqual([[['a2'], ['a3']], [['a1', 'b1']], [['c1']]])
    expect(moved.columns[0]!.rows[0]!.cells[0]!.activeTabId).toBe('a2')
    expect(moved.columns[1]!.rows[0]!.cells[0]!.activeTabId).toBe('a1')
  })

  it('moving a cell’s only tab removes the cell and its row; a column’s only row removes the column', () => {
    const cellGone = moveTab(base(), 'a3', { kind: 'cell', cellId: 'kd' }, seqIds())
    expect(shape(cellGone)).toEqual([[['a1', 'a2']], [['b1']], [['c1', 'a3']]])
    const colGone = moveTab(base(), 'b1', { kind: 'cell', cellId: 'kd' }, seqIds())
    expect(shape(colGone)).toEqual([[['a1', 'a2'], ['a3']], [['c1', 'b1']]])
    // A cell of a two-cell row: the row stays with the other cell.
    const pairGone = moveTab(paired(), 'a4', { kind: 'cell', cellId: 'kc' }, seqIds())
    expect(shape(pairGone)).toEqual([[['a1', 'a2'], ['a3']], [['b1', 'a4']]])
    expect(pairGone.columns[0]!.rows[1]!.id).toBe('rp')
    for (const l of [cellGone, colGone, pairGone]) expectInvariants(l)
  })

  it('to a cell edge / column edge makes a new row / cell / column', () => {
    const edge = moveTab(base(), 'a1', { kind: 'cell-edge', cellId: 'kc', edge: 'bottom' }, seqIds())
    expect(shape(edge)).toEqual([[['a2'], ['a3']], [['b1'], ['a1']], [['c1']]])
    const beside = moveTab(base(), 'a1', { kind: 'cell-edge', cellId: 'kc', edge: 'left' }, seqIds())
    expect(shape(beside)).toEqual([[['a2'], ['a3']], [['a1', '|', 'b1']], [['c1']]])
    const column = moveTab(base(), 'a1', { kind: 'column-edge', columnId: 'C', edge: 'right' }, seqIds())
    expect(shape(column)).toEqual([[['a2'], ['a3']], [['b1']], [['c1']], [['a1']]])
  })

  it('moves a whole single-tab column to another gutter', () => {
    const moved = moveTab(base(), 'c1', { kind: 'column-edge', columnId: 'A', edge: 'left' }, seqIds())
    expect(shape(moved)).toEqual([[['c1']], [['a1', 'a2'], ['a3']], [['b1']]])
  })

  it('no-ops: a single-tab cell onto its own edges / neighbour gutter; a single-cell column onto its own column edges', () => {
    const l = base()
    expect(moveTab(l, 'a3', { kind: 'cell-edge', cellId: 'kb', edge: 'top' }, seqIds())).toBe(l)
    expect(moveTab(l, 'a3', { kind: 'cell-edge', cellId: 'kb', edge: 'bottom' }, seqIds())).toBe(l)
    expect(moveTab(l, 'a3', { kind: 'cell-edge', cellId: 'ka', edge: 'bottom' }, seqIds())).toBe(l)
    expect(moveTab(l, 'a3', { kind: 'cell-edge', cellId: 'kb', edge: 'left' }, seqIds())).toBe(l)
    expect(moveTab(l, 'a3', { kind: 'cell-edge', cellId: 'kb', edge: 'right' }, seqIds())).toBe(l)
    expect(moveTab(l, 'a3', { kind: 'row-edge', rowId: 'kb-r', edge: 'top' }, seqIds())).toBe(l)
    expect(moveTab(l, 'b1', { kind: 'column-edge', columnId: 'B', edge: 'left' }, seqIds())).toBe(l)
    expect(moveTab(l, 'b1', { kind: 'column-edge', columnId: 'B', edge: 'right' }, seqIds())).toBe(l)
    expect(moveTab(l, 'b1', { kind: 'column-edge', columnId: 'A', edge: 'right' }, seqIds())).toBe(l)
    expect(moveTab(l, 'c1', { kind: 'layout' }, seqIds())).toBe(l)
    // Not a no-op: a multi-tab cell's tab onto its own edge splits it.
    const split = moveTab(l, 'a1', { kind: 'cell-edge', cellId: 'ka', edge: 'top' }, seqIds())
    expect(shape(split)[0]).toEqual([['a1'], ['a2'], ['a3']])
  })

  it('in a multi-cell row: the gutters beside a cell are no-ops, a row edge takes it out to its own row', () => {
    const l = paired()
    expect(moveTab(l, 'a4', { kind: 'cell-edge', cellId: 'kb', edge: 'right' }, seqIds())).toBe(l)
    expect(moveTab(l, 'a4', { kind: 'cell-edge', cellId: 'ke', edge: 'left' }, seqIds())).toBe(l)
    const swapped = moveTab(l, 'a4', { kind: 'cell-edge', cellId: 'kb', edge: 'left' }, seqIds())
    expect(shape(swapped)[0]![1]).toEqual(['a4', '|', 'a3'])
    const own = moveTab(l, 'a4', { kind: 'row-edge', rowId: 'rp', edge: 'bottom' }, seqIds())
    expect(shape(own)[0]).toEqual([['a1', 'a2'], ['a3'], ['a4']])
    expectInvariants(own)
  })

  it('unknown tab or target → same layout', () => {
    const l = base()
    expect(moveTab(l, 'nope', { kind: 'layout' }, seqIds())).toBe(l)
    expect(moveTab(l, 'a1', { kind: 'cell', cellId: 'nope' }, seqIds())).toBe(l)
  })
})

describe('closeTab / closeCell / splitCell', () => {
  it('closing the active tab activates the left neighbour, then the right', () => {
    const l = layout(col('A', [cell('k', ['t1', 't2', 't3'], { activeTabId: 't2' })]))
    expect(closeTab(l, 't2').columns[0]!.rows[0]!.cells[0]!.activeTabId).toBe('t1')
    const first = layout(col('A', [cell('k', ['t1', 't2'], { activeTabId: 't1' })]))
    expect(closeTab(first, 't1').columns[0]!.rows[0]!.cells[0]!.activeTabId).toBe('t2')
  })

  it('closing the last tab removes the cell, its row, then the empty column', () => {
    expect(shape(closeTab(base(), 'a3'))).toEqual([[['a1', 'a2']], [['b1']], [['c1']]])
    expect(shape(closeTab(base(), 'b1'))).toEqual([[['a1', 'a2'], ['a3']], [['c1']]])
    expect(shape(closeCell(base(), 'ka'))).toEqual([[['a3']], [['b1']], [['c1']]])
    expect(closeCell(base(), 'kc').columns.map((c) => c.id)).toEqual(['A', 'C'])
    expect(shape(closeCell(paired(), 'kb'))[0]).toEqual([['a1', 'a2'], ['a4']])
  })

  it('split below adds a row with an empty cell under it; split right a cell beside it; a new column one empty cell', () => {
    const below = splitCell(base(), 'ka', 'below', seqIds())
    expect(below.cellId).toBe('n2')
    expect(shape(below.layout)[0]).toEqual([['a1', 'a2'], [], ['a3']])
    expect(below.layout.columns[0]!.rows[1]).toEqual({ id: 'n1', weight: 0.5, cells: [{ id: 'n2', weight: 1, tabs: [] }] })
    const right = splitCell(base(), 'kb', 'right', seqIds())
    expect(shape(right.layout)[0]).toEqual([['a1', 'a2'], ['a3', '|']])
    expect(right.layout.columns[0]!.rows[1]!.cells[1]).toEqual({ id: 'n1', weight: 0.5, tabs: [] })
    expect(right.cellId).toBe('n1')
    const column = splitCell(base(), 'kb', 'new-column', seqIds())
    expect(shape(column.layout)).toEqual([[['a1', 'a2'], ['a3']], [[]], [['b1']], [['c1']]])
    expect(column.layout.columns[1]!.rows[0]!.cells[0]!.id).toBe(column.cellId)
    for (const r of [below, right, column]) expectInvariants(r.layout)
  })

  it('an empty cell takes a dropped tab; closing its only tab removes it again', () => {
    const { layout: split, cellId } = splitCell(base(), 'kc', 'below', seqIds())
    const filled = moveTab(split, 'c1', { kind: 'cell', cellId: cellId! }, seqIds())
    expect(shape(filled)).toEqual([[['a1', 'a2'], ['a3']], [['b1'], ['c1']]])
    expect(shape(closeTab(filled, 'c1'))).toEqual([[['a1', 'a2'], ['a3']], [['b1']]])
  })
})

describe('weights, view state, tab settings', () => {
  it('batched weights update listed ids only and ignore bad values', () => {
    const l = base()
    const cols = setColumnWeights(l, { A: 2, B: 0, C: Number.NaN, nope: 3 })
    expect(cols.columns.map((c) => c.weight)).toEqual([2, 1, 1])
    const rows = setRowWeights(l, { 'ka-r': 0.3, 'kb-r': 0.7, 'kd-r': -1 })
    expect(rows.columns[0]!.rows.map((r) => r.weight)).toEqual([0.3, 0.7])
    expect(rows.columns[2]).toBe(l.columns[2])
    expect(setColumnWeights(l, { A: 1 })).toBe(l)
    expect(setRowWeights(l, { 'ka-r': 1 })).toBe(l)
  })

  it('cell weights size the cells within a row (or band)', () => {
    const l = { ...paired(), top: { id: 'TB', height: 160, cells: [cell('tb', ['top1']), cell('tc', ['top2'])] } }
    const sized = setCellWeights(l, { kb: 2, ke: 0.5, tc: 3, kc: 0 })
    expect(sized.columns[0]!.rows[1]!.cells.map((c) => c.weight)).toEqual([2, 0.5])
    expect(sized.top?.cells.map((c) => c.weight)).toEqual([1, 3])
    expect(sized.columns[1]).toBe(l.columns[1])
    expect(sized.columns[0]!.rows[0]).toBe(l.columns[0]!.rows[0])
    expect(setCellWeights(l, { kb: 1 })).toBe(l)
  })

  it('collapse is a row’s; active tab a cell’s; a no-op returns the same layout', () => {
    const l = paired()
    const collapsed = setRowCollapsed(l, 'rp', true)
    expect(collapsed.columns[0]!.rows[1]!.collapsed).toBe(true)
    expect('collapsed' in setRowCollapsed(collapsed, 'rp', false).columns[0]!.rows[1]!).toBe(false)
    expect(setRowCollapsed(l, 'rp', false)).toBe(l)
    expect(setRowCollapsed(l, 'kb', true)).toBe(l)
    expect(setActiveTab(l, 'a2').columns[0]!.rows[0]!.cells[0]!.activeTabId).toBe('a2')
    expect(setActiveTab(l, 'a1')).toBe(l)
  })

  it('a cell’s strip setting is layout config: set, cleared, a no-op the same layout', () => {
    const l = base()
    const hidden = setCellStripShown(l, 'kb', false)
    expect(hidden.columns[0]!.rows[1]!.cells[0]!.stripShown).toBe(false)
    expect(layoutStructureEqual(l, hidden)).toBe(false)
    expect(setCellStripShown(hidden, 'kb', false)).toBe(hidden)
    expect('stripShown' in setCellStripShown(hidden, 'kb', null).columns[0]!.rows[1]!.cells[0]!).toBe(false)
    expect(setCellStripShown(l, 'kb', null)).toBe(l)
    expect(setCellStripShown(l, 'nope', true)).toBe(l)
  })

  it('config / view-state patches apply only to a tab of the named kind', () => {
    const l = addTab(base(), createTab('calendar', 'cal'), { kind: 'cell', cellId: 'kd' }, seqIds())
    const types = patchTabConfig(l, 'cal', 'calendar', { dateTypes: { due: false, followup: true } })
    expect(types.columns[2]!.rows[0]!.cells[0]!.tabs[1]).toMatchObject({ config: { dateTypes: { due: false, followup: true } } })
    expect(patchTabConfig(l, 'a1', 'calendar', { dateTypes: { due: false, followup: true } })).toBe(l)
    const view = patchTabViewState(l, 'cal', 'calendar', { view: 'month', offset: 2 })
    expect(view.columns[2]!.rows[0]!.cells[0]!.tabs[1]!.viewState).toEqual({ view: 'month', offset: 2 })
    expect(patchTabViewState(view, 'cal', 'calendar', { offset: 2 })).toBe(view)
  })

  it('a view-state key patched to undefined is removed', () => {
    const l = replaceTab(base(), 'a1', createTab('lens', 'a1'))
    const set = patchTabViewState(l, 'a1', 'lens', { detailsWidth: 300 })
    expect(set.columns[0]!.rows[0]!.cells[0]!.tabs[0]!.viewState).toEqual({ detailsWidth: 300 })
    const cleared = patchTabViewState(set, 'a1', 'lens', { detailsWidth: undefined })
    expect(cleared.columns[0]!.rows[0]!.cells[0]!.tabs[0]!.viewState).toEqual({})
    expect(layoutStructureEqual(l, set)).toBe(true)
  })

  it('a config key patched to undefined is removed', () => {
    const l = replaceTab(base(), 'a1', createTab('lens', 'a1'))
    const onList = patchTabConfig(l, 'a1', 'lens', { listDefinitionId: 7 })
    expect(onList.columns[0]!.rows[0]!.cells[0]!.tabs[0]!.config).toEqual({ listDefinitionId: 7 })
    expect(layoutStructureEqual(l, onList)).toBe(false)
    const back = patchTabConfig(onList, 'a1', 'lens', { listDefinitionId: undefined })
    expect(back.columns[0]!.rows[0]!.cells[0]!.tabs[0]!.config).toEqual({})
    expect('listDefinitionId' in back.columns[0]!.rows[0]!.cells[0]!.tabs[0]!.config).toBe(false)
    expect(layoutStructureEqual(l, back)).toBe(true)
  })

  it('counts the tabs showing a list: list tabs on it, Eisenhower tabs while the Eisenhower source is it', () => {
    let l = replaceTab(base(), 'a1', createTab('lens', 'a1', { listDefinitionId: 7 }))
    l = replaceTab(l, 'b1', createTab('eisenhower', 'b1'))
    l = replaceTab(l, 'c1', createTab('eisenhower', 'c1'))
    expect(countListTabs(l, 7, 7)).toBe(3)
    expect(countListTabs(l, 7, null)).toBe(1)
    expect(countListTabs(l, 7, 8)).toBe(1)
    expect(countListTabs(l, 8, 8)).toBe(2)
    expect(countListTabs(l, 7, 7, new Set(['a1']))).toBe(2)
    expect(countListTabs(l, 7, 7, new Set(['a1', 'b1', 'c1']))).toBe(0)
  })

  it('replaceTab swaps a tab in place and keeps it active', () => {
    const l = base()
    const next = replaceTab(l, 'a1', createTab('eisenhower', 'a1'))
    expect(next.columns[0]!.rows[0]!.cells[0]!.tabs[0]).toEqual({ id: 'a1', kind: 'eisenhower', config: {} })
    expect(next.columns[0]!.rows[0]!.cells[0]!.activeTabId).toBe('a1')
    expect(replaceTab(l, 'a1', createTab('eisenhower', 'b1'))).toBe(l)
  })
})

describe('finding parts', () => {
  it('findCell / findRow / rowOfCell reach column rows and bands', () => {
    const l = { ...paired(), top: { id: 'TB', height: 160, cells: [cell('tb', ['top1'])] } }
    expect(findCell(l, 'ke')).toEqual({ kind: 'column', colIdx: 0, rowIdx: 1, cellIdx: 1 })
    expect(findCell(l, 'tb')).toEqual({ kind: 'band', edge: 'top', cellIdx: 0 })
    expect(findCell(l, 'rp')).toBeNull()
    expect(findRow(l, 'rp')).toEqual({ kind: 'column', colIdx: 0, rowIdx: 1 })
    expect(findRow(l, 'TB')).toEqual({ kind: 'band', edge: 'top' })
    expect(findRow(l, 'ke')).toBeNull()
    expect(rowOfCell(l, 'ke')?.id).toBe('rp')
    expect(rowOfCell(l, 'tb')?.id).toBe('TB')
    expect(layoutRows(l).map((r) => r.id)).toEqual(['TB', 'ka-r', 'rp', 'kc-r'])
  })

  it('layoutIds holds every level’s ids, so a new id never repeats one', () => {
    const ids = layoutIds({ ...paired(), top: { id: 'TB', height: 160, cells: [cell('tb', ['top1'])] } })
    for (const id of ['A', 'ka-r', 'rp', 'ka', 'ke', 'a4', 'TB', 'tb', 'top1']) expect(ids.has(id), id).toBe(true)
  })
})

describe('layoutStructureEqual', () => {
  it('ignores view state (active tab, collapsed, viewState) and key order', () => {
    const l = addTab(base(), createTab('calendar', 'cal'), { kind: 'cell', cellId: 'kd' }, seqIds())
    let v = setActiveTab(l, 'c1')
    v = setRowCollapsed(v, 'ka-r', true)
    v = patchTabViewState(v, 'cal', 'calendar', { view: 'month' })
    expect(layoutStructureEqual(l, v)).toBe(true)
    const reordered: LayoutColumn[] = l.columns.map((c) => ({ rows: c.rows.map((r): LayoutRow => ({ cells: r.cells, weight: r.weight, id: r.id })), weight: c.weight, id: c.id }))
    expect(layoutStructureEqual(l, { columns: reordered })).toBe(true)
  })

  it('ignores sizes (view state): column, row and cell weights', () => {
    const l = paired()
    expect(layoutStructureEqual(l, setColumnWeights(l, { A: 3 }))).toBe(true)
    expect(layoutStructureEqual(l, setRowWeights(l, { rp: 0.25 }))).toBe(true)
    expect(layoutStructureEqual(l, setCellWeights(l, { ke: 0.25 }))).toBe(true)
  })

  it('sees structure and config: tabs, rows, cells side by side, a row’s id', () => {
    const l = addTab(base(), createTab('calendar', 'cal'), { kind: 'cell', cellId: 'kd' }, seqIds())
    expect(layoutStructureEqual(l, moveTab(l, 'a1', { kind: 'cell', cellId: 'ka', index: 1 }, seqIds()))).toBe(false)
    expect(layoutStructureEqual(l, splitCell(l, 'kc', 'below', seqIds()).layout)).toBe(false)
    expect(layoutStructureEqual(l, splitCell(l, 'kc', 'right', seqIds()).layout)).toBe(false)
    expect(layoutStructureEqual(l, patchTabConfig(l, 'cal', 'calendar', { dateTypes: { due: true, followup: false } }))).toBe(false)
    const renamedRow = { ...l, columns: l.columns.map((c, i) => (i === 1 ? { ...c, rows: c.rows.map((r) => ({ ...r, id: 'other' })) } : c)) }
    expect(layoutStructureEqual(l, renamedRow)).toBe(false)
  })
})

describe('copySizes', () => {
  const band = (): LayoutBand => ({ id: 'TB', height: 160, cells: [cell('tb', ['top1']), cell('tc', ['top2'])] })
  const sized = (): WorkspaceLayout => setBandHeight(setCellWeights(setRowWeights(setColumnWeights({ ...paired(), top: band() }, { A: 2, B: 3 }), { 'ka-r': 0.2, rp: 0.8 }), { kb: 3, ke: 1, tc: 4 }), 'top', 220)

  it('copies a group only where both layouts have the same parts', () => {
    const target = { ...paired(), top: band() }
    const all = copySizes(target, sized(), 'all')
    expect(all.columns.map((c) => c.weight)).toEqual([2, 3])
    expect(all.columns[0]!.rows.map((r) => r.weight)).toEqual([0.2, 0.8])
    expect(all.columns[0]!.rows[1]!.cells.map((c) => c.weight)).toEqual([3, 1])
    expect(all.top?.cells.map((c) => c.weight)).toEqual([1, 4])
    expect(all.top?.height).toBe(220)
    expect(copySizes(target, sized(), [{ kind: 'columns' }]).columns[0]!.rows.map((r) => r.weight)).toEqual([1, 1])
    expect(copySizes(target, sized(), [{ kind: 'band', edge: 'top' }]).columns).toBe(target.columns)
    expect(copySizes(target, sized(), [{ kind: 'cells', rowId: 'rp' }]).columns[0]!.rows.map((r) => r.weight)).toEqual([1, 1])

    // A new column: the columns' weights differ in parts; each column's rows still match.
    const wider = addTab(target, createTab('notes', 'x'), { kind: 'layout' }, seqIds())
    const out = copySizes(wider, sized(), 'all')
    expect(out.columns.map((c) => c.weight)).toEqual(wider.columns.map((c) => c.weight))
    expect(out.columns[0]!.rows.map((r) => r.weight)).toEqual([0.2, 0.8])
    // A new row in column A: its rows keep their weights; a row's cells still match.
    const split = splitCell(target, 'ka', 'below', seqIds()).layout
    expect(copySizes(split, sized(), [{ kind: 'rows', columnId: 'A' }])).toBe(split)
    expect(copySizes(split, sized(), [{ kind: 'cells', rowId: 'rp' }]).columns[0]!.rows[2]!.cells.map((c) => c.weight)).toEqual([3, 1])
    // A new cell in row rp: its cells keep their weights.
    const beside = splitCell(target, 'ke', 'right', seqIds()).layout
    expect(copySizes(beside, sized(), [{ kind: 'cells', rowId: 'rp' }])).toBe(beside)
    // Another band at that edge (or none): its height stays.
    const otherBand = { ...target, top: { id: 'TB2', height: 160, cells: [cell('tb9', ['top9'])] } }
    expect(copySizes(otherBand, sized(), [{ kind: 'band', edge: 'top' }])).toBe(otherBand)
    expect(copySizes(base(), sized(), [{ kind: 'band', edge: 'top' }])).toEqual(base())
  })

  it('returns the same layout when the sizes are already equal', () => {
    const l = sized()
    expect(copySizes(l, sized(), 'all')).toBe(l)
  })

  it('rowSizeGroups names the columns of the rows; cellSizeGroups the rows (and bands) of the cells', () => {
    expect(rowSizeGroups(base(), ['kb-r', 'ka-r', 'kd-r', 'nope'])).toEqual([{ kind: 'rows', columnId: 'A' }, { kind: 'rows', columnId: 'C' }])
    const l = { ...paired(), top: band() }
    expect(cellSizeGroups(l, ['ke', 'kb', 'tc', 'nope'])).toEqual([{ kind: 'cells', rowId: 'TB' }, { kind: 'cells', rowId: 'rp' }])
  })
})

describe('bands', () => {
  const withBands = (): WorkspaceLayout => ({
    ...base(),
    top: { id: 'TB', height: 160, cells: [{ id: 'tb', weight: 1, tabs: [createTab('dashboard', 'top1')] }] },
    bottom: { id: 'BB', height: 120, cells: [{ id: 'bb', weight: 1, tabs: [createTab('calendar', 'bot1'), createTab('notes', 'bot2')] }] },
  })

  it('layoutIds holds the bands, their cells and tabs, so a new id never repeats one', () => {
    const ids = layoutIds(withBands())
    for (const id of ['A', 'ka', 'a1', 'TB', 'tb', 'top1', 'BB', 'bb', 'bot1', 'bot2']) expect(ids.has(id), id).toBe(true)
  })

  it('findTab / panelOfTab / getTab and the view-state ops reach band tabs', () => {
    const l = withBands()
    expect(findTab(l, 'bot2')).toEqual({ cell: { kind: 'band', edge: 'bottom', cellIdx: 0 }, cellId: 'bb', tabIdx: 1 })
    expect(panelOfTab(l, 'top1')?.id).toBe('tb')
    expect(getTab(l, 'bot1')?.kind).toBe('calendar')
    const active = setActiveTab(l, 'bot2')
    expect(active.bottom?.cells[0]?.activeTabId).toBe('bot2')
    expect(active.bottom?.height).toBe(120)
    const collapsed = setRowCollapsed(l, 'TB', true)
    expect(collapsed.top?.collapsed).toBe(true)
    expect(setRowCollapsed(collapsed, 'TB', false).top).toEqual(l.top)
    const vs = patchTabViewState(l, 'bot1', 'calendar', { view: 'week' })
    expect(vs.bottom?.cells[0]?.tabs[0]?.viewState).toEqual({ view: 'week' })
    const lens = patchTabViewState(replaceTab(l, 'top1', createTab('lens', 'top1')), 'top1', 'lens', { detailsWidth: 240 })
    expect(lens.top?.cells[0]?.tabs[0]?.viewState).toEqual({ detailsWidth: 240 })
    expect(patchTabConfig(l, 'bot1', 'calendar', { dateTypes: { due: false, followup: true } }).bottom?.cells[0]?.tabs[0]?.config).toEqual({ dateTypes: { due: false, followup: true } })
    expect(layoutPanels(l).map((p) => p.id)).toEqual(['tb', 'ka', 'kb', 'kc', 'kd', 'bb'])
    expect(countListTabs(replaceTab(l, 'top1', createTab('lens', 'top1', { listDefinitionId: 7 })), 7, null)).toBe(1)
  })

  it('a tab moves into a band (body: at the end; strip: at the index) and out of it; an emptied band goes', () => {
    const l = withBands()
    const into = moveTab(l, 'a3', { kind: 'band', edge: 'top' }, seqIds())
    expect(bandShape(into, 'top')).toEqual(['top1', 'a3'])
    expect(into.top?.cells[0]?.activeTabId).toBe('a3')
    expect(shape(into)[0]).toEqual([['a1', 'a2']])
    const strip = moveTab(l, 'b1', { kind: 'cell', cellId: 'bb', index: 1 }, seqIds())
    expect(bandShape(strip, 'bottom')).toEqual(['bot1', 'b1', 'bot2'])
    expect(shape(strip).length).toBe(2) // column B emptied and went
    const out = moveTab(l, 'top1', { kind: 'cell', cellId: 'kc' }, seqIds())
    expect(out.top).toBeUndefined()
    expect('top' in out).toBe(false)
    expect(shape(out)[1]).toEqual([['b1', 'top1']])
    // Reordering inside a band
    const reordered = moveTab(l, 'bot1', { kind: 'band', edge: 'bottom', index: 1 }, seqIds())
    expect(bandShape(reordered, 'bottom')).toEqual(['bot2', 'bot1'])
    expect(moveTab(l, 'bot1', { kind: 'band', edge: 'bottom' }, seqIds())).toBe(l)
  })

  it('a band takes a cell beside one of its cells; a band losing its last cell goes, one losing another keeps the rest', () => {
    const l = withBands()
    const beside = moveTab(l, 'a3', { kind: 'cell-edge', cellId: 'tb', edge: 'right' }, seqIds())
    expect(bandShape(beside, 'top')).toEqual(['top1', '|', 'a3'])
    expect(beside.top?.cells.map((c) => c.weight)).toEqual([0.5, 0.5])
    expect(beside.top?.height).toBe(160)
    expect(bandShape(closeCell(beside, 'tb'), 'top')).toEqual(['a3'])
    expect('top' in closeCell(closeCell(beside, 'tb'), 'n1')).toBe(false)
    expectInvariants(beside)
  })

  it('a tab makes a new band only where there is none: first tab active, default height', () => {
    const l = { ...base(), bottom: withBands().bottom }
    const next = moveTab(l, 'a1', { kind: 'new-band', edge: 'top' }, seqIds())
    expect(next.top).toEqual({ id: 'n1', height: BAND_DEFAULT_HEIGHT, cells: [{ id: 'n2', weight: 1, tabs: [l.columns[0]!.rows[0]!.cells[0]!.tabs[0]], activeTabId: 'a1' }] })
    expect(moveTab(l, 'a1', { kind: 'new-band', edge: 'bottom' }, seqIds())).toBe(l)
    // The only tab of the bottom band onto the free top edge: the band moves.
    const moved = moveTab(l, 'bot1', { kind: 'new-band', edge: 'top' }, seqIds())
    expect(bandShape(moved, 'top')).toEqual(['bot1'])
    expect(bandShape(moved, 'bottom')).toEqual(['bot2'])
    expect(bandShape(addTab(base(), createTab('notes', 'x'), { kind: 'new-band', edge: 'bottom' }, seqIds()), 'bottom')).toEqual(['x'])
    expect(bandShape(addTab(l, createTab('notes', 'x'), { kind: 'band', edge: 'bottom' }, seqIds()), 'bottom')).toEqual(['bot1', 'bot2', 'x'])
    expect(addTab(base(), createTab('notes', 'x'), { kind: 'band', edge: 'top' }, seqIds()).top).toBeUndefined()
  })

  it('closeTab / closeCell remove a band once its last tab goes; a band cell splits only right', () => {
    const l = withBands()
    expect('top' in closeTab(l, 'top1')).toBe(false)
    const one = closeTab(l, 'bot1')
    expect(bandShape(one, 'bottom')).toEqual(['bot2'])
    expect('bottom' in closeCell(l, 'bb')).toBe(false)
    expect(splitCell(l, 'tb', 'below', seqIds())).toEqual({ layout: l, cellId: null })
    expect(splitCell(l, 'tb', 'new-column', seqIds())).toEqual({ layout: l, cellId: null })
    const right = splitCell(l, 'tb', 'right', seqIds())
    expect(bandShape(right.layout, 'top')).toEqual(['top1', '|'])
  })

  it('setBandHeight changes the height (rounded), only for a band that exists and a positive height', () => {
    const l = withBands()
    expect(setBandHeight(l, 'top', 201.6).top?.height).toBe(202)
    expect(setBandHeight(l, 'top', 160)).toBe(l)
    expect(setBandHeight(l, 'top', 0)).toBe(l)
    expect(setBandHeight(l, 'top', Number.NaN)).toBe(l)
    expect(setBandHeight(base(), 'top', 200).top).toBeUndefined()
  })

  it('layoutStructureEqual sees a band added, removed or its tabs changed — not its height or view state', () => {
    const l = withBands()
    expect(layoutStructureEqual(l, base())).toBe(false)
    expect(layoutStructureEqual(l, setBandHeight(l, 'top', 200))).toBe(true)
    expect(layoutStructureEqual(l, moveTab(l, 'bot1', { kind: 'band', edge: 'bottom', index: 1 }, seqIds()))).toBe(false)
    expect(layoutStructureEqual(l, patchTabConfig(l, 'bot1', 'calendar', { dateTypes: { due: false, followup: true } }))).toBe(false)
    let v = setActiveTab(l, 'bot2')
    v = setRowCollapsed(v, 'TB', true)
    v = patchTabViewState(v, 'bot1', 'calendar', { offset: 2 })
    expect(layoutStructureEqual(l, v)).toBe(true)
    expect(layoutStructureEqual(base(), { columns: base().columns })).toBe(true)
  })
})

describe('movePanel', () => {
  const withBands = (): WorkspaceLayout => ({
    ...base(),
    top: { id: 'TB', height: 160, cells: [{ id: 'tb', weight: 1, tabs: [createTab('dashboard', 'top1'), createTab('notes', 'top2')], activeTabId: 'top2' }] },
  })

  it('merging into another cell appends every tab in order; the first moved tab is active', () => {
    const next = movePanel(base(), 'ka', { kind: 'cell', cellId: 'kd' }, seqIds())
    expect(shape(next)).toEqual([[['a3']], [['b1']], [['c1', 'a1', 'a2']]])
    expect(next.columns[2]!.rows[0]!.cells[0]!.activeTabId).toBe('a1')
    const strip = movePanel(base(), 'ka', { kind: 'cell', cellId: 'kd', index: 0 }, seqIds())
    expect(shape(strip)[2]).toEqual([['a1', 'a2', 'c1']])
  })

  it('a cell edge makes a new row or cell with it (keeping its active tab and strip setting); a column edge a new column', () => {
    const l = setCellStripShown(setActiveTab(base(), 'a2'), 'ka', false)
    const edge = movePanel(l, 'ka', { kind: 'cell-edge', cellId: 'kc', edge: 'bottom' }, seqIds())
    expect(shape(edge)).toEqual([[['a3']], [['b1'], ['a1', 'a2']], [['c1']]])
    expect(edge.columns[1]!.rows[1]!.cells[0]).toMatchObject({ activeTabId: 'a2', weight: 1, stripShown: false })
    expect(edge.columns[1]!.rows[1]!.weight).toBe(0.5)
    const beside = movePanel(l, 'ka', { kind: 'cell-edge', cellId: 'kc', edge: 'right' }, seqIds())
    expect(shape(beside)[1]).toEqual([['b1', '|', 'a1', 'a2']])
    expect(beside.columns[1]!.rows[0]!.cells[1]).toMatchObject({ activeTabId: 'a2', weight: 0.5, stripShown: false })
    const col = movePanel(l, 'kb', { kind: 'column-edge', columnId: 'C', edge: 'right' }, seqIds())
    expect(shape(col)).toEqual([[['a1', 'a2']], [['b1']], [['c1']], [['a3']]])
    // The only cell of column B: column B goes.
    const lone = movePanel(base(), 'kc', { kind: 'column-edge', columnId: 'A', edge: 'left' }, seqIds())
    expect(shape(lone)).toEqual([[['b1']], [['a1', 'a2'], ['a3']], [['c1']]])
    expect(movePanel(base(), 'kc', { kind: 'layout' }, seqIds()).columns.map((c) => c.rows[0]!.cells[0]!.tabs[0]!.id)).toEqual(['a1', 'c1', 'b1'])
    for (const x of [edge, beside, col, lone]) expectInvariants(x)
  })

  it('removing a column’s last expanded row expands the row above it, else the new first', () => {
    const rows = () => [rowOf(cell('k1', ['t1']), { collapsed: true }), rowOf(cell('k2', ['t2'])), rowOf(cell('k3', ['t3']), { collapsed: true })]
    const expanded = (l: WorkspaceLayout) => l.columns[0]!.rows.filter((r) => r.collapsed !== true).map((r) => r.id)
    const colA = (r: LayoutRow[]): LayoutColumn => ({ id: 'A', weight: 1, rows: r })
    const other = col('B', [cell('kb', ['b1'])])

    expect(expanded(closeCell(layout(colA(rows())), 'k2'))).toEqual(['k1-r'])
    expect(expanded(closeTab(layout(colA(rows())), 't2'))).toEqual(['k1-r'])
    expect(expanded(moveTab(layout(colA(rows()), other), 't2', { kind: 'cell', cellId: 'kb' }, seqIds()))).toEqual(['k1-r'])
    expect(expanded(movePanel(layout(colA(rows()), other), 'k2', { kind: 'cell', cellId: 'kb' }, seqIds()))).toEqual(['k1-r'])

    const firstGoes = [rowOf(cell('k1', ['t1'])), rowOf(cell('k2', ['t2']), { collapsed: true })]
    expect(expanded(closeCell(layout(colA(firstGoes)), 'k1'))).toEqual(['k2-r'])
  })

  it('removing a row leaves the others’ collapse alone while an expanded row remains, when it was collapsed, or while the row keeps a cell', () => {
    const three = [rowOf(cell('k1', ['t1']), { collapsed: true }), rowOf(cell('k2', ['t2'])), rowOf(cell('k3', ['t3']))]
    const left = closeCell(layout({ id: 'A', weight: 1, rows: three }), 'k3').columns[0]!.rows
    expect(left.map((r) => r.collapsed === true)).toEqual([true, false])

    const allCollapsed = [rowOf(cell('k1', ['t1']), { collapsed: true }), rowOf(cell('k2', ['t2']), { collapsed: true })]
    expect(closeCell(layout({ id: 'A', weight: 1, rows: allCollapsed }), 'k2').columns[0]!.rows[0]!.collapsed).toBe(true)

    // A cell of a two-cell row goes: the row (still there) keeps its collapse.
    const pair = [rowOf(cell('k1', ['t1']), { collapsed: true }), row('rp', [cell('k2', ['t2']), cell('k3', ['t3'])], { collapsed: true })]
    const kept = closeCell(layout({ id: 'A', weight: 1, rows: pair }), 'k3').columns[0]!.rows
    expect(kept.map((r) => r.collapsed === true)).toEqual([true, true])
  })

  it('a cell of a collapsed row moved to a new place opens expanded', () => {
    const l = setRowCollapsed(base(), 'kb-r', true)
    const next = movePanel(l, 'kb', { kind: 'cell-edge', cellId: 'kc', edge: 'top' }, seqIds())
    expect(next.columns[1]!.rows[0]!.collapsed).toBeUndefined()
  })

  it('no-ops: its own body or strip, its own edges, the gutters beside it, its column’s edges when alone', () => {
    const l = base()
    expect(movePanel(l, 'ka', { kind: 'cell', cellId: 'ka' }, seqIds())).toBe(l)
    expect(movePanel(l, 'ka', { kind: 'cell', cellId: 'ka', index: 1 }, seqIds())).toBe(l)
    expect(movePanel(l, 'ka', { kind: 'cell-edge', cellId: 'ka', edge: 'bottom' }, seqIds())).toBe(l)
    expect(movePanel(l, 'ka', { kind: 'cell-edge', cellId: 'ka', edge: 'right' }, seqIds())).toBe(l)
    expect(movePanel(l, 'ka', { kind: 'cell-edge', cellId: 'kb', edge: 'top' }, seqIds())).toBe(l)
    expect(movePanel(l, 'ka', { kind: 'row-edge', rowId: 'kb-r', edge: 'top' }, seqIds())).toBe(l)
    expect(movePanel(l, 'kc', { kind: 'column-edge', columnId: 'B', edge: 'left' }, seqIds())).toBe(l)
    expect(movePanel(l, 'kc', { kind: 'column-edge', columnId: 'A', edge: 'right' }, seqIds())).toBe(l)
    expect(movePanel(l, 'kd', { kind: 'layout' }, seqIds())).toBe(l)
    expect(movePanel(l, 'nope', { kind: 'layout' }, seqIds())).toBe(l)
    // A cell of a column with others still moves to its column's edge.
    expect(movePanel(l, 'ka', { kind: 'column-edge', columnId: 'A', edge: 'left' }, seqIds())).not.toBe(l)
    // A cell of a two-cell row: beside its neighbour is a no-op; its row's edge is not, nor its column's.
    const p = paired()
    expect(movePanel(p, 'ke', { kind: 'cell-edge', cellId: 'kb', edge: 'right' }, seqIds())).toBe(p)
    expect(shape(movePanel(p, 'ke', { kind: 'row-edge', rowId: 'rp', edge: 'top' }, seqIds()))[0]).toEqual([['a1', 'a2'], ['a4'], ['a3']])
  })

  it('a cell moves into a band, makes a new band (first tab active), or merges into the existing one', () => {
    const l = setActiveTab(base(), 'a2')
    const nb = movePanel(l, 'ka', { kind: 'new-band', edge: 'bottom' }, seqIds())
    expect(nb.bottom).toEqual({ id: 'n1', height: BAND_DEFAULT_HEIGHT, cells: [{ id: 'n2', weight: 1, tabs: l.columns[0]!.rows[0]!.cells[0]!.tabs, activeTabId: 'a1' }] })
    expect(shape(nb)[0]).toEqual([['a3']])
    const b = withBands()
    expect(movePanel(b, 'ka', { kind: 'new-band', edge: 'top' }, seqIds())).toBe(b)
    const merged = movePanel(b, 'kd', { kind: 'band', edge: 'top' }, seqIds())
    expect(bandShape(merged, 'top')).toEqual(['top1', 'top2', 'c1'])
    expect(merged.top?.cells[0]?.activeTabId).toBe('c1')
    expect(merged.columns.length).toBe(2)
  })

  it('a band’s cell moves to the other edge, into the other band, into a cell, or out as a column; its band goes', () => {
    const b = withBands()
    const other = movePanel(b, 'tb', { kind: 'new-band', edge: 'bottom' }, seqIds())
    expect('top' in other).toBe(false)
    expect(bandShape(other, 'bottom')).toEqual(['top1', 'top2'])
    expect(movePanel(b, 'tb', { kind: 'new-band', edge: 'top' }, seqIds())).toBe(b)
    expect(movePanel(b, 'tb', { kind: 'band', edge: 'top' }, seqIds())).toBe(b)
    const both = { ...b, bottom: { id: 'BB', height: 100, cells: [{ id: 'bb', weight: 1, tabs: [createTab('notes', 'bot1')] }] } }
    const into = movePanel(both, 'tb', { kind: 'band', edge: 'bottom' }, seqIds())
    expect(bandShape(into, 'bottom')).toEqual(['bot1', 'top1', 'top2'])
    expect(into.bottom?.height).toBe(100)
    const cell = movePanel(b, 'tb', { kind: 'cell', cellId: 'kc' }, seqIds())
    expect(shape(cell)[1]).toEqual([['b1', 'top1', 'top2']])
    const column = movePanel(b, 'tb', { kind: 'layout' }, seqIds())
    expect('top' in column).toBe(false)
    expect(shape(column).at(-1)).toEqual([['top1', 'top2']])
    expect(column.columns.at(-1)!.rows[0]!.cells[0]!.activeTabId).toBe('top2')
  })
})

describe('bands, unchanged by column edits', () => {
  const withBands = (): WorkspaceLayout => ({
    ...base(),
    top: { id: 'TB', height: 160, cells: [{ id: 'tb', weight: 1, tabs: [createTab('dashboard', 'top1')] }] },
    bottom: { id: 'BB', height: 120, cells: [{ id: 'bb', weight: 1, tabs: [createTab('calendar', 'bot1'), createTab('notes', 'bot2')] }] },
  })

  it('column, row and cell edits keep the bands as they are', () => {
    const l = withBands()
    const moved = moveTab(addTab(l, createTab('notes', 'x'), { kind: 'layout' }, seqIds()), 'a1', { kind: 'cell', cellId: 'kd' }, seqIds())
    expect(moved.top).toBe(l.top)
    expect(moved.bottom).toBe(l.bottom)
    expect(setColumnWeights(l, { A: 2 }).top).toBe(l.top)
    expect(setRowWeights(l, { 'ka-r': 2 }).bottom).toBe(l.bottom)
    expect(setCellWeights(l, { ka: 2 }).top).toBe(l.top)
  })
})
