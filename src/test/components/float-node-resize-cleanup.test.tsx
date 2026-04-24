import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/react'
import { DndContext } from '@dnd-kit/core'
import { ReactFlowProvider } from '@xyflow/react'
import type { ReactNode } from 'react'
import { ListInsetNode, type ListInsetNodeData } from '../../components/canvas/ListInsetNode'
import type { ListInset } from '../../models'
import type { PersistedListDefinition } from '../../models/list-definition'
import { usePersonStore } from '../../stores/person-store'
import { useOrgStore } from '../../stores/org-store'
import { useStatusStore } from '../../stores/status-store'
import { useProjectStore } from '../../stores/project-store'
import { useFilterStore } from '../../stores/filter-store'
import { useListDefinitionStore, emptyPredicate } from '../../stores/list-definition-store'
import { useTodoStore } from '../../stores/todo-store'
import styles from '../../components/canvas/ListInsetNode.module.css'

vi.mock('../../hooks/use-bulk-actions', () => ({
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
  return (
    <ReactFlowProvider>
      <DndContext>{children}</DndContext>
    </ReactFlowProvider>
  )
}

function emptyDef(): PersistedListDefinition {
  return {
    id: 1,
    name: 'Empty',
    sortOrder: 0,
    pinnedToDashboard: false,
    favorited: false,
    membership: { kind: 'custom', predicate: emptyPredicate() },
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
  useListDefinitionStore.setState({ listDefinitions: [emptyDef()] })
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

function makeInset(overrides: Partial<ListInset> = {}): ListInset {
  return {
    id: 1,
    listDefinitionId: 1,
    canvasId: 1,
    x: 0,
    y: 0,
    width: 280,
    height: 400,
    isCollapsed: false,
    ...overrides,
  }
}

function renderInset() {
  const data: ListInsetNodeData = {
    inset: makeInset(),
    allTodos: [],
    assignedPeopleMap: new Map(),
    assignedOrgsMap: new Map(),
    personOrgMap: new Map(),
    onDelete: vi.fn(),
    onToggleCollapse: vi.fn(),
    onResize: vi.fn(),
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const NodeComp = ListInsetNode as any
  return render(
    <Wrapper>
      <NodeComp id="inset-1" type="listInset" data={data} dragging={false} selectable={false} deletable zIndex={0} isConnectable={false} xPos={0} yPos={0} selected={false} />
    </Wrapper>,
  )
}

function firePointerDown(el: Element, clientX: number, clientY: number) {
  fireEvent.pointerDown(el, { pointerId: 1, isPrimary: true, button: 0, bubbles: true, clientX, clientY })
}

describe('floating-node resize cleanup (H2 + L7)', () => {
  let addSpy: ReturnType<typeof vi.spyOn>
  let removeSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    resetStores()
    addSpy = vi.spyOn(window, 'addEventListener')
    removeSpy = vi.spyOn(window, 'removeEventListener')
  })

  afterEach(() => {
    addSpy.mockRestore()
    removeSpy.mockRestore()
    cleanup()
  })

  function windowMouseOrPointerAdds(): string[] {
    return addSpy.mock.calls
      .map((c: unknown[]) => String(c[0]))
      .filter((e: string) => e === 'mousemove' || e === 'mouseup' || e === 'pointermove' || e === 'pointerup')
  }

  it('does not attach mouse/pointer listeners to window on resize-handle pointerdown (right edge)', () => {
    const { container } = renderInset()
    const handle = container.querySelector('.' + styles.resizeHandle)
    expect(handle).toBeTruthy()
    const beforeCount = windowMouseOrPointerAdds().length
    firePointerDown(handle!, 100, 100)
    expect(windowMouseOrPointerAdds().length).toBe(beforeCount)
  })

  it('does not attach mouse/pointer listeners to window on resize-handle pointerdown (bottom edge)', () => {
    const { container } = renderInset()
    const handle = container.querySelector('.' + styles.bottomHandle)
    expect(handle).toBeTruthy()
    const beforeCount = windowMouseOrPointerAdds().length
    firePointerDown(handle!, 100, 400)
    expect(windowMouseOrPointerAdds().length).toBe(beforeCount)
  })

  it('does not attach mouse/pointer listeners to window on resize-handle pointerdown (corner)', () => {
    const { container } = renderInset()
    const handle = container.querySelector('.' + styles.cornerHandle)
    expect(handle).toBeTruthy()
    const beforeCount = windowMouseOrPointerAdds().length
    firePointerDown(handle!, 280, 400)
    expect(windowMouseOrPointerAdds().length).toBe(beforeCount)
  })

  it('leaks no window listeners when the floating node unmounts mid-drag', () => {
    const { container, unmount } = renderInset()
    const handle = container.querySelector('.' + styles.resizeHandle)
    expect(handle).toBeTruthy()
    firePointerDown(handle!, 100, 100)
    const windowAddsDuringDrag = windowMouseOrPointerAdds()
    unmount()
    // Even under the previous bug, unmount would not have fired the window
    // `mouseup` listener — it would have lingered. With pointer capture on
    // the handle, no window listener was ever attached, so there's nothing
    // to leak.
    expect(windowAddsDuringDrag.length).toBe(0)
  })
})
