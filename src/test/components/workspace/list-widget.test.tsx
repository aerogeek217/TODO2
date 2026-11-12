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
import { useWorkspaceStore } from '../../../stores/workspace-store'
import { cell, grid } from '../../helpers/layout-builders'
import { useUndoStore } from '../../../stores/undo-store'
import { useListOrderStore } from '../../../stores/list-order-store'
import { useSettingsStore } from '../../../stores/settings-store'
import { addFollowupInterval, formatFollowupDate } from '../../../utils/followup'
import { SHORTCUT_HANDLERS, type ShortcutCtx } from '../../../services/keyboard-shortcuts'
import { createCommands, type CommandContext } from '../../../services/command-registry'
import type { PersistedListDefinition } from '../../../models/list-definition'
import { createTab, type LensTab } from '../../../models/workspace-layout'
import type { Person, TodoPredicate } from '../../../models'
import { db } from '../../../data/database'
import { clearFilterStore, makeTodo, resetEntityStores, stubClipboard } from '../../helpers'
import { WidgetFaceContext, type WidgetFaceHost } from '../../../hooks/use-widget-face'

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
  useSettingsStore.setState({ urgentDueWithinDays: 3 })
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

  it('shows the list’s open tasks; nothing narrows it, so no count', () => {
    const { result } = setup(def())
    expect(titles()).toEqual(['Alice task', 'Bob task', 'Shared task'])
    // One number per list (2A): the tab's badge; a count only while the screen filter or the lens narrows it.
    expect(screen.queryByTestId('list-count')).toBeNull()
    expect(result()?.countLabel).toBeUndefined()
    // No filters anywhere: the filter line reads `Every open task` in words (no chips, no + Filter),
    // then the summary (`Manual` for an ungrouped manual list).
    const row = screen.getByTestId('list-filter-row')
    expect(within(row).getByRole('button', { name: 'Every open task' })).toBeInTheDocument()
    expect(within(row).queryByRole('button', { name: /Filter/ })).toBeNull()
    expect(screen.getByTestId('list-summary')).toHaveTextContent('Manual')
    expect(screen.queryByTestId('save-list')).toBeNull()
    expect(screen.queryByTestId('revert-list')).toBeNull()
  })

  it('the screen filter narrows it: a shown-of-total count, and no screen chips on the line (J13)', () => {
    setup(def())
    act(() => useFilterStore.getState().setPersonIds(new Set([1])))
    expect(titles()).toEqual(['Alice task', 'Shared task'])
    expect(screen.getByTestId('list-count')).toHaveTextContent('2 of 3')
    expect(screen.getByTestId('list-filter-row')).not.toHaveTextContent('Alice')
  })

  it('reads its filter in words; a click opens Edit list, and closes it when it is open', () => {
    useStatusStore.setState({ statuses: [{ id: 5, name: 'Waiting', color: '#aa0', sortOrder: 0 }] })
    setup(def({}, { personIds: [1], statusIds: [5], negate: { statusIds: true } }))
    render(<EditListHost />)
    const row = screen.getByTestId('list-filter-row')
    const words = within(row).getByTestId('list-filter-expression')
    expect(words).toHaveTextContent(/Alice.*not.*Waiting/)
    // Words, not editable chips: no remove ×, no + Filter.
    expect(within(row).queryByLabelText('Remove filter')).toBeNull()
    expect(within(row).queryByRole('button', { name: /Add a filter/ })).toBeNull()
    fireEvent.click(words)
    expect(useUIStore.getState().listEditor).toEqual({ listDefinitionId: 7, tabId: 't1' })
    fireEvent.click(words)
    expect(useUIStore.getState().listEditor).toBeNull()
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

  it('a screen Completed range on an open-tasks list: the total counts the completed tasks it lets in', () => {
    useTodoStore.setState({
      todos: [
        ...useTodoStore.getState().todos,
        makeTodo({ id: 5, title: 'Done today', sortOrder: 5, isCompleted: true, completedAt: new Date() }),
      ],
    })
    setup(def())
    const filters = useFilterStore.getState().filters
    act(() => useFilterStore.getState().setAllFilters({
      ...filters,
      dates: { completed: { match: 'range', start: { kind: 'relative', token: 'today' }, end: null } },
    }))
    expect(titles()).toEqual(['Done today'])
    // Of the list's 3 open tasks and the one completed task the range admits (as the top bar's
    // counter counts, cr33 M3 — not the completed task outside it): 1 shown.
    expect(screen.getByTestId('list-count')).toHaveTextContent('1 of 4')
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

  it('draws Edit list’s draft live, with no Revert · Save or unsaved mark on its line', () => {
    setup(def())
    act(() => useListDraftStore.getState().edit(7, (d) => ({ ...d, sort: 'name' })))
    const row = screen.getByTestId('list-filter-row')
    expect(row).toHaveTextContent('Every open task')
    expect(screen.queryByTestId('save-list')).toBeNull()
    expect(screen.queryByTestId('revert-list')).toBeNull()
    expect(screen.queryByRole('img', { name: 'unsaved list changes' })).toBeNull()
    // The summary reads the draft.
    expect(screen.getByTestId('list-summary')).toHaveTextContent(/^Name$/)
  })

  it('a direction change in the draft re-sorts the rows live and shows ↓ in the summary', () => {
    setup(def({ sort: 'name' }))
    expect(titles()).toEqual(['Alice task', 'Bob task', 'Shared task'])
    expect(screen.getByTestId('list-summary')).toHaveTextContent(/^Name$/)
    act(() => useListDraftStore.getState().edit(7, (d) => ({ ...d, sortDirection: 'desc' })))
    expect(titles()).toEqual(['Shared task', 'Bob task', 'Alice task'])
    expect(screen.getByTestId('list-summary')).toHaveTextContent(/^Name ↓$/)
  })

  it('a list set to hide its filter line shows none, its draft too', () => {
    setup(def({ showFilterLine: false }))
    expect(screen.queryByTestId('list-filter-row')).toBeNull()
    act(() => useListDraftStore.getState().edit(7, (d) => ({ ...d, sort: 'name' })))
    expect(screen.queryByTestId('list-filter-row')).toBeNull()
    act(() => useListDraftStore.getState().edit(7, (d) => {
      const { showFilterLine: hidden, ...shown } = d
      void hidden
      return shown
    }))
    expect(screen.getByTestId('list-filter-row')).toBeInTheDocument()
  })

  it('grouped by Priority: Focus, Urgent, Important, No priority; a task in each of its groups', () => {
    useTodoStore.setState({
      todos: [
        makeTodo({ id: 1, title: 'Focus urgent', sortOrder: 1, focus: true, urgent: true }),
        makeTodo({ id: 2, title: 'Important', sortOrder: 2, important: true }),
        makeTodo({ id: 3, title: 'Plain', sortOrder: 3 }),
      ],
    })
    setup(def({ grouping: 'priority' }))
    const groups = Array.from(document.querySelectorAll('[data-testid="list-group-name"]')).map((g) => g.textContent)
    expect(groups).toEqual(['Focus', 'Urgent', 'Important', 'No priority'])
    const rowsIn = (key: string) => Array.from(document.querySelector(`[data-list-group="${key}"]`)!.querySelectorAll('[data-todo-id]')).map((el) => el.getAttribute('data-todo-id'))
    expect(rowsIn('priority-focus')).toEqual(['1'])
    expect(rowsIn('priority-urgent')).toEqual(['1'])
    expect(rowsIn('priority-important')).toEqual(['2'])
    expect(rowsIn('no-priority')).toEqual(['3'])
    expect(screen.getByTestId('list-summary')).toHaveTextContent(/^Priority · Manual$/)
    // Each group collapses on its own.
    fireEvent.click(document.querySelector('[data-list-group="priority-focus"] button[aria-expanded]')!)
    expect(rowsIn('priority-focus')).toEqual([])
    expect(rowsIn('priority-urgent')).toEqual(['1'])
  })

  it('an empty list without filters', () => {
    useTodoStore.setState({ todos: [] })
    setup(def())
    expect(screen.getByText('No tasks in this list')).toBeInTheDocument()
  })

  it('shows every task: no "Showing N of M" line', () => {
    setup(def())
    expect(titles()).toHaveLength(3)
    expect(screen.queryByTestId('list-count')).toBeNull()
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

  it('renders the unsaved draft: its filter in words on the line', () => {
    useStatusStore.setState({ statuses: [{ id: 5, name: 'Waiting', color: '#aa0', sortOrder: 0 }] })
    setup(def({}, { statusIds: [5] }))
    act(() => useListDraftStore.getState().edit(7, (d) => ({ ...d, membership: { kind: 'custom', predicate: { ...d.membership.predicate, statusIds: null } } })))
    expect(useListDefinitionStore.getState().listDefinitions[0]!.membership.predicate.statusIds).toEqual([5])
    expect(titles()).toHaveLength(3)
    expect(screen.getByTestId('list-filter-row')).toHaveTextContent('Every open task')
  })

  it('a prompt shows its row; nothing picked = the pick-a-value state, no count', () => {
    setup(def({ runtimeFilter: { field: 'person' } }))
    expect(screen.getByText('Pick a person to show this list')).toBeInTheDocument()
    expect(screen.queryByTestId('list-count')).toBeNull()
    act(() => useListWidgetStore.getState().setPicks('t1', [2]))
    expect(titles()).toEqual(['Bob task', 'Shared task'])
    // The pick is the list's own narrowing, not the screen filter's: still no count.
    expect(screen.queryByTestId('list-count')).toBeNull()
  })

  it('the pick-a-value state’s one action puts the focus in the prompt’s field', () => {
    setup(def({ runtimeFilter: { field: 'person' } }))
    expect(document.querySelector('[data-empty-state="person"]')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Pick someone' }))
    expect(document.activeElement).toBe(screen.getByLabelText('Filter tasks by person'))
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

  it('a row is no focusable "draggable" button with keyboard-drag instructions (no keyboard sensor; cr31 M1)', () => {
    setup(def({ grouping: 'people' }))
    const row = document.querySelector('[data-row-key="person-1|3"]')!
    expect(row.getAttribute('role')).toBeNull()
    // Focusable by a click (the editor hands the focus back to it), no tab stop.
    expect(row.getAttribute('tabindex')).toBe('-1')
    expect(row.getAttribute('aria-roledescription')).toBeNull()
    expect(row.getAttribute('aria-describedby')).toBeNull()
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
    expect(screen.getByRole('dialog', { name: 'Follow-up' })).toBeInTheDocument()
    const next = (id: number) => useTodoStore.getState().todos.find((t) => t.id === id)?.nextFollowupAt
    expect(next(1)).toEqual(new Date(2026, 10, 20))
    expect(next(2)).toEqual(new Date(2026, 10, 20))
    expect(next(3)).toBeUndefined()
    await vi.waitFor(async () => expect((await db.todos.get(2))?.nextFollowupAt).toEqual(new Date(2026, 10, 20)))
  })

  it('the bulk bar’s follow-up popover: shared future date in the field, mixed empty; untouched, Mark followed up keeps each future date', async () => {
    const inFive = addFollowupInterval(new Date(), { count: 5, unit: 'd' })
    useTodoStore.setState({
      todos: [
        makeTodo({ id: 1, title: 'Alice task', sortOrder: 1, nextFollowupAt: inFive }),
        makeTodo({ id: 2, title: 'Bob task', sortOrder: 2, nextFollowupAt: inFive }),
        makeTodo({ id: 3, title: 'Cy task', sortOrder: 3 }),
      ],
    })
    await db.todos.bulkPut(useTodoStore.getState().todos)
    setup(def())
    clickTitle('all|1')
    clickTitle('all|2', { shiftKey: true })
    const bar = () => within(screen.getByTestId('list-bulk-bar'))
    fireEvent.click(bar().getByRole('button', { name: 'Set follow-up' }))
    let popover = screen.getByRole('dialog', { name: 'Follow-up' })
    const field = () => within(popover).getByRole('textbox', { name: 'Next follow-up' }) as HTMLInputElement
    expect(field().value).toBe(formatFollowupDate(inFive, new Date()))
    fireEvent.click(bar().getByRole('button', { name: 'Set follow-up' }))

    clickTitle('all|3', { shiftKey: true })
    fireEvent.click(bar().getByRole('button', { name: 'Set follow-up' }))
    popover = screen.getByRole('dialog', { name: 'Follow-up' })
    expect(field().value).toBe('')
    expect(field()).toHaveAttribute('placeholder', 'Each task’s own')
    expect(within(popover).getByText(/^Future dates kept · the rest →/)).toBeInTheDocument()
    await act(async () => { fireEvent.click(within(popover).getByRole('button', { name: 'Mark followed up' })) })
    const t = (id: number) => useTodoStore.getState().todos.find((x) => x.id === id)!
    const auto = addFollowupInterval(new Date(), { count: 1, unit: 'm' })
    expect(t(1).nextFollowupAt).toEqual(inFive)
    expect(t(2).nextFollowupAt).toEqual(inFive)
    expect(t(3).nextFollowupAt).toEqual(auto)
    for (const id of [1, 2, 3]) expect(t(id).lastFollowupAt).toBeInstanceOf(Date)
    await vi.waitFor(() => expect(useUndoStore.getState().snackbar?.description).toBe(`Followed up · next follow-up ${formatFollowupDate(auto, new Date())} · 2 kept`))
  })

  it('the bulk bar’s follow-up popover, edited: Mark followed up sets the field’s date on every task', async () => {
    const inFive = addFollowupInterval(new Date(), { count: 5, unit: 'd' })
    useTodoStore.setState({
      todos: [
        makeTodo({ id: 1, title: 'Alice task', sortOrder: 1, nextFollowupAt: inFive }),
        makeTodo({ id: 2, title: 'Bob task', sortOrder: 2 }),
      ],
    })
    await db.todos.bulkPut(useTodoStore.getState().todos)
    setup(def())
    clickTitle('all|1')
    clickTitle('all|2', { shiftKey: true })
    fireEvent.click(within(screen.getByTestId('list-bulk-bar')).getByRole('button', { name: 'Set follow-up' }))
    const popover = screen.getByRole('dialog', { name: 'Follow-up' })
    fireEvent.change(within(popover).getByRole('textbox', { name: 'Next follow-up' }), { target: { value: '2w' } })
    await act(async () => { fireEvent.click(within(popover).getByRole('button', { name: 'Mark followed up' })) })
    const t = (id: number) => useTodoStore.getState().todos.find((x) => x.id === id)!
    const twoWeeks = addFollowupInterval(new Date(), { count: 2, unit: 'w' })
    for (const id of [1, 2]) {
      expect(t(id).nextFollowupAt).toEqual(twoWeeks)
      expect(t(id).lastFollowupAt).toBeInstanceOf(Date)
    }
    await vi.waitFor(() => expect(useUndoStore.getState().snackbar?.description).toMatch(/^Followed up · next follow-up/))
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
    setup(def({}, { markers: [{ values: ['focus'] }, { values: ['important'] }] }))
    expect(screen.getByRole('button', { name: /Add task/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Add task/ }))
    expect(useUIStore.getState().quickAddDraft?.defaults?.markers).toEqual({ important: true, focus: true })
  })

  it('a list of several priorities offers + Add task, seeding none of them (as Status)', () => {
    setup(def({}, { markers: [{ values: ['urgent', 'important'] }] }))
    fireEvent.click(screen.getByRole('button', { name: /Add task/ }))
    expect(useUIStore.getState().quickAddDraft?.defaults?.markers).toBeUndefined()
  })

  it('a list whose only Priority clause is a No offers + Add task (the new task starts without the marker)', () => {
    setup(def({}, { markers: [{ values: ['urgent'], not: true }] }))
    fireEvent.click(screen.getByRole('button', { name: /Add task/ }))
    expect(useUIStore.getState().quickAddDraft?.defaults?.markers).toEqual({ urgent: false })
  })

  it('a list written as an expression offers + Add task; only its top-level chips seed', () => {
    const either = { kind: 'or' as const, items: [{ kind: 'person' as const, id: 1 }, { kind: 'priority' as const, value: 'focus' as const }] }
    setup(def({}, { expression: either }))
    fireEvent.click(screen.getByRole('button', { name: /Add task/ }))
    const defaults = useUIStore.getState().quickAddDraft?.defaults
    expect(defaults?.personIds).toEqual([])
    expect(defaults?.markers).toBeUndefined()
    cleanup()
    setup(def({}, { expression: { kind: 'and', items: [{ kind: 'status', id: 2 }, either] } }))
    fireEvent.click(screen.getByRole('button', { name: /Add task/ }))
    expect(useUIStore.getState().quickAddDraft?.defaults).toMatchObject({ statusId: 2, personIds: [] })
  })

  it('a Priority list re-filters when the urgent range changes', () => {
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
    setup(def({}, { markers: [{ values: ['urgent', 'focus'] }] }))
    expect(titles()).toEqual(['Alice task', 'Bob task'])
    act(() => useSettingsStore.setState({ urgentDueWithinDays: null }))
    expect(titles()).toEqual(['Bob task'])
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

describe('ListWidget People group headers', () => {
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

  it('no group header has a check-in envelope (widget feedback 2B); the header still collapses its group', () => {
    setup(def({ grouping: 'people' }))
    expect(screen.queryByRole('button', { name: /^Check-in/ })).toBeNull()
    fireEvent.click(header('person-1'))
    expect(document.querySelector('[data-list-group="person-1"]')!.querySelectorAll('[data-todo-id]')).toHaveLength(0)
  })
  it('another grouping’s header menu copies the group, headed by its name', async () => {
    const { written } = stubClipboard()
    setup(def({ grouping: 'status' }))
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

  it('right-click on a person’s header opens the person menu, then Copy; Show tasks opens the person’s task dialog', () => {
    setup(def({ grouping: 'people' }))
    fireEvent.contextMenu(header('person-1'), { clientX: 40, clientY: 60 })
    const menu = screen.getByRole('menu', { name: 'Alice group' })
    expect(Array.from(menu.querySelectorAll('[role="menuitem"]')).map((i) => i.textContent)).toEqual([
      'Show tasks', 'Edit…', 'Delete…', 'Copy 2 tasks',
    ])
    // The person menu (no Review here: no Review widget), then a separator before Copy.
    expect(menu.querySelectorAll('[role="separator"]')).toHaveLength(2)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Show tasks' }))
    expect(screen.queryByRole('menu')).toBeNull()
    expect(useUIStore.getState().taskDialog).toMatchObject({ title: 'Alice', personId: 1 })
    expect(useUIStore.getState().checkinDialog).toBeNull()
  })

  it('with a Review widget on a layout, the header menu’s Review with X jumps there with @X', async () => {
    const layout = { id: 7, name: 'Main', sortOrder: 0, createdAt: new Date(0), modifiedAt: new Date(0), ...grid([[cell('r', [createTab('review', 'rv')])]]) }
    useWorkspaceStore.setState({ working: layout, saved: layout, layouts: [layout], activeLayoutId: 7 })
    setup(def({ grouping: 'people' }))
    fireEvent.contextMenu(header('person-2'), { clientX: 40, clientY: 60 })
    fireEvent.click(screen.getByRole('menuitem', { name: 'Review with Bob' }))
    expect(screen.queryByRole('menu')).toBeNull()
    await vi.waitFor(() => expect(useListWidgetStore.getState().reviewFilters.rv).toEqual({ expression: { kind: 'person', id: 2 }, showCompleted: false }))
  })

  it('Shift+F10 (or the context-menu key) on a header opens the menu from the keyboard', () => {
    setup(def({ grouping: 'people' }))
    fireEvent.keyDown(header('person-2'), { key: 'F10', shiftKey: true })
    expect(screen.getByRole('menu', { name: 'Bob group' })).toBeInTheDocument()
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
    fireEvent.keyDown(header('person-1'), { key: 'ContextMenu' })
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

  it('a group menu opened from the keyboard gives the focus back to its header after Copy', async () => {
    stubClipboard()
    setup(def({ grouping: 'people' }))
    header('unassigned').focus()
    fireEvent.keyDown(header('unassigned'), { key: 'F10', shiftKey: true })
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy 1 task' }))
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(header('unassigned'))
    await vi.waitFor(() => expect(useUndoStore.getState().snackbar).toMatchObject({ description: 'Copied 1 task' }))
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

describe('ListWidget — a completed row leaves (D19)', () => {
  const complete = (id: number) => act(() => {
    useTodoStore.setState({ todos: useTodoStore.getState().todos.map((t) => (t.id === id ? { ...t, isCompleted: true, completedAt: new Date() } : t)) })
  })
  const leavingOf = (title: string) => document.querySelector(`[data-task-title="${title}"]`)?.closest('[data-leaving]')?.getAttribute('data-leaving') ?? null

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('stays in place, completed, for 500 ms, folds for 180 ms, then drops out of a list hiding completed tasks', () => {
    vi.useFakeTimers()
    setup(def())
    complete(2)
    expect(titles()).toEqual(['Alice task', 'Bob task', 'Shared task'])
    expect(leavingOf('Bob task')).toBe('stay')
    expect(screen.getByRole('checkbox', { name: 'Mark incomplete' })).toBeChecked()
    act(() => { vi.advanceTimersByTime(500) })
    expect(leavingOf('Bob task')).toBe('fold')
    act(() => { vi.advanceTimersByTime(180) })
    expect(titles()).toEqual(['Alice task', 'Shared task'])
  })

  it('reopened while it lingers, it simply stays', () => {
    vi.useFakeTimers()
    setup(def())
    complete(2)
    act(() => {
      useTodoStore.setState({ todos: useTodoStore.getState().todos.map((t) => (t.id === 2 ? { ...t, isCompleted: false, completedAt: undefined } : t)) })
    })
    expect(leavingOf('Bob task')).toBeNull()
    act(() => { vi.advanceTimersByTime(1000) })
    expect(titles()).toEqual(['Alice task', 'Bob task', 'Shared task'])
  })

  it('in a list that shows completed tasks nothing folds', () => {
    vi.useFakeTimers()
    setup(def({}, { showCompleted: true }))
    complete(2)
    expect(leavingOf('Bob task')).toBeNull()
    act(() => { vi.advanceTimersByTime(1000) })
    expect(titles()).toContain('Bob task')
  })

  it('under reduced motion the row leaves at once', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce'), media: query, addEventListener: () => {}, removeEventListener: () => {} }))
    setup(def())
    complete(2)
    expect(titles()).toEqual(['Alice task', 'Shared task'])
  })

  /** Completes task `id` as the store does: its modified date moves to now. */
  const completeNow = (id: number) => act(() => {
    const now = new Date(2026, 9, 10, 12)
    useTodoStore.setState({ todos: useTodoStore.getState().todos.map((t) => (t.id === id ? { ...t, isCompleted: true, completedAt: now, modifiedAt: now } : t)) })
  })
  const modifiedOn = (days: number[]) => useTodoStore.setState({
    todos: useTodoStore.getState().todos.map((t, i) => ({ ...t, modifiedAt: new Date(2026, 8, days[i] ?? 1) })),
  })

  /** Task `id` repeats weekly from `due`. */
  const repeatsWeekly = (id: number, due: Date) => useTodoStore.setState({
    todos: useTodoStore.getState().todos.map((t) => (t.id === id ? { ...t, recurrenceRule: { type: 'weekly' as const }, dueDate: due } : t)),
  })
  /** Its occurrence done, as the store does it: the due date advances, nothing is completed, the modified date moves. */
  const advance = (id: number, to: Date) => act(() => {
    useTodoStore.setState({ todos: useTodoStore.getState().todos.map((t) => (t.id === id ? { ...t, dueDate: to, modifiedAt: new Date(2026, 9, 10, 12) } : t)) })
  })
  const rowCheckbox = (title: string) => document.querySelector(`[data-task-title="${title}"]`)!.closest('[data-row-todo]')!.querySelector<HTMLInputElement>('input[type="checkbox"]')!

  it('a recurring task’s occurrence done: the row lingers as that occurrence, completed, then the next one takes its place', () => {
    vi.useFakeTimers()
    repeatsWeekly(2, new Date(2026, 9, 24))
    setup(def({ sort: 'modified' }))
    expect(titles()).toEqual(['Alice task', 'Bob task', 'Shared task'])
    advance(2, new Date(2026, 9, 31))
    // In place, checked and struck, though the task is open with its next date.
    expect(titles()).toEqual(['Alice task', 'Bob task', 'Shared task'])
    expect(leavingOf('Bob task')).toBe('stay')
    expect(rowCheckbox('Bob task').checked).toBe(true)
    act(() => { vi.advanceTimersByTime(500) })
    expect(leavingOf('Bob task')).toBe('fold')
    act(() => { vi.advanceTimersByTime(180) })
    // The next occurrence: still in the list (no date clause), open, at its new place (Modified sorts oldest first: the advance's date is the oldest here).
    expect(leavingOf('Bob task')).toBeNull()
    expect(rowCheckbox('Bob task').checked).toBe(false)
    expect(titles()).toEqual(['Bob task', 'Alice task', 'Shared task'])
  })

  it('a recurring task’s occurrence done leaves a list the next date falls outside, after the linger', () => {
    vi.useFakeTimers()
    repeatsWeekly(2, new Date(2026, 9, 24))
    const thatWeek = { match: 'range' as const, start: { kind: 'fixed' as const, iso: '2026-10-19' }, end: { kind: 'fixed' as const, iso: '2026-10-25' } }
    setup(def({}, { dates: { deadline: thatWeek } }))
    expect(titles()).toEqual(['Bob task'])
    advance(2, new Date(2026, 9, 31))
    expect(titles()).toEqual(['Bob task'])
    expect(leavingOf('Bob task')).toBe('stay')
    expect(rowCheckbox('Bob task').checked).toBe(true)
    act(() => { vi.advanceTimersByTime(680) })
    expect(titles()).toEqual([])
  })

  it('the advance undone while the row lingers takes it back, open', () => {
    vi.useFakeTimers()
    repeatsWeekly(2, new Date(2026, 9, 24))
    setup(def())
    advance(2, new Date(2026, 9, 31))
    expect(leavingOf('Bob task')).toBe('stay')
    advance(2, new Date(2026, 9, 24))
    expect(leavingOf('Bob task')).toBeNull()
    expect(rowCheckbox('Bob task').checked).toBe(false)
    act(() => { vi.advanceTimersByTime(1000) })
    expect(titles()).toEqual(['Alice task', 'Bob task', 'Shared task'])
  })

  it('in a list sorted by Modified the row keeps its place, though the completion moved its modified date', () => {
    vi.useFakeTimers()
    modifiedOn([1, 2, 3, 4])
    setup(def({ sort: 'modified' }))
    expect(titles()).toEqual(['Alice task', 'Bob task', 'Shared task'])
    completeNow(1)
    expect(titles()).toEqual(['Alice task', 'Bob task', 'Shared task'])
    expect(leavingOf('Alice task')).toBe('stay')
    act(() => { vi.advanceTimersByTime(680) })
    expect(titles()).toEqual(['Bob task', 'Shared task'])
  })

  it('a Modified date clause keeps the row while it lingers', () => {
    vi.useFakeTimers()
    modifiedOn([1, 2, 3, 4])
    const lastSeptember = { match: 'range' as const, start: { kind: 'fixed' as const, iso: '2026-09-01' }, end: { kind: 'fixed' as const, iso: '2026-09-30' } }
    setup(def({}, { dates: { modified: lastSeptember } }))
    completeNow(2)
    expect(titles()).toEqual(['Alice task', 'Bob task', 'Shared task'])
    expect(leavingOf('Bob task')).toBe('stay')
    act(() => { vi.advanceTimersByTime(680) })
    expect(titles()).toEqual(['Alice task', 'Shared task'])
  })
})

describe('ListWidget faces (D25 R)', () => {
  const TODAY = new Date(2026, 9, 14, 10)
  const day = (d: number) => new Date(2026, 9, d)

  function renderFace(host: WidgetFaceHost, d: PersistedListDefinition = def()) {
    useListDefinitionStore.setState({ listDefinitions: [d] })
    let result: ListWidgetResult | undefined
    render(
      <DndContext>
        <WidgetFaceContext.Provider value={host}>
          <ListWidget tab={tab} onResult={(r) => { result = r }} />
        </WidgetFaceContext.Provider>
      </DndContext>,
    )
    return { result: () => result }
  }
  const face = () => document.querySelector<HTMLElement>('[data-list-face]')

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(TODAY)
    useSettingsStore.setState({ rowDates: 'numeric', tabBadges: { due: 3, followup: 0 } })
    useTodoStore.setState({
      todos: [
        makeTodo({ id: 1, title: 'Alice task', sortOrder: 1, dueDate: day(16) }),
        makeTodo({ id: 2, title: 'Bob task', sortOrder: 2, dueDate: day(12) }),
        makeTodo({ id: 3, title: 'Shared task', sortOrder: 3 }),
        makeTodo({ id: 4, title: 'Done task', sortOrder: 4, isCompleted: true, dueDate: day(1) }),
      ],
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('small: the name, the count in the tab badge’s colour, the badge and the oldest due date (late: marked); no rows', () => {
    const { result } = renderFace({ forced: 'small' })
    expect(face()!.dataset.listFace).toBe('small')
    expect(face()!.textContent).toContain('Team')
    const count = screen.getByTestId('list-face-count')
    expect(count).toHaveTextContent('3')
    // Two due inside the badge's range (one overdue): the due colour.
    expect(count.style.color).toBe('var(--color-overdue)')
    expect(face()!.querySelector('[data-list-face-badge]')).not.toBeNull()
    expect(screen.getByTestId('list-face-oldest')).toHaveTextContent('Oldest due 10/12')
    expect(screen.getByTestId('list-face-oldest').className).toMatch(/late/)
    expect(face()!.querySelectorAll('[data-todo-id]')).toHaveLength(0)
    // Not a list widget's root (no selection, keyboard or zoom target), no tab count; Copy tasks still has its sections.
    expect(document.querySelector('[data-list-widget]')).toBeNull()
    expect(face()!.hasAttribute('data-selection-scope')).toBe(false)
    expect(result()?.countLabel).toBeUndefined()
    expect(result()?.sections.flatMap((sec) => sec.todos.map((t) => t.id))).toEqual([1, 2, 3])
  })

  it('small under the screen filter: shown of total, as the tab counts', () => {
    renderFace({ forced: 'small' })
    act(() => useFilterStore.getState().setPersonIds(new Set([1])))
    expect(screen.getByTestId('list-face-count')).toHaveTextContent('2')
    expect(face()!.textContent).toContain('of 3')
  })

  it('a count with nothing due in range takes the text colour; no oldest date without a due date', () => {
    useTodoStore.setState({ todos: [makeTodo({ id: 3, title: 'Shared task', sortOrder: 3 })] })
    renderFace({ forced: 'small' })
    expect(screen.getByTestId('list-face-count').style.color).toBe('')
    expect(screen.queryByTestId('list-face-oldest')).toBeNull()
  })

  it('medium: the line over as many quick rows as fit, `+N more` opening the full list; a row opens its editor', () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(400)
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(48)
    const openFull = vi.fn()
    renderFace({ forced: 'medium', openFull })
    expect(face()!.dataset.listFace).toBe('medium')
    const rows = [...face()!.querySelectorAll<HTMLElement>('[data-todo-id]')]
    expect(rows.map((r) => r.textContent)).toEqual(['Alice task10/16', 'Bob task10/12'])
    fireEvent.click(screen.getByTestId('list-face-more'))
    expect(screen.getByTestId('list-face-more')).toHaveTextContent('+1 more')
    expect(openFull).toHaveBeenCalledTimes(1)
    fireEvent.click(rows[1]!)
    expect(useUIStore.getState().selectedTodoId).toBe(2)
  })

  it('large: the list itself', () => {
    renderFace({ forced: 'large' })
    expect(face()).toBeNull()
    expect(titles()).toEqual(['Alice task', 'Bob task', 'Shared task'])
  })

  it('a prompt list waiting on its pick: a dash and what to pick', () => {
    renderFace({ forced: 'small' }, def({ runtimeFilter: { field: 'person' } }))
    expect(screen.getByTestId('list-face-count')).toHaveTextContent('—')
    expect(face()!.textContent).toContain('Pick a person')
  })
})
