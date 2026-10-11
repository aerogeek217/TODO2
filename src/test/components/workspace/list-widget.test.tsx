import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, cleanup, screen, fireEvent, act } from '@testing-library/react'
import { DndContext } from '@dnd-kit/core'
import { ListWidget, type ListWidgetResult } from '../../../components/workspace/list/ListWidget'
import { useListDefinitionStore, emptyPredicate } from '../../../stores/list-definition-store'
import { useListDraftStore } from '../../../stores/list-draft-store'
import { useListWidgetStore } from '../../../stores/list-widget-store'
import { useTodoStore } from '../../../stores/todo-store'
import { usePersonStore } from '../../../stores/person-store'
import { useStatusStore } from '../../../stores/status-store'
import { useFilterStore } from '../../../stores/filter-store'
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

  it('Add task shows only when the merged predicate names people / status / tags', () => {
    setup(def())
    expect(screen.queryByTitle('Add a task to this list')).toBeNull()
    cleanup()
    setup(def({}, { personIds: [1] }))
    expect(screen.getByTitle('Add a task to this list')).toBeInTheDocument()
  })
})

