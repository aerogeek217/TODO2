import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, cleanup, screen, fireEvent, act, waitFor } from '@testing-library/react'
import { DndContext } from '@dnd-kit/core'
import { ListWidget, type ListWidgetResult } from '../../../components/workspace/list/ListWidget'
import { useListDefinitionStore, emptyPredicate } from '../../../stores/list-definition-store'
import { useListDraftStore } from '../../../stores/list-draft-store'
import { useListWidgetStore } from '../../../stores/list-widget-store'
import { useTodoStore } from '../../../stores/todo-store'
import { usePersonStore } from '../../../stores/person-store'
import { useStatusStore } from '../../../stores/status-store'
import { useFilterStore } from '../../../stores/filter-store'
import { useUIStore } from '../../../stores/ui-store'
import { useListOrderStore } from '../../../stores/list-order-store'
import { useSettingsStore } from '../../../stores/settings-store'
import { SINGLE_BINDINGS, type ShortcutCtx } from '../../../services/keyboard-shortcuts'
import type { PersistedListDefinition } from '../../../models/list-definition'
import type { LensTab } from '../../../models/workspace-layout'
import type { Person, TodoPredicate } from '../../../models'
import { clearFilterStore, makeTodo, resetEntityStores } from '../../helpers'

const alice: Person = { id: 1, name: 'Alice', initials: 'AL', color: '#c33' }
const bob: Person = { id: 2, name: 'Bob', initials: 'BO' }

function def(over: Partial<PersistedListDefinition> = {}, predicate: Partial<TodoPredicate> = {}): PersistedListDefinition {
  return {
    id: 7, name: 'Team', sortOrder: 0, pinnedToDashboard: false,
    membership: { kind: 'custom', predicate: { ...emptyPredicate(), ...predicate } },
    sort: 'manual', grouping: 'none',
    ...over,
  }
}

const tab: LensTab = { id: 't1', kind: 'lens', config: { listDefinitionId: 7 } }

function setup(d: PersistedListDefinition) {
  useListDefinitionStore.setState({ listDefinitions: [d] })
  let result: ListWidgetResult | undefined
  render(
    <DndContext>
      <ListWidget tab={tab} onResult={(r) => { result = r }} />
    </DndContext>,
  )
  return { result: () => result }
}

beforeEach(() => {
  resetEntityStores()
  clearFilterStore()
  useListDraftStore.setState({ drafts: {} })
  useListWidgetStore.setState({ picks: {}, collapsed: {}, popover: null })
  useUIStore.getState().clearSelection()
  useUIStore.setState({ bulkConfirmation: null })
  useListOrderStore.setState({ ranks: new Map(), loaded: true })
  usePersonStore.setState({ people: [alice, bob], assignedPeopleMap: new Map([[1, [alice]], [2, [bob]], [3, [alice, bob]]]) })
  useTodoStore.setState({
    todos: [
      makeTodo({ id: 1, title: 'Alice task', sortOrder: 1 }),
      makeTodo({ id: 2, title: 'Bob task', sortOrder: 2 }),
      makeTodo({ id: 3, title: 'Shared task', sortOrder: 3 }),
      makeTodo({ id: 4, title: 'Done task', sortOrder: 4, isCompleted: true }),
    ],
  })
})

afterEach(() => {
  cleanup()
})

const titles = () => Array.from(document.querySelectorAll('[data-todo-id]')).map((el) => el.querySelector('[title]')?.getAttribute('title'))

describe('ListWidget', () => {
  it('shows the list’s open tasks and reports the count', () => {
    const { result } = setup(def())
    expect(titles()).toEqual(['Alice task', 'Bob task', 'Shared task'])
    expect(result()?.countLabel).toBe('3')
    // No filters anywhere: no filter row.
    expect(screen.queryByTestId('list-filter-row')).toBeNull()
  })

  it('the screen filter narrows it, with a read-only screen chip and a shown-of-total count', () => {
    const { result } = setup(def())
    act(() => useFilterStore.getState().setPersonIds(new Set([1])))
    expect(titles()).toEqual(['Alice task', 'Shared task'])
    expect(result()?.countLabel).toBe('2 of 3')
    expect(screen.getByTestId('screen-filter-chip').textContent).toContain('Alice')
  })

  it('screen and list filters on the same field AND strictly', () => {
    setup(def({}, { personIds: [2] }))
    act(() => useFilterStore.getState().setPersonIds(new Set([1])))
    expect(titles()).toEqual(['Shared task'])
  })

  it('Show completed in the top bar brings completed tasks back', () => {
    setup(def())
    expect(titles()).not.toContain('Done task')
    act(() => useFilterStore.getState().setShowCompleted(true))
    expect(titles()).toContain('Done task')
  })

  it('screen filters hiding everything: says so and offers to clear them', () => {
    setup(def())
    act(() => useFilterStore.getState().setSearchText('nothing matches this'))
    expect(screen.getByText('All 3 tasks in this list are hidden by the screen filter.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Clear screen filter' }))
    expect(useFilterStore.getState().isActive).toBe(false)
    expect(titles()).toHaveLength(3)
  })

  it('the list’s own filters returning nothing: names them, Edit filters opens List options', () => {
    useStatusStore.setState({ statuses: [{ id: 5, name: 'Waiting', color: '#aa0', sortOrder: 0 }] })
    setup(def({}, { statusIds: [5] }))
    expect(screen.getByText('No tasks match')).toBeInTheDocument()
    expect(screen.getByText('Status Waiting')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Edit filters' }))
    expect(useListWidgetStore.getState().popover).toMatchObject({ kind: 'options', listDefinitionId: 7 })
  })

  it('an empty list without filters', () => {
    useTodoStore.setState({ todos: [] })
    setup(def())
    expect(screen.getByText('No tasks in this list')).toBeInTheDocument()
  })

  it('hard cap: first N, a Showing N of M line, and switch to scroll edits the list', () => {
    const { result } = setup(def({ maxTasks: 2 }))
    expect(titles()).toEqual(['Alice task', 'Bob task'])
    expect(result()?.countLabel).toBe('2 of 3')
    expect(screen.getByText(/Showing 2 of 3/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'switch to scroll' }))
    expect(useListDraftStore.getState().drafts[7]?.limitMode).toBe('scroll')
    expect(titles()).toHaveLength(3)
  })

  it('scroll mode shows every task', () => {
    setup(def({ maxTasks: 1, limitMode: 'scroll' }))
    expect(titles()).toHaveLength(3)
    expect(screen.queryByText(/Showing/)).toBeNull()
  })

  it('groups collapse on their own; a person’s group doesn’t repeat their avatar', () => {
    setup(def({ grouping: 'people' }))
    const groups = Array.from(document.querySelectorAll('[data-testid="list-group-name"]')).map((g) => g.textContent)
    expect(groups).toEqual(['Alice', 'Bob'])
    const aliceGroup = document.querySelector('[data-list-group="person-1"]')!
    // Shared task under Alice shows Bob's avatar only.
    const sharedRow = Array.from(aliceGroup.querySelectorAll('[data-todo-id="3"]'))[0]!
    expect(sharedRow.textContent).toContain('BO')
    expect(sharedRow.textContent).not.toContain('AL')
    fireEvent.click(aliceGroup.querySelector('button[aria-expanded]')!)
    expect(aliceGroup.querySelectorAll('[data-todo-id]')).toHaveLength(0)
    expect(document.querySelector('[data-list-group="person-2"]')!.querySelectorAll('[data-todo-id]')).toHaveLength(2)
  })

  it('renders the unsaved draft, and removing a list chip edits the draft', () => {
    useStatusStore.setState({ statuses: [{ id: 5, name: 'Waiting', color: '#aa0', sortOrder: 0 }] })
    setup(def({}, { statusIds: [5] }))
    fireEvent.click(screen.getByLabelText('Remove filter'))
    expect(useListDraftStore.getState().drafts[7]?.membership.predicate.statusIds).toBeNull()
    expect(useListDefinitionStore.getState().listDefinitions[0]!.membership.predicate.statusIds).toEqual([5])
    expect(titles()).toHaveLength(3)
  })

  it('a prompt shows its row; nothing picked = the pick-a-value state and a — count', () => {
    const { result } = setup(def({ runtimeFilter: { field: 'person' } }))
    expect(screen.getByText('Pick a person to show this list')).toBeInTheDocument()
    expect(result()?.countLabel).toBe('—')
    act(() => useListWidgetStore.getState().setPicks('t1', [2]))
    expect(titles()).toEqual(['Bob task', 'Shared task'])
    expect(result()?.countLabel).toBe('2')
  })

  it('picking values in the prompt picker filters the list, several picks OR-combined', () => {
    usePersonStore.setState({
      people: [alice, bob],
      assignedPeopleMap: new Map([[1, [alice]], [2, [bob]]]),
    })
    setup(def({ runtimeFilter: { field: 'person' } }))
    const picker = screen.getByLabelText(/Filter tasks by person/i)
    const pick = (name: string) => {
      fireEvent.focus(picker)
      fireEvent.click(Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.endsWith(name))!)
    }
    pick('Alice')
    expect(titles()).toEqual(['Alice task'])
    pick('Bob')
    expect(titles()).toEqual(['Alice task', 'Bob task'])
  })

  it('Add task shows only when the merged predicate names people / status / tags', () => {
    setup(def())
    expect(screen.queryByTitle('Add a task to this list')).toBeNull()
    cleanup()
    setup(def({}, { personIds: [1] }))
    expect(screen.getByTitle('Add a task to this list')).toBeInTheDocument()
  })
})


/** Row occurrences of the widget, in display order. */
const rowKeys = () => Array.from(document.querySelectorAll<HTMLElement>('[data-row-key]')).map((el) => el.dataset.rowKey)

function clickTitle(key: string, mods: { shiftKey?: boolean; ctrlKey?: boolean } = {}) {
  const row = document.querySelector<HTMLElement>(`[data-row-key="${key}"]`)!
  fireEvent.click(row.querySelector('[data-todo-id] span[title]')!, mods)
}

function press(key: string, shiftKey = false) {
  const e = new KeyboardEvent('keydown', { key, shiftKey, cancelable: true })
  const binding = SINGLE_BINDINGS.find((b) => b.chord.key === key.toLowerCase())!
  const ctx: ShortcutCtx = { e, callbacks: { openPalette: () => {}, closePalette: () => {}, navigate: () => {} } }
  act(() => { void binding.handler(ctx) })
}

describe('ListWidget rows: occurrences, selection, manual order', () => {
  // JSDOM has no scrollIntoView (the arrow keys scroll the cursor row into view).
  const hadScroll = 'scrollIntoView' in Element.prototype
  beforeEach(() => {
    if (!hadScroll) Object.defineProperty(Element.prototype, 'scrollIntoView', { value: () => {}, configurable: true, writable: true })
  })
  afterEach(() => {
    if (!hadScroll) delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
  })

  it('a task in two people’s groups is two rows with their own drag ids', () => {
    setup(def({ grouping: 'people' }))
    expect(rowKeys()).toEqual(['person-1|1', 'person-1|3', 'person-2|2', 'person-2|3'])
    const ids = Array.from(document.querySelectorAll('[data-row-key]')).map((el) => el.getAttribute('data-drag-id'))
    expect(new Set(ids).size).toBe(4)
    expect(ids).toContain('lw|t1|person-1|3')
    expect(ids).toContain('lw|t1|person-2|3')
  })

  it('click selects one; Shift extends across groups; Ctrl toggles; the cursor sits on one occurrence', () => {
    setup(def({ grouping: 'people' }))
    clickTitle('person-1|3')
    expect(useUIStore.getState()).toMatchObject({ selectionScope: 't1', selectionCursorKey: 'person-1|3' })
    expect(document.querySelector('[data-row-key="person-1|3"]')!.getAttribute('data-cursor')).toBe('true')
    expect(document.querySelector('[data-row-key="person-2|3"]')!.getAttribute('data-cursor')).toBeNull()
    // Selecting a task selects both its rows.
    expect(document.querySelector('[data-row-key="person-2|3"]')!.getAttribute('data-selected')).toBe('true')

    clickTitle('person-2|2', { shiftKey: true })
    expect([...useUIStore.getState().selectedTodoIds].sort()).toEqual([2, 3])
    expect(screen.getByTestId('list-bulk-bar').textContent).toContain('2 selected')

    clickTitle('person-1|1', { ctrlKey: true })
    expect([...useUIStore.getState().selectedTodoIds].sort()).toEqual([1, 2, 3])
  })

  it('arrow keys walk the rows (each occurrence once); Shift extends; Mod-A takes the widget', () => {
    setup(def({ grouping: 'people' }))
    clickTitle('person-1|1')
    press('ArrowDown')
    expect(useUIStore.getState().selectionCursorKey).toBe('person-1|3')
    press('ArrowDown')
    expect(useUIStore.getState().selectionCursorKey).toBe('person-2|2')
    press('ArrowDown')
    // Task 3 again — its second row, not a jump back to the first.
    expect(useUIStore.getState().selectionCursorKey).toBe('person-2|3')
    press('ArrowUp', true)
    expect(useUIStore.getState().selectionCursorKey).toBe('person-2|2')
    expect([...useUIStore.getState().selectedTodoIds].sort()).toEqual([2, 3])
    const selectAll = SINGLE_BINDINGS.find((b) => b.chord.key === 'a' && b.chord.mod)!
    act(() => { void selectAll.handler({ e: new KeyboardEvent('keydown', { key: 'a', ctrlKey: true }), callbacks: { openPalette: () => {}, closePalette: () => {}, navigate: () => {} } }) })
    expect([...useUIStore.getState().selectedTodoIds].sort()).toEqual([1, 2, 3])
  })

  it('selecting in another widget clears this one’s', () => {
    setup(def())
    clickTitle('all|1')
    act(() => useUIStore.getState().setScopedSelection('other', { ids: new Set([2]), anchorKey: 'x|2', cursorKey: 'x|2', cursorTodoId: 2 }))
    expect(document.querySelector('[data-row-key="all|2"]')!.getAttribute('data-selected')).toBeNull()
    expect(document.querySelector('[data-cursor]')).toBeNull()
  })

  it('the bulk bar acts on the selection through the existing bulk paths', () => {
    setup(def())
    clickTitle('all|1')
    clickTitle('all|3', { shiftKey: true })
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(useUIStore.getState().bulkConfirmation).toMatchObject({ action: 'delete', ids: [1, 2, 3] })
    fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }))
    expect(useUIStore.getState().selectedTodoIds.size).toBe(0)
    expect(screen.queryByTestId('list-bulk-bar')).toBeNull()
  })

  /** Opens the bulk bar's ⋯ More menu. */
  function openMore() {
    fireEvent.click(screen.getByRole('button', { name: 'More' }))
    return screen.getByRole('menu', { name: 'More actions' })
  }

  it('the bulk bar keeps the D4 order and puts Followed up + Markers under ⋯ More', () => {
    setup(def())
    clickTitle('all|1')
    clickTitle('all|2', { shiftKey: true })
    const bar = screen.getByTestId('list-bulk-bar')
    expect(Array.from(bar.querySelectorAll(':scope > button, :scope > span > button')).map((b) => b.getAttribute('aria-label')))
      .toEqual(['Set due date', 'Set follow-up', 'Assign people', 'Add tag', 'Complete', 'More', 'Delete', 'Clear selection'])
    const menu = openMore()
    expect(Array.from(menu.querySelectorAll('[role^="menuitem"]')).map((b) => b.getAttribute('data-menu-label')))
      .toEqual(['Followed up', 'Urgent', 'Important', 'Focus'])
  })

  it('⋯ More › Focus puts every selected task in focus, then takes them out', async () => {
    useTodoStore.setState({
      todos: [
        makeTodo({ id: 1, title: 'Alice task', sortOrder: 1, focus: true }),
        makeTodo({ id: 2, title: 'Bob task', sortOrder: 2 }),
      ],
    })
    setup(def())
    clickTitle('all|1')
    clickTitle('all|2', { shiftKey: true })
    openMore()
    const focus = screen.getByRole('menuitemcheckbox', { name: /Focus/ })
    expect(focus).toHaveAttribute('aria-checked', 'mixed')
    expect(focus).toHaveTextContent('1 of 2')
    await act(async () => { fireEvent.click(focus) })
    expect(useTodoStore.getState().todos.map((t) => t.focus)).toEqual([true, true])
    openMore()
    const remove = screen.getByRole('menuitemcheckbox', { name: /Focus/ })
    expect(remove).toHaveAttribute('aria-checked', 'true')
    await act(async () => { fireEvent.click(remove) })
    expect(useTodoStore.getState().todos.map((t) => t.focus)).toEqual([undefined, undefined])
  })

  it('⋯ More › Urgent / Important are tri-state; Urgent counts due dates and asks before removing them', async () => {
    useSettingsStore.setState({ urgentDueWithinDays: 3 })
    const tomorrow = new Date()
    tomorrow.setHours(0, 0, 0, 0)
    tomorrow.setDate(tomorrow.getDate() + 1)
    useTodoStore.setState({
      todos: [
        makeTodo({ id: 1, title: 'Alice task', sortOrder: 1, important: true }),
        makeTodo({ id: 2, title: 'Bob task', sortOrder: 2, dueDate: tomorrow }),
      ],
    })
    setup(def())
    clickTitle('all|1')
    clickTitle('all|2', { shiftKey: true })

    openMore()
    const important = screen.getByRole('menuitemcheckbox', { name: /Important/ })
    expect(important).toHaveAttribute('aria-checked', 'mixed')
    await act(async () => { fireEvent.click(important) })
    expect(useTodoStore.getState().todos.map((t) => t.important)).toEqual([true, true])
    openMore()
    await act(async () => { fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /Important/ })) })
    expect(useTodoStore.getState().todos.map((t) => t.important)).toEqual([undefined, undefined])

    // Bob's task is urgent by its due date: mixed until both are flagged.
    openMore()
    const urgent = screen.getByRole('menuitemcheckbox', { name: /Urgent/ })
    expect(urgent).toHaveAttribute('aria-checked', 'mixed')
    await act(async () => { fireEvent.click(urgent) })
    expect(useTodoStore.getState().todos.map((t) => t.urgent)).toEqual([true, true])
    openMore()
    await act(async () => { fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /Urgent/ })) })
    expect(useTodoStore.getState().todos.map((t) => t.urgent)).toEqual([undefined, undefined])
    await waitFor(() => expect(useUIStore.getState().bulkConfirmation).toMatchObject({
      ids: [2], message: '1 of 2 tasks stays urgent because of its due date.',
    }))
  })

  it('⋯ More › Followed up stamps every selected task, and is dimmed once they all were today', async () => {
    useTodoStore.setState({
      todos: [
        makeTodo({ id: 1, title: 'Alice task', sortOrder: 1 }),
        makeTodo({ id: 2, title: 'Bob task', sortOrder: 2 }),
      ],
    })
    setup(def())
    clickTitle('all|1')
    clickTitle('all|2', { shiftKey: true })
    openMore()
    const followedUp = screen.getByRole('menuitem', { name: 'Followed up' })
    expect(followedUp).not.toHaveTextContent('Today')
    await act(async () => { fireEvent.click(followedUp) })
    expect(useTodoStore.getState().todos.every((t) => t.lastFollowupAt instanceof Date)).toBe(true)
    openMore()
    expect(screen.getByRole('menuitem', { name: /^Followed up/ })).toHaveTextContent('Today')
  })

  it('a Markers list offers + Add task (new tasks start with those markers)', () => {
    setup(def({}, { markers: { focus: true, important: true } }))
    expect(screen.getByRole('button', { name: /Add task/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Add task/ }))
    expect(useUIStore.getState().quickAddDraft?.defaults?.markers).toEqual({ important: true, focus: true })
  })

  it('a manual list follows its ranks; unranked tasks come after, oldest first', () => {
    useTodoStore.setState({
      todos: [
        makeTodo({ id: 1, title: 'Alice task', createdAt: new Date('2026-10-01') }),
        makeTodo({ id: 2, title: 'Bob task', createdAt: new Date('2026-10-03') }),
        makeTodo({ id: 3, title: 'Shared task', createdAt: new Date('2026-10-02') }),
      ],
    })
    useListOrderStore.setState({ ranks: new Map([[7, new Map([[2, 1]])]]), loaded: true })
    setup(def())
    expect(titles()).toEqual(['Bob task', 'Alice task', 'Shared task'])
  })
})
