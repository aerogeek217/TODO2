import { describe, it, expect } from 'vitest'
import { createTab, type LayoutCell, type LayoutColumn, type WorkspaceLayout } from '../../models/workspace-layout'
import {
  addTab,
  closeCell,
  closeTab,
  layoutStructureEqual,
  moveTab,
  patchTabConfig,
  patchTabViewState,
  replaceTab,
  setActiveTab,
  setCellCollapsed,
  setCellWeights,
  setColumnWeights,
  splitCell,
} from '../../utils/workspace-layout-ops'

function cell(id: string, tabIds: string[], extra: Partial<LayoutCell> = {}): LayoutCell {
  const tabs = tabIds.map((t) => createTab('notes', t))
  return { id, weight: 1, tabs, ...(tabs[0] ? { activeTabId: tabs[0].id } : {}), ...extra }
}

function col(id: string, cells: LayoutCell[], weight = 1): LayoutColumn {
  return { id, weight, cells }
}

function layout(...columns: LayoutColumn[]): WorkspaceLayout {
  return { name: 'L', columns, createdAt: new Date(0), modifiedAt: new Date(0) }
}

/** Tab ids per cell per column. */
function shape(l: WorkspaceLayout): string[][][] {
  return l.columns.map((c) => c.cells.map((k) => k.tabs.map((t) => t.id)))
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

describe('addTab', () => {
  it('joins a cell at the end (or at an index) and becomes active', () => {
    const l = base()
    const end = addTab(l, createTab('calendar', 'x'), { kind: 'cell', cellId: 'ka' }, seqIds())
    expect(shape(end)[0]![0]).toEqual(['a1', 'a2', 'x'])
    expect(end.columns[0]!.cells[0]!.activeTabId).toBe('x')
    const front = addTab(l, createTab('calendar', 'x'), { kind: 'cell', cellId: 'ka', index: 0 }, seqIds())
    expect(shape(front)[0]![0]).toEqual(['x', 'a1', 'a2'])
  })

  it('cell edge: a new cell above / below that splits the hovered cell weight', () => {
    const l = base()
    const above = addTab(l, createTab('notes', 'x'), { kind: 'cell-edge', cellId: 'kb', edge: 'top' }, seqIds())
    expect(shape(above)[0]).toEqual([['a1', 'a2'], ['x'], ['a3']])
    expect(above.columns[0]!.cells.map((c) => c.weight)).toEqual([1, 0.5, 0.5])
    const below = addTab(l, createTab('notes', 'x'), { kind: 'cell-edge', cellId: 'kb', edge: 'bottom' }, seqIds())
    expect(shape(below)[0]).toEqual([['a1', 'a2'], ['a3'], ['x']])
    expect(below.columns[0]!.cells[2]).toMatchObject({ id: 'n1', activeTabId: 'x' })
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

  it('layout target appends a column; an empty layout gets one at the default weight', () => {
    const empty = layout()
    const first = addTab(empty, createTab('lens', 'x', { listDefinitionId: 4 }), { kind: 'layout' }, seqIds())
    expect(first.columns).toEqual([{ id: 'n1', weight: 1, cells: [{ id: 'n2', weight: 1, activeTabId: 'x', tabs: [{ id: 'x', kind: 'lens', config: { listDefinitionId: 4 } }] }] }])
    const last = addTab(base(), createTab('notes', 'x'), { kind: 'layout' }, seqIds())
    expect(shape(last).at(-1)).toEqual([['x']])
  })

  it('unknown target or a taken tab id → same layout', () => {
    const l = base()
    expect(addTab(l, createTab('notes', 'x'), { kind: 'cell', cellId: 'nope' }, seqIds())).toBe(l)
    expect(addTab(l, createTab('notes', 'a1'), { kind: 'cell', cellId: 'ka' }, seqIds())).toBe(l)
  })
})

describe('moveTab', () => {
  it('reorders within its own cell (index among the other tabs); no index = no-op', () => {
    const l = base()
    const moved = moveTab(l, 'a1', { kind: 'cell', cellId: 'ka', index: 1 }, seqIds())
    expect(shape(moved)[0]![0]).toEqual(['a2', 'a1'])
    expect(moved.columns[0]!.cells[0]!.activeTabId).toBe('a1')
    expect(moveTab(l, 'a2', { kind: 'cell', cellId: 'ka' }, seqIds())).toBe(l)
    expect(moveTab(l, 'a1', { kind: 'cell', cellId: 'ka', index: 0 }, seqIds())).toBe(l)
  })

  it('joins another cell; the source cell keeps its other tabs and re-picks its active tab', () => {
    const moved = moveTab(base(), 'a1', { kind: 'cell', cellId: 'kc', index: 0 }, seqIds())
    expect(shape(moved)).toEqual([[['a2'], ['a3']], [['a1', 'b1']], [['c1']]])
    expect(moved.columns[0]!.cells[0]!.activeTabId).toBe('a2')
    expect(moved.columns[1]!.cells[0]!.activeTabId).toBe('a1')
  })

  it('moving a cell\'s only tab removes the cell; a column\'s only cell removes the column', () => {
    const cellGone = moveTab(base(), 'a3', { kind: 'cell', cellId: 'kd' }, seqIds())
    expect(shape(cellGone)).toEqual([[['a1', 'a2']], [['b1']], [['c1', 'a3']]])
    const colGone = moveTab(base(), 'b1', { kind: 'cell', cellId: 'kd' }, seqIds())
    expect(shape(colGone)).toEqual([[['a1', 'a2'], ['a3']], [['c1', 'b1']]])
  })

  it('to a cell edge / column edge makes a new cell / column', () => {
    const edge = moveTab(base(), 'a1', { kind: 'cell-edge', cellId: 'kc', edge: 'bottom' }, seqIds())
    expect(shape(edge)).toEqual([[['a2'], ['a3']], [['b1'], ['a1']], [['c1']]])
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
    expect(moveTab(l, 'b1', { kind: 'column-edge', columnId: 'B', edge: 'left' }, seqIds())).toBe(l)
    expect(moveTab(l, 'b1', { kind: 'column-edge', columnId: 'B', edge: 'right' }, seqIds())).toBe(l)
    expect(moveTab(l, 'b1', { kind: 'column-edge', columnId: 'A', edge: 'right' }, seqIds())).toBe(l)
    expect(moveTab(l, 'c1', { kind: 'layout' }, seqIds())).toBe(l)
    // Not a no-op: a multi-tab cell's tab onto its own edge splits it.
    const split = moveTab(l, 'a1', { kind: 'cell-edge', cellId: 'ka', edge: 'top' }, seqIds())
    expect(shape(split)[0]).toEqual([['a1'], ['a2'], ['a3']])
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
    expect(closeTab(l, 't2').columns[0]!.cells[0]!.activeTabId).toBe('t1')
    const first = layout(col('A', [cell('k', ['t1', 't2'], { activeTabId: 't1' })]))
    expect(closeTab(first, 't1').columns[0]!.cells[0]!.activeTabId).toBe('t2')
  })

  it('closing the last tab removes the cell, then the empty column', () => {
    expect(shape(closeTab(base(), 'a3'))).toEqual([[['a1', 'a2']], [['b1']], [['c1']]])
    expect(shape(closeTab(base(), 'b1'))).toEqual([[['a1', 'a2'], ['a3']], [['c1']]])
    expect(shape(closeCell(base(), 'ka'))).toEqual([[['a3']], [['b1']], [['c1']]])
    expect(closeCell(base(), 'kc').columns.map((c) => c.id)).toEqual(['A', 'C'])
  })

  it('split below adds an empty cell under it; split right a new column with one empty cell', () => {
    const below = splitCell(base(), 'ka', 'below', seqIds())
    expect(below.cellId).toBe('n1')
    expect(shape(below.layout)[0]).toEqual([['a1', 'a2'], [], ['a3']])
    expect(below.layout.columns[0]!.cells[1]).toEqual({ id: 'n1', weight: 0.5, tabs: [] })
    const right = splitCell(base(), 'kb', 'right', seqIds())
    expect(shape(right.layout)).toEqual([[['a1', 'a2'], ['a3']], [[]], [['b1']], [['c1']]])
    expect(right.layout.columns[1]!.cells[0]!.id).toBe(right.cellId)
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
    const cells = setCellWeights(l, { ka: 0.3, kb: 0.7, kd: -1 })
    expect(cells.columns[0]!.cells.map((c) => c.weight)).toEqual([0.3, 0.7])
    expect(cells.columns[2]).toBe(l.columns[2])
    expect(setColumnWeights(l, { A: 1 })).toBe(l)
  })

  it('collapse / active tab change the cell only; a no-op returns the same layout', () => {
    const l = base()
    const collapsed = setCellCollapsed(l, 'ka', true)
    expect(collapsed.columns[0]!.cells[0]!.collapsed).toBe(true)
    expect('collapsed' in setCellCollapsed(collapsed, 'ka', false).columns[0]!.cells[0]!).toBe(false)
    expect(setCellCollapsed(l, 'ka', false)).toBe(l)
    expect(setActiveTab(l, 'a2').columns[0]!.cells[0]!.activeTabId).toBe('a2')
    expect(setActiveTab(l, 'a1')).toBe(l)
  })

  it('config / view-state patches apply only to a tab of the named kind', () => {
    const l = addTab(base(), createTab('calendar', 'cal'), { kind: 'cell', cellId: 'kd' }, seqIds())
    const types = patchTabConfig(l, 'cal', 'calendar', { dateTypes: { due: false, followup: true } })
    expect(types.columns[2]!.cells[0]!.tabs[1]).toMatchObject({ config: { dateTypes: { due: false, followup: true } } })
    expect(patchTabConfig(l, 'a1', 'calendar', { dateTypes: { due: false, followup: true } })).toBe(l)
    const view = patchTabViewState(l, 'cal', 'calendar', { view: 'month', offset: 2 })
    expect(view.columns[2]!.cells[0]!.tabs[1]!.viewState).toEqual({ view: 'month', offset: 2 })
    expect(patchTabViewState(view, 'cal', 'calendar', { offset: 2 })).toBe(view)
  })

  it('replaceTab swaps a tab in place and keeps it active', () => {
    const l = base()
    const next = replaceTab(l, 'a1', createTab('status', 'a1'))
    expect(next.columns[0]!.cells[0]!.tabs[0]).toEqual({ id: 'a1', kind: 'status', config: {} })
    expect(next.columns[0]!.cells[0]!.activeTabId).toBe('a1')
    expect(replaceTab(l, 'a1', createTab('status', 'b1'))).toBe(l)
  })
})

describe('layoutStructureEqual', () => {
  it('ignores view state (active tab, collapsed, viewState) and key order', () => {
    const l = addTab(base(), createTab('calendar', 'cal'), { kind: 'cell', cellId: 'kd' }, seqIds())
    let v = setActiveTab(l, 'c1')
    v = setCellCollapsed(v, 'ka', true)
    v = patchTabViewState(v, 'cal', 'calendar', { view: 'month' })
    expect(layoutStructureEqual(l.columns, v.columns)).toBe(true)
    const reordered: LayoutColumn[] = l.columns.map((c) => ({ cells: c.cells, weight: c.weight, id: c.id }))
    expect(layoutStructureEqual(l.columns, reordered)).toBe(true)
  })

  it('compares weights as shares of their siblings', () => {
    const l = base()
    expect(layoutStructureEqual(l.columns, setColumnWeights(l, { A: 2, B: 2, C: 2 }).columns)).toBe(true)
    expect(layoutStructureEqual(l.columns, setCellWeights(l, { kc: 0.25 }).columns)).toBe(true) // only cell of its column
    expect(layoutStructureEqual(l.columns, setCellWeights(l, { ka: 0.25 }).columns)).toBe(false)
  })

  it('sees structure, weights and config', () => {
    const l = addTab(base(), createTab('calendar', 'cal'), { kind: 'cell', cellId: 'kd' }, seqIds())
    expect(layoutStructureEqual(l.columns, moveTab(l, 'a1', { kind: 'cell', cellId: 'ka', index: 1 }, seqIds()).columns)).toBe(false)
    expect(layoutStructureEqual(l.columns, setColumnWeights(l, { A: 3 }).columns)).toBe(false)
    expect(layoutStructureEqual(l.columns, patchTabConfig(l, 'cal', 'calendar', { dateTypes: { due: true, followup: false } }).columns)).toBe(false)
  })
})
