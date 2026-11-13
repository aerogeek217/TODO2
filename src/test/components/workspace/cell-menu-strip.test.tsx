import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, cleanup, fireEvent, within, screen, act } from '@testing-library/react'
import { DndContext } from '@dnd-kit/core'
import { WorkspaceCell } from '../../../components/workspace/WorkspaceCell'
import { WidgetPopupHost } from '../../../components/workspace/WidgetPopup'
import { registerOpenEditor } from '../../../stores/editor-leave'
import { useUIStore } from '../../../stores/ui-store'
import { useUndoStore } from '../../../stores/undo-store'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import { createTab, type LayoutBody, type LayoutCell, type PersistedWorkspaceLayout } from '../../../models/workspace-layout'
import { makeTodo, resetEntityStores } from '../../helpers'
import { emptyPredicate } from '../../../models'
import { useListDefinitionStore } from '../../../stores/list-definition-store'
import { useTodoStore } from '../../../stores/todo-store'
import { useFilterStore } from '../../../stores/filter-store'
import { cell, grid, picture, single, type CellSpec } from '../../helpers/layout-builders'

/**
 * The cell's menus (D26 P2 + AA1, UX cleanup 4A): the ⋯'s — the widget's
 * own entries, then Add widget… with where first —, the grip's — the table's
 * words: Split cell ▸ Right / Below, Merge with ▸ (only into a rectangle),
 * Insert ▸ a row or column at an edge, Collapse row, Close … —, and both on a
 * right-click or Shift+F10; and tabs on demand: one widget has no strip, its
 * top line holds the grip and ⋯.
 */

const AT = new Date(2026, 0, 1)

function open(body: LayoutBody): void {
  const layout: PersistedWorkspaceLayout = { id: 1, sortOrder: 0, name: 'Main', createdAt: AT, modifiedAt: AT, ...body }
  useWorkspaceStore.setState({ layouts: [layout], activeLayoutId: 1, working: layout, saved: layout, writeFailed: false, hydrated: true })
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
      <WidgetPopupHost />
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

/** A menu's group headings, in order. */
function headings(menu: HTMLElement): Array<string | null> {
  return Array.from(menu.querySelectorAll(':scope > [role="presentation"]')).map((el) => el.textContent)
}

beforeEach(() => {
  resetEntityStores()
})

afterEach(cleanup)

/** Opens the grip's menu (UX cleanup 4A): the cell's layout entries. */
function gripMenu(): HTMLElement {
  return cellMenu('Cell layout')
}

describe('the cell menu', () => {
  /** Opens the grip menu's `item` submenu (the last menu open). */
  function submenu(item: string): HTMLElement {
    fireEvent.click(within(gripMenu()).getByRole('menuitem', { name: item }))
    return screen.getAllByRole('menu').at(-1)!
  }

  it('the ⋯ lists the widget’s entries under its kind, then Add widget…; nothing of the layout', () => {
    const k = cell('k', [createTab('notes', 'n')])
    open(single(k))
    renderCell(k)
    const menu = cellMenu()
    expect(headings(menu)).toEqual(['Notes'])
    expect(itemLabels(menu)).toEqual(['Open larger', 'Name and icon…', 'Change widget', 'Add widget…'])
  })

  it('the grip lists the table’s words under Cell in order; one widget’s close is Close cell', () => {
    const k = cell('k', [createTab('notes', 'n')])
    open(single(k))
    renderCell(k)
    const grip = screen.getByRole('button', { name: 'Cell layout' })
    expect(grip).toHaveAttribute('aria-haspopup', 'menu')
    expect(grip).toHaveAttribute('aria-expanded', 'false')
    const menu = gripMenu()
    expect(headings(menu)).toEqual(['Cell'])
    expect(itemLabels(menu)).toEqual(['Split cell', 'Merge with', 'Insert', 'Collapse row', 'Close cell'])
    expect(grip).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: 'Cell options' })).toHaveAttribute('aria-expanded', 'false')
    // Its second click closes it.
    fireEvent.click(grip)
    expect(screen.queryByRole('menu', { name: 'Cell layout' })).toBeNull()
  })

  it('with two widgets: the header’s grip has Close tab and Close cell (2 tabs); the ⋯ the active one’s entries', () => {
    const k = cell('k', [createTab('notes', 'n'), createTab('calendar', 'c')], { activeTabId: 'c' })
    open(single(k))
    renderCell(k)
    const header = document.querySelector<HTMLElement>('[data-ws-cell-header="k"]')!
    expect(within(header).getByRole('button', { name: 'Cell layout' })).toHaveAttribute('aria-haspopup', 'menu')
    // The header's empty space drags, and is no button.
    expect(header.querySelector('[data-ws-panel-handle="k"]')?.tagName).toBe('DIV')
    const more = cellMenu()
    expect(headings(more)).toEqual(['Calendar'])
    expect(within(more).getByRole('menuitem', { name: /^Change widget/ })).toHaveTextContent('Calendar')
    expect(itemLabels(more).at(-1)).toBe('Add widget…')
    fireEvent.keyDown(document, { key: 'Escape' })
    const menu = gripMenu()
    expect(itemLabels(menu).slice(-3)).toEqual(['Collapse row', 'Close tab “Calendar”', 'Close cell (2 tabs)'])
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

  it('Add widget… asks where first, as a picture: Below puts the widget in a new cell under it', () => {
    const k = cell('k', [createTab('notes', 'n')])
    open(single(k))
    renderCell(k)
    fireEvent.click(within(cellMenu()).getByRole('menuitem', { name: 'Add widget…' }))
    const add = screen.getByRole('menu', { name: 'Add widget' })
    const where = within(add).getByRole('group', { name: 'Where' })
    expect(within(where).getAllByRole('menuitemradio').map((el) => el.getAttribute('aria-label'))).toEqual([
      'Insert row · full width, top', 'Insert column · full height, left',
      'Split · above', 'Split · left', 'Add as tab', 'Split · right', 'Split · below',
      'Insert column · full height, right', 'Insert row · full width, bottom',
    ])
    const caption = () => where.querySelector('[data-menu-picture-caption]')?.textContent
    // Default: a tab.
    const tab = within(where).getByRole('menuitemradio', { name: 'Add as tab' })
    expect(tab).toHaveAttribute('aria-checked', 'true')
    expect(tab).toHaveTextContent('Tab')
    expect(caption()).toBe('Add as tab')
    // Hover names a choice under the picture.
    fireEvent.mouseEnter(within(where).getByRole('menuitemradio', { name: 'Split · left' }))
    expect(caption()).toBe('Split · left')
    fireEvent.click(within(where).getByRole('menuitemradio', { name: 'Split · below' }))
    expect(within(where).getByRole('menuitemradio', { name: 'Split · below' })).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(within(add).getByRole('menuitem', { name: 'Notes' }))
    expect(working().cells).toHaveLength(2)
    expect(working().cells[1]?.area.row).toBe(1)
    expect(working().cells[1]?.tabs[0]?.kind).toBe('notes')
  })

  it.each([
    ['Split · above', { col: 0, row: 0, colSpan: 1, rowSpan: 1 }, 2],
    ['Split · left', { col: 0, row: 0, colSpan: 1, rowSpan: 1 }, 2],
    ['Insert row · full width, top', { col: 0, row: 0, colSpan: 1, rowSpan: 1 }, 2],
    ['Insert column · full height, left', { col: 0, row: 0, colSpan: 1, rowSpan: 1 }, 2],
    ['Insert row · full width, bottom', { col: 0, row: 1, colSpan: 1, rowSpan: 1 }, 2],
    ['Insert column · full height, right', { col: 1, row: 0, colSpan: 1, rowSpan: 1 }, 2],
    ['Split · right', { col: 1, row: 0, colSpan: 1, rowSpan: 1 }, 2],
    ['Add as tab', { col: 0, row: 0, colSpan: 1, rowSpan: 1 }, 1],
  ])('Where “%s” puts the new Notes there', (name, area, cells) => {
    const k = cell('k', [createTab('calendar', 'cal')])
    open(single(k))
    renderCell(k)
    fireEvent.click(within(cellMenu()).getByRole('menuitem', { name: 'Add widget…' }))
    const add = screen.getByRole('menu', { name: 'Add widget' })
    fireEvent.click(within(add).getByRole('menuitemradio', { name }))
    fireEvent.click(within(add).getByRole('menuitem', { name: 'Notes' }))
    expect(working().cells).toHaveLength(cells)
    const notes = working().cells.find((c) => c.tabs.some((t) => t.kind === 'notes'))
    expect(notes?.area).toEqual(area)
  })

  it('the Where picture: arrow keys move between zones by where they sit, ↓ past the bottom bar goes on to the kinds, Enter picks', () => {
    const k = cell('k', [createTab('notes', 'n')])
    open(single(k))
    renderCell(k)
    fireEvent.click(within(cellMenu()).getByRole('menuitem', { name: 'Add widget…' }))
    const add = screen.getByRole('menu', { name: 'Add widget' })
    const focused = () => document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.textContent
    expect(focused()).toBe('Add as tab')
    const key = (k: string) => fireEvent.keyDown(document.activeElement!, { key: k })
    key('ArrowLeft')
    expect(focused()).toBe('Split · left')
    key('ArrowLeft')
    expect(focused()).toBe('Insert column · full height, left')
    key('ArrowRight')
    key('ArrowRight')
    key('ArrowUp')
    expect(focused()).toBe('Split · above')
    key('ArrowUp')
    expect(focused()).toBe('Insert row · full width, top')
    key('ArrowDown')
    key('ArrowDown')
    key('ArrowDown')
    expect(focused()).toBe('Split · below')
    // Moving names it; only Enter (a click) picks it.
    expect(add.querySelector('[data-menu-picture-caption]')?.textContent).toBe('Split · below')
    expect(within(add).getByRole('menuitemradio', { name: 'Add as tab' })).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(document.activeElement!)
    expect(within(add).getByRole('menuitemradio', { name: 'Split · below' })).toHaveAttribute('aria-checked', 'true')
    key('ArrowDown')
    expect(focused()).toBe('Insert row · full width, bottom')
    key('ArrowDown')
    expect(document.activeElement?.getAttribute('role')).toBe('menuitem')
    // ↑ comes back to the picture, on its picked zone.
    key('ArrowUp')
    expect(focused()).toBe('Split · below')
  })

  it('Collapse row collapses the row tracks the cell covers', () => {
    const k = cell('k', [createTab('notes', 'n')])
    const m = cell('m', [createTab('notes', 'm1')])
    open(grid([[k, m]]))
    renderCell(k)
    fireEvent.click(within(gripMenu()).getByRole('menuitem', { name: 'Collapse row' }))
    expect(working().grid.rows[0]?.collapsed).toBe(true)
  })
})

describe('an open editor with changes is asked before a tab close, Close cell or Change widget (cr34 answer 17)', () => {
  /** An editor holding changes, registered as Edit list and the widget editors are; `answer` is what its question resolves. */
  function dirtyEditor() {
    const editor = { answer: false, changed: true, ask: vi.fn(() => { if (editor.answer) editor.changed = false; return Promise.resolve(editor.answer) }) }
    const unregister = registerOpenEditor({ changed: () => editor.changed, ask: editor.ask })
    return Object.assign(editor, { unregister })
  }
  const tabIds = () => working().cells.flatMap((c) => c.tabs.map((t) => t.id))
  const tabKinds = () => working().cells.flatMap((c) => c.tabs.map((t) => t.kind))
  const undoNames = () => useUndoStore.getState().undoStack.map((e) => e.description)
  const two = () => cell('k', [createTab('notes', 'n'), createTab('calendar', 'c')], { activeTabId: 'c' })
  /** Runs one way of closing or changing, then lets its question's answer land. */
  const press = async (run: () => void) => {
    run()
    await act(async () => {})
  }

  const PATHS: Array<[name: string, run: () => void, after: string[], undo: string]> = [
    ['the tab’s ×', () => fireEvent.click(screen.getByRole('button', { name: /^Close .*Calendar/ })), ['n'], 'Closed tab “Calendar”'],
    ['Delete on the tab', () => fireEvent.keyDown(document.querySelector('[data-ws-tab="c"]')!, { key: 'Delete' }), ['n'], 'Closed tab “Calendar”'],
    ['the menu’s Close tab', () => fireEvent.click(within(cellMenu('Cell layout')).getByRole('menuitem', { name: 'Close tab “Calendar”' })), ['n'], 'Closed tab “Calendar”'],
    ['the menu’s Close cell', () => fireEvent.click(within(cellMenu('Cell layout')).getByRole('menuitem', { name: 'Close cell (2 tabs)' })), [], 'Closed cell (2 tabs)'],
  ]

  it.each(PATHS)('%s: Keep editing closes nothing; Save or Discard then closes it, as one undo step named as ever', async (_name, run, after, undo) => {
    const k = two()
    open(single(k))
    renderCell(k)
    const editor = dirtyEditor()
    await press(run)
    expect(editor.ask).toHaveBeenCalledTimes(1)
    expect(tabIds()).toEqual(['n', 'c'])
    expect(undoNames()).toEqual([])
    // Saved or discarded: it carries on.
    editor.answer = true
    fireEvent.keyDown(document, { key: 'Escape' })
    await press(run)
    expect(editor.ask).toHaveBeenCalledTimes(2)
    await vi.waitFor(() => expect(tabIds()).toEqual(after))
    await vi.waitFor(() => expect(undoNames()).toEqual([undo]))
    editor.unregister()
  })

  it.each(PATHS)('%s with no editor holding changes: nothing asks, it closes in the same tick', (_name, run, after) => {
    const k = two()
    open(single(k))
    renderCell(k)
    // An open editor without changes doesn't ask either.
    const ask = vi.fn(() => Promise.resolve(false))
    const unregister = registerOpenEditor({ changed: () => false, ask })
    run()
    expect(tabIds()).toEqual(after)
    expect(ask).not.toHaveBeenCalled()
    unregister()
  })

  const changeTo = (kind: string) => {
    fireEvent.click(within(cellMenu()).getByRole('menuitem', { name: /^Change widget/ }))
    fireEvent.click(within(screen.getByRole('menu', { name: 'Change widget' })).getByRole('menuitemradio', { name: kind }))
  }

  it('Change widget: Keep editing changes nothing; Save or Discard then changes the kind; with no changes at once', async () => {
    const k = cell('k', [createTab('notes', 'n')])
    open(single(k))
    renderCell(k)
    const editor = dirtyEditor()
    await press(() => changeTo('Calendar'))
    expect(editor.ask).toHaveBeenCalledTimes(1)
    expect(tabKinds()).toEqual(['notes'])
    // The kind it already is asks nothing.
    fireEvent.keyDown(document, { key: 'Escape' })
    await press(() => changeTo('Notes'))
    expect(editor.ask).toHaveBeenCalledTimes(1)
    editor.answer = true
    fireEvent.keyDown(document, { key: 'Escape' })
    await press(() => changeTo('Calendar'))
    expect(editor.ask).toHaveBeenCalledTimes(2)
    await vi.waitFor(() => expect(tabKinds()).toEqual(['calendar']))
    // No changes left: the next change is made in the same tick.
    fireEvent.keyDown(document, { key: 'Escape' })
    changeTo('Neglect map')
    expect(tabKinds()).toEqual(['neglect'])
    expect(editor.ask).toHaveBeenCalledTimes(2)
    editor.unregister()
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
    // The whole menu: both sections.
    expect(headings(menu)).toEqual(['Notes', 'Cell'])
    expect(within(menu).getByRole('menuitem', { name: 'Split cell' })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: 'Close tab “Notes”' })).toBeInTheDocument()
    fireEvent.click(within(menu).getByRole('menuitem', { name: /^Change widget/ }))
    const kinds = screen.getByRole('menu', { name: 'Change widget' })
    expect(within(kinds).getByRole('menuitemradio', { name: 'Notes' })).toHaveAttribute('aria-checked', 'true')
  })

  it('a right-click on the top line opens the ⋯ menu; one in the widget’s body is left to it', () => {
    const k = cell('k', [createTab('notes', 'n')])
    open(single(k))
    renderCell(k)
    fireEvent.contextMenu(document.querySelector('[data-ws-cell-body="k"]')!)
    expect(screen.queryByRole('menu', { name: 'Cell options' })).toBeNull()
    fireEvent.contextMenu(topLine('k'))
    const menu = screen.getByRole('menu', { name: 'Cell options' })
    expect(headings(menu)).toEqual(['Notes', 'Cell'])
    expect(itemLabels(menu)).toEqual([
      'Open larger', 'Name and icon…', 'Change widget',
      'Add widget…', 'Split cell', 'Merge with', 'Insert', 'Collapse row', 'Close cell',
    ])
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
  const popover = () => document.querySelector<HTMLElement>('[data-testid="widget-popup"]')

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

  it('a one-tab List cell at its small face: its click opens the list in the widget popup, Esc closes it', () => {
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

  it('the keyboard opener opens it too; × closes it', () => {
    stubSize(400, 80)
    const k = cell('k', [listTab])
    open(single(k))
    renderCell(k)
    fireEvent.click(screen.getByRole('button', { name: 'Open Team' }))
    expect(popover()).not.toBeNull()
    expect(useUIStore.getState().widgetPopup).toEqual({ kind: 'tab', tabId: listTab.id })
    fireEvent.click(within(popover()!).getByRole('button', { name: 'Close' }))
    expect(popover()).toBeNull()
  })

  it('the controls slot has Open larger before the ⋯; a closed tab closes the popup', () => {
    stubSize(400, 400)
    const k = cell('k', [listTab])
    open(single(k))
    renderCell(k)
    const slot = document.querySelector('[data-cell-controls]')!
    const names = within(slot as HTMLElement).getAllByRole('button').map((b) => b.getAttribute('aria-label'))
    expect(names).toEqual(['Cell layout', 'Open larger', 'Cell options'])
    fireEvent.click(within(slot as HTMLElement).getByRole('button', { name: 'Open larger' }))
    expect(popover()).not.toBeNull()
    act(() => { open(single(cell('k2', [createTab('notes', 'other')]))) })
    expect(popover()).toBeNull()
    expect(useUIStore.getState().widgetPopup).toBeNull()
  })

  it('a tab strip’s header has Open larger too, after the grip: it opens the active tab', () => {
    stubSize(400, 400)
    const k = cell('k', [listTab, createTab('notes', 'n')])
    open(single(k))
    renderCell(k)
    const header = document.querySelector<HTMLElement>('[data-ws-cell-header]')!
    const names = within(header).getAllByRole('button').map((b) => b.getAttribute('aria-label'))
    expect(names.slice(-4)).toEqual(['Cell layout', 'Open larger', 'Collapse row', 'Cell options'])
    fireEvent.click(within(header).getByRole('button', { name: 'Open larger' }))
    expect(useUIStore.getState().widgetPopup).toEqual({ kind: 'tab', tabId: listTab.id })
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

  it('a list whose filter line is hidden: alone, a slim top line with its name, and a count only while narrowed', () => {
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
    // One number per list (2A): nothing narrows it, so no count.
    expect(within(line).queryByTestId('list-count')).toBeNull()
    act(() => useFilterStore.getState().setSearchText('zzz-no-match'))
    expect(within(line).getByTestId('list-count')).toHaveTextContent('0 of 2')
  })

  it('a fit row’s cell shows its widget’s small face, whatever its measured size', () => {
    stubSize(400, 400)
    const n = cell('n', [createTab('number', 'num')])
    open(single(n))
    renderCell(n, { fitRow: true })
    expect(cellEl('n').dataset.face).toBe('small')
    expect(document.querySelector('[data-glance]')!.getAttribute('data-face')).toBe('small')
  })

  it('a face with no top line of its own (the calendar’s small one): the cell’s slot stands for the tab', () => {
    stubSize(400, 80)
    const k = cell('k', [createTab('calendar', 'e')])
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
