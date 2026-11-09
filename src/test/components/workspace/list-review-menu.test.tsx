import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, cleanup, fireEvent, screen, within } from '@testing-library/react'
import { DndContext } from '@dnd-kit/core'
import { WorkspaceCell } from '../../../components/workspace/WorkspaceCell'
import { createCommands, type CommandContext } from '../../../services/command-registry'
import { SHORTCUT_HANDLERS } from '../../../services/keyboard-shortcuts'
import { shortcutSpec } from '../../../models/keyboard-shortcut'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import { useListDefinitionStore } from '../../../stores/list-definition-store'
import { useListWidgetStore } from '../../../stores/list-widget-store'
import { useListOrderStore } from '../../../stores/list-order-store'
import { useReviewStore } from '../../../stores/review-store'
import { useSettingsStore } from '../../../stores/settings-store'
import { useStatusStore } from '../../../stores/status-store'
import { useTodoStore } from '../../../stores/todo-store'
import { useUIStore } from '../../../stores/ui-store'
import type { LayoutCell, PersistedWorkspaceLayout } from '../../../models/workspace-layout'
import type { PersistedListDefinition } from '../../../models/list-definition'
import { emptyPredicate } from '../../../models'
import { clearFilterStore, makeTodo, resetEntityStores } from '../../helpers'
import { single } from '../../helpers/layout-builders'

/**
 * A list tab's Review these N tasks (D26): the tab menu's item, the
 * shortcut (R) and the palette's Review List all open the deck on the tab's
 * tasks as shown — the list's filter and order, its group headers as
 * dividers.
 */

const AT = new Date(2026, 0, 1)
const CELL: LayoutCell = { id: 'k', area: { col: 0, row: 0, colSpan: 1, rowSpan: 1 }, tabs: [{ id: 'mine', kind: 'lens', config: { listDefinitionId: 2 } }] }

const def = (extra: Partial<PersistedListDefinition> = {}): PersistedListDefinition => ({
  id: 2, name: 'Aisha 1:1', sortOrder: 0, sort: 'manual', grouping: 'none',
  membership: { kind: 'custom', predicate: emptyPredicate() }, owner: { layoutId: 1 }, ...extra,
})

function setList(extra: Partial<PersistedListDefinition> = {}) {
  useListDefinitionStore.setState({ listDefinitions: [def(extra)], loaded: true })
}

beforeEach(() => {
  resetEntityStores()
  clearFilterStore()
  useUIStore.setState(useUIStore.getInitialState(), true)
  useListOrderStore.setState({ ranks: new Map(), loaded: true })
  const layout: PersistedWorkspaceLayout = { id: 1, sortOrder: 0, name: 'Main', createdAt: AT, modifiedAt: AT, ...single(CELL) }
  useWorkspaceStore.setState({ layouts: [layout], activeLayoutId: 1, working: layout, saved: layout, isDirty: false, hydrated: true })
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
  render(<DndContext><WorkspaceCell cell={CELL} rowTrackIds={['r1']} collapsed={false} /></DndContext>)
}

function openTabMenu(): HTMLElement {
  fireEvent.contextMenu(document.querySelector('[data-ws-tab="mine"]')!)
  return screen.getByRole('menu', { name: 'Change widget' })
}

const paletteCommands = () => createCommands({ shortcuts: {} } as unknown as CommandContext)

describe('a list tab’s Review these N tasks', () => {
  it('the tab menu offers it with the key, and opens the deck on the tasks as shown', () => {
    showCell()
    const menu = openTabMenu()
    const item = within(menu).getByRole('menuitem', { name: /Review these 3 tasks/ })
    expect(item).toHaveTextContent('R')
    fireEvent.click(item)
    expect(useReviewStore.getState()).toMatchObject({
      open: true,
      source: { kind: 'list', title: 'Aisha 1:1', description: 'list · Manual' },
      ids: [1, 2, 3],
      dividers: [],
      index: 0,
    })
  })

  it('a grouped list: its groups as dividers, in the list’s order', () => {
    setList({ grouping: 'status' })
    showCell()
    fireEvent.click(within(openTabMenu()).getByRole('menuitem', { name: /Review these 3 tasks/ }))
    const { ids, dividers } = useReviewStore.getState()
    expect(ids).toEqual([2, 3, 1])
    expect(dividers).toEqual([{ index: 0, label: 'Waiting' }, { index: 2, label: 'Doing' }])
  })

  it('collapsed groups come along', () => {
    setList({ grouping: 'status' })
    showCell()
    const waiting = Object.keys(useListWidgetStore.getState().shown).length > 0
      ? useListWidgetStore.getState().shown.mine?.sections.find((s) => s.label === 'Waiting')?.key
      : undefined
    expect(waiting).toBeDefined()
    useListWidgetStore.getState().setCollapsed('mine', [waiting!])
    fireEvent.click(within(openTabMenu()).getByRole('menuitem', { name: /Review these 3 tasks/ }))
    expect(useReviewStore.getState().ids).toEqual([2, 3, 1])
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

  it('the widget gone: its shown tasks go with it', () => {
    showCell()
    expect(useListWidgetStore.getState().shown.mine?.sections.flatMap((s) => s.todos.map((t) => t.id))).toEqual([1, 2, 3])
    cleanup()
    expect(useListWidgetStore.getState().shown.mine).toBeUndefined()
  })
})

describe('Review List: the shortcut and the palette', () => {
  it('R by default, editable, not in text fields, blocked while the editor is open', () => {
    expect(shortcutSpec('review-list')).toMatchObject({ chord: [{ key: 'r' }], editable: true, blockedByEditPopup: true })
    expect(shortcutSpec('review-list').allowInInput).toBeUndefined()
  })

  it('the palette offers Review List for the list on screen, with its name and count', () => {
    showCell()
    const command = paletteCommands().find((c) => c.id === 'review-list')
    expect(command).toMatchObject({ name: 'Review List', hint: 'Aisha 1:1 · 3 tasks', shortcut: 'R', category: 'task' })
  })

  it('no Review List without a list on screen, or with one that shows nothing', () => {
    expect(paletteCommands().some((c) => c.id === 'review-list')).toBe(false)
    useTodoStore.setState({ todos: [] })
    showCell()
    expect(paletteCommands().some((c) => c.id === 'review-list')).toBe(false)
  })

  it('the key opens the deck on the list on screen', () => {
    showCell()
    let prevented = false
    void SHORTCUT_HANDLERS['review-list']({ e: { key: 'r', shiftKey: false, preventDefault: () => { prevented = true } }, callbacks: { openPalette() {}, closePalette() {}, openSettings() {} } })
    expect(prevented).toBe(true)
    expect(useReviewStore.getState()).toMatchObject({ open: true, ids: [1, 2, 3] })
  })

  it('the key with no list on screen does nothing (and leaves the key alone)', () => {
    let prevented = false
    void SHORTCUT_HANDLERS['review-list']({ e: { key: 'r', shiftKey: false, preventDefault: () => { prevented = true } }, callbacks: { openPalette() {}, closePalette() {}, openSettings() {} } })
    expect(prevented).toBe(false)
    expect(useReviewStore.getState().open).toBe(false)
  })

  it('the palette command runs the key’s handler', () => {
    useSettingsStore.setState({ shortcutOverrides: {} })
    showCell()
    paletteCommands().find((c) => c.id === 'review-list')?.action()
    expect(useReviewStore.getState().open).toBe(true)
  })
})
