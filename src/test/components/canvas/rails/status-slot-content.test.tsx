import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { DndContext } from '@dnd-kit/core'
import type { ReactNode } from 'react'
import { db } from '../../../../data/database'
import { StatusSlotContent } from '../../../../components/canvas/rails/StatusSlotContent'
import { useTodoStore } from '../../../../stores/todo-store'
import { usePersonStore } from '../../../../stores/person-store'
import { useOrgStore } from '../../../../stores/org-store'
import { useTagStore } from '../../../../stores/tag-store'
import { useStatusStore } from '../../../../stores/status-store'
import { makeTodo } from '../../../helpers'
import type { Status } from '../../../../models'

vi.mock('../../../../hooks/use-bulk-actions', () => ({
  useBulkActions: () => ({
    toggleComplete: vi.fn(),
    toggleStar: vi.fn(),
    remove: vi.fn(),
    setPriority: vi.fn(),
    setDueDate: vi.fn(),
    setProject: vi.fn(),
    quickAssignPerson: vi.fn(),
    quickUnassignPerson: vi.fn(),
    quickAssignOrg: vi.fn(),
    quickUnassignOrg: vi.fn(),
    quickAssignTag: vi.fn(),
    quickUnassignTag: vi.fn(),
  }),
}))

const STATUS_RED: Status = { id: 1, name: 'Red', color: '#ff0000', icon: 'circle', sortOrder: 1 }
const STATUS_BLUE: Status = { id: 2, name: 'Blue', color: '#0000ff', icon: 'circle', sortOrder: 2 }

function Wrap({ children }: { children: ReactNode }) {
  return <DndContext>{children}</DndContext>
}

beforeEach(async () => {
  await db.delete()
  await db.open()
  useTodoStore.setState({ todos: [], todosVersion: 0, loading: false, error: null })
  usePersonStore.setState({ people: [], assignedPeopleMap: new Map(), loading: false, error: null })
  useOrgStore.setState({ orgs: [], assignedOrgsMap: new Map(), personOrgMap: new Map(), loading: false, error: null })
  useTagStore.setState({ tags: [], assignedTagsMap: new Map(), loading: false, error: null })
  useStatusStore.setState({ statuses: [], loading: false, error: null })
})

afterEach(() => {
  cleanup()
})

describe('StatusSlotContent — empty', () => {
  it('renders an empty hint when no open tasks exist', () => {
    useStatusStore.setState({ statuses: [STATUS_RED] })
    render(<Wrap><StatusSlotContent /></Wrap>)
    expect(screen.getByText(/no open tasks/i)).toBeInTheDocument()
  })
})

describe('StatusSlotContent — click parity with Horizons', () => {
  it('renders one legend row per configured status plus a No-status bucket when needed', () => {
    useStatusStore.setState({ statuses: [STATUS_RED, STATUS_BLUE] })
    useTodoStore.setState({
      todos: [
        makeTodo({ id: 1, statusId: 1 }),
        makeTodo({ id: 2, statusId: 2 }),
        makeTodo({ id: 3, statusId: undefined }),
      ],
      todosVersion: 1,
    })

    render(<Wrap><StatusSlotContent /></Wrap>)
    expect(screen.getByText('Red')).toBeInTheDocument()
    expect(screen.getByText('Blue')).toBeInTheDocument()
    expect(screen.getByText('No status')).toBeInTheDocument()
  })

  it('clicking a legend row reveals tasks for that status; clicking again hides them', () => {
    useStatusStore.setState({ statuses: [STATUS_RED, STATUS_BLUE] })
    useTodoStore.setState({
      todos: [
        makeTodo({ id: 10, title: 'Red one', statusId: 1 }),
        makeTodo({ id: 11, title: 'Red two', statusId: 1 }),
        makeTodo({ id: 12, title: 'Blue one', statusId: 2 }),
      ],
      todosVersion: 1,
    })

    render(<Wrap><StatusSlotContent /></Wrap>)
    // Tasks aren't shown until selection
    expect(screen.queryByText('Red one')).not.toBeInTheDocument()

    const redRow = document.querySelector('[data-status-key="1"]') as HTMLButtonElement
    expect(redRow).toBeTruthy()
    fireEvent.click(redRow)
    expect(screen.getByText('Red one')).toBeInTheDocument()
    expect(screen.getByText('Red two')).toBeInTheDocument()
    expect(screen.queryByText('Blue one')).not.toBeInTheDocument()

    // Click again to deselect — tasks hide
    fireEvent.click(redRow)
    expect(screen.queryByText('Red one')).not.toBeInTheDocument()
  })

  it('clicking a different legend row swaps the visible tasks', () => {
    useStatusStore.setState({ statuses: [STATUS_RED, STATUS_BLUE] })
    useTodoStore.setState({
      todos: [
        makeTodo({ id: 10, title: 'Red one', statusId: 1 }),
        makeTodo({ id: 12, title: 'Blue one', statusId: 2 }),
      ],
      todosVersion: 1,
    })

    render(<Wrap><StatusSlotContent /></Wrap>)
    fireEvent.click(document.querySelector('[data-status-key="1"]') as HTMLButtonElement)
    expect(screen.getByText('Red one')).toBeInTheDocument()
    expect(screen.queryByText('Blue one')).not.toBeInTheDocument()

    fireEvent.click(document.querySelector('[data-status-key="2"]') as HTMLButtonElement)
    expect(screen.queryByText('Red one')).not.toBeInTheDocument()
    expect(screen.getByText('Blue one')).toBeInTheDocument()
  })

  it('selecting the No-status bucket renders only todos missing a statusId', () => {
    useStatusStore.setState({ statuses: [STATUS_RED] })
    useTodoStore.setState({
      todos: [
        makeTodo({ id: 1, title: 'Has status', statusId: 1 }),
        makeTodo({ id: 2, title: 'Free agent', statusId: undefined }),
      ],
      todosVersion: 1,
    })

    render(<Wrap><StatusSlotContent /></Wrap>)
    fireEvent.click(document.querySelector('[data-status-key="unset"]') as HTMLButtonElement)
    expect(screen.getByText('Free agent')).toBeInTheDocument()
    expect(screen.queryByText('Has status')).not.toBeInTheDocument()
  })

  it('completed todos are excluded from the selection body', () => {
    useStatusStore.setState({ statuses: [STATUS_RED] })
    useTodoStore.setState({
      todos: [
        makeTodo({ id: 1, title: 'Open task', statusId: 1 }),
        makeTodo({ id: 2, title: 'Done task', statusId: 1, isCompleted: true }),
      ],
      todosVersion: 1,
    })

    render(<Wrap><StatusSlotContent /></Wrap>)
    fireEvent.click(document.querySelector('[data-status-key="1"]') as HTMLButtonElement)
    expect(screen.getByText('Open task')).toBeInTheDocument()
    expect(screen.queryByText('Done task')).not.toBeInTheDocument()
  })

  it('right-click on a legend row opens a context menu', () => {
    useStatusStore.setState({ statuses: [STATUS_RED] })
    useTodoStore.setState({
      todos: [makeTodo({ id: 1, statusId: 1 })],
      todosVersion: 1,
    })

    render(<Wrap><StatusSlotContent /></Wrap>)
    fireEvent.contextMenu(document.querySelector('[data-status-key="1"]') as HTMLButtonElement)
    // Menu opens with a "Show tasks" item (status not yet selected)
    expect(screen.getByRole('menuitem', { name: /show tasks/i })).toBeInTheDocument()
  })

  it('right-click "Show tasks" toggles selection and reveals tasks', () => {
    useStatusStore.setState({ statuses: [STATUS_RED] })
    useTodoStore.setState({
      todos: [makeTodo({ id: 1, title: 'R', statusId: 1 })],
      todosVersion: 1,
    })

    render(<Wrap><StatusSlotContent /></Wrap>)
    fireEvent.contextMenu(document.querySelector('[data-status-key="1"]') as HTMLButtonElement)
    fireEvent.click(screen.getByRole('menuitem', { name: /show tasks/i }))
    expect(screen.getByText('R')).toBeInTheDocument()
  })
})
