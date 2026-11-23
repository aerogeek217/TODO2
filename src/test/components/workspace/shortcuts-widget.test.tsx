import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { DndContext } from '@dnd-kit/core'
import { WidgetPopupHost } from '../../../components/workspace/WidgetPopup'
import { ShortcutsWidget } from '../../../components/workspace/shortcuts/ShortcutsWidget'
import { moveShortcut } from '../../../components/workspace/shortcuts/shortcuts-menu'
import { WidgetFaceContext } from '../../../hooks/use-widget-face'
import { emptyPredicate } from '../../../models/filter-predicate'
import type { ListDefinition } from '../../../models/list-definition'
import { createTab, shortcutListTabId, type PersistedWorkspaceLayout, type ShortcutsTab } from '../../../models/workspace-layout'
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
 * Shortcuts (2026-11-23) in JSDOM: a tile per picked list of any layout —
 * its tab's icon, its badge capsule, its count and first titles, its
 * layout — the writes that add, remove and move a list (one undo step
 * each), its faces, and the popup showing a list of another layout.
 */

const TODAY = new Date(2026, 10, 23, 10)
const day = (offset: number) => new Date(2026, 10, 23 + offset, 9)

function list(id: number, name: string, layoutId: number, extra: Partial<ListDefinition> = {}): ListDefinition & { id: number } {
  return { id, name, sortOrder: id, membership: { kind: 'custom', predicate: emptyPredicate() }, sort: 'manual', grouping: 'none', owner: { layoutId }, ...extra } as ListDefinition & { id: number }
}

const shortcuts = (lists?: number[]): ShortcutsTab => ({ id: 'sc', kind: 'shortcuts', config: lists ? { lists } : {} })

function setup(lists?: number[]) {
  const lens = (id: string, listDefinitionId: number) => ({ ...createTab('lens', id), config: { listDefinitionId } })
  const home: PersistedWorkspaceLayout = {
    id: 1, name: 'Home', sortOrder: 0, createdAt: new Date(0), modifiedAt: new Date(0),
    ...grid([[cell('a', [{ ...lens('t-errands', 1), icon: { kind: 'line', key: 'flag' } }]), cell('b', [shortcuts(lists)])]]),
  }
  const work: PersistedWorkspaceLayout = {
    id: 2, name: 'Work', sortOrder: 1, createdAt: new Date(0), modifiedAt: new Date(0),
    ...single(cell('w', [lens('t-clients', 2), lens('t-who', 3), lens('t-later', 4)])),
  }
  useWorkspaceStore.setState({ working: home, saved: home, layouts: [home, work], activeLayoutId: 1, hydrated: true })
}

/** The Shortcuts tab as it is in the open layout (re-rendered on each write). */
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
const tileIds = () => [...document.querySelectorAll<HTMLElement>('[data-shortcut-tile]')].map((el) => Number(el.dataset.shortcutTile))

let width = 900
let height = 600

beforeEach(() => {
  width = 900
  height = 600
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => width)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(() => height)
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(TODAY)
  resetEntityStores()
  clearFilterStore()
  useSettingsStore.setState({ urgentDueWithinDays: 3 })
  useTodoStore.setState({
    todos: [
      makeTodo({ id: 1, title: 'Buy stamps', sortOrder: 1 }),
      makeTodo({ id: 2, title: 'Call Acme', dueDate: day(-1), sortOrder: 2, statusId: 5 }),
      makeTodo({ id: 3, title: 'Send invoice', sortOrder: 3, statusId: 5 }),
      makeTodo({ id: 4, title: 'Renew lease', sortOrder: 4, statusId: 5 }),
      makeTodo({ id: 5, title: 'Plan offsite', sortOrder: 5, statusId: 5 }),
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

describe('Shortcuts’ tiles', () => {
  it('a tile per picked list, in order, from any layout; a deleted list is skipped, its id kept', () => {
    setup([2, 1, 99])
    render(<Live />)
    expect(tileIds()).toEqual([2, 1])
    expect(current().config.lists).toEqual([2, 1, 99])
    // Its layout's name at its foot (the open one's too).
    expect(within(tile(2)!).getByText('Work')).toBeInTheDocument()
    expect(within(tile(1)!).getByText('Home')).toBeInTheDocument()
  })

  it('shows its list tab’s picked icon (none when none was picked), its badge capsule, its count and first titles', () => {
    setup([1, 2])
    render(<Live />)
    expect(tile(1)!.querySelector('[data-app-icon="line"]')).not.toBeNull()
    expect(tile(2)!.querySelector('[data-app-icon]')).toBeNull()
    // Clients: one task overdue, the capsule's due part solid.
    expect(tile(2)!.querySelector('[data-shortcut-badge] [data-badge-part="due"]')).toHaveTextContent('1')
    expect(tile(2)!.querySelector('[data-shortcut-count]')).toHaveTextContent('4')
    // The first three titles, as built.
    expect([...tile(2)!.querySelectorAll('[data-peek-line]')].map((el) => el.textContent)).toEqual(['Call Acme', 'Send invoice', 'Renew lease'])
  })

  it('a list waiting on its prompt: no capsule, no titles, its count —; a pick in its popup counts', () => {
    setup([3])
    render(<Live />)
    expect(tile(3)!.querySelector('[data-shortcut-count]')).toHaveTextContent('—')
    expect(tile(3)!.querySelector('[data-shortcut-badge]')).toBeNull()
    expect(tile(3)!.querySelectorAll('[data-peek-line]')).toHaveLength(0)
    act(() => { useListWidgetStore.setState({ picks: { [shortcutListTabId(3)]: [] } }) })
    expect(tile(3)!.querySelector('[data-shortcut-count]')).toHaveTextContent('5')
  })

  it('empty: a line and an Add a list button', () => {
    setup()
    render(<Live />)
    expect(screen.getByRole('status')).toHaveTextContent('No lists added.')
    expect(screen.getByRole('button', { name: 'Add a list' })).toBeInTheDocument()
  })
})

describe('adding, removing and moving (one undo step each)', () => {
  it('Add a list offers every list not added, under its layout, the open layout first; a pick adds it at the end', async () => {
    setup([2])
    render(<Live />)
    fireEvent.click(document.querySelector<HTMLElement>('[data-shortcuts-add]')!)
    const menu = screen.getByRole('menu', { name: 'Add a list' })
    const words = [...menu.querySelectorAll('[role="presentation"], [role="menuitem"]')].map((el) => el.textContent?.trim()).filter(Boolean)
    expect(words).toEqual(['Home', 'Errands', 'Work', 'Tasks for…', 'Later'])
    await act(async () => { fireEvent.click(within(menu).getByRole('menuitem', { name: 'Later' })) })
    expect(current().config.lists).toEqual([2, 4])
    expect(layoutSteps()).toEqual(['Added “Later” to Shortcuts'])
    expect(tileIds()).toEqual([2, 4])
  })

  it('a tile’s right-click: Remove from Shortcuts takes the list out (the list stays); Open opens it', async () => {
    setup([1, 2])
    render(<DndContext><Live /><WidgetPopupHost /></DndContext>)
    fireEvent.contextMenu(within(tile(1)!).getByRole('button', { name: /^Errands: .*Open$/ }))
    await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name: 'Remove from Shortcuts' })) })
    expect(current().config.lists).toEqual([2])
    expect(layoutSteps()).toEqual(['Removed “Errands” from Shortcuts'])
    expect(useListDefinitionStore.getState().listDefinitions.some((d) => d.id === 1)).toBe(true)
    fireEvent.contextMenu(within(tile(2)!).getByRole('button', { name: /^Clients: .*Open$/ }))
    await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name: 'Open' })) })
    expect(useUIStore.getState().widgetPopup).toEqual({ kind: 'shortcut', listDefinitionId: 2 })
  })

  it('a drag moves a list to where it was dropped', async () => {
    setup([1, 2, 4])
    render(<Live />)
    await act(async () => { moveShortcut(current(), 4, 1) })
    expect(current().config.lists).toEqual([4, 1, 2])
    expect(layoutSteps()).toEqual(['Moved “Later”'])
    expect(tileIds()).toEqual([4, 1, 2])
  })
})

describe('Shortcuts’ faces', () => {
  it('large: the grid of tiles and the dashed Add a list tile', () => {
    setup([1, 2])
    render(<Live />)
    expect(document.querySelector('[data-shortcuts-face]')!.getAttribute('data-shortcuts-face')).toBe('large')
    expect(document.querySelector('[data-shortcuts-add]')).not.toBeNull()
  })

  it('rows when narrow: a row per list, no titles, no layout line', () => {
    width = 300
    setup([1, 2])
    render(<Live />)
    expect(document.querySelector('[data-shortcuts-face]')!.getAttribute('data-shortcuts-face')).toBe('rows')
    expect(tileIds()).toEqual([1, 2])
    expect(document.querySelectorAll('[data-peek-line], [data-shortcut-layout]')).toHaveLength(0)
  })

  it('compact when short: one line of tiles, the ones that don’t fit in +N', () => {
    width = 400
    height = 140
    setup([1, 2, 3, 4])
    render(<Live />)
    expect(document.querySelector('[data-shortcuts-face]')!.getAttribute('data-shortcuts-face')).toBe('compact')
    // 400px holds two tiles of 150: one list and +3.
    expect(tileIds()).toEqual([1])
    expect(document.querySelector('[data-shortcuts-more]')).toHaveTextContent('+3')
    expect(document.querySelectorAll('[data-peek-line]')).toHaveLength(0)
  })

  it('small: its name and the number of lists', () => {
    height = 80
    setup([1, 2])
    render(<Live />)
    expect(screen.getByRole('group', { name: 'Shortcuts: 2 lists' })).toBeInTheDocument()
    expect(tileIds()).toEqual([])
  })
})

describe('a tile’s list in the widget popup', () => {
  it('shows a list of another layout over this one, under its own tab id, with its tab’s icon', async () => {
    setup([2])
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
    setup([3])
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
