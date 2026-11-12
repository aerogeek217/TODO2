import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, cleanup, fireEvent, screen, within, waitFor } from '@testing-library/react'
import { DndContext } from '@dnd-kit/core'
import { WorkspaceCell } from '../../../components/workspace/WorkspaceCell'
import { createCommands, type CommandContext } from '../../../services/command-registry'
import { SHORTCUT_HANDLERS } from '../../../services/keyboard-shortcuts'
import { shortcutSpec } from '../../../models/keyboard-shortcut'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import { useListDefinitionStore } from '../../../stores/list-definition-store'
import { useListWidgetStore } from '../../../stores/list-widget-store'
import { useListOrderStore } from '../../../stores/list-order-store'
import { useSettingsStore } from '../../../stores/settings-store'
import { useStatusStore } from '../../../stores/status-store'
import { useTodoStore } from '../../../stores/todo-store'
import { useUIStore } from '../../../stores/ui-store'
import { createTab, type LayoutCell, type PersistedWorkspaceLayout } from '../../../models/workspace-layout'
import { REVIEW_POPUP_TAB_ID } from '../../../models/review'
import type { PersistedListDefinition } from '../../../models/list-definition'
import { emptyPredicate } from '../../../models'
import { clearFilterStore, makeTodo, resetEntityStores } from '../../helpers'
import { cell, grid } from '../../helpers/layout-builders'

/**
 * A list tab's Review these N tasks (widget feedback 2B): the tab menu's
 * item, the shortcut (R) and the palette's Review List all jump to a Review
 * widget with the list's filter as it shows its tasks — hidden while no
 * layout has a Review widget.
 */

const AT = new Date(2026, 0, 1)
const LIST_CELL = cell('k', [{ id: 'mine', kind: 'lens', config: { listDefinitionId: 2 } }])
const REVIEW_CELL = cell('rv-cell', [createTab('review', 'rv')])

const def = (extra: Partial<PersistedListDefinition> = {}): PersistedListDefinition => ({
  id: 2, name: 'Aisha 1:1', sortOrder: 0, sort: 'manual', grouping: 'none',
  membership: { kind: 'custom', predicate: emptyPredicate() }, owner: { layoutId: 1 }, ...extra,
})

function setList(extra: Partial<PersistedListDefinition> = {}) {
  useListDefinitionStore.setState({ listDefinitions: [def(extra)], loaded: true })
}

/** The open layout: the list beside a Review widget (or the list alone). */
function setLayout(withReview: boolean) {
  const body = withReview ? grid([[LIST_CELL, REVIEW_CELL]]) : grid([[LIST_CELL]])
  const layout: PersistedWorkspaceLayout = { id: 1, sortOrder: 0, name: 'Main', createdAt: AT, modifiedAt: AT, ...body }
  useWorkspaceStore.setState({ layouts: [layout], activeLayoutId: 1, working: layout, saved: layout, writeFailed: false, hydrated: true })
}

beforeEach(() => {
  resetEntityStores()
  clearFilterStore()
  useUIStore.setState(useUIStore.getInitialState(), true)
  useListOrderStore.setState({ ranks: new Map(), loaded: true })
  setLayout(true)
  useStatusStore.setState({ statuses: [{ id: 1, name: 'Waiting', color: '#db5', sortOrder: 1 }, { id: 2, name: 'Doing', color: '#5b8', sortOrder: 2 }] })
  useTodoStore.setState({
    todos: [
      makeTodo({ id: 1, title: 'First', sortOrder: 1, statusId: 2 }),
      makeTodo({ id: 2, title: 'Second', sortOrder: 2, statusId: 1 }),
      makeTodo({ id: 3, title: 'Third', sortOrder: 3, statusId: 1 }),
      makeTodo({ id: 4, title: 'Done one', sortOrder: 4, isCompleted: true }),
    ],
  })
  setList()
})

afterEach(cleanup)

function showCell() {
  const listCell = useWorkspaceStore.getState().working?.cells.find((c) => c.id === 'k') as LayoutCell
  render(<DndContext><WorkspaceCell cell={listCell} rowTrackIds={['r1']} collapsed={false} /></DndContext>)
}

function openTabMenu(): HTMLElement {
  fireEvent.contextMenu(document.querySelector('[data-ws-tab="mine"]')!)
  return screen.getByRole('menu', { name: 'Cell options' })
}

const paletteCommands = () => createCommands({ shortcuts: {} } as unknown as CommandContext)
const reviewFilter = () => useListWidgetStore.getState().reviewFilters.rv

describe('a list tab’s Review these N tasks', () => {
  it('the tab menu offers it with the key; it sets the Review widget’s filter to the list’s', async () => {
    setList({ membership: { kind: 'custom', predicate: { ...emptyPredicate(), statusIds: [1] } } })
    showCell()
    const item = within(openTabMenu()).getByRole('menuitem', { name: /Review these 2 tasks/ })
    expect(item).toHaveTextContent('R')
    fireEvent.click(item)
    await waitFor(() => expect(reviewFilter()).toEqual({ expression: { kind: 'status', id: 1 }, showCompleted: false }))
  })

  it('a list that narrows by nothing: every open task (an empty filter)', async () => {
    showCell()
    fireEvent.click(within(openTabMenu()).getByRole('menuitem', { name: /Review these 3 tasks/ }))
    await waitFor(() => expect(reviewFilter()).toEqual({ expression: { kind: 'and', items: [] }, showCompleted: false }))
  })

  it('counts the open tasks shown (a completed one it shows isn’t reviewed)', () => {
    setList({ membership: { kind: 'custom', predicate: { ...emptyPredicate(), showCompleted: true } } })
    showCell()
    expect(within(openTabMenu()).getByRole('menuitem', { name: /Review these 3 tasks/ })).toBeInTheDocument()
  })

  it('one task: Review this task', () => {
    useTodoStore.setState({ todos: [makeTodo({ id: 1, title: 'Only', sortOrder: 1 })] })
    showCell()
    expect(within(openTabMenu()).getByRole('menuitem', { name: /Review this task/ })).toBeInTheDocument()
  })

  it('a list showing nothing: no Review item', () => {
    useTodoStore.setState({ todos: [] })
    showCell()
    expect(within(openTabMenu()).queryByRole('menuitem', { name: /Review/ })).toBeNull()
  })

  it('no Review widget on the layout: the item still shows and opens the popup review', async () => {
    setLayout(false)
    showCell()
    fireEvent.click(within(openTabMenu()).getByRole('menuitem', { name: /^Review these/ }))
    await waitFor(() => expect(useUIStore.getState().widgetPopup).toEqual({ kind: 'review' }))
    expect(useListWidgetStore.getState().reviewFilters[REVIEW_POPUP_TAB_ID]).toBeDefined()
  })

  it('the widget gone: its shown tasks go with it', () => {
    showCell()
    expect(useListWidgetStore.getState().shown.mine?.sections.flatMap((s) => s.todos.map((t) => t.id))).toEqual([1, 2, 3])
    cleanup()
    expect(useListWidgetStore.getState().shown.mine).toBeUndefined()
  })
})

describe('Review List: the shortcut and the palette', () => {
  const press = () => {
    let prevented = false
    void SHORTCUT_HANDLERS['review-list']({ e: { key: 'r', shiftKey: false, preventDefault: () => { prevented = true } }, callbacks: { openPalette() {}, closePalette() {}, openSettings() {} } })
    return prevented
  }

  it('R by default, editable, not in text fields, blocked while the editor is open', () => {
    expect(shortcutSpec('review-list')).toMatchObject({ chord: [{ key: 'r' }], editable: true, blockedByEditPopup: true })
    expect(shortcutSpec('review-list').allowInInput).toBeUndefined()
  })

  it('the palette offers Review List for the list on screen, with its name and open tasks', () => {
    showCell()
    const command = paletteCommands().find((c) => c.id === 'review-list')
    expect(command).toMatchObject({ name: 'Review List', hint: 'Aisha 1:1 · 3 tasks', shortcut: 'R', category: 'task' })
  })

  it('no Review List without a list on screen or with one that shows nothing; with no Review widget it is there', () => {
    expect(paletteCommands().some((c) => c.id === 'review-list')).toBe(false)
    useTodoStore.setState({ todos: [] })
    showCell()
    expect(paletteCommands().some((c) => c.id === 'review-list')).toBe(false)
    cleanup()
    useTodoStore.setState({ todos: [makeTodo({ id: 1, sortOrder: 1 })] })
    setLayout(false)
    showCell()
    expect(paletteCommands().some((c) => c.id === 'review-list')).toBe(true)
  })

  it('the key jumps with the list on screen', async () => {
    setList({ membership: { kind: 'custom', predicate: { ...emptyPredicate(), statusIds: [2] } } })
    showCell()
    expect(press()).toBe(true)
    await waitFor(() => expect(reviewFilter()).toEqual({ expression: { kind: 'status', id: 2 }, showCompleted: false }))
  })

  it('the key with no list on screen does nothing (and leaves the key alone); with no Review widget it opens the popup review', async () => {
    expect(press()).toBe(false)
    setLayout(false)
    showCell()
    expect(press()).toBe(true)
    await waitFor(() => expect(useListWidgetStore.getState().reviewFilters[REVIEW_POPUP_TAB_ID]).toBeDefined())
    expect(reviewFilter()).toBeUndefined()
  })

  it('the palette command runs the key’s handler', async () => {
    useSettingsStore.setState({ shortcutOverrides: {} })
    showCell()
    paletteCommands().find((c) => c.id === 'review-list')?.action()
    await waitFor(() => expect(reviewFilter()).toBeDefined())
  })
})
