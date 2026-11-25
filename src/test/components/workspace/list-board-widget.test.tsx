import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, renderHook, screen, within } from '@testing-library/react'
import { DndContext } from '@dnd-kit/core'
import { CellControlsContext, type CellControlsValue } from '../../../components/workspace/cell-controls'
import { WidgetPopupHost } from '../../../components/workspace/WidgetPopup'
import { ShortcutsWidget } from '../../../components/workspace/shortcuts/ShortcutsWidget'
import { moveShortcut, useShortcutsMenuEntries } from '../../../components/workspace/shortcuts/shortcuts-menu'
import { WidgetFaceContext } from '../../../hooks/use-widget-face'
import { emptyPredicate } from '../../../models/filter-predicate'
import type { ListDefinition } from '../../../models/list-definition'
import { createTab, shortcutListTabId, type LayoutTab, type PersistedWorkspaceLayout, type ShortcutsTab } from '../../../models/workspace-layout'
import type { WidgetFace } from '../../../utils/widget-face'
import { openShortcutList } from '../../../services/widget-popup'
import { useListDefinitionStore } from '../../../stores/list-definition-store'
import { useListWidgetStore } from '../../../stores/list-widget-store'
import { useSettingsStore } from '../../../stores/settings-store'
import { useTodoStore } from '../../../stores/todo-store'
import { useUIStore } from '../../../stores/ui-store'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import { clearFilterStore, makeTodo, resetEntityStores } from '../../helpers'
import { cell, grid, single } from '../../helpers/layout-builders'
import { layoutSteps } from '../../helpers/layout-steps'

/**
 * The List board (widget kind `shortcuts`) in JSDOM: a tile per list — the
 * lists picked, of any layout, or every list tab of the open layout — its
 * tab's icon, its badge capsule, its count, its squares and first titles;
 * the writes that add, remove and move a list and switch its source (one
 * undo step each), each source's tile menu, its faces, and the popup
 * showing a list of another layout.
 */

const TODAY = new Date(2026, 10, 23, 10)
const day = (offset: number) => new Date(2026, 10, 23 + offset, 9)

function list(id: number, name: string, layoutId: number, extra: Partial<ListDefinition> = {}): ListDefinition & { id: number } {
  return { id, name, sortOrder: id, membership: { kind: 'custom', predicate: emptyPredicate() }, sort: 'manual', grouping: 'none', owner: { layoutId }, ...extra } as ListDefinition & { id: number }
}

const picked = (lists?: number[]): ShortcutsTab => ({ id: 'sc', kind: 'shortcuts', config: lists ? { lists } : {} })
const ofLayout = (lists?: number[]): ShortcutsTab => ({ id: 'sc', kind: 'shortcuts', config: { source: 'layout', ...(lists ? { lists } : {}) } })
const lens = (id: string, listDefinitionId: number): LayoutTab => ({ ...createTab('lens', id), config: { listDefinitionId } })

/**
 * Two layouts: Home (open) — Errands (flagged) and Tasks for… (a prompt) in
 * cell a, the board in b, Later in c under them — and Work: Clients, Who,
 * Later.
 */
function setup(board: ShortcutsTab, homeTabs: LayoutTab[] = [{ ...lens('t-errands', 1), icon: { kind: 'line', key: 'flag' } }, lens('t-who-home', 3)]) {
  const home: PersistedWorkspaceLayout = {
    id: 1, name: 'Home', sortOrder: 0, createdAt: new Date(0), modifiedAt: new Date(0),
    ...grid([[cell('a', homeTabs), cell('b', [board])], [cell('c', [lens('t-later-home', 4)]), cell('b')]]),
  }
  const work: PersistedWorkspaceLayout = {
    id: 2, name: 'Work', sortOrder: 1, createdAt: new Date(0), modifiedAt: new Date(0),
    ...single(cell('w', [lens('t-clients', 2), lens('t-who', 3), lens('t-later', 4)])),
  }
  useWorkspaceStore.setState({ working: home, saved: home, layouts: [home, work], activeLayoutId: 1, hydrated: true })
}

/** The board as it is in the open layout (re-rendered on each write). */
function Live({ face }: { face?: WidgetFace }) {
  const tab = useWorkspaceStore((s) => s.working!.cells.find((c) => c.id === 'b')!.tabs[0]) as ShortcutsTab
  return (
    <WidgetFaceContext.Provider value={face ? { forced: face } : {}}>
      <ShortcutsWidget tab={tab} />
    </WidgetFaceContext.Provider>
  )
}

const current = () => useWorkspaceStore.getState().working!.cells.find((c) => c.id === 'b')!.tabs[0] as ShortcutsTab
const tile = (id: number) => document.querySelector<HTMLElement>(`[data-shortcut-tile="${id}"]`)
const tabTile = (tabId: string) => document.querySelector<HTMLElement>(`[data-board-tab="${tabId}"]`)
const tileIds = () => [...document.querySelectorAll<HTMLElement>('[data-shortcut-tile]')].map((el) => Number(el.dataset.shortcutTile))
const tabTileIds = () => [...document.querySelectorAll<HTMLElement>('[data-board-tab]')].map((el) => el.dataset.boardTab)
const squareTones = (el: HTMLElement) => [...el.querySelectorAll('button[data-tone]')].map((b) => b.getAttribute('data-tone'))

/** Hovers `el` long enough for its tooltip; returns the tooltip's text. */
function tooltipOf(el: Element): string {
  fireEvent.pointerEnter(el, { pointerType: 'mouse' })
  act(() => { vi.advanceTimersByTime(500) })
  const text = screen.getByRole('tooltip').textContent ?? ''
  fireEvent.pointerLeave(el)
  return text
}

let width = 900
let height = 600

beforeEach(() => {
  width = 900
  height = 600
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => width)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(() => height)
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
  vi.setSystemTime(TODAY)
  resetEntityStores()
  clearFilterStore()
  useSettingsStore.setState({ urgentDueWithinDays: 3, staleAfterDays: 30 })
  useTodoStore.setState({
    todos: [
      makeTodo({ id: 1, title: 'Buy stamps', sortOrder: 1, modifiedAt: day(-1) }),
      makeTodo({ id: 2, title: 'Call Acme', dueDate: day(-1), sortOrder: 2, statusId: 5, modifiedAt: day(-1), focus: true }),
      makeTodo({ id: 3, title: 'Send invoice', sortOrder: 3, statusId: 5, modifiedAt: day(-40) }),
      makeTodo({ id: 4, title: 'Renew lease', sortOrder: 4, statusId: 5, nextFollowupAt: day(-2), modifiedAt: day(-1) }),
      makeTodo({ id: 5, title: 'Plan offsite', sortOrder: 5, statusId: 5, dueDate: day(2), modifiedAt: day(-1) }),
      makeTodo({ id: 6, title: 'Filed', sortOrder: 6, statusId: 5, isCompleted: true }),
    ],
  })
  useListDefinitionStore.setState({
    listDefinitions: [
      list(1, 'Errands', 1, { membership: { kind: 'custom', predicate: { ...emptyPredicate(), statusIds: [5], negate: { statusIds: true } } } }),
      list(2, 'Clients', 2, { membership: { kind: 'custom', predicate: { ...emptyPredicate(), statusIds: [5] } } }),
      list(3, 'Tasks for…', 2, { runtimeFilter: { field: 'person' } }),
      list(4, 'Later', 2),
    ],
  })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('Lists I pick', () => {
  it('a tile per picked list, in order, from any layout; a deleted list is skipped, its id kept', () => {
    setup(picked([2, 1, 99]))
    render(<Live />)
    expect(tileIds()).toEqual([2, 1])
    expect(current().config.lists).toEqual([2, 1, 99])
    // Its layout's name is no line on it: its tooltip leads with it, and ends with the squares' legend.
    expect(within(tile(2)!).queryByText('Work')).toBeNull()
    const tip = tooltipOf(within(tile(2)!).getByRole('button', { name: /Open$/ }))
    expect(tip).toMatch(/^Clients · Work4 tasks · 1 overdue · 1 due soon · 1 follow-up late · 1 stale/)
    expect(tip).toMatch(/Overdue.*Due soon.*Follow-up late.*On track.*Stale$/)
    expect(tooltipOf(within(tile(1)!).getByRole('button', { name: /Open$/ }))).toMatch(/^Errands · Home1 task · 1 on track/)
  })

  it('shows the icon stored on its list tab, as the strip does, its badge capsule — its count only with no capsule —, its squares and first titles', () => {
    setup(picked([1, 2]))
    render(<Live />)
    // Errands' tab has the flag; Clients' the list glyph a new list tab is given, shown as any icon is.
    expect(tile(1)!.querySelector('[data-app-icon="line"]')).not.toBeNull()
    expect(tile(2)!.querySelector('[data-app-icon="line"]')).not.toBeNull()
    // Clients: one task overdue and one due soon, the capsule's due part; its count of 4 is in its tooltip, not beside it.
    expect(tile(2)!.querySelector('[data-shortcut-badge] [data-badge-part="due"]')).toHaveTextContent('2')
    // On a tile the capsule is a corner badge, out of the head's line.
    expect(tile(2)!.querySelector('[data-corner-badge] [data-shortcut-badge]')).not.toBeNull()
    expect(tile(2)!.querySelector('[data-shortcut-count]')).toBeNull()
    // Errands: no capsule, and no count either, so the tile stays narrow — the count is in its tooltip and squares.
    expect(tile(1)!.querySelector('[data-shortcut-badge]')).toBeNull()
    expect(tile(1)!.querySelector('[data-shortcut-count]')).toBeNull()
    // A square per open task, the trouble first.
    expect(squareTones(tile(2)!)).toEqual(['late', 'soon', 'followup', 'stale'])
    // The first three titles, as built.
    expect([...tile(2)!.querySelectorAll('[data-peek-line]')].map((el) => el.textContent)).toEqual(['Call Acme', 'Send invoice', 'Renew lease'])
  })

  it('a list waiting on its prompt: no capsule, no squares, no titles, its count —; a pick in its popup counts', () => {
    setup(picked([3]))
    render(<Live />)
    expect(tile(3)!.querySelector('[data-shortcut-count]')).toHaveTextContent('—')
    expect(tile(3)!.querySelector('[data-shortcut-badge]')).toBeNull()
    expect(tile(3)!.querySelectorAll('[data-peek-line], [data-tone]')).toHaveLength(0)
    act(() => { useListWidgetStore.setState({ picks: { [shortcutListTabId(3)]: [] } }) })
    // Its five tasks: in its tooltip and a square each; the — goes, and no count takes its place.
    expect(tooltipOf(within(tile(3)!).getByRole('button', { name: /Open$/ }))).toMatch(/5 tasks · /)
    expect(squareTones(tile(3)!)).toHaveLength(5)
    expect(tile(3)!.querySelector('[data-shortcut-count]')).toBeNull()
  })

  it('empty: a line and an Add a list button', () => {
    setup(picked())
    render(<Live />)
    expect(screen.getByRole('status')).toHaveTextContent('No lists added.')
    expect(screen.getByRole('button', { name: 'Add a list' })).toBeInTheDocument()
  })
})

describe('a tile’s squares', () => {
  it('draws a square’s priority as its task’s checkbox does; its name its task; a click opens it', () => {
    setup(picked([2]))
    const open = vi.spyOn(useUIStore.getState(), 'openEditPopup')
    render(<Live />)
    const square = within(tile(2)!).getByRole('button', { name: /^Call Acme: / })
    expect(square).toHaveAccessibleName('Call Acme: Overdue · Priority: Focus, Urgent (due soon)')
    expect(square.querySelector('[data-focus-glow]')).not.toBeNull()
    expect(within(tile(2)!).getByRole('button', { name: 'Send invoice: Stale' }).querySelector('[data-priority-ring], [data-focus-glow]')).toBeNull()
    fireEvent.click(within(tile(2)!).getByRole('button', { name: 'Renew lease: Follow-up late' }))
    expect(open).toHaveBeenCalledWith(4)
    // The square opened its task, not the list.
    expect(useUIStore.getState().widgetPopup).toBeNull()
  })

  it('a big list stops at its rows, its last three squares giving way to +N', () => {
    useTodoStore.setState({ todos: Array.from({ length: 80 }, (_, i) => makeTodo({ id: i + 1, title: `T${i + 1}`, sortOrder: i, modifiedAt: day(-1) })) })
    setup(picked([4]))
    width = 112
    render(<Live face="large" />)
    // 112px across: 9 a row, four rows at most — 33 squares and +47.
    expect(squareTones(tile(4)!)).toHaveLength(33)
    expect(tile(4)!.querySelector('[data-board-more]')).toHaveTextContent('+47')
  })
})

describe('adding, removing and moving (one undo step each)', () => {
  it('Add a list offers every list not added, under its layout, the open layout first; a pick adds it at the end', async () => {
    setup(picked([2]))
    render(<Live />)
    fireEvent.click(document.querySelector<HTMLElement>('[data-shortcuts-add]')!)
    const menu = screen.getByRole('menu', { name: 'Add a list' })
    const words = [...menu.querySelectorAll('[role="presentation"], [role="menuitem"]')].map((el) => el.textContent?.trim()).filter(Boolean)
    expect(words).toEqual(['Home', 'Errands', 'Work', 'Tasks for…', 'Later'])
    await act(async () => { fireEvent.click(within(menu).getByRole('menuitem', { name: 'Later' })) })
    expect(current().config.lists).toEqual([2, 4])
    expect(layoutSteps()).toEqual(['Added “Later” to List board'])
    expect(tileIds()).toEqual([2, 4])
  })

  it('a tile’s right-click: Remove from List board takes the list out (the list stays); Open opens it', async () => {
    setup(picked([1, 2]))
    render(<DndContext><Live /><WidgetPopupHost /></DndContext>)
    fireEvent.contextMenu(within(tile(1)!).getByRole('button', { name: /^Errands: .*Open$/ }))
    expect(screen.getByRole('menu', { name: 'List board options' })).toBeInTheDocument()
    await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name: 'Remove from List board' })) })
    expect(current().config.lists).toEqual([2])
    expect(layoutSteps()).toEqual(['Removed “Errands” from List board'])
    expect(useListDefinitionStore.getState().listDefinitions.some((d) => d.id === 1)).toBe(true)
    fireEvent.contextMenu(within(tile(2)!).getByRole('button', { name: /^Clients: .*Open$/ }))
    await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name: 'Open' })) })
    expect(useUIStore.getState().widgetPopup).toEqual({ kind: 'shortcut', listDefinitionId: 2 })
  })

  it('a drag moves a list to where it was dropped', async () => {
    setup(picked([1, 2, 4]))
    render(<Live />)
    await act(async () => { moveShortcut(current(), 4, 1) })
    expect(current().config.lists).toEqual([4, 1, 2])
    expect(layoutSteps()).toEqual(['Moved “Later”'])
    expect(tileIds()).toEqual([4, 1, 2])
  })
})

describe('This layout’s lists', () => {
  it('a list tab with no icon stored shows none on its tile, as on its strip', () => {
    const { icon: _icon, ...bare } = lens('t-errands', 1)
    void _icon
    setup(ofLayout(), [bare, lens('t-who-home', 3)])
    render(<Live />)
    expect(tabTile('t-errands')!.querySelector('[data-app-icon]')).toBeNull()
    expect(tabTile('t-who-home')!.querySelector('[data-app-icon="line"]')).not.toBeNull()
  })

  it('a tile per list tab of the open layout, in reading order, each with its tab’s own icon and prompt pick', () => {
    setup(ofLayout())
    render(<Live />)
    expect(tabTileIds()).toEqual(['t-errands', 't-who-home', 't-later-home'])
    expect(tabTile('t-errands')!.querySelector('[data-app-icon="line"]')).not.toBeNull()
    // No layout name: every tile is of this layout.
    expect(tooltipOf(within(tabTile('t-errands')!).getByRole('button', { name: /Open$/ }))).toMatch(/^Errands1 task · 1 on track/)
    expect(within(tabTile('t-errands')!).getByRole('button', { name: /Open$/ })).toHaveAccessibleName('Errands: 1 task. Open')
    // Tasks for… waits on this tab's prompt; a pick in another of its tabs doesn't count here.
    expect(tabTile('t-who-home')!.querySelector('[data-shortcut-count]')).toHaveTextContent('—')
    act(() => { useListWidgetStore.setState({ picks: { [shortcutListTabId(3)]: [] } }) })
    expect(tabTile('t-who-home')!.querySelector('[data-shortcut-count]')).toHaveTextContent('—')
    act(() => { useListWidgetStore.setState({ picks: { 't-who-home': [] } }) })
    expect(tooltipOf(within(tabTile('t-who-home')!).getByRole('button', { name: /Open$/ }))).toMatch(/5 tasks · /)
    // No Add a list tile, and no drag.
    expect(document.querySelector('[data-shortcuts-add]')).toBeNull()
    expect(within(tabTile('t-errands')!).getByRole('button', { name: /Open$/ })).not.toHaveAttribute('aria-roledescription')
  })

  it('a click opens the tab larger; its menu: Open, Show in its cell (no Remove)', async () => {
    setup(ofLayout())
    const setActive = vi.spyOn(useWorkspaceStore.getState(), 'setActiveTab').mockResolvedValue(undefined as never)
    render(<DndContext><Live /><WidgetPopupHost /></DndContext>)
    await act(async () => { fireEvent.click(within(tabTile('t-who-home')!).getByRole('button', { name: /Open$/ })) })
    expect(useUIStore.getState().widgetPopup).toEqual({ kind: 'tab', tabId: 't-who-home' })
    act(() => { useUIStore.getState().closeWidgetPopup() })
    fireEvent.contextMenu(within(tabTile('t-who-home')!).getByRole('button', { name: /Open$/ }))
    const menu = screen.getByRole('menu', { name: 'List board options' })
    expect(within(menu).getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['Open', 'Show in its cell'])
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Show in its cell' }))
    expect(setActive).toHaveBeenCalledWith('t-who-home')
  })

  it('empty: a line, no Add a list', () => {
    setup(ofLayout(), [])
    useWorkspaceStore.setState((s) => ({ working: { ...s.working!, cells: s.working!.cells.map((c) => (c.id === 'c' ? { ...c, tabs: [] } : c)) } }))
    render(<Live />)
    expect(screen.getByRole('status')).toHaveTextContent('No list tabs in this layout.')
    expect(screen.queryByRole('button', { name: 'Add a list' })).toBeNull()
  })
})

describe('Which lists (one undo step; the picks kept)', () => {
  it('the ⋯ offers Which lists ›, then Add a list › while it shows the lists picked', () => {
    setup(picked([2]))
    const { result, rerender } = renderHook(({ tab }) => useShortcutsMenuEntries(tab), { initialProps: { tab: current() } })
    expect(result.current.map((e) => (e.kind === 'item' ? [e.label, e.note] : e.kind))).toEqual([['Which lists', 'Lists I pick'], ['Add a list', undefined]])
    rerender({ tab: ofLayout([2]) })
    expect(result.current.map((e) => (e.kind === 'item' ? [e.label, e.note] : e.kind))).toEqual([['Which lists', 'This layout’s lists']])
  })

  it('switching shows the other lists, one undo step; switching back finds the picks', async () => {
    setup(picked([2, 4]))
    render(<Live />)
    expect(tileIds()).toEqual([2, 4])
    /** Picks `label` under Which lists ›, as the ⋯ offers it now. */
    const pick = async (label: string) => {
      const { result, unmount } = renderHook(() => useShortcutsMenuEntries(current()))
      const which = result.current[0]
      if (which?.kind !== 'item' || !which.children) throw new Error('no Which lists')
      const choice = which.children.find((e) => e.kind === 'item' && e.label === label)
      await act(async () => { if (choice?.kind === 'item') choice.onSelect?.() })
      unmount()
    }
    await pick('This layout’s lists')
    expect(current().config).toEqual({ source: 'layout', lists: [2, 4] })
    expect(layoutSteps()).toEqual(['Changed “List board”'])
    expect(tabTileIds()).toEqual(['t-errands', 't-who-home', 't-later-home'])
    await pick('Lists I pick')
    expect(current().config).toEqual({ source: 'picked', lists: [2, 4] })
    expect(layoutSteps()).toHaveLength(2)
    expect(tileIds()).toEqual([2, 4])
    // The source it shows already: nothing written.
    await pick('Lists I pick')
    expect(layoutSteps()).toHaveLength(2)
  })
})

describe('the List board’s faces', () => {
  it('large: the grid of tiles and the dashed Add a list tile; no name line by default', () => {
    setup(picked([1, 2]))
    render(<Live />)
    expect(document.querySelector('[data-shortcuts-face]')!.getAttribute('data-shortcuts-face')).toBe('large')
    expect(document.querySelector('[data-shortcuts-add]')).not.toBeNull()
    expect(screen.queryByTestId('top-line-name')).toBeNull()
  })

  it('Show widget names: its name line says List board', () => {
    useSettingsStore.setState({ showWidgetNames: true })
    setup(picked([1, 2]))
    const controls: CellControlsValue = {
      cellId: 'b', tabs: [current()], tabId: 'sc', title: 'List board', touch: false, setMoreButton: () => undefined, menuOpen: false,
      onMore: () => {}, collapsed: false, onExpand: () => {}, claim: () => () => {},
    }
    render(<CellControlsContext.Provider value={controls}><Live /></CellControlsContext.Provider>)
    expect(screen.getByTestId('top-line-name')).toHaveTextContent('List board')
  })

  it('rows when narrow: a row per list with its bar, no squares, no titles', () => {
    width = 300
    setup(picked([1, 2]))
    render(<Live />)
    expect(document.querySelector('[data-shortcuts-face]')!.getAttribute('data-shortcuts-face')).toBe('rows')
    expect(tileIds()).toEqual([1, 2])
    expect(document.querySelectorAll('[data-peek-line], button[data-tone]')).toHaveLength(0)
    expect([...tile(2)!.querySelectorAll('[data-board-bar] [data-tone]')].map((s) => s.getAttribute('data-tone'))).toEqual(['late', 'soon', 'followup', 'stale'])
    // A row keeps its capsule in its line, and its count beside it.
    expect(tile(2)!.querySelector('[data-corner-badge]')).toBeNull()
    expect(tile(2)!.querySelector('[data-shortcut-badge]')).not.toBeNull()
    expect(tile(2)!.querySelector('[data-shortcut-count]')).toHaveTextContent('4')
  })

  it('compact when short: every tile, wrapping — none folded into +N; squares, no titles', () => {
    width = 380
    height = 140
    setup(picked([1, 2, 3, 4]))
    render(<Live />)
    expect(document.querySelector('[data-shortcuts-face]')!.getAttribute('data-shortcuts-face')).toBe('compact')
    expect(tileIds()).toEqual([1, 2, 3, 4])
    expect(document.querySelector('[data-shortcuts-more]')).toBeNull()
    expect(document.querySelectorAll('[data-peek-line]')).toHaveLength(0)
    expect(squareTones(tile(2)!)).toHaveLength(4)
  })

  it('small: its name and the number of lists, of either source', () => {
    // Wide, under a tile's head (63px): a short wide board keeps its line of tiles down to that.
    height = 50
    setup(picked([1, 2]))
    const { unmount } = render(<Live />)
    expect(screen.getByRole('group', { name: 'List board: 2 lists' })).toBeInTheDocument()
    expect(tileIds()).toEqual([])
    unmount()
    setup(ofLayout())
    render(<Live />)
    expect(screen.getByRole('group', { name: 'List board: 3 lists' })).toBeInTheDocument()
  })
})

describe('a tile’s list in the widget popup', () => {
  it('shows a list of another layout over this one, under its own tab id, with its tab’s icon', async () => {
    setup(picked([2]))
    useWorkspaceStore.setState((s) => ({
      layouts: s.layouts.map((l) => (l.id === 2
        ? { ...l, cells: l.cells.map((c) => ({ ...c, tabs: c.tabs.map((t) => (t.id === 't-clients' ? { ...t, icon: { kind: 'emoji' as const, emoji: '💼' } } : t)) })) }
        : l)),
    }))
    render(<DndContext><Live /><WidgetPopupHost /></DndContext>)
    await act(async () => { fireEvent.click(within(tile(2)!).getByRole('button', { name: /^Clients: .*Open$/ })) })
    expect(useUIStore.getState().widgetPopup).toEqual({ kind: 'shortcut', listDefinitionId: 2 })
    const dialog = document.querySelector<HTMLElement>('[data-testid="widget-popup"]')!
    expect(dialog.getAttribute('aria-label')).toBe('Clients')
    expect(dialog.querySelector(`[data-list-host="${shortcutListTabId(2)}"]`)).not.toBeNull()
    expect(within(dialog).getByText('Send invoice')).toBeInTheDocument()
    expect(dialog.querySelector('[data-tab-icon]')?.textContent).toContain('💼')
  })

  it('keeps the popup’s prompt pick while it shows; the list deleted closes it', async () => {
    setup(picked([3]))
    render(<DndContext><Live /><WidgetPopupHost /></DndContext>)
    await act(async () => { await openShortcutList(3) })
    act(() => { useListWidgetStore.getState().setPicks(shortcutListTabId(3), [7]) })
    // Another tab's pick prunes gone tabs: the popup's stays.
    act(() => { useListWidgetStore.getState().setPicks('t-who', [8]) })
    expect(useListWidgetStore.getState().picks[shortcutListTabId(3)]).toEqual([7])
    act(() => { useListDefinitionStore.setState((s) => ({ listDefinitions: s.listDefinitions.filter((d) => d.id !== 3) })) })
    expect(useUIStore.getState().widgetPopup).toBeNull()
    act(() => { useListWidgetStore.getState().setPicks('t-who', [9]) })
    expect(useListWidgetStore.getState().picks[shortcutListTabId(3)]).toBeUndefined()
  })
})
