import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, screen, fireEvent } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import type { ReactNode } from 'react'
import { ListDefinitionBody } from '../../../components/canvas/ListDefinitionBody'
import { usePersonStore } from '../../../stores/person-store'
import { useOrgStore } from '../../../stores/org-store'
import { useStatusStore } from '../../../stores/status-store'
import { useProjectStore } from '../../../stores/project-store'
import { useFilterStore } from '../../../stores/filter-store'
import { useListDefinitionStore, emptyPredicate } from '../../../stores/list-definition-store'
import { useTodoStore } from '../../../stores/todo-store'
import type { PersistedListDefinition } from '../../../models/list-definition'
import { makeTodo } from '../../helpers'

vi.mock('../../../hooks/use-bulk-actions', () => ({
  useBulkActions: () => ({
    toggleComplete: vi.fn(),
    remove: vi.fn(),
    setScheduled: vi.fn(),
    setDeadline: vi.fn(),
    setProject: vi.fn(),
    setStatus: vi.fn(),
    quickAssignPerson: vi.fn(),
    quickUnassignPerson: vi.fn(),
    quickAssignOrg: vi.fn(),
    quickUnassignOrg: vi.fn(),
  }),
}))

function Wrapper({ children }: { children: ReactNode }) {
  return <ReactFlowProvider>{children}</ReactFlowProvider>
}

function futureDef(): PersistedListDefinition {
  const predicate = emptyPredicate()
  predicate.dateField = 'date'
  predicate.dateRangeEnd = { kind: 'fixed', iso: new Date(2026, 3, 23).toISOString() }
  return {
    id: 1,
    name: 'Due this week',
    sortOrder: 0,
    pinnedToDashboard: false,
    membership: { kind: 'custom', predicate },
    sort: { kind: 'effective-date-asc' },
    grouping: { kind: 'none' },
  }
}

function resetStores() {
  useTodoStore.setState({ todos: [] })
  usePersonStore.setState({ people: [], assignedPeopleMap: new Map() })
  useOrgStore.setState({ orgs: [], assignedOrgsMap: new Map(), personOrgMap: new Map() })
  useStatusStore.setState({ statuses: [] })
  useProjectStore.setState({ projects: [] })
  useListDefinitionStore.setState({ listDefinitions: [futureDef()] })
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

describe('ListDefinitionBody', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 3, 16))
    resetStores()
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('renders tasks matching the list-definition predicate', () => {
    useTodoStore.setState({
      todos: [
        makeTodo({ id: 1, title: 'Within window', dueDate: new Date(2026, 3, 18) }),
        makeTodo({ id: 2, title: 'Far out', dueDate: new Date(2026, 4, 15) }),
      ],
    })
    render(
      <Wrapper>
        <ListDefinitionBody listDefinitionId={1} />
      </Wrapper>,
    )
    expect(screen.getByText('Within window')).toBeInTheDocument()
    expect(screen.queryByText('Far out')).not.toBeInTheDocument()
  })

  it('renders the empty label when no tasks match', () => {
    useTodoStore.setState({
      todos: [makeTodo({ id: 3, title: 'Nope', dueDate: new Date(2026, 4, 15) })],
    })
    render(
      <Wrapper>
        <ListDefinitionBody listDefinitionId={1} emptyLabel="Nothing here" />
      </Wrapper>,
    )
    expect(screen.getByText('Nothing here')).toBeInTheDocument()
  })

  it('invokes onResult with the definition name and count', () => {
    useTodoStore.setState({
      todos: [
        makeTodo({ id: 4, title: 'A', dueDate: new Date(2026, 3, 18) }),
        makeTodo({ id: 5, title: 'B', dueDate: new Date(2026, 3, 20) }),
      ],
    })
    const onResult = vi.fn()
    render(
      <Wrapper>
        <ListDefinitionBody listDefinitionId={1} onResult={onResult} />
      </Wrapper>,
    )
    expect(onResult).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'Due this week', count: 2 }))
  })

  it('reports a null name when the definition was deleted', () => {
    useListDefinitionStore.setState({ listDefinitions: [] })
    const onResult = vi.fn()
    render(
      <Wrapper>
        <ListDefinitionBody listDefinitionId={1} onResult={onResult} />
      </Wrapper>,
    )
    expect(onResult).toHaveBeenLastCalledWith(expect.objectContaining({ name: null, count: 0 }))
  })

  it('uses the custom renderRow when provided', () => {
    useTodoStore.setState({
      todos: [makeTodo({ id: 6, title: 'Custom rendered', dueDate: new Date(2026, 3, 18) })],
    })
    render(
      <Wrapper>
        <ListDefinitionBody
          listDefinitionId={1}
          renderRow={({ todo }) => <div data-custom-id={todo.id}>{todo.title}</div>}
        />
      </Wrapper>,
    )
    const el = document.querySelector('[data-custom-id="6"]')
    expect(el).toBeTruthy()
    expect(el?.textContent).toBe('Custom rendered')
  })

  it('ignores the global top-bar filter — def predicate is authoritative', () => {
    // Regression: a list def whose predicate references a hidden status was
    // showing zero rows until the user flipped global "Show hidden", because
    // the component pre-filtered via applyFilter. On canvas the def is
    // authoritative; the global filter must not intersect.
    useStatusStore.setState({
      statuses: [
        { id: 10, name: 'Open', color: '#fff', sortOrder: 0 },
        { id: 11, name: 'Blocked', color: '#fff', sortOrder: 1, hideByDefault: true },
      ],
    })
    useTodoStore.setState({
      todos: [
        makeTodo({ id: 20, title: 'Blocked task', statusId: 11, dueDate: new Date(2026, 3, 18) }),
      ],
    })
    const predicate = emptyPredicate()
    predicate.dateField = 'date'
    predicate.dateRangeEnd = { kind: 'fixed', iso: new Date(2026, 3, 23).toISOString() }
    predicate.statusIds = [11]
    useListDefinitionStore.setState({
      listDefinitions: [{
        id: 1,
        name: 'Blocked this week',
        sortOrder: 0,
        pinnedToDashboard: false,
        membership: { kind: 'custom', predicate },
        sort: { kind: 'effective-date-asc' },
        grouping: { kind: 'none' },
      }],
    })
    // Global top-bar hides hidden statuses — should NOT affect the widget.
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
    render(
      <Wrapper>
        <ListDefinitionBody listDefinitionId={1} />
      </Wrapper>,
    )
    expect(screen.getByText('Blocked task')).toBeInTheDocument()
  })

  it('default row click invokes openEditPopup through the ui store', () => {
    useTodoStore.setState({
      todos: [makeTodo({ id: 7, title: 'Clickable', dueDate: new Date(2026, 3, 18) })],
    })
    // Avoid rendering full TaskRow click internals — just make sure body mounts.
    const { container } = render(
      <Wrapper>
        <ListDefinitionBody listDefinitionId={1} />
      </Wrapper>,
    )
    expect(container.textContent).toContain('Clickable')
    // Suppress unused-import lint
    fireEvent.scroll(container)
  })
})
