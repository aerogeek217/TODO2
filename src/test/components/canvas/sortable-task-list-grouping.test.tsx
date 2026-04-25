import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, screen } from '@testing-library/react'
import { DndContext } from '@dnd-kit/core'
import type { ReactNode } from 'react'
import { SortableTaskList } from '../../../components/canvas/SortableTaskList'
import { DragInsertContext, DragPreviewContext } from '../../../components/canvas/DragInsertContext'
import { useStatusStore } from '../../../stores/status-store'
import { useOrgStore } from '../../../stores/org-store'
import { usePersonStore } from '../../../stores/person-store'
import { useProjectStore } from '../../../stores/project-store'
import { useTodoStore } from '../../../stores/todo-store'
import { useUIStore } from '../../../stores/ui-store'
import { useTaskboardStore } from '../../../stores/taskboard-store'
import type { Status, PersistedTodoItem } from '../../../models'
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

const STATUSES: Status[] = [
  { id: 1, name: 'Active', color: '#0a0', sortOrder: 0 },
  { id: 2, name: 'Blocked', color: '#a00', sortOrder: 1 },
]

function resetStores() {
  useStatusStore.setState({ statuses: STATUSES })
  useOrgStore.setState({ orgs: [], assignedOrgsMap: new Map(), personOrgMap: new Map() })
  usePersonStore.setState({ people: [], assignedPeopleMap: new Map() })
  useProjectStore.setState({ projects: [] })
  useTaskboardStore.setState({ board: null })
  useUIStore.setState({
    selectedTodoIds: new Set(),
    focusedTodoId: null,
    inlineCreateAfterId: null,
    clipboardTodoIds: [],
    clipboardSourceProjectId: null,
    hoveredTodoId: null,
  } as Partial<ReturnType<typeof useUIStore.getState>>)
  useTodoStore.setState({ todos: [] })
}

const idleDragInsert = { activeDragTodoId: null, dragExpandedProjectId: null, dragSelectionIds: null }
const idlePreview = { insertTodoId: null, insertAtEnd: false, insertProjectId: null }

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <DndContext>
      <DragInsertContext.Provider value={idleDragInsert}>
        <DragPreviewContext.Provider value={idlePreview}>
          {children}
        </DragPreviewContext.Provider>
      </DragInsertContext.Provider>
    </DndContext>
  )
}

/** Find the TaskGroup section for a label, then return the visible todo IDs inside it. */
function rowIdsInGroup(label: string): number[] {
  const region = screen.getByRole('region', { name: label })
  return Array.from(region.querySelectorAll<HTMLElement>('[data-stl-row]'))
    .map((el) => Number(el.dataset.stlRow))
}

describe('SortableTaskList — grouped render', () => {
  beforeEach(() => {
    resetStores()
  })

  afterEach(() => cleanup())

  it('renders one TaskGroup per non-empty status, with todos partitioned by statusId', () => {
    const todos: PersistedTodoItem[] = [
      makeTodo({ id: 1, statusId: 1, sortOrder: 1 }),
      makeTodo({ id: 2, statusId: 2, sortOrder: 2 }),
      makeTodo({ id: 3, statusId: 1, sortOrder: 3 }),
    ]
    render(
      <Wrapper>
        <SortableTaskList projectId={10} todos={todos} groupBy="status" />
      </Wrapper>,
    )

    expect(rowIdsInGroup('Active')).toEqual([1, 3])
    expect(rowIdsInGroup('Blocked')).toEqual([2])
  })

  it('routes status-less todos into the ungrouped block above the named groups', () => {
    const todos: PersistedTodoItem[] = [
      makeTodo({ id: 1, sortOrder: 1 }),                   // ungrouped
      makeTodo({ id: 2, statusId: 1, sortOrder: 2 }),
      makeTodo({ id: 3, statusId: 2, sortOrder: 3 }),
    ]
    const { container } = render(
      <Wrapper>
        <SortableTaskList projectId={10} todos={todos} groupBy="status" />
      </Wrapper>,
    )

    // Ungrouped row is NOT inside any region.
    const allRows = Array.from(container.querySelectorAll<HTMLElement>('[data-stl-row]'))
    const ungroupedRow = allRows.find((el) => Number(el.dataset.stlRow) === 1)!
    expect(ungroupedRow.closest('section[aria-label]')).toBeNull()

    // The two named groups still render in status sortOrder.
    expect(rowIdsInGroup('Active')).toEqual([2])
    expect(rowIdsInGroup('Blocked')).toEqual([3])

    // The ungrouped row precedes the first named group in document order.
    const firstRegion = screen.getAllByRole('region')[0]!
    expect(
      ungroupedRow.compareDocumentPosition(firstRegion) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('preserves the flat single-context render when groupBy is null', () => {
    const todos: PersistedTodoItem[] = [
      makeTodo({ id: 1, statusId: 1, sortOrder: 1 }),
      makeTodo({ id: 2, statusId: 2, sortOrder: 2 }),
    ]
    render(
      <Wrapper>
        <SortableTaskList projectId={10} todos={todos} groupBy={null} />
      </Wrapper>,
    )
    expect(screen.queryByRole('region')).toBeNull()
  })

  it('cross-group drag effect — sortOrder change without statusId change keeps the row in its original group', () => {
    // Initial state: todo 1 in Active (status 1), todo 2 in Blocked (status 2).
    const initial: PersistedTodoItem[] = [
      makeTodo({ id: 1, statusId: 1, sortOrder: 1 }),
      makeTodo({ id: 2, statusId: 2, sortOrder: 2 }),
    ]
    const { rerender } = render(
      <Wrapper>
        <SortableTaskList projectId={10} todos={initial} groupBy="status" />
      </Wrapper>,
    )
    expect(rowIdsInGroup('Active')).toEqual([1])
    expect(rowIdsInGroup('Blocked')).toEqual([2])

    // Simulate a "drag from Active to Blocked": dnd-kit cross-context drop
    // would mutate sortOrder (and ONLY sortOrder — statusId stays put because
    // partition is purely visual). Re-render with todo 1's sortOrder bumped
    // past todo 2 — it'd be visually positioned below todo 2 in a flat list,
    // but since statusId=1 hasn't changed it must remain in the Active group.
    const afterDrag: PersistedTodoItem[] = [
      { ...initial[0]!, sortOrder: 99 },
      initial[1]!,
    ]
    rerender(
      <Wrapper>
        <SortableTaskList projectId={10} todos={afterDrag} groupBy="status" />
      </Wrapper>,
    )

    expect(rowIdsInGroup('Active')).toEqual([1])
    expect(rowIdsInGroup('Blocked')).toEqual([2])
  })
})
