import { describe, it, expect } from 'vitest'
import { BAND_DEFAULT_HEIGHT, createTab, type LayoutCell, type LayoutColumn, type WorkspaceLayout } from '../../models/workspace-layout'
import {
  addTab,
  closeCell,
  closeTab,
  countListTabs,
  findPanel,
  findTab,
  getPanel,
  getTab,
  layoutPanels,
  movePanel,
  panelOfTab,
  setBandHeight,
  layoutIds,
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

  it('a view-state key patched to undefined is removed', () => {
    const l = replaceTab(base(), 'a1', createTab('lens', 'a1'))
    const set = patchTabViewState(l, 'a1', 'lens', { detailsWidth: 300 })
    expect(set.columns[0]!.cells[0]!.tabs[0]!.viewState).toEqual({ detailsWidth: 300 })
    const cleared = patchTabViewState(set, 'a1', 'lens', { detailsWidth: undefined })
    expect(cleared.columns[0]!.cells[0]!.tabs[0]!.viewState).toEqual({})
    expect(layoutStructureEqual(l, set)).toBe(true)
  })

  it('replaceTab swaps a tab in place and keeps it active', () => {
    const l = base()
    const next = replaceTab(l, 'a1', createTab('eisenhower', 'a1'))
    expect(next.columns[0]!.cells[0]!.tabs[0]).toEqual({ id: 'a1', kind: 'eisenhower', config: {} })
    expect(next.columns[0]!.cells[0]!.activeTabId).toBe('a1')
    expect(replaceTab(l, 'a1', createTab('eisenhower', 'b1'))).toBe(l)
  })
})

describe('layoutStructureEqual', () => {
  it('ignores view state (active tab, collapsed, viewState) and key order', () => {
    const l = addTab(base(), createTab('calendar', 'cal'), { kind: 'cell', cellId: 'kd' }, seqIds())
    let v = setActiveTab(l, 'c1')
    v = setCellCollapsed(v, 'ka', true)
    v = patchTabViewState(v, 'cal', 'calendar', { view: 'month' })
    expect(layoutStructureEqual(l, v)).toBe(true)
    const reordered: LayoutColumn[] = l.columns.map((c) => ({ cells: c.cells, weight: c.weight, id: c.id }))
    expect(layoutStructureEqual(l, { columns: reordered })).toBe(true)
  })

  it('compares weights as shares of their siblings', () => {
    const l = base()
    expect(layoutStructureEqual(l, setColumnWeights(l, { A: 2, B: 2, C: 2 }))).toBe(true)
    expect(layoutStructureEqual(l, setCellWeights(l, { kc: 0.25 }))).toBe(true) // only cell of its column
    expect(layoutStructureEqual(l, setCellWeights(l, { ka: 0.25 }))).toBe(false)
  })

  it('sees structure, weights and config', () => {
    const l = addTab(base(), createTab('calendar', 'cal'), { kind: 'cell', cellId: 'kd' }, seqIds())
    expect(layoutStructureEqual(l, moveTab(l, 'a1', { kind: 'cell', cellId: 'ka', index: 1 }, seqIds()))).toBe(false)
    expect(layoutStructureEqual(l, setColumnWeights(l, { A: 3 }))).toBe(false)
    expect(layoutStructureEqual(l, patchTabConfig(l, 'cal', 'calendar', { dateTypes: { due: true, followup: false } }))).toBe(false)
  })
})

describe('bands', () => {
  const withBands = (): WorkspaceLayout => ({
    ...base(),
    top: { id: 'tb', height: 160, tabs: [createTab('dashboard', 'top1')] },
    bottom: { id: 'bb', height: 120, tabs: [createTab('calendar', 'bot1'), createTab('notes', 'bot2')] },
  })

  it('layoutIds holds the bands and their tabs, so a new id never repeats one', () => {
    const ids = layoutIds(withBands())
    for (const id of ['A', 'ka', 'a1', 'tb', 'top1', 'bb', 'bot1', 'bot2']) expect(ids.has(id), id).toBe(true)
  })

  const bandTabs = (l: WorkspaceLayout, edge: 'top' | 'bottom') => l[edge]?.tabs.map((t) => t.id)

  it('findTab / panelOfTab / getTab and the view-state ops reach band tabs', () => {
    const l = withBands()
    expect(findTab(l, 'bot2')).toEqual({ panel: { kind: 'band', edge: 'bottom' }, panelId: 'bb', tabIdx: 1 })
    expect(panelOfTab(l, 'top1')?.id).toBe('tb')
    expect(getTab(l, 'bot1')?.kind).toBe('calendar')
    expect(findPanel(l, 'bb')).toEqual({ kind: 'band', edge: 'bottom' })
    expect(getPanel(l, 'kc')?.id).toBe('kc')
    const active = setActiveTab(l, 'bot2')
    expect(active.bottom?.activeTabId).toBe('bot2')
    expect(active.bottom?.height).toBe(120)
    const collapsed = setCellCollapsed(l, 'tb', true)
    expect(collapsed.top?.collapsed).toBe(true)
    expect(setCellCollapsed(collapsed, 'tb', false).top).toEqual(l.top)
    const vs = patchTabViewState(l, 'bot1', 'calendar', { view: 'week' })
    expect(vs.bottom?.tabs[0]?.viewState).toEqual({ view: 'week' })
    const lens = patchTabViewState(replaceTab(l, 'top1', createTab('lens', 'top1')), 'top1', 'lens', { detailsWidth: 240 })
    expect(lens.top?.tabs[0]?.viewState).toEqual({ detailsWidth: 240 })
    expect(patchTabConfig(l, 'bot1', 'calendar', { dateTypes: { due: false, followup: true } }).bottom?.tabs[0]?.config).toEqual({ dateTypes: { due: false, followup: true } })
    expect(layoutPanels(l).map((p) => p.id)).toEqual(['tb', 'ka', 'kb', 'kc', 'kd', 'bb'])
    expect(countListTabs(replaceTab(l, 'top1', createTab('lens', 'top1', { listDefinitionId: 7 })), 7)).toBe(1)
  })

  it('a tab moves into a band (body: at the end; strip: at the index) and out of it; an emptied band goes', () => {
    const l = withBands()
    const into = moveTab(l, 'a3', { kind: 'band', edge: 'top' }, seqIds())
    expect(bandTabs(into, 'top')).toEqual(['top1', 'a3'])
    expect(into.top?.activeTabId).toBe('a3')
    expect(shape(into)[0]).toEqual([['a1', 'a2']])
    const strip = moveTab(l, 'b1', { kind: 'cell', cellId: 'bb', index: 1 }, seqIds())
    expect(bandTabs(strip, 'bottom')).toEqual(['bot1', 'b1', 'bot2'])
    expect(shape(strip).length).toBe(2) // column B emptied and went
    const out = moveTab(l, 'top1', { kind: 'cell', cellId: 'kc' }, seqIds())
    expect(out.top).toBeUndefined()
    expect('top' in out).toBe(false)
    expect(shape(out)[1]).toEqual([['b1', 'top1']])
    // Reordering inside a band
    const reordered = moveTab(l, 'bot1', { kind: 'band', edge: 'bottom', index: 1 }, seqIds())
    expect(bandTabs(reordered, 'bottom')).toEqual(['bot2', 'bot1'])
    expect(moveTab(l, 'bot1', { kind: 'band', edge: 'bottom' }, seqIds())).toBe(l)
  })

  it('a tab makes a new band only where there is none: first tab active, default height', () => {
    const l = { ...base(), bottom: withBands().bottom }
    const next = moveTab(l, 'a1', { kind: 'new-band', edge: 'top' }, seqIds())
    expect(next.top).toEqual({ id: 'n1', height: BAND_DEFAULT_HEIGHT, tabs: [l.columns[0]!.cells[0]!.tabs[0]], activeTabId: 'a1' })
    expect(moveTab(l, 'a1', { kind: 'new-band', edge: 'bottom' }, seqIds())).toBe(l)
    // The only tab of the bottom band onto the free top edge: the band moves.
    const moved = moveTab(l, 'bot1', { kind: 'new-band', edge: 'top' }, seqIds())
    expect(bandTabs(moved, 'top')).toEqual(['bot1'])
    expect(bandTabs(moved, 'bottom')).toEqual(['bot2'])
    expect(addTab(base(), createTab('notes', 'x'), { kind: 'new-band', edge: 'bottom' }, seqIds()).bottom?.tabs.map((t) => t.id)).toEqual(['x'])
    expect(addTab(l, createTab('notes', 'x'), { kind: 'band', edge: 'bottom' }, seqIds()).bottom?.tabs.map((t) => t.id)).toEqual(['bot1', 'bot2', 'x'])
    expect(addTab(base(), createTab('notes', 'x'), { kind: 'band', edge: 'top' }, seqIds()).top).toBeUndefined()
  })

  it('closeTab / closeCell remove a band once its last tab goes', () => {
    const l = withBands()
    expect('top' in closeTab(l, 'top1')).toBe(false)
    const one = closeTab(l, 'bot1')
    expect(bandTabs(one, 'bottom')).toEqual(['bot2'])
    expect('bottom' in closeCell(l, 'bb')).toBe(false)
    expect(splitCell(l, 'tb', 'below', seqIds())).toEqual({ layout: l, cellId: null })
  })

  it('setBandHeight changes the height (rounded), only for a band that exists and a positive height', () => {
    const l = withBands()
    expect(setBandHeight(l, 'top', 201.6).top?.height).toBe(202)
    expect(setBandHeight(l, 'top', 160)).toBe(l)
    expect(setBandHeight(l, 'top', 0)).toBe(l)
    expect(setBandHeight(l, 'top', Number.NaN)).toBe(l)
    expect(setBandHeight(base(), 'top', 200).top).toBeUndefined()
  })

  it('layoutStructureEqual sees a band added, removed, resized or its tabs changed — not its view state', () => {
    const l = withBands()
    expect(layoutStructureEqual(l, base())).toBe(false)
    expect(layoutStructureEqual(l, setBandHeight(l, 'top', 200))).toBe(false)
    expect(layoutStructureEqual(l, moveTab(l, 'bot1', { kind: 'band', edge: 'bottom', index: 1 }, seqIds()))).toBe(false)
    expect(layoutStructureEqual(l, patchTabConfig(l, 'bot1', 'calendar', { dateTypes: { due: false, followup: true } }))).toBe(false)
    let v = setActiveTab(l, 'bot2')
    v = setCellCollapsed(v, 'tb', true)
    v = patchTabViewState(v, 'bot1', 'calendar', { offset: 2 })
    expect(layoutStructureEqual(l, v)).toBe(true)
    expect(layoutStructureEqual(base(), { columns: base().columns })).toBe(true)
  })
})

describe('movePanel', () => {
  const withBands = (): WorkspaceLayout => ({
    ...base(),
    top: { id: 'tb', height: 160, tabs: [createTab('dashboard', 'top1'), createTab('notes', 'top2')], activeTabId: 'top2' },
  })

  it('merging into another cell appends every tab in order; the first moved tab is active', () => {
    const next = movePanel(base(), 'ka', { kind: 'cell', cellId: 'kd' }, seqIds())
    expect(shape(next)).toEqual([[['a3']], [['b1']], [['c1', 'a1', 'a2']]])
    expect(next.columns[2]!.cells[0]!.activeTabId).toBe('a1')
    const strip = movePanel(base(), 'ka', { kind: 'cell', cellId: 'kd', index: 0 }, seqIds())
    expect(shape(strip)[2]).toEqual([['a1', 'a2', 'c1']])
  })

  it('a cell edge makes a new cell with the panel (keeping its active tab); a column edge a new column', () => {
    const l = setActiveTab(base(), 'a2')
    const edge = movePanel(l, 'ka', { kind: 'cell-edge', cellId: 'kc', edge: 'bottom' }, seqIds())
    expect(shape(edge)).toEqual([[['a3']], [['b1'], ['a1', 'a2']], [['c1']]])
    expect(edge.columns[1]!.cells[1]!.activeTabId).toBe('a2')
    expect(edge.columns[1]!.cells[1]!.weight).toBe(0.5)
    const col = movePanel(l, 'kb', { kind: 'column-edge', columnId: 'C', edge: 'right' }, seqIds())
    expect(shape(col)).toEqual([[['a1', 'a2']], [['b1']], [['c1']], [['a3']]])
    // The only cell of column B: column B goes.
    const lone = movePanel(base(), 'kc', { kind: 'column-edge', columnId: 'A', edge: 'left' }, seqIds())
    expect(shape(lone)).toEqual([[['b1']], [['a1', 'a2'], ['a3']], [['c1']]])
    expect(movePanel(base(), 'kc', { kind: 'layout' }, seqIds()).columns.map((c) => c.cells[0]!.tabs[0]!.id)).toEqual(['a1', 'c1', 'b1'])
  })

  it('a collapsed panel moved to a new place opens expanded', () => {
    const l = setCellCollapsed(base(), 'kb', true)
    const next = movePanel(l, 'kb', { kind: 'cell-edge', cellId: 'kc', edge: 'top' }, seqIds())
    expect(next.columns[1]!.cells[0]!.collapsed).toBeUndefined()
  })

  it('no-ops: its own body or strip, its own edges, the gutters beside it, its column’s edges when alone', () => {
    const l = base()
    expect(movePanel(l, 'ka', { kind: 'cell', cellId: 'ka' }, seqIds())).toBe(l)
    expect(movePanel(l, 'ka', { kind: 'cell', cellId: 'ka', index: 1 }, seqIds())).toBe(l)
    expect(movePanel(l, 'ka', { kind: 'cell-edge', cellId: 'ka', edge: 'bottom' }, seqIds())).toBe(l)
    expect(movePanel(l, 'ka', { kind: 'cell-edge', cellId: 'kb', edge: 'top' }, seqIds())).toBe(l)
    expect(movePanel(l, 'kc', { kind: 'column-edge', columnId: 'B', edge: 'left' }, seqIds())).toBe(l)
    expect(movePanel(l, 'kc', { kind: 'column-edge', columnId: 'A', edge: 'right' }, seqIds())).toBe(l)
    expect(movePanel(l, 'kd', { kind: 'layout' }, seqIds())).toBe(l)
    expect(movePanel(l, 'nope', { kind: 'layout' }, seqIds())).toBe(l)
    // A cell of a column with others still moves to its column's edge.
    expect(movePanel(l, 'ka', { kind: 'column-edge', columnId: 'A', edge: 'left' }, seqIds())).not.toBe(l)
  })

  it('a panel moves into a band, makes a new band (first tab active), or merges into the existing one', () => {
    const l = setActiveTab(base(), 'a2')
    const nb = movePanel(l, 'ka', { kind: 'new-band', edge: 'bottom' }, seqIds())
    expect(nb.bottom).toEqual({ id: 'n1', height: BAND_DEFAULT_HEIGHT, tabs: l.columns[0]!.cells[0]!.tabs, activeTabId: 'a1' })
    expect(shape(nb)[0]).toEqual([['a3']])
    const b = withBands()
    expect(movePanel(b, 'ka', { kind: 'new-band', edge: 'top' }, seqIds())).toBe(b)
    const merged = movePanel(b, 'kd', { kind: 'band', edge: 'top' }, seqIds())
    expect(merged.top?.tabs.map((t) => t.id)).toEqual(['top1', 'top2', 'c1'])
    expect(merged.top?.activeTabId).toBe('c1')
    expect(merged.columns.length).toBe(2)
  })

  it('a band moves to the other edge, into the other band, into a cell, or out as a column; it goes from its edge', () => {
    const b = withBands()
    const other = movePanel(b, 'tb', { kind: 'new-band', edge: 'bottom' }, seqIds())
    expect('top' in other).toBe(false)
    expect(other.bottom?.tabs.map((t) => t.id)).toEqual(['top1', 'top2'])
    expect(movePanel(b, 'tb', { kind: 'new-band', edge: 'top' }, seqIds())).toBe(b)
    expect(movePanel(b, 'tb', { kind: 'band', edge: 'top' }, seqIds())).toBe(b)
    const both = { ...b, bottom: { id: 'bb', height: 100, tabs: [createTab('notes', 'bot1')] } }
    const into = movePanel(both, 'tb', { kind: 'band', edge: 'bottom' }, seqIds())
    expect(into.bottom?.tabs.map((t) => t.id)).toEqual(['bot1', 'top1', 'top2'])
    expect(into.bottom?.height).toBe(100)
    const cell = movePanel(b, 'tb', { kind: 'cell', cellId: 'kc' }, seqIds())
    expect(shape(cell)[1]).toEqual([['b1', 'top1', 'top2']])
    const column = movePanel(b, 'tb', { kind: 'layout' }, seqIds())
    expect('top' in column).toBe(false)
    expect(shape(column).at(-1)).toEqual([['top1', 'top2']])
    expect(column.columns.at(-1)!.cells[0]!.activeTabId).toBe('top2')
  })
})

describe('bands, unchanged by column edits', () => {
  const withBands = (): WorkspaceLayout => ({
    ...base(),
    top: { id: 'tb', height: 160, tabs: [createTab('dashboard', 'top1')] },
    bottom: { id: 'bb', height: 120, tabs: [createTab('calendar', 'bot1'), createTab('notes', 'bot2')] },
  })

  it('column and cell edits keep the bands as they are', () => {
    const l = withBands()
    const moved = moveTab(addTab(l, createTab('notes', 'x'), { kind: 'layout' }, seqIds()), 'a1', { kind: 'cell', cellId: 'kd' }, seqIds())
    expect(moved.top).toBe(l.top)
    expect(moved.bottom).toBe(l.bottom)
    expect(setColumnWeights(l, { A: 2 }).top).toBe(l.top)
  })
})
