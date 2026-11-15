import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { DndContext } from '@dnd-kit/core'
import { WorkspaceView } from '../../../components/workspace/WorkspaceView'
import type { WorkspaceCellProps } from '../../../components/workspace/WorkspaceCell'
import { createTab, type WorkspaceLayout } from '../../../models/workspace-layout'
import { resetEntityStores } from '../../helpers'

/**
 * The table renders a cell again only when something of that cell changed
 * (cr34 M16): its own object, its row tracks, its collapse, its place.
 * Before, any change of the layout object — a tab switched in another cell —
 * and any render of the page above rendered every cell and every widget.
 */

const renders: string[] = []

// The cell itself is not this test's: a stand-in that records each render.
vi.mock('../../../components/workspace/WorkspaceCell', () => ({
  WorkspaceCell: ({ cell, rowTrackIds, collapsed, style }: WorkspaceCellProps) => {
    renders.push(cell.id)
    return <section data-ws-cell={cell.id} data-rows={rowTrackIds.join(',')} data-collapsed={String(collapsed)} style={style} />
  },
}))

const T0 = new Date('2026-09-01T09:00:00.000Z')

function layout(): WorkspaceLayout {
  return {
    name: 'Two', sortOrder: 0, createdAt: T0, modifiedAt: T0,
    grid: { columns: [{ id: 'c1', weight: 500 }, { id: 'c2', weight: 500 }], rows: [{ id: 'r1', weight: 600 }, { id: 'r2', weight: 400 }] },
    cells: [
      { id: 'left', area: { col: 0, row: 0, colSpan: 1, rowSpan: 2 }, activeTabId: 'n1', tabs: [createTab('notes', 'n1'), createTab('calendar', 'c1')] },
      { id: 'top', area: { col: 1, row: 0, colSpan: 1, rowSpan: 1 }, activeTabId: 'n2', tabs: [createTab('notes', 'n2')] },
      { id: 'bottom', area: { col: 1, row: 1, colSpan: 1, rowSpan: 1 }, activeTabId: 'n3', tabs: [createTab('notes', 'n3')] },
    ],
  }
}

const show = (l: WorkspaceLayout) => <DndContext><WorkspaceView layout={l} /></DndContext>
const cell = (id: string) => document.querySelector<HTMLElement>(`[data-ws-cell="${id}"]`)!

beforeEach(() => {
  resetEntityStores()
  renders.length = 0
})

afterEach(() => {
  cleanup()
})

describe('the table’s cells', () => {
  it('each cell gets its row tracks, its collapse and its place', () => {
    render(show(layout()))
    expect(renders.sort()).toEqual(['bottom', 'left', 'top'])
    expect(cell('left').dataset.rows).toBe('r1,r2')
    expect(cell('bottom').dataset.rows).toBe('r2')
    expect(cell('bottom').style.gridArea).toBe('2 / 2 / span 1 / span 1')
    expect(cell('left').dataset.collapsed).toBe('false')
  })

  it('a tab switched in one cell renders that cell alone', () => {
    const before = layout()
    const view = render(show(before))
    renders.length = 0
    // As `setActiveTab` leaves it: a new layout and a new object for that cell, the other cells' objects kept.
    const after: WorkspaceLayout = { ...before, cells: before.cells.map((c) => (c.id === 'left' ? { ...c, activeTabId: 'c1' } : c)) }
    view.rerender(show(after))
    expect(renders).toEqual(['left'])
  })

  it('the page above rendering again (Settings or the palette opening) renders no cell', () => {
    const l = layout()
    const view = render(show(l))
    renders.length = 0
    view.rerender(show(l))
    view.rerender(show({ ...l }))
    expect(renders).toEqual([])
  })

  it('a row collapsed renders the cells lying in it, with the collapse', () => {
    const before = layout()
    const view = render(show(before))
    renders.length = 0
    const rows = before.grid.rows.map((t) => (t.id === 'r2' ? { ...t, collapsed: true } : t))
    view.rerender(show({ ...before, grid: { ...before.grid, rows } }))
    expect(renders).toEqual(['bottom'])
    expect(cell('bottom').dataset.collapsed).toBe('true')
  })
})
