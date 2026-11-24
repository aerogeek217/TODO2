import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, cleanup, fireEvent, screen, within, act } from '@testing-library/react'
import { DndContext } from '@dnd-kit/core'
import { WorkspaceView } from '../../../components/workspace/WorkspaceView'
import { useUIStore } from '../../../stores/ui-store'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import { createTab, type LayoutBody, type LayoutTab, type PersistedWorkspaceLayout } from '../../../models/workspace-layout'
import { columnStrips } from '../../../utils/workspace-table'
import { resetEntityStores } from '../../helpers'
import { cell, grid } from '../../helpers/layout-builders'

/**
 * Collapse column: a collapsed column draws as a strip — Expand column at
 * its top, then each cell's widget named down it, a name opening that widget
 * larger —, and a divider's pill collapses the columns (rows) on either side
 * of it. Outside the layout edit mode only.
 */

const AT = new Date(2026, 0, 1)

const named = (id: string, name: string): LayoutTab => ({ ...createTab('notes', id), name })
const filled = (id: string, name: string) => cell(id, [named(`${id}-t`, name)], { activeTabId: `${id}-t` })

function open(body: LayoutBody): void {
  const layout: PersistedWorkspaceLayout = { id: 1, sortOrder: 0, name: 'Main', createdAt: AT, modifiedAt: AT, ...body }
  useWorkspaceStore.setState({ layouts: [layout], activeLayoutId: 1, working: layout, saved: layout, writeFailed: false, hydrated: true })
}

function working(): LayoutBody {
  const w = useWorkspaceStore.getState().working
  if (!w) throw new Error('no working layout')
  return w
}

function show(): void {
  const w = useWorkspaceStore.getState().working as PersistedWorkspaceLayout
  render(<DndContext><WorkspaceView layout={w} /></DndContext>)
}

const folded = (body: LayoutBody, axis: 'columns' | 'rows') => body.grid[axis].map((t) => t.collapsed === true)

/**
 * a c
 * b c    — c's column collapsed, a over b in the other, then the right
 * w w      column's two cells (q over s) stacked: one strip names both.
 */
function stacked(collapsed: boolean): LayoutBody {
  const [a, b, q, s, w] = [filled('a', 'Alpha'), filled('b', 'Beta'), filled('q', 'Queue'), filled('s', 'Shelf'), filled('w', 'Wide')]
  return grid([[a, q], [b, s], [w, w]], { cols: [1000, collapsed ? { weight: 1000, collapsed: true } : 1000] })
}

beforeEach(() => {
  resetEntityStores()
})

afterEach(cleanup)

describe('a collapsed column’s strip', () => {
  it('joins the cells stacked in it into one strip; a cell spanning through it parts it', () => {
    const strips = columnStrips(stacked(true))
    expect(strips.map((s) => ({ rows: [s.r0, s.r1], cols: [s.c0, s.c1], cells: s.cells.map((c) => c.id), tracks: s.trackIds }))).toEqual([
      { rows: [0, 2], cols: [1, 2], cells: ['q', 's'], tracks: ['c2'] },
    ])
    expect(columnStrips(stacked(false))).toEqual([])
  })

  it('draws Expand column and each widget’s name in place of the cells lying only in it; a cell spanning it still draws', () => {
    open(stacked(true))
    show()
    const strip = screen.getByRole('region', { name: 'Collapsed column' })
    expect(within(strip).getByRole('button', { name: 'Expand column' })).toBeTruthy()
    expect(within(strip).getAllByRole('button').map((b) => b.textContent)).toEqual(['›‹', 'Queue', 'Shelf'])
    expect(document.querySelector('[data-ws-cell="q"]')).toBeNull()
    expect(document.querySelector('[data-ws-cell="s"]')).toBeNull()
    expect(document.querySelector('[data-ws-cell="w"]')).not.toBeNull()
    expect(document.querySelector('[data-ws-cell="a"]')).not.toBeNull()
  })

  it('a name opens that widget larger, the column left collapsed', async () => {
    open(stacked(true))
    show()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Shelf' })) })
    expect(useUIStore.getState().widgetPopup).toEqual({ kind: 'tab', tabId: 's-t' })
    expect(folded(working(), 'columns')).toEqual([false, true])
  })

  it('Expand column expands it — view state, no undo step', async () => {
    open(stacked(true))
    show()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Expand column' })) })
    expect(folded(working(), 'columns')).toEqual([false, false])
  })

  it('in the layout edit mode the column’s cells are cards like any other: no strip', () => {
    open(stacked(true))
    useWorkspaceStore.setState({ editing: { layoutId: 1, selectedCellId: null, undo: [], redo: [], createdLists: [] } })
    show()
    expect(screen.queryByRole('region', { name: 'Collapsed column' })).toBeNull()
    expect(document.querySelector('[data-ws-cell="q"]')).not.toBeNull()
  })
})

describe('a divider’s collapse pill', () => {
  it('between columns: ◂ collapses the column on the left, ▸ the one on the right', async () => {
    const [p, q] = [filled('p', 'Pine'), filled('q', 'Quay')]
    open(grid([[p, q]]))
    show()
    expect(screen.getByRole('button', { name: 'Collapse the column on the left' })).toBeTruthy()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Collapse the column on the right' })) })
    expect(folded(working(), 'columns')).toEqual([false, true])
  })

  it('between rows: ▴ collapses the rows above (every row the cells there cover), ▾ the row below', async () => {
    const [p, q, r, s] = [filled('p', 'Pine'), filled('q', 'Quay'), filled('r', 'Reed'), filled('s', 'Sand')]
    // p spans two rows above the line under it; s is the row below.
    open(grid([[p, q], [p, r], [s, s]]))
    show()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Collapse the rows above' })) })
    expect(folded(working(), 'rows')).toEqual([true, true, false])
  })

  it('offers no button for a side of only empty cells, and none in the layout edit mode', () => {
    const [p, e] = [filled('p', 'Pine'), cell('e', [])]
    open(grid([[p, e]]))
    show()
    expect(screen.getByRole('button', { name: 'Collapse the column on the left' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Collapse the column on the right' })).toBeNull()
    cleanup()
    useWorkspaceStore.setState({ editing: { layoutId: 1, selectedCellId: null, undo: [], redo: [], createdLists: [] } })
    show()
    expect(screen.queryByRole('button', { name: 'Collapse the column on the left' })).toBeNull()
  })

  it('a line beside a collapsed column has no divider, and so no pill', () => {
    open(stacked(true))
    show()
    expect(document.querySelectorAll('[data-ws-divider][data-axis="columns"]')).toHaveLength(0)
    // The row line between q and s lies inside the strip: no divider there either.
    expect(Array.from(document.querySelectorAll('[data-ws-divider][data-axis="rows"]')).map((d) => d.getAttribute('data-ws-divider'))).toEqual(['a|b', 'b|w'])
  })
})
