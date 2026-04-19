import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
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
import { useSettingsStore } from '../../stores/settings-store'
import type { PersistedListDefinition } from '../../models/list-definition'
import type { TodoPredicate } from '../../models'
import { makeTodo } from '../helpers'

function emptyPredicate(): TodoPredicate {
  return {
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
    hasScheduled: null,
    hasDeadline: null,
  }
}

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
    membership: { kind: 'custom', predicate: emptyPredicate() },
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
    hasScheduled: null,
    hasDeadline: null,
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

  it('renders no list cards but still shows the Add list tile when empty', async () => {
    useListDefinitionStore.setState({ listDefinitions: [] })
    const { container } = render(<DashboardView />)
    expect(container.querySelectorAll('[data-list-key]').length).toBe(0)
    expect(screen.getByText(/Add list/i)).toBeInTheDocument()
  })

  it('only renders lists that are pinned to dashboard', () => {
    useListDefinitionStore.setState({
      listDefinitions: [
        makeDef({ id: 1, name: 'Pinned', sortOrder: 0, pinnedToDashboard: true }),
        makeDef({ id: 2, name: 'Hidden', sortOrder: 1, pinnedToDashboard: false }),
      ],
    })
    render(<DashboardView />)
    expect(screen.getByText('Pinned')).toBeInTheDocument()
    expect(screen.queryByText('Hidden')).not.toBeInTheDocument()
  })

  it('renders one card per list definition', () => {
    useListDefinitionStore.setState({
      listDefinitions: [
        makeDef({ id: 1, name: 'Deck One', sortOrder: 0 }),
        makeDef({ id: 2, name: 'Deck Two', sortOrder: 1 }),
        makeDef({ id: 3, name: 'Deck Three', sortOrder: 2 }),
        makeDef({ id: 4, name: 'Deck Four', sortOrder: 3 }),
      ],
    })
    const { container } = render(<DashboardView />)
    const cards = container.querySelectorAll('[data-list-key]')
    expect(cards.length).toBe(4)
    expect(screen.getByText('Deck One')).toBeInTheDocument()
    expect(screen.getByText('Deck Two')).toBeInTheDocument()
    expect(screen.getByText('Deck Three')).toBeInTheDocument()
    expect(screen.getByText('Deck Four')).toBeInTheDocument()
  })

  it('renders group labels when a list uses relative-effective grouping', () => {
    useListDefinitionStore.setState({
      listDefinitions: [
        makeDef({
          id: 1,
          name: 'Upcoming',
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
        makeDef({ id: 1, name: 'Today', sortOrder: 0 }),
        makeDef({ id: 2, name: 'Upcoming', sortOrder: 1 }),
        makeDef({ id: 3, name: 'Deadlines', sortOrder: 2 }),
        makeDef({ id: 4, name: 'Someday', sortOrder: 3 }),
      ],
    })
    const { container } = render(<DashboardView />)
    const keys = Array.from(container.querySelectorAll('[data-list-key]')).map(
      (el) => el.getAttribute('data-list-key'),
    )
    expect(keys).toEqual(['def-1', 'def-2', 'def-3', 'def-4'])
  })
})

describe('DashboardView — Phase 5 polish', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 3, 16))
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
    // Map every horizon slot to a real list-def so the ribbon shows mapped cells,
    // the hero renders, and "Edit horizons…" becomes available.
    useListDefinitionStore.setState({
      listDefinitions: [
        makeDef({ id: 11, name: 'This week', sortOrder: 0 }),
        makeDef({ id: 12, name: 'Next week', sortOrder: 1 }),
        makeDef({ id: 13, name: 'Rest of month', sortOrder: 2 }),
        makeDef({ id: 14, name: 'Later', sortOrder: 3 }),
        makeDef({ id: 15, name: 'Someday', sortOrder: 4 }),
      ],
    })
    useSettingsStore.setState({
      horizonSlots: {
        thisweek: 11,
        nextweek: 12,
        thismonth: 13,
        later: 14,
        someday: 15,
      },
      selectedHorizon: 'thisweek',
      horizonCollapsed: {},
    })
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('hero card has role="tabpanel" wired to the selected horizon tab', () => {
    render(
      <MemoryRouter>
        <DashboardView />
      </MemoryRouter>,
    )
    const hero = document.getElementById('horizon-hero-panel')
    expect(hero).not.toBeNull()
    expect(hero?.getAttribute('role')).toBe('tabpanel')
    const labelledBy = hero?.getAttribute('aria-labelledby')
    expect(labelledBy).toBe('horizon-tab-thisweek')
    const tab = document.getElementById('horizon-tab-thisweek')
    expect(tab?.getAttribute('aria-selected')).toBe('true')
    expect(tab?.getAttribute('aria-controls')).toBe('horizon-hero-panel')
  })

  it('renders an "Edit horizons…" button that opens the filtered editor', () => {
    const { container } = render(
      <MemoryRouter>
        <DashboardView />
      </MemoryRouter>,
    )
    const btn = screen.getByText(/Edit horizons/i)
    fireEvent.click(btn)
    // The filtered modal uses the supplied title.
    expect(screen.getByText('Edit Horizons')).toBeInTheDocument()
    // The 5 horizon-mapped defs render as editable rows within the modal.
    const modal = container.querySelector<HTMLElement>('[class*="modal"]')!
    const rowNames = Array.from(
      modal.querySelectorAll<HTMLElement>('[class*="nameEditable"]'),
    ).map((el) => el.textContent)
    expect(rowNames).toEqual(['This week', 'Next week', 'Rest of month', 'Later', 'Someday'])
    // The "+ Add List" affordance is suppressed in filtered mode.
    expect(screen.queryByText(/\+ Add List/i)).toBeNull()
  })

  it('renders an inline "+ Add task to …" button in the hero card', () => {
    render(
      <MemoryRouter>
        <DashboardView />
      </MemoryRouter>,
    )
    const btn = screen.getByText(/\+ Add task to This week/i)
    expect(btn).toBeInTheDocument()
    fireEvent.click(btn)
    const input = document.querySelector<HTMLInputElement>(
      'input[placeholder*="New task"]',
    )
    expect(input).not.toBeNull()
  })

  it('no longer renders the "Other horizons" section', () => {
    render(
      <MemoryRouter>
        <DashboardView />
      </MemoryRouter>,
    )
    expect(screen.queryByText(/Other horizons/i)).toBeNull()
  })

  it('renders taskboard + hero in the top row, honoring dashboardTopOrder', () => {
    useSettingsStore.setState({ dashboardTopOrder: ['taskboard', 'horizon'] })
    const { container } = render(
      <MemoryRouter>
        <DashboardView />
      </MemoryRouter>,
    )
    const topRow = container.querySelector<HTMLElement>('[class*="topRow"]')
    expect(topRow).not.toBeNull()
    // Two sortable wrappers (taskboard + hero).
    const wrappers = topRow!.querySelectorAll('[class*="sortableCardWrapper"]')
    expect(wrappers.length).toBe(2)
    // Default order: taskboard first, horizon second.
    const firstHasTaskboard = wrappers[0].querySelector('[class*="panel"]') != null
      || wrappers[0].textContent?.includes('Taskboard')
    expect(firstHasTaskboard).toBe(true)
    const secondHero = wrappers[1].querySelector('#horizon-hero-panel')
    expect(secondHero).not.toBeNull()
  })

  it('reversed dashboardTopOrder puts hero before taskboard', () => {
    useSettingsStore.setState({ dashboardTopOrder: ['horizon', 'taskboard'] })
    const { container } = render(
      <MemoryRouter>
        <DashboardView />
      </MemoryRouter>,
    )
    const wrappers = container.querySelectorAll<HTMLElement>(
      '[class*="topRow"] > [class*="sortableCardWrapper"]',
    )
    expect(wrappers.length).toBe(2)
    expect(wrappers[0].querySelector('#horizon-hero-panel')).not.toBeNull()
    expect(wrappers[1].textContent).toMatch(/Taskboard/i)
  })

  it('persists the hero card collapse toggle via setHorizonCollapsed', () => {
    const spy = vi.spyOn(useSettingsStore.getState(), 'setHorizonCollapsed')
    render(
      <MemoryRouter>
        <DashboardView />
      </MemoryRouter>,
    )
    const hero = document.getElementById('horizon-hero-panel')!
    const header = hero.querySelector<HTMLElement>('[class*="cardHeader"]')!
    act(() => {
      fireEvent.click(header)
    })
    expect(spy).toHaveBeenCalledWith('thisweek', true)
  })
})
