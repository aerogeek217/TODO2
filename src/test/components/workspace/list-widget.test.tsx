import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, cleanup, screen, fireEvent, act, within } from '@testing-library/react'
import { DndContext } from '@dnd-kit/core'
import { ListWidget, type ListWidgetResult } from '../../../components/workspace/list/ListWidget'
import { EditListHost } from '../../../components/workspace/list/EditList'
import { useListDefinitionStore } from '../../../stores/list-definition-store'
import { emptyPredicate } from '../../../models'
import { useListDraftStore } from '../../../stores/list-draft-store'
import { useListWidgetStore } from '../../../stores/list-widget-store'
import { useTodoStore } from '../../../stores/todo-store'
import { usePersonStore } from '../../../stores/person-store'
import { useStatusStore } from '../../../stores/status-store'
import { useFilterStore } from '../../../stores/filter-store'
import { useUIStore } from '../../../stores/ui-store'
import { useUndoStore } from '../../../stores/undo-store'
import { useListOrderStore } from '../../../stores/list-order-store'
import { useSettingsStore } from '../../../stores/settings-store'
import { DEFAULT_HOT_RULE } from '../../../utils/hot'
import { SHORTCUT_HANDLERS, type ShortcutCtx } from '../../../services/keyboard-shortcuts'
import { createCommands, type CommandContext } from '../../../services/command-registry'
import type { PersistedListDefinition } from '../../../models/list-definition'
import type { LensTab } from '../../../models/workspace-layout'
import type { Person, TodoPredicate } from '../../../models'
import { db } from '../../../data/database'
import { clearFilterStore, makeTodo, resetEntityStores, stubClipboard } from '../../helpers'

const alice: Person = { id: 1, name: 'Alice', initials: 'AL', color: '#c33' }
const bob: Person = { id: 2, name: 'Bob', initials: 'BO' }

function def(over: Partial<PersistedListDefinition> = {}, predicate: Partial<TodoPredicate> = {}): PersistedListDefinition {
  return {
    id: 7, name: 'Team', sortOrder: 0, 
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
  useListWidgetStore.setState({ picks: {}, collapsed: {} })
  useUIStore.getState().clearSelection()
  useUIStore.setState({ bulkConfirmation: null })
  useListOrderStore.setState({ ranks: new Map(), loaded: true })
  useSettingsStore.setState({ urgentDueWithinDays: 3, hotRule: DEFAULT_HOT_RULE })
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

const titles = () => Array.from(document.querySelectorAll('[data-todo-id]')).map((el) => el.querySelector('[data-task-title]')?.getAttribute('data-task-title'))

describe('ListWidget', () => {
  it('a malformed stored filter loads as no filter instead of crashing the widget', async () => {
    const stored = def({}, { personIds: 5 as unknown as number[], tags: 'x' as unknown as number[] })
    await db.listDefinitions.put(stored)
    try {
      await act(() => useListDefinitionStore.getState().load())
      expect(useListDefinitionStore.getState().listDefinitions[0]!.membership.predicate).toMatchObject({ personIds: null, tags: null })
      render(<DndContext><ListWidget tab={tab} onResult={() => {}} /></DndContext>)
      expect(titles()).toEqual(['Alice task', 'Bob task', 'Shared task'])
    } finally {
      await db.listDefinitions.clear()
    }
  })

  it('shows the list’s open tasks and reports the count', () => {
    const { result } = setup(def())
    expect(titles()).toEqual(['Alice task', 'Bob task', 'Shared task'])
    expect(result()?.countLabel).toBe('3')
    // No filters anywhere: the filter line still shows (the way in to setting them) — No filters, + Filter,
    // the summary (`Manual` for an ungrouped manual list); no Revert · Save while saved.
    const row = screen.getByTestId('list-filter-row')
    expect(row).toHaveTextContent('No filters')
    expect(within(row).getByRole('button', { name: /Filter/ })).toBeInTheDocument()
    expect(screen.getByTestId('list-summary')).toHaveTextContent('Manual')
    expect(screen.queryByTestId('save-list')).toBeNull()
    expect(screen.queryByTestId('revert-list')).toBeNull()
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

  it('the list’s own filters returning nothing: names them, Edit filters opens Edit list', () => {
    useStatusStore.setState({ statuses: [{ id: 5, name: 'Waiting', color: '#aa0', sortOrder: 0 }] })
    setup(def({}, { statusIds: [5] }))
    expect(screen.getByText('No tasks match')).toBeInTheDocument()
    expect(screen.getByText('Status Waiting')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Edit filters' }))
    expect(useUIStore.getState().listEditor).toEqual({ listDefinitionId: 7, tabId: 't1' })
  })

  it('the group · sort summary opens Edit list, and closes it when it is open', () => {
    setup(def({ grouping: 'status', sort: 'priority' }, { searchText: 'task' }))
    // Edit list's host answers the close (the list is saved: at once).
    render(<EditListHost />)
    const summary = screen.getByTestId('list-summary')
    expect(summary).toHaveTextContent('Status · Priority')
    fireEvent.click(summary)
    expect(useUIStore.getState().listEditor).toEqual({ listDefinitionId: 7, tabId: 't1' })
    expect(summary).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(summary)
    expect(useUIStore.getState().listEditor).toBeNull()
  })

  it('an unsaved list adds Revert · Save to its filter line', () => {
    setup(def())
    expect(screen.getByTestId('list-filter-row')).toBeInTheDocument()
    expect(screen.queryByTestId('save-list')).toBeNull()
    act(() => useListDraftStore.getState().edit(7, (d) => ({ ...d, sort: 'name' })))
    const row = screen.getByTestId('list-filter-row')
    expect(row).toHaveTextContent('No filters')
    expect(screen.getByRole('button', { name: 'Revert list changes' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save list Team' })).toBeInTheDocument()
    // The summary reads the draft.
    expect(screen.getByTestId('list-summary')).toHaveTextContent(/^Name$/)
  })

  it('a direction change in the draft re-sorts the rows live, shows ↓ in the summary and makes the list unsaved', () => {
    setup(def({ sort: 'name' }))
    expect(titles()).toEqual(['Alice task', 'Bob task', 'Shared task'])
    expect(screen.getByTestId('list-summary')).toHaveTextContent(/^Name$/)
    act(() => useListDraftStore.getState().edit(7, (d) => ({ ...d, sortDirection: 'desc' })))
    expect(titles()).toEqual(['Shared task', 'Bob task', 'Alice task'])
    expect(screen.getByTestId('list-summary')).toHaveTextContent(/^Name ↓$/)
    expect(screen.getByTestId('save-list')).toBeInTheDocument()
  })

  it('Save on the filter line writes the draft; the line stays, without Revert · Save', async () => {
    setup(def())
    act(() => useListDraftStore.getState().edit(7, (d) => ({ ...d, sort: 'name' })))
    await act(async () => { fireEvent.click(screen.getByTestId('save-list')) })
    expect(useListDraftStore.getState().drafts).toEqual({})
    expect(useListDefinitionStore.getState().listDefinitions[0]!.sort).toBe('name')
    expect(screen.getByTestId('list-filter-row')).toBeInTheDocument()
    expect(screen.queryByTestId('save-list')).toBeNull()
  })

  it('a list set to hide its filter line shows none — until it is unsaved, and again none once saved', async () => {
    setup(def({ showFilterLine: false }))
    expect(screen.queryByTestId('list-filter-row')).toBeNull()
    expect(titles()).toEqual(['Alice task', 'Bob task', 'Shared task'])
    act(() => useListDraftStore.getState().edit(7, (d) => ({ ...d, sort: 'name' })))
    expect(screen.getByTestId('list-filter-row')).toBeInTheDocument()
    expect(screen.getByTestId('save-list')).toBeInTheDocument()
    await act(async () => { fireEvent.click(screen.getByTestId('save-list')) })
    expect(useListDefinitionStore.getState().listDefinitions[0]).toMatchObject({ sort: 'name', showFilterLine: false })
    expect(screen.queryByTestId('list-filter-row')).toBeNull()
  })

  it('hiding the filter line from a draft keeps it shown while unsaved', () => {
    setup(def())
    act(() => useListDraftStore.getState().edit(7, (d) => ({ ...d, showFilterLine: false })))
    expect(screen.getByTestId('list-filter-row')).toBeInTheDocument()
    expect(screen.getByTestId('revert-list')).toBeInTheDocument()
  })

  it('grouped by Priority: Hot, Focus, Urgent, Important, No priority; a task in each of its groups', () => {
    useTodoStore.setState({
      todos: [
        makeTodo({ id: 1, title: 'Focus urgent', sortOrder: 1, focus: true, urgent: true }),
        makeTodo({ id: 2, title: 'Important', sortOrder: 2, important: true }),
        makeTodo({ id: 3, title: 'Plain', sortOrder: 3 }),
      ],
    })
    setup(def({ grouping: 'priority' }))
    const groups = Array.from(document.querySelectorAll('[data-testid="list-group-name"]')).map((g) => g.textContent)
    expect(groups).toEqual(['Hot', 'Focus', 'Urgent', 'Important', 'No priority'])
    const rowsIn = (key: string) => Array.from(document.querySelector(`[data-list-group="${key}"]`)!.querySelectorAll('[data-todo-id]')).map((el) => el.getAttribute('data-todo-id'))
    expect(rowsIn('priority-hot')).toEqual(['1'])
    expect(rowsIn('priority-focus')).toEqual(['1'])
    expect(rowsIn('priority-urgent')).toEqual(['1'])
    expect(rowsIn('priority-important')).toEqual(['2'])
    expect(rowsIn('no-priority')).toEqual(['3'])
    expect(screen.getByTestId('list-summary')).toHaveTextContent(/^Priority · Manual$/)
    // Each group collapses on its own.
    fireEvent.click(document.querySelector('[data-list-group="priority-hot"] button[aria-expanded]')!)
    expect(rowsIn('priority-hot')).toEqual([])
    expect(rowsIn('priority-focus')).toEqual(['1'])
  })

  it('Revert on the filter line drops the draft (Undo brings it back)', async () => {
    setup(def())
    act(() => useListDraftStore.getState().edit(7, (d) => ({ ...d, sort: 'name' })))
    fireEvent.click(screen.getByTestId('revert-list'))
    expect(useListDraftStore.getState().drafts).toEqual({})
    expect(screen.queryByTestId('revert-list')).toBeNull()
    expect(useUndoStore.getState().snackbar).toMatchObject({ description: 'List changes reverted' })
    await act(() => useUndoStore.getState().undo())
    expect(screen.getByTestId('save-list')).toBeInTheDocument()
  })

  it('a blank draft name can’t be saved from the filter line', () => {
    setup(def())
    act(() => useListDraftStore.getState().edit(7, (d) => ({ ...d, name: '  ' })))
    expect(screen.getByTestId('save-list')).toBeDisabled()
  })

  it('an empty list without filters', () => {
    useTodoStore.setState({ todos: [] })
    setup(def())
    expect(screen.getByText('No tasks in this list')).toBeInTheDocument()
  })

  it('shows every task: no "Showing N of M" line', () => {
    const { result } = setup(def())
    expect(titles()).toHaveLength(3)
    expect(result()?.countLabel).toBe('3')
    expect(screen.queryByText(/Showing/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'switch to scroll' })).toBeNull()
  })

  it('groups collapse on their own; a row in a person’s group shows every person, that one included', () => {
    setup(def({ grouping: 'people' }))
    const groups = Array.from(document.querySelectorAll('[data-testid="list-group-name"]')).map((g) => g.textContent)
    expect(groups).toEqual(['Alice', 'Bob'])
    const aliceGroup = document.querySelector('[data-list-group="person-1"]')!
    const aliceRow = aliceGroup.querySelector('[data-todo-id="1"] [data-row-cell="people"]')!
    expect(aliceRow.textContent).toContain('AL')
    const sharedRow = aliceGroup.querySelector('[data-todo-id="3"] [data-row-cell="people"]')!
    expect(sharedRow.textContent).toContain('AL')
    expect(sharedRow.textContent).toContain('BO')
    fireEvent.click(aliceGroup.querySelector('button[aria-expanded]')!)
    expect(aliceGroup.querySelectorAll('[data-todo-id]')).toHaveLength(0)
    expect(document.querySelector('[data-list-group="person-2"]')!.querySelectorAll('[data-todo-id]')).toHaveLength(2)
  })

  it('on a phone, a row in a person’s group shows every person, that one included', () => {
    const original = window.matchMedia
    window.matchMedia = ((query: string) => ({ ...original(query), matches: query.includes('max-width: 640px') })) as typeof window.matchMedia
    try {
      setup(def({ grouping: 'people' }))
      const aliceGroup = document.querySelector('[data-list-group="person-1"]')!
      expect(aliceGroup.querySelector('[data-row-cell]')).toBeNull() // the phone's rows
      expect(aliceGroup.querySelector('[data-todo-id="1"]')!.textContent).toContain('AL')
      const sharedRow = aliceGroup.querySelector('[data-todo-id="3"]')!
      expect(sharedRow.textContent).toContain('AL')
      expect(sharedRow.textContent).toContain('BO')
    } finally {
      window.matchMedia = original
    }
  })

  it('a row in a person’s group: its people picker shows every person ticked', () => {
    setup(def({ grouping: 'people' }))
    const aliceGroup = document.querySelector('[data-list-group="person-1"]')!
    const sharedRow = aliceGroup.querySelector('[data-todo-id="3"]')!
    fireEvent.click(sharedRow.querySelector('[data-row-cell="people"]')!)
    const options = screen.getAllByRole('option')
    const ticked = options.filter((o) => o.getAttribute('aria-selected') === 'true').map((o) => o.textContent)
    expect(ticked).toHaveLength(2)
    expect(ticked.some((t) => t?.includes('Alice'))).toBe(true)
    expect(ticked.some((t) => t?.includes('Bob'))).toBe(true)
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
  fireEvent.click(row.querySelector('[data-todo-id] span[data-task-title]')!, mods)
}

function press(key: string, shiftKey = false) {
  const e = new KeyboardEvent('keydown', { key, shiftKey, cancelable: true })
  const handler = SHORTCUT_HANDLERS[key === 'ArrowUp' ? 'select-previous' : 'select-next']
  const ctx: ShortcutCtx = { e, callbacks: { openPalette: () => {}, closePalette: () => {}, openSettings: () => {} } }
  act(() => { void handler(ctx) })
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
    const selectAll = SHORTCUT_HANDLERS['select-all']
    act(() => { void selectAll({ e: new KeyboardEvent('keydown', { key: 'a', ctrlKey: true }), callbacks: { openPalette: () => {}, closePalette: () => {}, openSettings: () => {} } }) })
    expect([...useUIStore.getState().selectedTodoIds].sort()).toEqual([1, 2, 3])
  })

  it('the palette’s Select All Tasks takes the widget with the selection, as Mod-A does', () => {
    setup(def({ grouping: 'people' }))
    // Another task shown elsewhere on the page (a calendar entry, another widget's row).
    const elsewhere = document.createElement('button')
    elsewhere.setAttribute('data-todo-id', '4')
    document.body.appendChild(elsewhere)
    clickTitle('person-1|1')
    const ctx = {
      shortcuts: { openPalette: () => {}, closePalette: () => {}, openSettings: () => {} },
      selectionCount: 1,
      getStatuses: () => [],
    } as unknown as CommandContext
    act(() => { createCommands(ctx).find((c) => c.id === 'select-all')!.action() })
    expect([...useUIStore.getState().selectedTodoIds].sort()).toEqual([1, 2, 3])
    expect(useUIStore.getState().selectionScope).toBe('t1')
    elsewhere.remove()
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

  it('the bulk bar’s Set follow-up: a day picked in the date picker is every selected task’s next follow-up', async () => {
    await db.todos.bulkPut(useTodoStore.getState().todos)
    setup(def())
    clickTitle('all|1')
    clickTitle('all|2', { shiftKey: true })
    fireEvent.click(within(screen.getByTestId('list-bulk-bar')).getByRole('button', { name: 'Set follow-up' }))
    const popover = screen.getByRole('dialog', { name: 'Follow-up' })
    const button = within(popover).getByRole('button', { name: 'Pick next follow-up date' })
    await act(async () => { fireEvent.change(button.nextElementSibling as HTMLInputElement, { target: { value: '2026-11-20' } }) })
    expect(screen.queryByRole('dialog', { name: 'Follow-up' })).toBeNull()
    const next = (id: number) => useTodoStore.getState().todos.find((t) => t.id === id)?.nextFollowupAt
    expect(next(1)).toEqual(new Date(2026, 10, 20))
    expect(next(2)).toEqual(new Date(2026, 10, 20))
    expect(next(3)).toBeUndefined()
    await vi.waitFor(async () => expect((await db.todos.get(2))?.nextFollowupAt).toEqual(new Date(2026, 10, 20)))
  })

  /** Opens the bulk bar's ⋯ More menu. */
  function openMore() {
    fireEvent.click(screen.getByRole('button', { name: 'More' }))
    return screen.getByRole('menu', { name: 'More actions' })
  }

  it('the bulk bar keeps its button order and puts Mark followed up + Markers under ⋯ More', () => {
    setup(def())
    clickTitle('all|1')
    clickTitle('all|2', { shiftKey: true })
    const bar = screen.getByTestId('list-bulk-bar')
    expect(Array.from(bar.querySelectorAll(':scope > button, :scope > span > button')).map((b) => b.getAttribute('aria-label')))
      .toEqual(['Set due date', 'Set follow-up', 'Assign people', 'Add tag', 'Complete', 'More', 'Delete', 'Clear selection'])
    const menu = openMore()
    expect(Array.from(menu.querySelectorAll('[role^="menuitem"]')).map((b) => b.getAttribute('data-menu-label')))
      .toEqual(['Mark followed up', 'Focus', 'Urgent', 'Important'])
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

  it('⋯ More › Urgent / Important are tri-state by flag; a due date is Urgent’s hint, never a prompt', async () => {
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

    // Bob's task is urgent by its due date, not flagged: unchecked, by due date — a click flags both.
    openMore()
    const urgent = screen.getByRole('menuitemcheckbox', { name: /Urgent/ })
    expect(urgent).toHaveAttribute('aria-checked', 'false')
    expect(urgent).toHaveTextContent('By due date')
    expect(urgent).toHaveAttribute('title', '1 of 2 tasks is urgent by its due date, flagged or not.')
    await act(async () => { fireEvent.click(urgent) })
    expect(useTodoStore.getState().todos.map((t) => t.urgent)).toEqual([true, true])
    openMore()
    await act(async () => { fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /Urgent/ })) })
    // Clearing clears the flags only: Bob's due date stays, nothing is asked.
    expect(useTodoStore.getState().todos.map((t) => t.urgent)).toEqual([undefined, undefined])
    expect(useTodoStore.getState().todos[1]!.dueDate).toEqual(tomorrow)
    expect(useUIStore.getState().bulkConfirmation).toBeNull()
  })

  it('⋯ More › Mark followed up stamps every selected task, and is dimmed once they all were today', async () => {
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
    const followedUp = screen.getByRole('menuitem', { name: 'Mark followed up' })
    expect(followedUp).not.toHaveTextContent('Today')
    await act(async () => { fireEvent.click(followedUp) })
    expect(useTodoStore.getState().todos.every((t) => t.lastFollowupAt instanceof Date)).toBe(true)
    // The write lands (and its undo snackbar shows) before the test ends, not in a later one.
    await vi.waitFor(() => expect(useUndoStore.getState().snackbar?.description).toMatch(/^Followed up/))
    openMore()
    expect(screen.getByRole('menuitem', { name: /^Mark followed up/ })).toHaveTextContent('Today')
  })

  it('a Markers list offers + Add task (new tasks start with those markers)', () => {
    setup(def({}, { markers: { focus: true, important: true } }))
    expect(screen.getByRole('button', { name: /Add task/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Add task/ }))
    expect(useUIStore.getState().quickAddDraft?.defaults?.markers).toEqual({ important: true, focus: true })
  })

  it('a list whose only Priority clause is a No offers + Add task (the new task starts without the marker)', () => {
    setup(def({}, { markers: { urgent: false } }))
    fireEvent.click(screen.getByRole('button', { name: /Add task/ }))
    expect(useUIStore.getState().quickAddDraft?.defaults?.markers).toEqual({ urgent: false })
  })

  it('a Hot list re-filters when the Hot rule or the urgent range changes, and offers no + Add task', () => {
    const tomorrow = new Date()
    tomorrow.setHours(0, 0, 0, 0)
    tomorrow.setDate(tomorrow.getDate() + 1)
    useTodoStore.setState({
      todos: [
        makeTodo({ id: 1, title: 'Alice task', sortOrder: 1, important: true, dueDate: tomorrow }),
        makeTodo({ id: 2, title: 'Bob task', sortOrder: 2, focus: true }),
        makeTodo({ id: 3, title: 'Shared task', sortOrder: 3, important: true }),
      ],
    })
    const { result } = setup(def({}, { markers: 'hot' }))
    expect(titles()).toEqual(['Alice task', 'Bob task'])
    expect(screen.queryByRole('button', { name: /Add task/ })).toBeNull()
    act(() => useSettingsStore.setState({ hotRule: [{ important: true }] }))
    expect(titles()).toEqual(['Alice task', 'Shared task'])
    expect(result()?.countLabel).toBe('2')
    act(() => useSettingsStore.setState({ hotRule: [{ urgent: true }] }))
    expect(titles()).toEqual(['Alice task'])
    act(() => useSettingsStore.setState({ urgentDueWithinDays: null }))
    expect(titles()).toEqual([])
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

describe('ListWidget People group headers: email check-in', () => {
  beforeEach(() => {
    // No clipboard unless a test stubs one (a send then falls back to the dialog).
    Reflect.deleteProperty(navigator, 'clipboard')
    Reflect.deleteProperty(globalThis, 'ClipboardItem')
    useUIStore.setState({ checkinDialog: null, taskDialog: null })
    useTodoStore.setState((s) => ({ todos: [...s.todos, makeTodo({ id: 5, title: 'Nobody’s task', sortOrder: 5 })] }))
    // Its people loaded, as the store loads them: nobody.
    usePersonStore.setState((s) => ({ assignedPeopleMap: new Map([...s.assignedPeopleMap, [5, []]]) }))
  })

  const header = (key: string) => document.querySelector(`[data-list-group="${key}"] button[aria-expanded]`) as HTMLElement

  // No clipboard in this environment: a one-click send can't copy, so it opens the check-in dialog for the person.
  it('each person’s group has an envelope that sends their check-in (here: the dialog, as the copy fails); Unassigned has none', async () => {
    setup(def({ grouping: 'people' }))
    expect(screen.getAllByRole('button', { name: /^Email check-in to / }).map((b) => b.getAttribute('aria-label')))
      .toEqual(['Email check-in to Alice', 'Email check-in to Bob'])
    expect(document.querySelector('[data-list-group="unassigned"] [aria-label^="Email check-in"]')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Email check-in to Bob' }))
    await vi.waitFor(() => expect(useUIStore.getState().checkinDialog).toMatchObject({ personIds: [2], notice: expect.stringMatching(/clipboard/) }))
    // The header itself still collapses its group.
    fireEvent.click(header('person-1'))
    expect(document.querySelector('[data-list-group="person-1"]')!.querySelectorAll('[data-todo-id]')).toHaveLength(0)
  })

  it('other groupings get no envelope; their header’s menu copies the group, headed by its name', async () => {
    const { written } = stubClipboard()
    setup(def({ grouping: 'status' }))
    expect(screen.queryByRole('button', { name: /^Email check-in to / })).toBeNull()
    const first = document.querySelector('[data-list-group] button[aria-expanded]')!
    const name = first.querySelector('[data-testid="list-group-name"]')!.textContent!
    fireEvent.contextMenu(first)
    const menu = screen.getByRole('menu', { name: `${name} group` })
    expect(Array.from(menu.querySelectorAll('[role="menuitem"]')).map((i) => i.textContent)).toEqual(['Copy 4 tasks'])
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy 4 tasks' }))
    await vi.waitFor(() => expect(written).toEqual([
      [`== ${name} ==`, '[ ] Alice task @Alice', '[ ] Bob task @Bob', '[ ] Shared task @Alice, @Bob', '[ ] Nobody’s task'].join('\n'),
    ]))
    await vi.waitFor(() => expect(useUndoStore.getState().snackbar).toMatchObject({ notice: true, description: 'Copied 4 tasks' }))
  })

  it('right-click on a person’s header opens its menu; Show all opens the person’s task dialog', () => {
    setup(def({ grouping: 'people' }))
    fireEvent.contextMenu(header('person-1'), { clientX: 40, clientY: 60 })
    const menu = screen.getByRole('menu', { name: 'Alice group' })
    expect(Array.from(menu.querySelectorAll('[role="menuitem"]')).map((i) => i.textContent))
      .toEqual(['Email check-in: Alice', 'Show all of Alice’s tasks', 'Copy 2 tasks'])
    // The person's items, a separator, then Copy.
    expect(menu.querySelector('[role="separator"]')).not.toBeNull()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Show all of Alice’s tasks' }))
    expect(screen.queryByRole('menu')).toBeNull()
    expect(useUIStore.getState().taskDialog).toMatchObject({ title: 'Alice', personId: 1 })
    expect(useUIStore.getState().checkinDialog).toBeNull()
  })

  it('Shift+F10 (or the context-menu key) on a header opens the menu from the keyboard', async () => {
    setup(def({ grouping: 'people' }))
    fireEvent.keyDown(header('person-2'), { key: 'F10', shiftKey: true })
    fireEvent.click(screen.getByRole('menuitem', { name: 'Email check-in: Bob' }))
    await vi.waitFor(() => expect(useUIStore.getState().checkinDialog).toMatchObject({ personIds: [2] }))
    fireEvent.keyDown(screen.getByRole('button', { name: 'Email check-in to Alice' }), { key: 'ContextMenu' })
    expect(screen.getByRole('menu', { name: 'Alice group' })).toBeInTheDocument()
  })

  it('Unassigned’s header menu holds only Copy (from the pointer or Shift+F10)', async () => {
    const { written } = stubClipboard()
    setup(def({ grouping: 'people' }))
    fireEvent.keyDown(header('unassigned'), { key: 'F10', shiftKey: true })
    const menu = screen.getByRole('menu', { name: 'Unassigned group' })
    expect(Array.from(menu.querySelectorAll('[role="menuitem"]')).map((i) => i.textContent)).toEqual(['Copy 1 task'])
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy 1 task' }))
    await vi.waitFor(() => expect(written).toEqual(['== Unassigned ==\n[ ] Nobody’s task']))
    await vi.waitFor(() => expect(useUndoStore.getState().snackbar).toMatchObject({ notice: true, description: 'Copied 1 task' }))
    fireEvent.contextMenu(header('unassigned'))
    expect(screen.getByRole('menu', { name: 'Unassigned group' })).toBeInTheDocument()
  })

  it('the task menu’s Copy N tasks copies the selection in display order, without headings', async () => {
    const { written } = stubClipboard()
    setup(def({ grouping: 'people' }))
    // Bob's task, then the shared task's first row (in Alice's group, above Bob's).
    clickTitle('person-2|2')
    clickTitle('person-1|3', { ctrlKey: true })
    fireEvent.contextMenu(document.querySelector('[data-row-key="person-2|2"] [data-todo-id]')!)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy 2 tasks' }))
    await vi.waitFor(() => expect(written).toEqual(['[ ] Shared task @Alice, @Bob\n[ ] Bob task @Bob']))
    await vi.waitFor(() => expect(useUndoStore.getState().snackbar).toMatchObject({ notice: true, description: 'Copied 2 tasks' }))
  })
})
