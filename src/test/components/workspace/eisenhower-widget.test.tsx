import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, cleanup, fireEvent, act, within, screen } from '@testing-library/react'
import { DndContext } from '@dnd-kit/core'
import { EisenhowerWidget, type EisenhowerResult } from '../../../components/workspace/eisenhower/EisenhowerWidget'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import { useTodoStore } from '../../../stores/todo-store'
import { useSettingsStore } from '../../../stores/settings-store'
import { useFilterStore } from '../../../stores/filter-store'
import { usePersonStore } from '../../../stores/person-store'
import { useUIStore } from '../../../stores/ui-store'
import { useUndoStore } from '../../../stores/undo-store'
import type { EisenhowerTab, PersistedWorkspaceLayout } from '../../../models/workspace-layout'
import type { PersistedListDefinition } from '../../../models/list-definition'
import { emptyPredicate, type TodoPredicate } from '../../../models'
import { useListDefinitionStore } from '../../../stores/list-definition-store'
import { useListDraftStore } from '../../../stores/list-draft-store'
import { useListOrderStore } from '../../../stores/list-order-store'
import { useStatusStore } from '../../../stores/status-store'
import { clearFilterStore, makePerson, makeTodo, patchScreenFilter, resetEntityStores } from '../../helpers'

const TODAY = new Date(2026, 9, 10, 10) // Sat 10 Oct 2026
const day = (n: number) => new Date(2026, 9, 10 + n)

function layoutWith(tab: EisenhowerTab): PersistedWorkspaceLayout {
  const now = new Date(2026, 0, 1)
  return { id: 1, name: 'Main', createdAt: now, modifiedAt: now, columns: [{ id: 'c1', weight: 1, cells: [{ id: 'x1', weight: 1, tabs: [tab] }] }] }
}

let lastResult: EisenhowerResult | null = null

/** Renders the tab as the workspace store holds it (so view-state edits show). */
function Host() {
  const tab = useWorkspaceStore((s) => s.working?.columns[0]?.cells[0]?.tabs[0])
  return tab?.kind === 'eisenhower' ? <EisenhowerWidget tab={tab} onResult={(r) => { lastResult = r }} /> : null
}

function setup(tab: EisenhowerTab = { id: 'eis', kind: 'eisenhower', config: {} }) {
  const layout = layoutWith(tab)
  useWorkspaceStore.setState({ layouts: [layout], activeLayoutId: 1, working: layout, saved: layout, isDirty: false, hydrated: true })
  render(<DndContext><Host /></DndContext>)
}

const quadrant = (q: string) => document.querySelector<HTMLElement>(`[data-eis-quadrant="${q}"]`)!
const titles = (q: string) => Array.from(quadrant(q).querySelectorAll('[data-row-todo]')).map((r) => r.textContent ?? '')
  .map((t) => ['Fix outage', 'Draft OKRs', 'Board update', 'Call plumber', 'Analytics', 'Vendor', 'Blog', 'Old report'].find((n) => t.includes(n)))
const widget = () => document.querySelector<HTMLElement>('[data-eisenhower]')!
const count = (q: string) => within(quadrant(q)).getByTestId('eisenhower-count').textContent

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(TODAY)
  lastResult = null
  resetEntityStores()
  clearFilterStore()
  useSettingsStore.setState({ urgentDueWithinDays: 3 })
  useUIStore.setState({ quickAddOpen: false, quickAddDraft: null, selectedTodoIds: new Set(), selectionScope: null })
  useWorkspaceStore.setState({ layouts: [], activeLayoutId: null, working: null, saved: null, isDirty: false, hydrated: false })
  useTodoStore.setState({
    todos: [
      makeTodo({ id: 1, title: 'Fix outage', urgent: true, important: true, dueDate: day(0), sortOrder: 1 }),
      makeTodo({ id: 2, title: 'Draft OKRs', important: true, dueDate: day(5), sortOrder: 2 }),
      makeTodo({ id: 3, title: 'Board update', important: true, dueDate: day(13), sortOrder: 3 }),
      makeTodo({ id: 4, title: 'Call plumber', dueDate: day(-2), sortOrder: 4 }),
      makeTodo({ id: 5, title: 'Analytics', urgent: true, sortOrder: 5 }),
      makeTodo({ id: 6, title: 'Vendor', dueDate: day(4), sortOrder: 6 }),
      makeTodo({ id: 7, title: 'Blog', sortOrder: 7 }),
      makeTodo({ id: 8, title: 'Old report', urgent: true, dueDate: day(-9), isCompleted: true, sortOrder: 8 }),
    ],
  })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  // The stacked-layout test stubs `clientWidth`; later tests must measure the real (0 = unmeasured → grid) width.
  vi.restoreAllMocks()
})

describe('EisenhowerWidget', () => {
  it('places open tasks by effective urgent × important, sorted by due date', () => {
    setup()
    expect(document.querySelector('[data-eisenhower]')?.getAttribute('data-layout')).toBe('grid')
    expect(titles('do')).toEqual(['Fix outage'])
    expect(titles('schedule')).toEqual(['Draft OKRs', 'Board update'])
    // Overdue (urgent by date) first, then the undated flagged task.
    expect(titles('delegate')).toEqual(['Call plumber', 'Analytics'])
    expect(titles('drop')).toEqual(['Vendor', 'Blog'])
    expect(lastResult).toEqual({ countLabel: '7' })
  })

  it('completed tasks show with "Show completed", by their flags, last, and don\'t count', () => {
    setup()
    act(() => useFilterStore.getState().setShowCompleted(true))
    // Overdue but completed: only its flag counts (urgent, not important).
    expect(titles('delegate')).toEqual(['Call plumber', 'Analytics', 'Old report'])
    expect(count('delegate')).toBe('2')
    expect(lastResult).toEqual({ countLabel: '7' })
  })

  it('the urgent range moves tasks: Off → only flags count', () => {
    setup()
    act(() => useSettingsStore.setState({ urgentDueWithinDays: null }))
    expect(titles('delegate')).toEqual(['Analytics'])
    expect(titles('drop')).toEqual(['Call plumber', 'Vendor', 'Blog'])
    act(() => useSettingsStore.setState({ urgentDueWithinDays: 7 }))
    expect(titles('delegate')).toEqual(['Call plumber', 'Vendor', 'Analytics'])
  })

  it('the screen filter narrows it: count reads "shown of total"', () => {
    usePersonStore.setState({ people: [makePerson({ id: 9, name: 'Dana' })], assignedPeopleMap: new Map([[2, [makePerson({ id: 9, name: 'Dana' })]]]) })
    setup()
    act(() => useFilterStore.getState().setPersonIds(new Set([9])))
    expect(titles('schedule')).toEqual(['Draft OKRs'])
    expect(titles('do')).toEqual([])
    expect(lastResult).toEqual({ countLabel: '1 of 7' })
    // An empty quadrant says what's missing.
    expect(within(quadrant('do')).getByText('Nothing urgent and important')).toBeInTheDocument()
  })

  it('a screen filter that hides everything shows the note panel instead of empty lines', () => {
    setup()
    act(() => useFilterStore.getState().setSearchText('zzz'))
    expect(lastResult).toEqual({ countLabel: '0 of 7' })
    const panel = within(widget()).getByRole('status')
    expect(panel).toHaveTextContent('All 7 open tasks are hidden by the screen filter.')
    expect(within(quadrant('do')).queryByText('Nothing urgent and important')).toBeNull()
    fireEvent.click(within(panel).getByRole('button', { name: 'Clear screen filter' }))
    expect(lastResult).toEqual({ countLabel: '7' })
  })

  it('no tasks at all: every quadrant shows its own lines', () => {
    useTodoStore.setState({ todos: [] })
    setup()
    expect(lastResult).toEqual({ countLabel: '0' })
    expect(within(widget()).queryByRole('status')).toBeNull()
    expect(within(quadrant('drop')).getByText('Tasks with neither flag land here.')).toBeInTheDocument()
  })

  it('a quadrant\'s "+" opens Quick Add with its flags, the screen defaults and the source', () => {
    usePersonStore.setState({ people: [makePerson({ id: 9, name: 'Dana' })] })
    setup()
    act(() => {
      useFilterStore.getState().setPersonIds(new Set([9]))
      patchScreenFilter({ markers: { focus: true, urgent: true } })
    })
    fireEvent.click(within(quadrant('schedule')).getByRole('button', { name: 'Add task to Schedule' }))
    expect(useUIStore.getState().quickAddOpen).toBe(true)
    expect(useUIStore.getState().quickAddDraft).toEqual({
      rawTitle: '',
      // Focus stays from the screen filter; Urgent / Important are the quadrant's.
      defaults: { personIds: [9], tagIds: [], statusId: undefined, markers: { focus: true, important: true } },
      source: 'Schedule',
    })
  })

  it('stacks below 560px: sections collapse as view state, never dirty', () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(420)
    setup()
    expect(document.querySelector('[data-eisenhower]')?.getAttribute('data-layout')).toBe('stacked')
    const toggle = within(quadrant('schedule')).getByRole('button', { expanded: true })
    fireEvent.click(toggle)
    expect(useWorkspaceStore.getState().working?.columns[0]?.cells[0]?.tabs[0]?.viewState).toEqual({ collapsed: ['schedule'] })
    expect(useWorkspaceStore.getState().isDirty).toBe(false)
    expect(quadrant('schedule').getAttribute('data-collapsed')).toBe('true')
    expect(titles('schedule')).toEqual([])
    // The count stays; → expands again.
    expect(count('schedule')).toBe('2')
    fireEvent.keyDown(within(quadrant('schedule')).getByRole('button', { expanded: false }), { key: 'ArrowRight' })
    expect(titles('schedule')).toEqual(['Draft OKRs', 'Board update'])
  })
})

describe('EisenhowerWidget on a saved list', () => {
  const waiting = { id: 2, name: 'Waiting', color: '#888', sortOrder: 1 }
  function listDef(over: Partial<PersistedListDefinition> = {}, predicate: Partial<TodoPredicate> = {}): PersistedListDefinition {
    return {
      id: 7, name: 'Not waiting', sortOrder: 0,
      membership: { kind: 'custom', predicate: { ...emptyPredicate(), ...predicate } },
      sort: 'manual', grouping: 'none',
      ...over,
    }
  }
  const notWaiting = { statusIds: [2], negate: { statusIds: true as const } }
  /** The Eisenhower on list 7 (the app-wide source). */
  const setupOnList = () => {
    useSettingsStore.setState({ eisenhowerListId: 7 })
    setup()
  }

  beforeEach(() => {
    useStatusStore.setState({ statuses: [waiting] })
    useListOrderStore.setState({ ranks: new Map(), loaded: true })
    useListDraftStore.setState({ drafts: {} })
    useTodoStore.setState({
      todos: useTodoStore.getState().todos.map((t) => (t.id === 2 || t.id === 7 ? { ...t, statusId: 2 } : t)),
    })
  })

  it('shows only the list\'s members; the count is against the list, not all tasks', () => {
    useListDefinitionStore.setState({ listDefinitions: [listDef({}, notWaiting)] })
    setupOnList()
    // Draft OKRs (2) and Blog (7) are Waiting: the list leaves them out.
    expect(titles('schedule')).toEqual(['Board update'])
    expect(titles('drop')).toEqual(['Vendor'])
    expect(lastResult).toEqual({ countLabel: '5' })
    // The list's filter line, without the group · sort summary.
    const line = within(document.querySelector<HTMLElement>('[data-list-host="eis"]')!).getByTestId('list-filter-row')
    expect(line).toHaveTextContent('not Waiting')
    expect(within(line).queryByTestId('list-summary')).toBeNull()
  })

  it('switching the source back to all tasks shows every task again', () => {
    useListDefinitionStore.setState({ listDefinitions: [listDef({}, notWaiting)] })
    setupOnList()
    expect(lastResult).toEqual({ countLabel: '5' })
    act(() => useSettingsStore.setState({ eisenhowerListId: null }))
    expect(titles('schedule')).toEqual(['Draft OKRs', 'Board update'])
    expect(lastResult).toEqual({ countLabel: '7' })
    expect(document.querySelector('[data-list-host]')).toBeNull()
  })

  it('shows the list as edited (its unsaved draft), with Revert · Save on the filter line', () => {
    const saved = listDef()
    useListDefinitionStore.setState({ listDefinitions: [saved] })
    setupOnList()
    expect(lastResult).toEqual({ countLabel: '7' })
    act(() => useListDraftStore.getState().edit(7, (d) => ({ ...d, membership: { kind: 'custom', predicate: { ...d.membership.predicate, ...notWaiting } } })))
    expect(lastResult).toEqual({ countLabel: '5' })
    expect(screen.getByTestId('save-list')).toBeInTheDocument()
  })

  it('composes the screen filter in: "shown of the list\'s total"', () => {
    useListDefinitionStore.setState({ listDefinitions: [listDef({}, notWaiting)] })
    setupOnList()
    act(() => useFilterStore.getState().setSearchText('outage'))
    expect(lastResult).toEqual({ countLabel: '1 of 5' })
    act(() => useFilterStore.getState().setSearchText('zzz'))
    expect(within(widget()).getByRole('status')).toHaveTextContent('All 5 open tasks in “Not waiting” are hidden by the screen filter.')
  })

  it('ignores the list\'s prompt (a temporary pick): every member shows', () => {
    useListDefinitionStore.setState({ listDefinitions: [listDef({ runtimeFilter: { field: 'status' } }, notWaiting)] })
    setupOnList()
    expect(lastResult).toEqual({ countLabel: '5' })
  })

  it('names the list\'s filter when it hides every open task', () => {
    useListDefinitionStore.setState({ listDefinitions: [listDef({}, { searchText: 'nothing like this' })] })
    setupOnList()
    expect(lastResult).toEqual({ countLabel: '0' })
    const panel = within(widget()).getByRole('status')
    expect(panel).toHaveTextContent('All 7 open tasks are hidden by the filters of “Not waiting”.')
    fireEvent.click(within(panel).getByRole('button', { name: 'Edit list' }))
    expect(useUIStore.getState().listEditor).toEqual({ listDefinitionId: 7, tabId: 'eis' })
  })

  it('a quadrant\'s "+" seeds the list\'s defaults and the quadrant\'s flags, from "<pane> · <list>"', () => {
    usePersonStore.setState({ people: [makePerson({ id: 9, name: 'Dana' })] })
    useListDefinitionStore.setState({ listDefinitions: [listDef({ name: 'Dana' }, { personIds: [9], ...notWaiting })] })
    setupOnList()
    // The screen filter seeds nothing here: the list's own Add task doesn't use it either.
    act(() => useFilterStore.getState().setPersonIds(new Set([5])))
    fireEvent.click(within(quadrant('do')).getByRole('button', { name: 'Add task to Do' }))
    expect(useUIStore.getState().quickAddDraft).toEqual({
      rawTitle: '',
      // "is not Waiting" seeds no status.
      defaults: { personIds: [9], tagIds: [], statusId: undefined, markers: { urgent: true, important: true } },
      source: 'Do · Dana',
    })
  })

  it('a deleted list: says so, and offers all tasks', async () => {
    useListDefinitionStore.setState({ listDefinitions: [] })
    setupOnList()
    expect(screen.getByText('This list was deleted')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Show all tasks' }))
    expect(lastResult).toEqual({ countLabel: '7' })
    // The app-wide source goes back to all tasks (one undo step), not the layout.
    expect(useSettingsStore.getState().eisenhowerListId).toBeNull()
    await vi.waitFor(() => expect(useUndoStore.getState().undoStack.map((e) => e.description)).toEqual(['Eisenhower shows all tasks']))
    expect(useWorkspaceStore.getState().isDirty).toBe(false)
  })
})
