import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent, cleanup, screen } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import { DndContext } from '@dnd-kit/core'
import type { ReactNode } from 'react'
import { ProjectNode, type ProjectNodeData } from '../../../components/canvas/ProjectNode'
import { useProjectStore } from '../../../stores/project-store'
import { useStatusStore } from '../../../stores/status-store'
import { useTodoStore } from '../../../stores/todo-store'
import { DragInsertContext, DragPreviewContext } from '../../../components/canvas/DragInsertContext'
import { makeProject, makeTodo } from '../../helpers'

/**
 * P11 — UI test for the group-by picker on ProjectNode.
 *
 * task-grouping P5 added the ⊟ button + popover but had no UI test asserting
 * the click flow drives `useProjectStore.updateProjectGrouping`. The pure
 * unit tests in `project-node-sort.test.ts` only cover `GROUP_OPTIONS` shape
 * and `sortProjectTasks` — not the picker wiring. This file closes the gap.
 */

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
    quickAssignTag: vi.fn(),
    quickUnassignTag: vi.fn(),
  }),
}))

const idleDragInsert = { activeDragTodoId: null, dragExpandedProjectId: null, dragSelectionIds: null }
const idlePreview = { insertTodoId: null, insertAtEnd: false, insertProjectId: null }

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <ReactFlowProvider>
      <DndContext>
        <DragInsertContext.Provider value={idleDragInsert}>
          <DragPreviewContext.Provider value={idlePreview}>
            {children}
          </DragPreviewContext.Provider>
        </DragInsertContext.Provider>
      </DndContext>
    </ReactFlowProvider>
  )
}

function renderProjectNode(data?: Partial<ProjectNodeData>) {
  const merged: ProjectNodeData = {
    project: makeProject({ id: 5, canvasId: 1, name: 'Group target' }),
    todos: [makeTodo({ id: 1, title: 'Row' })],
    assignedPeopleMap: new Map(),
    onAddTask: vi.fn(),
    onDeleteProject: vi.fn(),
    onRenameProject: vi.fn(),
    onToggleCollapse: vi.fn(),
    ...data,
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const NodeComp = ProjectNode as any
  return render(
    <Wrapper>
      <NodeComp
        id="project-5"
        type="project"
        data={merged}
        dragging={false}
        selectable={false}
        deletable
        zIndex={0}
        xPos={0}
        yPos={0}
        selected={false}
        isConnectable={false}
      />
    </Wrapper>,
  )
}

describe('ProjectNode group-by picker', () => {
  beforeEach(() => {
    useStatusStore.setState({ statuses: [], loading: false, error: null })
    useTodoStore.setState({ todos: [], todosVersion: 0, loading: false, error: null })
    useProjectStore.setState({ projects: [], loading: false, error: null })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('opens on ⊟ click and lists every GROUP_OPTIONS entry', () => {
    renderProjectNode()
    fireEvent.click(screen.getByTitle('Group tasks'))
    // Each label appears as a button inside the menu.
    for (const label of ['None', 'Effective Date', 'Scheduled', 'Deadline', 'Status', 'People', 'Org', 'Tag']) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
  })

  it('clicking an option dispatches updateProjectGrouping with the picked value', () => {
    const updateProjectGrouping = vi.fn().mockResolvedValue(undefined)
    vi.spyOn(useProjectStore, 'getState').mockReturnValue({
      updateProjectGrouping,
    } as unknown as ReturnType<typeof useProjectStore.getState>)

    renderProjectNode()
    fireEvent.click(screen.getByTitle('Group tasks'))
    fireEvent.click(screen.getByText('People'))

    expect(updateProjectGrouping).toHaveBeenCalledWith(5, 'people')
  })

  it('clicking None passes null (clears grouping)', () => {
    const updateProjectGrouping = vi.fn().mockResolvedValue(undefined)
    vi.spyOn(useProjectStore, 'getState').mockReturnValue({
      updateProjectGrouping,
    } as unknown as ReturnType<typeof useProjectStore.getState>)

    renderProjectNode({
      project: makeProject({ id: 5, canvasId: 1, name: 'Group target', groupBy: 'status' }),
    })
    fireEvent.click(screen.getByTitle('Group tasks'))
    fireEvent.click(screen.getByText('None'))

    expect(updateProjectGrouping).toHaveBeenCalledWith(5, null)
  })

  it('marks the active option with the active class', () => {
    const { container } = renderProjectNode({
      project: makeProject({ id: 5, canvasId: 1, name: 'Group target', groupBy: 'status' }),
    })
    fireEvent.click(screen.getByTitle('Group tasks'))
    const statusBtn = screen.getByText('Status')
    // The active class name is generated by CSS modules. Just check the button
    // has an extra class beyond the base groupOption.
    const classList = (statusBtn.className || '').split(/\s+/).filter(Boolean)
    expect(classList.length).toBeGreaterThan(1)
    // Verify None is NOT marked active in this case — its className matches
    // the un-marked base shape (single class).
    const noneBtn = screen.getByText('None')
    const noneClasses = (noneBtn.className || '').split(/\s+/).filter(Boolean)
    expect(noneClasses.length).toBeLessThan(classList.length)
    // Suppress unused-import lint
    expect(container).toBeTruthy()
  })
})
