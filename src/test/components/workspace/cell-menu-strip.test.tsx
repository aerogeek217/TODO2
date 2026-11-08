import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, cleanup, fireEvent, within, screen } from '@testing-library/react'
import { DndContext } from '@dnd-kit/core'
import { WorkspaceCell } from '../../../components/workspace/WorkspaceCell'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import { createTab, type LayoutBody, type LayoutCell, type PersistedWorkspaceLayout } from '../../../models/workspace-layout'
import { makeTodo, resetEntityStores } from '../../helpers'
import { emptyPredicate } from '../../../models'
import { useListDefinitionStore } from '../../../stores/list-definition-store'
import { useTodoStore } from '../../../stores/todo-store'
import { cell, grid, picture, single, type CellSpec } from '../../helpers/layout-builders'

/**
 * The cell menu in the table's words (D26 P2): Split cell ▸ Right / Below,
 * Merge with ▸ (only into a rectangle), Insert ▸ a row or column at an
 * edge, Add widget… with where first; and a headless cell (one glance tab,
 * or a widget at its small face): its strip marked hidden, its right-click
 * the tab menu. (P3 brings tabs on demand.)
 */

const AT = new Date(2026, 0, 1)

function open(body: LayoutBody): void {
  const layout: PersistedWorkspaceLayout = { id: 1, sortOrder: 0, name: 'Main', createdAt: AT, modifiedAt: AT, ...body }
  useWorkspaceStore.setState({ layouts: [layout], activeLayoutId: 1, working: layout, saved: layout, isDirty: false, hydrated: true })
}

function working(): LayoutBody {
  const w = useWorkspaceStore.getState().working
  if (!w) throw new Error('no working layout')
  return w
}

/** The cell `c` placed in a one-cell layout (its area there). */
function placed(c: CellSpec): LayoutCell {
  return single(c).cells[0]!
}

function renderCell(c: CellSpec, extra: { fitRow?: boolean } = {}) {
  return render(
    <DndContext>
      <WorkspaceCell cell={placed(c)} rowTrackIds={['r1']} collapsed={false} fitRow={extra.fitRow} />
    </DndContext>,
  )
}

function cellMenu(name = 'Cell options'): HTMLElement {
  fireEvent.click(screen.getByRole('button', { name }))
  return screen.getByRole('menu', { name })
}

beforeEach(() => {
  resetEntityStores()
})

afterEach(cleanup)

describe('the cell menu', () => {
  /** Opens the cell menu's `item` submenu (the last menu open). */
  function submenu(item: string): HTMLElement {
    fireEvent.click(within(cellMenu()).getByRole('menuitem', { name: item }))
    return screen.getAllByRole('menu').at(-1)!
  }

  it('lists the table’s words in order', () => {
    const k = cell('k', [createTab('notes', 'n')])
    open(single(k))
    renderCell(k)
    const labels = within(cellMenu()).getAllByRole('menuitem').map((el) => el.getAttribute('data-menu-label'))
    expect(labels).toEqual(['Add widget…', 'Split cell', 'Merge with', 'Insert', 'Collapse row', 'Close tab “Notes”', 'Close cell (1 tab)'])
  })

  it('Split cell ▸ Right puts an empty cell beside it; Below one under it', () => {
    const k = cell('k', [createTab('notes', 'n')])
    open(single(k))
    renderCell(k)
    const sub = submenu('Split cell')
    expect(within(sub).getAllByRole('menuitem').map((el) => el.getAttribute('data-menu-label'))).toEqual(['Right', 'Below'])
    fireEvent.click(within(sub).getByRole('menuitem', { name: 'Right' }))
    expect(working().cells.map((x) => x.tabs.length)).toEqual([1, 0])
    fireEvent.click(within(submenu('Split cell')).getByRole('menuitem', { name: 'Below' }))
    expect(picture(working())).toHaveLength(2)
    expect(working().cells).toHaveLength(3)
  })

  it('Merge with ▸ Right joins the cell beside it into one, its tabs after; Below is off when no rectangle', () => {
    const k = cell('k', [createTab('notes', 'n')])
    const m = cell('m', [createTab('notes', 'm1')])
    const w = cell('w', [createTab('notes', 'w1')])
    // k | m over w spanning both: k merges right with m, but nothing below makes a rectangle with it alone.
    open(grid([[k, m], [w, w]]))
    renderCell(k)
    const sub = submenu('Merge with')
    expect(within(sub).getByRole('menuitem', { name: 'Below' })).toBeDisabled()
    fireEvent.click(within(sub).getByRole('menuitem', { name: 'Right' }))
    expect(picture(working())).toEqual(['k', 'w'])
    expect(working().cells[0]?.tabs.map((t) => t.id)).toEqual(['n', 'm1'])
  })

  it('Insert ▸ Column at the left adds a full-height empty column', () => {
    const k = cell('k', [createTab('notes', 'n')])
    const m = cell('m', [createTab('notes', 'm1')])
    open(grid([[k], [m]]))
    renderCell(k)
    const sub = submenu('Insert')
    expect(within(sub).getAllByRole('menuitem').map((el) => el.getAttribute('data-menu-label')))
      .toEqual(['Row at the top', 'Row at the bottom', 'Column at the left', 'Column at the right'])
    fireEvent.click(within(sub).getByRole('menuitem', { name: 'Column at the left' }))
    const added = working().cells.find((c) => c.tabs.length === 0)
    expect(added?.area).toEqual({ col: 0, row: 0, colSpan: 1, rowSpan: 2 })
  })

  it('Add widget… asks where first: Below puts the widget in a new cell under it', () => {
    const k = cell('k', [createTab('notes', 'n')])
    open(single(k))
    renderCell(k)
    fireEvent.click(within(cellMenu()).getByRole('menuitem', { name: 'Add widget…' }))
    const add = screen.getByRole('menu', { name: 'Add widget' })
    const where = within(add).getByRole('group', { name: 'Where' })
    expect(within(where).getAllByRole('menuitemradio').map((el) => el.textContent)).toEqual(['Tab', 'Right', 'Below', 'Row', 'Column'])
    expect(within(where).getByRole('menuitemradio', { name: 'Tab' })).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(within(where).getByRole('menuitemradio', { name: 'Below' }))
    expect(within(where).getByRole('menuitemradio', { name: 'Below' })).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(within(add).getByRole('menuitem', { name: 'Notes' }))
    expect(working().cells).toHaveLength(2)
    expect(working().cells[1]?.area.row).toBe(1)
    expect(working().cells[1]?.tabs[0]?.kind).toBe('notes')
  })

  it('Collapse row collapses the row tracks the cell covers', () => {
    const k = cell('k', [createTab('notes', 'n')])
    const m = cell('m', [createTab('notes', 'm1')])
    open(grid([[k, m]]))
    renderCell(k)
    fireEvent.click(within(cellMenu()).getByRole('menuitem', { name: 'Collapse row' }))
    expect(working().grid.rows[0]?.collapsed).toBe(true)
  })
})

describe('a headless cell', () => {
  it('one glance tab: its strip marked hidden, a right-click anywhere on it opens its tab’s menu', () => {
    const k = cell('k', [createTab('trend', 't')])
    open(single(k))
    renderCell(k)
    expect(document.querySelector('[data-ws-cell="k"]')).toHaveAttribute('data-headless', 'true')
    expect(document.querySelector('[data-ws-cell-header="k"]')).toHaveAttribute('data-strip-hidden')
    fireEvent.contextMenu(document.querySelector('[data-ws-cell-body="k"]')!)
    expect(screen.getByRole('menu', { name: 'Change widget' })).toBeInTheDocument()
  })

  it('a cell that shows its strip leaves the right-click to its body', () => {
    const k = cell('k', [createTab('notes', 'n')])
    open(single(k))
    renderCell(k)
    expect(document.querySelector('[data-ws-cell="k"]')).not.toHaveAttribute('data-headless')
    fireEvent.contextMenu(document.querySelector('[data-ws-cell-body="k"]')!)
    expect(screen.queryByRole('menu', { name: 'Change widget' })).toBeNull()
  })
})

describe('a cell’s widget faces (D25 R)', () => {
  const listTab = { id: 'l', kind: 'lens' as const, config: { listDefinitionId: 7 } }
  const cellEl = (id: string) => document.querySelector<HTMLElement>(`[data-ws-cell="${id}"]`)!
  const popover = () => document.querySelector<HTMLElement>('[data-testid="widget-face-popover"]')

  /** Every element measures `width` × `height` (JSDOM lays nothing out). */
  function stubSize(width: number, height: number) {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(width)
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(height)
  }

  beforeEach(() => {
    useListDefinitionStore.setState({
      listDefinitions: [{
        id: 7, name: 'Team', sortOrder: 0, owner: { layoutId: 1 },
        membership: { kind: 'custom', predicate: emptyPredicate() }, sort: 'manual', grouping: 'none',
      }],
    })
    useTodoStore.setState({ todos: [makeTodo({ id: 1, title: 'One', sortOrder: 1 }), makeTodo({ id: 2, title: 'Two', sortOrder: 2 })] })
  })

  afterEach(() => vi.restoreAllMocks())

  it('a one-tab List cell at its small face is headless; its click opens the full list over it, Esc closes it', () => {
    stubSize(400, 80)
    const k = cell('k', [listTab])
    open(single(k))
    renderCell(k)
    expect(cellEl('k').dataset.face).toBe('small')
    expect(cellEl('k').dataset.headless).toBe('true')
    expect(document.querySelector('[data-list-face="small"]')).not.toBeNull()

    fireEvent.click(document.querySelector('[data-list-face]')!)
    expect(popover()).not.toBeNull()
    expect(popover()!.getAttribute('aria-label')).toBe('Team')
    // The full widget, whatever the room: its rows.
    expect(within(popover()!).getAllByRole('button').some((b) => b.closest('[data-todo-id]'))).toBe(true)
    expect(popover()!.querySelector('[data-list-face]')).toBeNull()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(popover()).toBeNull()
  })

  it('the keyboard opener opens it too; a second click on the face closes it', () => {
    stubSize(400, 80)
    const k = cell('k', [listTab])
    open(single(k))
    renderCell(k)
    fireEvent.click(screen.getByRole('button', { name: 'Open Team' }))
    expect(popover()).not.toBeNull()
    fireEvent.click(document.querySelector('[data-list-face]')!)
    expect(popover()).toBeNull()
  })

  it('a bigger List cell shows its strip and opens nothing on a click', () => {
    stubSize(400, 400)
    const k = cell('k', [listTab])
    open(single(k))
    renderCell(k)
    expect(cellEl('k').dataset.face).toBe('large')
    expect(cellEl('k').dataset.headless).toBeUndefined()
    fireEvent.click(cellEl('k').querySelector('[data-ws-cell-body]')!)
    expect(popover()).toBeNull()
    expect(screen.queryByRole('button', { name: 'Open Team' })).toBeNull()
  })

  it('a fit row’s cell shows its widget’s small face, whatever its measured size', () => {
    stubSize(400, 400)
    const n = cell('n', [createTab('number', 'num')])
    open(single(n))
    renderCell(n, { fitRow: true })
    expect(cellEl('n').dataset.face).toBe('small')
    expect(document.querySelector('[data-glance]')!.getAttribute('data-face')).toBe('small')
  })

  it('a widget without faces (Notes) is large and never opens a popover', () => {
    stubSize(400, 60)
    const k = cell('k', [createTab('notes', 'n')])
    open(single(k))
    renderCell(k)
    expect(cellEl('k').dataset.face).toBe('large')
    expect(cellEl('k').dataset.headless).toBeUndefined()
  })
})
