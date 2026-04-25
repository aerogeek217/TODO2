import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, fireEvent, act } from '@testing-library/react'
import { ListView } from '../../views/ListView'
import { useTodoStore } from '../../stores/todo-store'
import { usePersonStore } from '../../stores/person-store'
import { useOrgStore } from '../../stores/org-store'
import { useStatusStore } from '../../stores/status-store'
import { useProjectStore } from '../../stores/project-store'
import { useTagStore } from '../../stores/tag-store'
import { useFilterStore } from '../../stores/filter-store'
import { useListDefinitionStore, emptyPredicate } from '../../stores/list-definition-store'
import { useUIStore } from '../../stores/ui-store'
import type { PersistedListDefinition } from '../../models/list-definition'
import { makeTodo, makePerson, makeProject } from '../helpers'

vi.mock('../../data/todo-repository', () => ({
  todoRepository: {
    getAll: async () => [],
    getById: async () => undefined,
    insert: async () => 1,
    update: async () => {},
    remove: async () => {},
    bulkUpdate: async () => {},
    bulkDelete: async () => {},
    purgeExpired: async () => 0,
  },
}))
vi.mock('../../data/person-repository', () => ({
  personRepository: {
    getAll: async () => [],
    getAssignedPeopleForTodos: async () => new Map(),
    assignPerson: async () => {},
    unassignPerson: async () => {},
  },
}))
vi.mock('../../data/org-repository', () => ({
  orgRepository: {
    getAll: async () => [],
    getAssignedOrgsForTodos: async () => new Map(),
    getPersonOrgMap: async () => new Map(),
    assignOrg: async () => {},
    unassignOrg: async () => {},
  },
}))
vi.mock('../../data/status-repository', () => ({
  statusRepository: { getAll: async () => [] },
}))
vi.mock('../../data/project-repository', () => ({
  projectRepository: { getAll: async () => [] },
}))
vi.mock('../../data/tag-repository', () => ({
  tagRepository: {
    getAll: async () => [],
    getAssignedTagsForTodos: async () => new Map(),
    assignTag: async () => {},
    unassignTag: async () => {},
    insert: async () => 1,
    update: async () => {},
    delete: async () => {},
  },
}))
vi.mock('../../data/list-definition-repository', () => ({
  listDefinitionRepository: {
    getAll: async () => [],
    insert: async () => 1,
    update: async () => {},
    remove: async () => {},
    reorder: async () => {},
  },
}))

function resetFilterStore() {
  useFilterStore.getState().setAllFilters({
    showCompleted: false,
    showHiddenStatuses: false,
    personIds: null,
    personFilterMode: 'include-orgs',
    orgIds: null,
    orgFilterMode: 'include-people',
    projectIds: null,
    statusIds: null,
    searchText: '',
    dateField: 'date',
    dateRangeStart: null,
    dateRangeEnd: null,
    dateRangeIncludeNoDate: false,
    hasScheduled: null,
    hasDeadline: null,
    tags: null,
  })
}

function resetStores() {
  useTodoStore.setState({ todos: [] })
  usePersonStore.setState({ people: [], assignedPeopleMap: new Map() })
  useOrgStore.setState({ orgs: [], assignedOrgsMap: new Map(), personOrgMap: new Map() })
  useStatusStore.setState({ statuses: [] })
  useProjectStore.setState({ projects: [] })
  useTagStore.setState({ tags: [], assignedTagsMap: new Map() })
  useListDefinitionStore.setState({ listDefinitions: [] })
  useUIStore.getState().closeEditPopup?.()
  useUIStore.getState().clearBulkConfirmation?.()
  resetFilterStore()
}

/**
 * The component mounts a big `useEffect` that re-loads every store from the
 * repo. Our mocks return empty arrays, so without stubs those async reloads
 * overwrite our test-seeded state on the next microtask. Replace the load
 * actions with no-ops so the seeded state survives.
 */
function stubLoadActions() {
  useTodoStore.setState({ loadAll: async () => {} } as never)
  usePersonStore.setState({
    load: async () => {},
    loadAssignments: async () => {},
  } as never)
  useOrgStore.setState({
    load: async () => {},
    loadAssignments: async () => {},
    loadPersonOrgMap: async () => {},
  } as never)
  useStatusStore.setState({ load: async () => {} } as never)
  useProjectStore.setState({ loadAll: async () => {} } as never)
  useTagStore.setState({
    load: async () => {},
    loadAssignments: async () => {},
  } as never)
  useListDefinitionStore.setState({ load: async () => {} } as never)
}

function makeDef(overrides: Partial<PersistedListDefinition> & { id: number }): PersistedListDefinition {
  return {
    name: `List ${overrides.id}`,
    sortOrder: overrides.id,
    pinnedToDashboard: false,
    favorited: true,
    membership: { kind: 'custom', predicate: emptyPredicate() },
    sort: { kind: 'sort-order' },
    grouping: { kind: 'none' },
    ...overrides,
  }
}

describe('ListView — runtime-filter picker', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }),
    })
    resetStores()
    stubLoadActions()
  })

  afterEach(() => {
    cleanup()
  })

  it('hides the RuntimeFilterPicker when no def is loaded', () => {
    const { queryByLabelText } = render(<ListView />)
    expect(queryByLabelText(/Filter tasks by/i)).toBeNull()
  })

  it('shows the RuntimeFilterPicker after loading a def whose runtimeFilter is set', () => {
    usePersonStore.setState({
      people: [makePerson({ id: 1, name: 'Alice' })],
      assignedPeopleMap: new Map(),
    })
    const def = makeDef({
      id: 1,
      name: 'Tasks for…',
      runtimeFilter: { field: 'person' },
    })
    useListDefinitionStore.setState({ listDefinitions: [def] })

    const { getByText, getByLabelText } = render(<ListView />)
    fireEvent.click(getByText('Tasks for…'))

    // Picker input is visible (multi-select shape — chips + searchable list).
    const picker = getByLabelText(/Filter tasks by person/i) as HTMLInputElement
    expect(picker).toBeTruthy()
    expect(picker.tagName).toBe('INPUT')
    // Focusing the input opens the option list; Alice should appear.
    fireEvent.focus(picker)
    expect(document.body.textContent).toMatch(/Alice/)
    // Empty-state message prompts for a pick.
    expect(document.body.textContent).toMatch(/Pick a person/i)
  })

  it('filters the task list by the picked value', () => {
    useProjectStore.setState({
      projects: [
        makeProject({ id: 1, canvasId: 1, name: 'Alpha' }),
        makeProject({ id: 2, canvasId: 1, name: 'Beta' }),
      ],
    })
    useTodoStore.setState({
      todos: [
        makeTodo({ id: 10, title: 'Alpha task', projectId: 1 }),
        makeTodo({ id: 11, title: 'Beta task', projectId: 2 }),
      ],
    })
    const def = makeDef({
      id: 1,
      name: 'Tasks for…',
      runtimeFilter: { field: 'project' },
    })
    useListDefinitionStore.setState({ listDefinitions: [def] })

    const { getByText, getByLabelText } = render(<ListView />)
    fireEvent.click(getByText('Tasks for…'))

    const picker = getByLabelText(/Filter tasks by project/i) as HTMLInputElement
    fireEvent.focus(picker)
    // Click the Alpha option in the anchored panel.
    const alphaOption = Array.from(document.querySelectorAll('button'))
      .find((b) => b.textContent === 'Alpha')
    expect(alphaOption).toBeTruthy()
    fireEvent.click(alphaOption!)

    // Alpha task is visible; Beta task is filtered out.
    expect(document.body.textContent).toMatch(/Alpha task/)
    expect(document.body.textContent).not.toMatch(/Beta task/)
  })

  it('toggles the picker off when the toolbar Prompt select is set to None', () => {
    const def = makeDef({
      id: 1,
      name: 'Tasks for…',
      runtimeFilter: { field: 'person' },
    })
    useListDefinitionStore.setState({ listDefinitions: [def] })

    const { getByText, getByLabelText, queryByLabelText } = render(<ListView />)
    fireEvent.click(getByText('Tasks for…'))
    expect(queryByLabelText(/Filter tasks by person/i)).toBeTruthy()

    const promptSelect = getByLabelText(/Prompt field/i) as HTMLSelectElement
    fireEvent.change(promptSelect, { target: { value: 'none' } })
    expect(queryByLabelText(/Filter tasks by person/i)).toBeNull()
  })

  it('round-trips runtimeFilter spec changes through Save', async () => {
    const updates: PersistedListDefinition[] = []
    const def = makeDef({
      id: 1,
      name: 'Tasks for…',
      runtimeFilter: { field: 'person' },
    })
    useListDefinitionStore.setState({
      listDefinitions: [def],
      update: async (next: PersistedListDefinition) => {
        updates.push(next)
        const prev = useListDefinitionStore.getState().listDefinitions
        useListDefinitionStore.setState({
          listDefinitions: prev.map((d) => (d.id === next.id ? next : d)),
        })
      },
    } as Partial<ReturnType<typeof useListDefinitionStore.getState>> as never)

    const { getByText, getByLabelText } = render(<ListView />)
    fireEvent.click(getByText('Tasks for…'))

    // Change the spec from 'person' → 'project'.
    const promptSelect = getByLabelText(/Prompt field/i) as HTMLSelectElement
    fireEvent.change(promptSelect, { target: { value: 'project' } })

    async function triggerSaveConfirm() {
      // Open the save selector, pick the row in the selector (disambiguate
      // from the favorite chip that also renders the def name by class-name).
      fireEvent.click(getByText('Save'))
      const rows = Array.from(document.body.querySelectorAll('button[class*="selectorName"]')) as HTMLButtonElement[]
      const row = rows.find((b) => b.textContent === 'Tasks for…')
      expect(row).toBeTruthy()
      fireEvent.click(row!)

      // `showBulkConfirmation` renders no dialog in this test tree — invoke
      // the onConfirm stashed on ui-store to proceed.
      const confirm = useUIStore.getState().bulkConfirmation
      expect(confirm?.onConfirm).toBeDefined()
      await act(async () => {
        const result = (confirm!.onConfirm as () => unknown)()
        if (result instanceof Promise) await result
      })
    }

    await triggerSaveConfirm()
    expect(updates.length).toBe(1)
    expect(updates[0].runtimeFilter).toEqual({ field: 'project' })

    // Clear the spec via 'none'; Save again and confirm it persists as undefined.
    fireEvent.change(promptSelect, { target: { value: 'none' } })
    useUIStore.getState().clearBulkConfirmation()
    await triggerSaveConfirm()
    expect(updates.length).toBe(2)
    expect(updates[1].runtimeFilter).toBeUndefined()
  })
})
