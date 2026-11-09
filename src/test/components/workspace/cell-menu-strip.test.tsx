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
 * The cell's ⋯ menu (D26 P2 + AA1): the widget's own entries first, then
 * the table's words — Split cell ▸ Right / Below, Merge with ▸ (only into a
 * rectangle), Insert ▸ a row or column at an edge, Add widget… with where
 * first —; and tabs on demand: one widget has no strip, its top line holds
 * the grip and ⋯ and opens the menu on a right-click or Shift+F10.
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

function renderCell(c: CellSpec, extra: { fitRow?: boolean; collapsed?: boolean } = {}) {
  return render(
    <DndContext>
      <WorkspaceCell cell={placed(c)} rowTrackIds={['r1']} collapsed={extra.collapsed ?? false} fitRow={extra.fitRow} />
    </DndContext>,
  )
}

function cellMenu(name = 'Cell options'): HTMLElement {
  fireEvent.click(screen.getByRole('button', { name }))
  return screen.getByRole('menu', { name })
}

/** Every item of a menu, in order (radios and checkboxes too). */
function itemLabels(menu: HTMLElement): Array<string | null> {
  return Array.from(menu.querySelectorAll('[role^="menuitem"]')).map((el) => el.getAttribute('data-menu-label'))
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

  it('lists the widget’s entries, then the table’s words in order; one widget’s close is Close cell', () => {
    const k = cell('k', [createTab('notes', 'n')])
    open(single(k))
    renderCell(k)
    expect(itemLabels(cellMenu())).toEqual([
      'List', 'Notes', 'Numbers & charts',
      'Add widget…', 'Split cell', 'Merge with', 'Insert', 'Collapse row', 'Close cell',
    ])
  })

  it('with two widgets: the active one’s entries, then Close tab and Close cell (2 tabs)', () => {
    const k = cell('k', [createTab('notes', 'n'), createTab('calendar', 'c')], { activeTabId: 'c' })
    open(single(k))
    renderCell(k)
    const labels = itemLabels(cellMenu())
    expect(labels.slice(-3)).toEqual(['Collapse row', 'Close tab “Calendar”', 'Close cell (2 tabs)'])
    expect(labels.indexOf('Notes')).toBeLessThan(labels.indexOf('Add widget…'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Close tab “Calendar”' }))
    expect(working().cells[0]?.tabs.map((t) => t.id)).toEqual(['n'])
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

describe('tabs on demand (D26 AA1)', () => {
  const topLine = (cellId: string) => document.querySelector<HTMLElement>(`[data-ws-cell="${cellId}"] [data-widget-top-line]`)!

  it('one widget: no strip; its top line stands for the tab and holds the grip and ⋯', () => {
    const k = cell('k', [createTab('notes', 'n')])
    open(single(k))
    renderCell(k)
    expect(screen.queryByRole('tablist')).toBeNull()
    expect(document.querySelector('[data-ws-cell-header="k"]')).toBeNull()
    expect(topLine('k')).toHaveAttribute('data-ws-tab', 'n')
    expect(topLine('k')).toHaveTextContent('Notes')
    const slot = topLine('k').querySelector<HTMLElement>('[data-cell-controls]')!
    expect(slot.querySelector('[data-ws-panel-handle="k"]')).not.toBeNull()
    expect(within(slot).getByRole('button', { name: 'Cell options' })).toBeInTheDocument()
    // The slot is its top line's: the cell draws none of its own.
    expect(document.querySelectorAll('[data-cell-controls]')).toHaveLength(1)
  })

  it('two widgets: the strip, with the ⋯ in its header; no top line stands for a tab', () => {
    const k = cell('k', [createTab('notes', 'n'), createTab('calendar', 'c')], { activeTabId: 'n' })
    open(single(k))
    renderCell(k)
    expect(screen.getByRole('tablist')).toBeInTheDocument()
    expect(within(document.querySelector<HTMLElement>('[data-ws-cell-header="k"]')!).getByRole('button', { name: 'Cell options' })).toBeInTheDocument()
    expect(document.querySelectorAll('[data-widget-top-line][data-ws-tab]')).toHaveLength(0)
    expect(document.querySelector('[data-cell-controls]')).toBeNull()
  })

  it('a right-click on a tab opens the merged menu for that tab', () => {
    const k = cell('k', [createTab('notes', 'n'), createTab('calendar', 'c')], { activeTabId: 'c' })
    open(single(k))
    renderCell(k)
    fireEvent.contextMenu(document.querySelector('[data-ws-tab="n"]')!)
    const menu = screen.getByRole('menu', { name: 'Cell options' })
    expect(within(menu).getByRole('menuitemradio', { name: 'Notes' })).toHaveAttribute('aria-checked', 'true')
    expect(within(menu).getByRole('menuitem', { name: 'Close tab “Notes”' })).toBeInTheDocument()
  })

  it('a right-click on the top line opens the ⋯ menu; one in the widget’s body is left to it', () => {
    const k = cell('k', [createTab('notes', 'n')])
    open(single(k))
    renderCell(k)
    fireEvent.contextMenu(document.querySelector('[data-ws-cell-body="k"]')!)
    expect(screen.queryByRole('menu', { name: 'Cell options' })).toBeNull()
    fireEvent.contextMenu(topLine('k'))
    expect(screen.getByRole('menu', { name: 'Cell options' })).toBeInTheDocument()
  })

  it('Shift+F10 on the focused ⋯ and the Menu key on the top line open the ⋯ menu', () => {
    const k = cell('k', [createTab('notes', 'n')])
    open(single(k))
    renderCell(k)
    const more = within(topLine('k')).getByRole('button', { name: 'Cell options' })
    fireEvent.keyDown(more, { key: 'F10', shiftKey: true })
    expect(screen.getByRole('menu', { name: 'Cell options' })).toBeInTheDocument()
    expect(more).toHaveAttribute('aria-expanded', 'true')
    cleanup()
    renderCell(k)
    fireEvent.keyDown(topLine('k'), { key: 'ContextMenu' })
    expect(screen.getByRole('menu', { name: 'Cell options' })).toBeInTheDocument()
  })

  it('a glance widget alone: a right-click anywhere on it opens the menu; its slot floats over the cell (its line is in a button)', () => {
    const k = cell('k', [createTab('number', 'num')])
    open(single(k))
    renderCell(k)
    expect(topLine('k')).toHaveAttribute('data-ws-tab', 'num')
    expect(topLine('k').querySelector('[data-cell-controls]')).toBeNull()
    expect(document.querySelector('[data-ws-cell="k"] > [data-cell-controls]')).not.toBeNull()
    fireEvent.contextMenu(document.querySelector('[data-ws-cell-body="k"]')!)
    expect(screen.getByRole('menu', { name: 'Cell options' })).toBeInTheDocument()
  })

  it('collapsed with one widget: its top line shows, with Expand row', () => {
    const k = cell('k', [createTab('notes', 'n')])
    open(grid([[k]], { rows: [{ weight: 1000, collapsed: true }] }))
    renderCell(k, { collapsed: true })
    expect(topLine('k')).toHaveTextContent('Notes')
    fireEvent.click(within(topLine('k')).getByRole('button', { name: 'Expand row' }))
    expect(working().grid.rows[0]?.collapsed).not.toBe(true)
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

  it('a one-tab List cell at its small face: its click opens the full list over it, Esc closes it', () => {
    stubSize(400, 80)
    const k = cell('k', [listTab])
    open(single(k))
    renderCell(k)
    expect(cellEl('k').dataset.face).toBe('small')
    expect(screen.queryByRole('tablist')).toBeNull()
    expect(document.querySelector('[data-list-face="small"]')).not.toBeNull()

    fireEvent.click(document.querySelector('[data-list-face]')!)
    expect(popover()).not.toBeNull()
    expect(popover()!.getAttribute('aria-label')).toBe('Team')
    // The full widget, whatever the room: its rows — and no cell controls of its own in there.
    expect(within(popover()!).getAllByRole('button').some((b) => b.closest('[data-todo-id]'))).toBe(true)
    expect(popover()!.querySelector('[data-list-face]')).toBeNull()
    expect(popover()!.querySelector('[data-cell-controls]')).toBeNull()

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

  it('the ⋯ on a small face opens the menu, not the full widget', () => {
    stubSize(400, 80)
    const k = cell('k', [listTab])
    open(single(k))
    renderCell(k)
    fireEvent.click(screen.getByRole('button', { name: 'Cell options' }))
    expect(screen.getByRole('menu', { name: 'Cell options' })).toBeInTheDocument()
    expect(popover()).toBeNull()
  })

  it('a bigger List cell shows its whole list, its name on its filter line, and opens nothing on a click', () => {
    stubSize(400, 400)
    const k = cell('k', [listTab])
    open(single(k))
    renderCell(k)
    expect(cellEl('k').dataset.face).toBe('large')
    const line = within(cellEl('k')).getByTestId('list-filter-row')
    expect(line).toHaveAttribute('data-widget-top-line')
    expect(within(line).getByTestId('top-line-name')).toHaveTextContent('Team')
    fireEvent.click(cellEl('k').querySelector('[data-ws-cell-body]')!)
    expect(popover()).toBeNull()
    expect(screen.queryByRole('button', { name: 'Open Team' })).toBeNull()
  })

  it('a list whose filter line is hidden: alone, a slim top line with its name and count', () => {
    stubSize(400, 400)
    useListDefinitionStore.setState({
      listDefinitions: [{
        id: 7, name: 'Team', sortOrder: 0, owner: { layoutId: 1 }, showFilterLine: false,
        membership: { kind: 'custom', predicate: emptyPredicate() }, sort: 'manual', grouping: 'none',
      }],
    })
    const k = cell('k', [listTab])
    open(single(k))
    renderCell(k)
    expect(within(cellEl('k')).queryByTestId('list-filter-row')).toBeNull()
    const line = within(cellEl('k')).getByTestId('list-name-line')
    expect(within(line).getByTestId('top-line-name')).toHaveTextContent('Team')
    expect(within(line).getByTestId('list-count')).toHaveTextContent('2')
  })

  it('a fit row’s cell shows its widget’s small face, whatever its measured size', () => {
    stubSize(400, 400)
    const n = cell('n', [createTab('number', 'num')])
    open(single(n))
    renderCell(n, { fitRow: true })
    expect(cellEl('n').dataset.face).toBe('small')
    expect(document.querySelector('[data-glance]')!.getAttribute('data-face')).toBe('small')
  })

  it('a face with no top line of its own (the Eisenhower’s small one): the cell’s slot stands for the tab', () => {
    stubSize(400, 80)
    const k = cell('k', [createTab('eisenhower', 'e')])
    open(single(k))
    renderCell(k)
    expect(cellEl('k').dataset.face).toBe('small')
    const slot = document.querySelector<HTMLElement>('[data-ws-cell="k"] > [data-cell-controls]')!
    expect(slot).toHaveAttribute('data-ws-tab', 'e')
    expect(slot).toHaveAttribute('data-widget-top-line')
    expect(document.querySelectorAll('[data-ws-tab="e"]')).toHaveLength(1)
    fireEvent.contextMenu(slot)
    expect(screen.getByRole('menu', { name: 'Cell options' })).toBeInTheDocument()
  })

  it('a widget without faces (Notes) is large and never opens a popover', () => {
    stubSize(400, 60)
    const k = cell('k', [createTab('notes', 'n')])
    open(single(k))
    renderCell(k)
    expect(cellEl('k').dataset.face).toBe('large')
  })
})
