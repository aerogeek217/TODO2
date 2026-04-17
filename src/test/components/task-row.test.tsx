import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { TaskRow } from '../../components/task/TaskRow'
import { usePersonStore } from '../../stores/person-store'
import { useTagStore } from '../../stores/tag-store'
import { useOrgStore } from '../../stores/org-store'
import { useStatusStore } from '../../stores/status-store'
import { useProjectStore } from '../../stores/project-store'
import { useTaskboardStore } from '../../stores/taskboard-store'
import { makeTodo } from '../helpers'

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
    quickAssignTag: vi.fn(),
    quickUnassignTag: vi.fn(),
    quickAssignOrg: vi.fn(),
    quickUnassignOrg: vi.fn(),
  }),
}))

function getRow(): HTMLElement {
  return document.querySelector('[data-todo-id]') as HTMLElement
}

function resetStores() {
  usePersonStore.setState({ people: [], assignedPeopleMap: new Map() })
  useTagStore.setState({ tags: [] })
  useOrgStore.setState({ orgs: [], assignedOrgsMap: new Map(), personOrgMap: new Map() })
  useStatusStore.setState({ statuses: [] })
  useProjectStore.setState({ projects: [] })
  useTaskboardStore.setState({ entries: [] })
}

describe('TaskRow (unified scheduling)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 3, 16)) // April 16, 2026 (Thursday)
    resetStores()
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  describe('priority removal', () => {
    it('renders no priority dot in the row', () => {
      const { container } = render(<TaskRow todo={makeTodo({ id: 1 })} />)
      expect(container.querySelector('[class*="priorityDot"]')).toBeNull()
      expect(container.querySelector('[class*="priority"]')).toBeNull()
    })
  })

  describe('scheduled chip', () => {
    it('renders with fuzzy label when scheduledDate is fuzzy', () => {
      render(<TaskRow todo={makeTodo({ id: 1, scheduledDate: { kind: 'fuzzy', token: 'today' } })} />)
      expect(screen.getByText('Today')).toBeInTheDocument()
    })

    it('renders with relative label when scheduledDate is precise', () => {
      render(<TaskRow todo={makeTodo({ id: 1, scheduledDate: { kind: 'date', value: new Date(2026, 3, 17) } })} />)
      expect(screen.getByText('Tomorrow')).toBeInTheDocument()
    })

    it('is absent when scheduledDate is not set', () => {
      const { container } = render(<TaskRow todo={makeTodo({ id: 1 })} />)
      expect(container.querySelector('[class*="scheduledChip"]')).toBeNull()
    })

    it('does not render the empty-state calendar button when scheduledDate is set', () => {
      // When scheduledDate is present, the empty-state "Schedule or set deadline" button is hidden
      const { container } = render(<TaskRow todo={makeTodo({ id: 1, scheduledDate: { kind: 'fuzzy', token: 'today' } })} />)
      expect(container.querySelector('[title="Schedule or set deadline"]')).toBeNull()
    })
  })

  describe('deadline chip', () => {
    it('renders with formatted date when dueDate is set', () => {
      render(<TaskRow todo={makeTodo({ id: 1, dueDate: new Date(2026, 3, 20) })} />)
      expect(screen.getByText(/4\/20\/2026|Apr 20/)).toBeInTheDocument()
    })

    it('is absent when dueDate is not set', () => {
      const { container } = render(<TaskRow todo={makeTodo({ id: 1 })} />)
      expect(container.querySelector('[class*="deadlineChip"]')).toBeNull()
    })

    it('shows the recurrence indicator when recurrenceRule is set on deadline', () => {
      const { container } = render(
        <TaskRow todo={makeTodo({ id: 1, dueDate: new Date(2026, 3, 20), recurrenceRule: { type: 'weekly' } })} />,
      )
      expect(container.querySelector('[class*="recurrenceIndicator"]')).toBeInTheDocument()
    })
  })

  describe('both chips', () => {
    it('renders scheduled and deadline chips simultaneously', () => {
      const { container } = render(
        <TaskRow
          todo={makeTodo({
            id: 1,
            scheduledDate: { kind: 'fuzzy', token: 'today' },
            dueDate: new Date(2026, 3, 20),
          })}
        />,
      )
      expect(container.querySelector('[class*="scheduledChip"]')).toBeInTheDocument()
      expect(container.querySelector('[class*="deadlineChip"]')).toBeInTheDocument()
    })
  })

  describe('empty-state date button', () => {
    it('renders when neither scheduled nor deadline is set', () => {
      render(<TaskRow todo={makeTodo({ id: 1 })} />)
      expect(screen.getByTitle('Schedule or set deadline')).toBeInTheDocument()
    })

    it('does not render when only scheduled is set', () => {
      render(<TaskRow todo={makeTodo({ id: 1, scheduledDate: { kind: 'fuzzy', token: 'today' } })} />)
      expect(screen.queryByTitle('Schedule or set deadline')).not.toBeInTheDocument()
    })

    it('does not render when only deadline is set', () => {
      render(<TaskRow todo={makeTodo({ id: 1, dueDate: new Date(2026, 3, 20) })} />)
      expect(screen.queryByTitle('Schedule or set deadline')).not.toBeInTheDocument()
    })
  })

  describe('context menu', () => {
    it('opens a menu without a filter-by-priority option', () => {
      render(<TaskRow todo={makeTodo({ id: 1 })} />)
      fireEvent.contextMenu(getRow())
      expect(screen.queryByText(/priority/i)).not.toBeInTheDocument()
      expect(screen.getByText(/Taskboard/i)).toBeInTheDocument()
      expect(screen.getByText(/Move to project/i)).toBeInTheDocument()
    })
  })
})
