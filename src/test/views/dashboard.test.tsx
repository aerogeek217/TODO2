import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { DashboardView } from '../../views/DashboardView'
import { useTodoStore } from '../../stores/todo-store'
import { usePersonStore } from '../../stores/person-store'
import { useTagStore } from '../../stores/tag-store'
import { useOrgStore } from '../../stores/org-store'
import { useStatusStore } from '../../stores/status-store'
import { useProjectStore } from '../../stores/project-store'
import { useTaskboardStore } from '../../stores/taskboard-store'
import { useFilterStore } from '../../stores/filter-store'
import { useUIStore } from '../../stores/ui-store'
import { useCanvasStore } from '../../stores/canvas-store'
import { useListDefinitionStore } from '../../stores/list-definition-store'
import type { PersistedListDefinition } from '../../models/list-definition'
import { makeTodo } from '../helpers'

// Repositories touched by effect-driven loads: no-op them so tests drive stores directly.
vi.mock('../../data/list-definition-repository', () => ({
  listDefinitionRepository: { getAll: async () => [] },
}))
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
vi.mock('../../data/tag-repository', () => ({
  tagRepository: {
    getAll: async () => [],
    getTagsForTodos: async () => new Map(),
    assignTag: async () => {},
    unassignTag: async () => {},
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
  statusRepository: {
    getAll: async () => [],
  },
}))
vi.mock('../../data/taskboard-repository', () => ({
  taskboardRepository: {
    getAll: async () => [],
  },
}))

function makeDef(overrides: Partial<PersistedListDefinition> & { id: number }): PersistedListDefinition {
  return {
    name: 'List',
    sortOrder: 0,
    pinnedToDashboard: true,
    membership: { kind: 'someday' },
    sort: { kind: 'sort-order' },
    grouping: { kind: 'none' },
    ...overrides,
  }
}

function resetStores() {
  useTodoStore.setState({ todos: [] })
  usePersonStore.setState({ people: [], assignedPeopleMap: new Map() })
  useTagStore.setState({ tags: [], assignedTagsMap: new Map() })
  useOrgStore.setState({ orgs: [], assignedOrgsMap: new Map(), personOrgMap: new Map() })
  useStatusStore.setState({ statuses: [] })
  useProjectStore.setState({ projects: [] })
  useTaskboardStore.setState({ entries: [] })
  useCanvasStore.setState({ selectedCanvasId: 1 })
  useListDefinitionStore.setState({ listDefinitions: [] })
  useUIStore.getState().closeEditPopup?.()
  useFilterStore.getState().setAllFilters({
    showCompleted: false,
    showHiddenStatuses: false,
    personIds: null,
    personFilterMode: 'include-orgs',
    tagIds: null,
    orgIds: null,
    orgFilterMode: 'include-people',
    statusIds: null,
    searchText: '',
    dateField: 'date',
    dateRangeStart: null,
    dateRangeEnd: null,
    dateRangeIncludeNoDate: false,
  })
}

describe('DashboardView', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 3, 16))
    // useIsMobile reads window.matchMedia on mount; jsdom lacks it by default.
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
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('renders an empty-state message when there are no list definitions', async () => {
    useListDefinitionStore.setState({ listDefinitions: [] })
    render(<DashboardView />)
    expect(screen.getByText(/No dashboard lists/i)).toBeInTheDocument()
  })

  it('renders one card per list definition', () => {
    useListDefinitionStore.setState({
      listDefinitions: [
        makeDef({ id: 1, name: 'Today', membership: { kind: 'today' }, sortOrder: 0 }),
        makeDef({ id: 2, name: 'Upcoming', membership: { kind: 'upcoming' }, sortOrder: 1 }),
        makeDef({ id: 3, name: 'Deadlines', membership: { kind: 'deadlines' }, sortOrder: 2 }),
        makeDef({ id: 4, name: 'Someday', membership: { kind: 'someday' }, sortOrder: 3 }),
      ],
    })
    const { container } = render(<DashboardView />)
    const cards = container.querySelectorAll('[data-list-key]')
    expect(cards.length).toBe(4)
    expect(screen.getByText('Today')).toBeInTheDocument()
    expect(screen.getByText('Upcoming')).toBeInTheDocument()
    expect(screen.getByText('Deadlines')).toBeInTheDocument()
    expect(screen.getByText('Someday')).toBeInTheDocument()
  })

  it('renders group labels when a list uses relative-effective grouping', () => {
    useListDefinitionStore.setState({
      listDefinitions: [
        makeDef({
          id: 1,
          name: 'Upcoming',
          membership: { kind: 'upcoming' },
          sort: { kind: 'effective-date-asc' },
          grouping: { kind: 'relative-effective' },
          sortOrder: 0,
        }),
      ],
    })
    useTodoStore.setState({
      todos: [
        makeTodo({ id: 100, title: 'Next week task', dueDate: new Date(2026, 3, 22) }),
      ],
    })

    render(<DashboardView />)
    // relative-effective produces non-empty buckets such as "This week" / "Next week"
    const card = document.querySelector('[data-list-key="def-1"]') as HTMLElement
    expect(card).toBeInTheDocument()
    expect(card.querySelector('[class*="groupLabel"]')).toBeInTheDocument()
  })

  it('renders the TaskboardPanel alongside the list cards', () => {
    useListDefinitionStore.setState({ listDefinitions: [makeDef({ id: 1, name: 'Today' })] })
    render(<DashboardView />)
    expect(screen.getByText(/Taskboard/i)).toBeInTheDocument()
  })

  it('reflects listDefinitions sortOrder in rendered card order', () => {
    useListDefinitionStore.setState({
      listDefinitions: [
        makeDef({ id: 1, name: 'Today', membership: { kind: 'today' }, sortOrder: 0 }),
        makeDef({ id: 2, name: 'Upcoming', membership: { kind: 'upcoming' }, sortOrder: 1 }),
        makeDef({ id: 3, name: 'Deadlines', membership: { kind: 'deadlines' }, sortOrder: 2 }),
        makeDef({ id: 4, name: 'Someday', membership: { kind: 'someday' }, sortOrder: 3 }),
      ],
    })
    const { container } = render(<DashboardView />)
    const keys = Array.from(container.querySelectorAll('[data-list-key]')).map(
      (el) => el.getAttribute('data-list-key'),
    )
    expect(keys).toEqual(['def-1', 'def-2', 'def-3', 'def-4'])
  })
})
