import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, cleanup, fireEvent, within, screen, act } from '@testing-library/react'
import { DndContext } from '@dnd-kit/core'
import { WorkspaceCell } from '../../../components/workspace/WorkspaceCell'
import { WidgetPopupHost } from '../../../components/workspace/WidgetPopup'
import { useChartWidgetsStore } from '../../../stores/chart-widgets-store'
import { useSettingsStore } from '../../../stores/settings-store'
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
 * The cell's menus (D26 P2 + AA1, UX cleanup 4A; layout edit mode E4 —
 * edit mode changes the grid; what's inside a cell changes in place):
 * outside the mode the ⋯'s and a right-click's — the widget's own entries,
 * then Add widget as tab ›, Remove widget (a lone widget's cell stays,
 * empty), Collapse row and Edit layout —, no grip; in the mode (E3) the
 * cell is a card whose menu (its ⋯, Cell layout) places it — Move to ▸,
 * Swap with ▸, Insert ▸, Merge with ▸, Stretch right / down, Remove widget,
 * Close cell — and whose surface takes the keys; and tabs on demand: one
 * widget has no strip, its top line holds the controls (the ⋯).
 */

const AT = new Date(2026, 0, 1)

function open(body: LayoutBody): void {
  const layout: PersistedWorkspaceLayout = { id: 1, sortOrder: 0, name: 'Main', createdAt: AT, modifiedAt: AT, ...body }
  useWorkspaceStore.setState({ layouts: [layout], activeLayoutId: 1, working: layout, saved: layout, writeFailed: false, hydrated: true })
}

/** The layout edit mode on the open layout (its session set straight: the draft is `working`). */
function editing(): void {
  useWorkspaceStore.setState({ editing: { layoutId: 1, selectedCellId: null, undo: [], redo: [], createdLists: [] } })
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

/** Opens a card's menu in the layout edit mode (E3, its ⋯: Cell layout). */
function cardMenu(): HTMLElement {
  return cellMenu('Cell layout')
}

describe('the cell menu', () => {
  /** Opens the card menu's `item` submenu (the last menu open). */
  function submenu(item: string): HTMLElement {
    fireEvent.click(within(cardMenu()).getByRole('menuitem', { name: item }))
    return screen.getAllByRole('menu').at(-1)!
  }

  it('outside the mode: no grip; the ⋯ lists the widget’s entries under its kind, then Add widget as tab, Remove widget, Collapse row and Edit layout', () => {
    const k = cell('k', [createTab('notes', 'n')])
    open(single(k))
    renderCell(k)
    expect(screen.queryByRole('button', { name: 'Cell layout' })).toBeNull()
    expect(screen.queryByTestId('ws-cell-grip')).toBeNull()
    const menu = cellMenu()
    expect(headings(menu)).toEqual(['Notes'])
    expect(itemLabels(menu)).toEqual(['Open larger', 'Name and icon…', 'Change widget', 'Move to layout', 'Copy to layout', 'Add widget as tab', 'Remove widget', 'Collapse row', 'Edit layout'])
  })

  it('Add widget as tab › a kind adds it to this cell as its active tab; the cells stay', () => {
    const k = cell('k', [createTab('notes', 'n')])
    open(single(k))
    renderCell(k)
    fireEvent.click(within(cellMenu()).getByRole('menuitem', { name: 'Add widget as tab' }))
    fireEvent.click(within(screen.getAllByRole('menu').at(-1)!).getByRole('menuitem', { name: 'Calendar' }))
    expect(working().cells).toHaveLength(1)
    expect(working().cells[0]?.tabs.map((t) => t.kind)).toEqual(['notes', 'calendar'])
    const added = working().cells[0]?.tabs[1]
    expect(working().cells[0]?.activeTabId).toBe(added?.id)
    expect(useUndoStore.getState().undoStack.at(-1)?.description).toBe('Added “Calendar”')
  })

  it('Remove widget on a lone widget leaves its cell, empty, as one undo step; Undo brings the widget back', async () => {
    const k = cell('k', [createTab('notes', 'n')])
    const m = cell('m', [createTab('calendar', 'c')])
    open(grid([[k, m]]))
    renderCell(k)
    fireEvent.click(within(cellMenu()).getByRole('menuitem', { name: 'Remove widget' }))
    expect(picture(working())).toEqual(['k m'])
    expect(working().cells.find((c) => c.id === 'k')?.tabs).toEqual([])
    expect(useUndoStore.getState().undoStack.map((e) => e.description)).toEqual(['Removed “Notes”'])
    await act(async () => { await useUndoStore.getState().undo() })
    expect(working().cells.find((c) => c.id === 'k')?.tabs.map((t) => t.id)).toEqual(['n'])
  })

  it('Edit layout opens the layout edit mode with this cell selected', async () => {
    const k = cell('k', [createTab('notes', 'n')])
    open(single(k))
    renderCell(k)
    const item = within(cellMenu()).getByRole('menuitem', { name: 'Edit layout' })
    await act(async () => { fireEvent.click(item) })
    await vi.waitFor(() => expect(useWorkspaceStore.getState().editing?.selectedCellId).toBe('k'))
    useWorkspaceStore.getState().leaveEdit()
  })

  it('in the mode: the card’s ⋯ lists Move to, Swap with, Insert, Merge with, Stretch, Remove widget, Close cell — no grip, no drag handle', () => {
    const k = cell('k', [createTab('notes', 'n')])
    open(single(k))
    editing()
    renderCell(k)
    expect(screen.queryByTestId('ws-cell-grip')).toBeNull()
    expect(document.querySelector('[data-ws-panel-handle]')).toBeNull()
    const more = screen.getByRole('button', { name: 'Cell layout' })
    expect(more).toHaveAttribute('aria-haspopup', 'menu')
    const menu = cardMenu()
    expect(itemLabels(menu)).toEqual(['Move to', 'Swap with', 'Join as tabs', 'Insert', 'Merge with', 'Stretch right', 'Stretch down', 'Move cell to layout', 'Copy cell to layout', 'Remove widget', 'Close cell'])
    expect(more).toHaveAttribute('aria-expanded', 'true')
    // Its second click closes it.
    fireEvent.click(more)
    expect(screen.queryByRole('menu', { name: 'Cell layout' })).toBeNull()
  })

  it('in the mode the card’s surface is its Tab stop: Enter opens its menu, Delete removes its widget (the cell stays, a slot)', () => {
    const k = cell('k', [createTab('notes', 'n')])
    const m = cell('m', [createTab('calendar', 'c')])
    open(grid([[k, m]]))
    editing()
    renderCell(k)
    const surface = document.querySelector<HTMLElement>('[data-edit-surface="k"]')!
    expect(surface).toHaveAttribute('tabindex', '0')
    expect(surface.getAttribute('aria-label')).toMatch(/^Notes card, A1\. .*Delete removes Notes$/)
    fireEvent.keyDown(surface, { key: 'Enter' })
    expect(screen.getByRole('menu', { name: 'Cell layout' })).toBeInTheDocument()
    fireEvent.keyDown(screen.getByRole('menu', { name: 'Cell layout' }), { key: 'Escape' })
    fireEvent.keyDown(surface, { key: 'Delete' })
    expect(working().cells.find((c) => c.id === 'k')?.tabs).toEqual([])
    expect(useWorkspaceStore.getState().editing?.undo).toHaveLength(1)
  })

  it('Move to ▸ lists the slots by ruler name and moves the card there; Swap with ▸ swaps it with a card', () => {
    const k = cell('k', [createTab('notes', 'n')])
    const e = cell('e', [])
    const m = cell('m', [createTab('calendar', 'c')])
    open(grid([[k, e], [m, m]]))
    editing()
    renderCell(k)
    const move = submenu('Move to')
    expect(within(move).getAllByRole('menuitem').map((el) => el.getAttribute('data-menu-label'))).toEqual(['B1'])
    fireEvent.click(within(move).getByRole('menuitem', { name: 'B1' }))
    const holder = working().cells.find((c) => c.tabs.some((t) => t.id === 'n'))
    expect(holder?.area).toMatchObject({ col: 1, row: 0 })
    expect(useWorkspaceStore.getState().editing?.selectedCellId).toBe(holder?.id)
    cleanup()
    open(grid([[k, e], [m, m]]))
    editing()
    renderCell(k)
    const swap = submenu('Swap with')
    fireEvent.click(within(swap).getByRole('menuitem', { name: /^Calendar/ }))
    expect(picture(working())).toEqual(['m e', 'k k'])
  })

  it('Stretch right covers the slot beside it; Stretch down is off with a card below', () => {
    const k = cell('k', [createTab('notes', 'n')])
    const e = cell('e', [])
    const m = cell('m', [createTab('calendar', 'c')])
    open(grid([[k, e], [m, m]]))
    editing()
    renderCell(k)
    const menu = cardMenu()
    expect(within(menu).getByRole('menuitem', { name: 'Stretch down' })).toBeDisabled()
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Stretch right' }))
    expect(picture(working())).toEqual(['k', 'm'])
  })

  it('with two widgets: the ⋯ the active one’s entries and Remove tab; no grip and no drag handle outside the mode', () => {
    const k = cell('k', [createTab('notes', 'n'), createTab('calendar', 'c')], { activeTabId: 'c' })
    open(single(k))
    renderCell(k)
    const header = document.querySelector<HTMLElement>('[data-ws-cell-header="k"]')!
    expect(within(header).queryByRole('button', { name: 'Cell layout' })).toBeNull()
    // The header's empty space is only room: nothing drags a cell outside the mode.
    expect(header.querySelector('[data-ws-panel-handle="k"]')).toBeNull()
    expect(header.querySelector('[data-strip-room]')).not.toBeNull()
    const more = cellMenu()
    expect(headings(more)).toEqual(['Calendar'])
    expect(within(more).getByRole('menuitem', { name: /^Change widget/ })).toHaveTextContent('Calendar')
    // A cell showing a tab strip speaks of tabs: Add tab ›, Remove tab.
    expect(itemLabels(more).slice(-4)).toEqual(['Add tab', 'Remove tab', 'Collapse row', 'Edit layout'])
    fireEvent.click(within(more).getByRole('menuitem', { name: 'Remove tab' }))
    expect(working().cells[0]?.tabs.map((t) => t.id)).toEqual(['n'])
  })

  it('in the mode, with two widgets: the header’s own buttons give way to the card’s ⋯; its tabs still take presses; Close cell (2 tabs)', () => {
    const k = cell('k', [createTab('notes', 'n'), createTab('calendar', 'c')], { activeTabId: 'c' })
    open(single(k))
    editing()
    renderCell(k)
    const header = document.querySelector<HTMLElement>('[data-ws-cell-header="k"]')!
    expect(within(header).queryByRole('button', { name: 'Cell options' })).toBeNull()
    expect(within(header).queryByRole('button', { name: 'Collapse row' })).toBeNull()
    expect(header.querySelector('[data-ws-panel-handle]')).toBeNull()
    expect(within(header).getAllByRole('tab')).toHaveLength(2)
    expect(itemLabels(cardMenu()).slice(-2)).toEqual(['Remove tab', 'Close cell (2 tabs)'])
  })

  it('Insert ▸ a full row or column, or a new cell on a side; New cell right puts an empty cell beside it, below one under it', () => {
    const k = cell('k', [createTab('notes', 'n')])
    open(single(k))
    editing()
    renderCell(k)
    const sub = submenu('Insert')
    expect(within(sub).getAllByRole('menuitem').map((el) => el.getAttribute('data-menu-label'))).toEqual([
      'Row above', 'Row below', 'Column left', 'Column right', 'New cell above', 'New cell left', 'New cell right', 'New cell below',
    ])
    fireEvent.click(within(sub).getByRole('menuitem', { name: 'New cell right' }))
    expect(working().cells.map((x) => x.tabs.length)).toEqual([1, 0])
    fireEvent.click(within(submenu('Insert')).getByRole('menuitem', { name: 'New cell below' }))
    expect(picture(working())).toHaveLength(2)
    expect(working().cells).toHaveLength(3)
  })

  it('Insert ▸ Row above puts a full-width row over the card, its new cell selected', () => {
    const k = cell('k', [createTab('notes', 'n')])
    const m = cell('m', [createTab('notes', 'm1')])
    open(grid([[k, m]]))
    editing()
    renderCell(k)
    fireEvent.click(within(submenu('Insert')).getByRole('menuitem', { name: 'Row above' }))
    expect(working().grid.rows).toHaveLength(2)
    const added = working().cells.find((c) => c.tabs.length === 0)
    expect(added?.area).toEqual({ col: 0, row: 0, colSpan: 2, rowSpan: 1 })
    expect(useWorkspaceStore.getState().editing?.selectedCellId).toBe(added?.id)
  })

  it('Merge with ▸ Right joins the cell beside it into one, its tabs after; Below is off when no rectangle', () => {
    const k = cell('k', [createTab('notes', 'n')])
    const m = cell('m', [createTab('notes', 'm1')])
    const w = cell('w', [createTab('notes', 'w1')])
    // k | m over w spanning both: k merges right with m, but nothing below makes a rectangle with it alone.
    open(grid([[k, m], [w, w]]))
    editing()
    renderCell(k)
    const sub = submenu('Merge with')
    expect(within(sub).getByRole('menuitem', { name: 'Below' })).toBeDisabled()
    fireEvent.click(within(sub).getByRole('menuitem', { name: 'Right' }))
    expect(picture(working())).toEqual(['k', 'w'])
    expect(working().cells[0]?.tabs.map((t) => t.id)).toEqual(['n', 'm1'])
  })

  it('the ⋯’s Collapse row collapses the row tracks the cell covers', () => {
    const k = cell('k', [createTab('notes', 'n')])
    const m = cell('m', [createTab('notes', 'm1')])
    open(grid([[k, m]]))
    renderCell(k)
    fireEvent.click(within(cellMenu()).getByRole('menuitem', { name: 'Collapse row' }))
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
    ['the tab’s ×', () => fireEvent.click(screen.getByRole('button', { name: /^Remove .*Calendar/ })), ['n'], 'Removed “Calendar”'],
    ['Delete on the tab', () => fireEvent.keyDown(document.querySelector('[data-ws-tab="c"]')!, { key: 'Delete' }), ['n'], 'Removed “Calendar”'],
    ['the ⋯’s Remove tab', () => fireEvent.click(within(cellMenu()).getByRole('menuitem', { name: 'Remove tab' })), ['n'], 'Removed “Calendar”'],
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

describe('an open editor with changes is asked before its widget can leave the screen: a tab switch, a collapse, a tab added', () => {
  /** An editor holding changes, registered as Edit list and the widget editors are; `answer` is what its question resolves. */
  function dirtyEditor() {
    const editor = { answer: false, changed: true, ask: vi.fn(() => { if (editor.answer) editor.changed = false; return Promise.resolve(editor.answer) }) }
    const unregister = registerOpenEditor({ changed: () => editor.changed, ask: editor.ask })
    return Object.assign(editor, { unregister })
  }
  /** The open layout's table and tabs, as text: what a path changed. */
  const table = () => JSON.stringify({ grid: working().grid, cells: working().cells })
  const activeOf = (cellId: string) => working().cells.find((c) => c.id === cellId)?.activeTabId
  const tab = (id: string) => document.querySelector<HTMLElement>(`[data-ws-tab="${id}"]`)!
  /** k (Notes, Calendar — Calendar shown) beside m (Notes): k merges right with m. */
  function setup(extra: { collapsed?: boolean } = {}) {
    const k = cell('k', [createTab('notes', 'n'), createTab('calendar', 'c')], { activeTabId: 'c' })
    const m = cell('m', [createTab('notes', 'm1')])
    open(grid([[k, m]], extra.collapsed ? { rows: [{ weight: 1000, collapsed: true }] } : undefined))
    renderCell(k, extra)
  }
  const settle = async () => { await act(async () => {}) }

  const PATHS: Array<[name: string, run: () => void]> = [
    ['a click on another tab', () => fireEvent.click(tab('n'))],
    ['Enter on another tab', () => fireEvent.keyDown(tab('n'), { key: 'Enter' })],
    ['an arrow key on the strip', () => fireEvent.keyDown(tab('c'), { key: 'ArrowLeft' })],
    ['the header’s Collapse row button', () => fireEvent.click(screen.getByRole('button', { name: 'Collapse row' }))],
    ['the ⋯’s Collapse row', () => fireEvent.click(within(cellMenu()).getByRole('menuitem', { name: 'Collapse row' }))],
    ['the ⋯’s Add tab ›', () => {
      fireEvent.click(within(cellMenu()).getByRole('menuitem', { name: 'Add tab' }))
      fireEvent.click(within(screen.getAllByRole('menu').at(-1)!).getByRole('menuitem', { name: 'Notes' }))
    }],
  ]

  it.each(PATHS)('%s: asks; Keep editing changes nothing; Save or Discard then carries on', async (_name, run) => {
    setup()
    const before = table()
    const editor = dirtyEditor()
    run()
    await settle()
    expect(editor.ask).toHaveBeenCalledTimes(1)
    expect(table()).toBe(before)
    // Saved or discarded (the question resolves true): the same press then does what it does.
    editor.answer = true
    fireEvent.keyDown(document, { key: 'Escape' })
    run()
    await settle()
    expect(editor.ask).toHaveBeenCalledTimes(2)
    await vi.waitFor(() => expect(table()).not.toBe(before))
    editor.unregister()
  })

  it.each(PATHS)('%s with no editor holding changes: nothing asks, and it is done in the same tick', (_name, run) => {
    setup()
    const before = table()
    const ask = vi.fn(() => Promise.resolve(false))
    const unregister = registerOpenEditor({ changed: () => false, ask })
    run()
    expect(table()).not.toBe(before)
    expect(ask).not.toHaveBeenCalled()
    unregister()
  })

  it('a tab switch lands on the tab pressed, once: the active tab after Save or Discard, and the arrow key’s focus', async () => {
    setup()
    const editor = dirtyEditor()
    editor.answer = true
    tab('c').focus()
    fireEvent.keyDown(tab('c'), { key: 'ArrowRight' })
    await settle()
    await vi.waitFor(() => expect(activeOf('k')).toBe('n'))
    expect(editor.ask).toHaveBeenCalledTimes(1)
    await vi.waitFor(() => expect(document.activeElement).toBe(tab('n')))
    editor.unregister()
  })

  it('the tab already shown asks nothing: nothing would change', async () => {
    setup()
    const before = table()
    const editor = dirtyEditor()
    fireEvent.click(tab('c'))
    fireEvent.keyDown(tab('c'), { key: 'Enter' })
    await settle()
    expect(editor.ask).not.toHaveBeenCalled()
    expect(table()).toBe(before)
    editor.unregister()
  })

  it('a collapsed row: Expand row and a tab’s click (which expands it) ask too', async () => {
    setup({ collapsed: true })
    const before = table()
    const editor = dirtyEditor()
    fireEvent.click(screen.getByRole('button', { name: 'Expand row' }))
    await settle()
    fireEvent.click(tab('c'))
    await settle()
    expect(editor.ask).toHaveBeenCalledTimes(2)
    expect(table()).toBe(before)
    editor.answer = true
    fireEvent.click(tab('n'))
    await settle()
    await vi.waitFor(() => expect(working().grid.rows[0]?.collapsed).not.toBe(true))
    expect(activeOf('k')).toBe('n')
    editor.unregister()
  })

  it('Edit breakdown… on a tab out of sight asks before it shows the tab (as Edit list… and Edit number… do)', async () => {
    const k = cell('k', [createTab('notes', 'n'), createTab('breakdown', 'b')], { activeTabId: 'n' })
    open(single(k))
    renderCell(k)
    const editor = dirtyEditor()
    const editBreakdown = () => {
      fireEvent.contextMenu(tab('b'))
      fireEvent.click(within(screen.getByRole('menu', { name: 'Cell options' })).getByRole('menuitem', { name: /^Edit breakdown/ }))
    }
    editBreakdown()
    await settle()
    expect(editor.ask).toHaveBeenCalledTimes(1)
    expect(activeOf('k')).toBe('n')
    expect(useChartWidgetsStore.getState().editorTabId).toBeNull()
    editor.answer = true
    editBreakdown()
    await settle()
    await vi.waitFor(() => expect(useChartWidgetsStore.getState().editorTabId).toBe('b'))
    expect(activeOf('k')).toBe('b')
    editor.unregister()
  })
})

describe('tabs on demand (D26 AA1)', () => {
  const topLine = (cellId: string) => document.querySelector<HTMLElement>(`[data-ws-cell="${cellId}"] [data-widget-top-line]`)!

  it('one widget: no strip; its top line stands for the tab and holds the ⋯ — in the mode the card’s surface and ⋯ instead', () => {
    useSettingsStore.setState({ showWidgetNames: true })
    const k = cell('k', [createTab('notes', 'n')])
    open(single(k))
    renderCell(k)
    expect(screen.queryByRole('tablist')).toBeNull()
    expect(document.querySelector('[data-ws-cell-header="k"]')).toBeNull()
    expect(topLine('k')).toHaveAttribute('data-ws-tab', 'n')
    expect(topLine('k')).toHaveTextContent('Notes')
    const slot = topLine('k').querySelector<HTMLElement>('[data-cell-controls]')!
    expect(slot.querySelector('[data-ws-panel-handle="k"]')).toBeNull()
    expect(within(slot).getByRole('button', { name: 'Cell options' })).toBeInTheDocument()
    expect(document.querySelector('[data-edit-surface]')).toBeNull()
    act(() => editing())
    expect(document.querySelector('[data-edit-surface="k"]')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Cell layout' })).toBeInTheDocument()
    // The slot is its top line's: the cell draws none of its own.
    expect(document.querySelectorAll('[data-cell-controls]')).toHaveLength(1)
  })

  it('Show widget names off (the default): a Notes cell has no name line; the cell’s own controls float, standing for the tab', () => {
    const k = cell('k', [createTab('notes', 'n')])
    open(single(k))
    renderCell(k)
    expect(document.querySelector('[data-widget-top-line][data-ws-tab]:not([data-cell-controls])')).toBeNull()
    expect(screen.queryByTestId('top-line-name')).toBeNull()
    const slot = document.querySelector<HTMLElement>('[data-cell-controls]')!
    expect(slot).toHaveAttribute('data-ws-tab', 'n')
    expect(within(slot).getByRole('button', { name: 'Cell options' })).toBeInTheDocument()
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
    // That widget's menu, with Edit layout in place of the layout section.
    expect(headings(menu)).toEqual(['Notes'])
    expect(within(menu).queryByRole('menuitem', { name: 'Split cell' })).toBeNull()
    expect(within(menu).getByRole('menuitem', { name: 'Remove tab' })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: 'Edit layout' })).toBeInTheDocument()
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
    expect(headings(menu)).toEqual(['Notes'])
    expect(itemLabels(menu)).toEqual(['Open larger', 'Name and icon…', 'Change widget', 'Move to layout', 'Copy to layout', 'Add widget as tab', 'Remove widget', 'Collapse row', 'Edit layout'])
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
    useSettingsStore.setState({ showWidgetNames: true })
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
    expect(names).toEqual(['Open larger', 'Cell options'])
    fireEvent.click(within(slot as HTMLElement).getByRole('button', { name: 'Open larger' }))
    expect(popover()).not.toBeNull()
    act(() => { open(single(cell('k2', [createTab('notes', 'other')]))) })
    expect(popover()).toBeNull()
    expect(useUIStore.getState().widgetPopup).toBeNull()
  })

  it('a tab strip’s header has Open larger too: it opens the active tab', () => {
    stubSize(400, 400)
    const k = cell('k', [listTab, createTab('notes', 'n')])
    open(single(k))
    renderCell(k)
    const header = document.querySelector<HTMLElement>('[data-ws-cell-header]')!
    const names = within(header).getAllByRole('button').map((b) => b.getAttribute('aria-label'))
    expect(names.slice(-3)).toEqual(['Open larger', 'Collapse row', 'Cell options'])
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
