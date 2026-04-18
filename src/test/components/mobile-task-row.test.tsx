import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { MobileTaskRow } from '../../components/task/MobileTaskRow'
import { useOrgStore } from '../../stores/org-store'
import { makeTodo, makePerson, makeTag, makeOrg } from '../helpers'

const mockToggleComplete = vi.fn()
vi.mock('../../hooks/use-bulk-actions', () => ({
  useBulkActions: () => ({
    toggleComplete: mockToggleComplete,
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

/** The row is the element with data-todo-id (avoids matching child buttons) */
function getRow(): HTMLElement {
  return document.querySelector('[data-todo-id]') as HTMLElement
}

describe('MobileTaskRow', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 3, 11)) // April 11, 2026
    vi.clearAllMocks()
    useOrgStore.setState({ assignedOrgsMap: new Map() })
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  // ── Rendering basics ──────────────────────────────────────────────

  describe('rendering', () => {
    it('renders task title', () => {
      render(<MobileTaskRow todo={makeTodo({ id: 1, title: 'Buy groceries' })} />)
      expect(screen.getByText('Buy groceries')).toBeInTheDocument()
    })

    it('renders unchecked checkbox for incomplete task', () => {
      render(<MobileTaskRow todo={makeTodo({ id: 1 })} />)
      expect(screen.getByRole('checkbox', { name: 'Toggle complete' })).not.toBeChecked()
    })

    it('renders checked checkbox for completed task', () => {
      render(<MobileTaskRow todo={makeTodo({ id: 1, isCompleted: true })} />)
      expect(screen.getByRole('checkbox', { name: 'Toggle complete' })).toBeChecked()
    })

    it('shows status button with "Set status" label when no status', () => {
      render(<MobileTaskRow todo={makeTodo({ id: 1 })} />)
      expect(screen.getByLabelText('Set status')).toBeInTheDocument()
    })

    it('renders detail chevron button', () => {
      render(<MobileTaskRow todo={makeTodo({ id: 1 })} />)
      expect(screen.getByLabelText('Open task details')).toBeInTheDocument()
    })

    it('sets data-todo-id on the row', () => {
      render(<MobileTaskRow todo={makeTodo({ id: 42 })} />)
      expect(getRow()).toHaveAttribute('data-todo-id', '42')
    })
  })

  // ── Date chips ────────────────────────────────────────────────────

  describe('date chips', () => {
    it('shows deadline chip with formatted date', () => {
      const year = new Date().getFullYear()
      render(<MobileTaskRow todo={makeTodo({ id: 1, dueDate: new Date(year, 3, 11) })} />)
      expect(screen.getByText(/Apr 11$/)).toBeInTheDocument()
    })

    it('shows scheduled chip label for fuzzy token', () => {
      render(<MobileTaskRow todo={makeTodo({ id: 1, scheduledDate: { kind: 'fuzzy', token: 'today' } })} />)
      expect(screen.getByText('Today')).toBeInTheDocument()
    })

    it('renders no date chip when neither scheduled nor due is set', () => {
      render(<MobileTaskRow todo={makeTodo({ id: 1 })} />)
      expect(screen.queryByText(/Apr/)).not.toBeInTheDocument()
      expect(screen.queryByText('Today')).not.toBeInTheDocument()
    })

    it('shows recurrence indicator inside deadline chip when recurrenceRule is set', () => {
      const year = new Date().getFullYear()
      render(<MobileTaskRow todo={makeTodo({ id: 1, dueDate: new Date(year, 3, 11), recurrenceRule: { type: 'weekly' } })} />)
      const chip = screen.getByText(/Apr 11/)
      expect(chip.textContent).toContain('\u21bb')
    })
  })

  // ── Metadata chips ────────────────────────────────────────────────

  describe('metadata', () => {
    it('shows people initials', () => {
      const people = [
        makePerson({ id: 1, name: 'Alice', initials: 'AL' }),
        makePerson({ id: 2, name: 'Bob', initials: 'BO' }),
      ]
      render(<MobileTaskRow todo={makeTodo({ id: 1 })} assignedPeople={people} />)
      expect(screen.getByText('AL')).toBeInTheDocument()
      expect(screen.getByText('BO')).toBeInTheDocument()
    })

    it('shows overflow count for 3+ people (max 2 shown)', () => {
      const people = [
        makePerson({ id: 1, initials: 'A' }),
        makePerson({ id: 2, initials: 'B' }),
        makePerson({ id: 3, initials: 'C' }),
      ]
      render(<MobileTaskRow todo={makeTodo({ id: 1 })} assignedPeople={people} />)
      expect(screen.getByText('A')).toBeInTheDocument()
      expect(screen.getByText('B')).toBeInTheDocument()
      expect(screen.getByText('+1')).toBeInTheDocument()
      expect(screen.queryByText('C')).not.toBeInTheDocument()
    })

    it('shows first tag name', () => {
      render(<MobileTaskRow todo={makeTodo({ id: 1 })} assignedTags={[makeTag({ id: 1, name: 'Bug' })]} />)
      expect(screen.getByText('Bug')).toBeInTheDocument()
    })

    it('shows overflow count for 2+ tags (max 1 shown)', () => {
      const tags = [makeTag({ id: 1, name: 'Bug' }), makeTag({ id: 2, name: 'Feature' })]
      render(<MobileTaskRow todo={makeTodo({ id: 1 })} assignedTags={tags} />)
      expect(screen.getByText('Bug')).toBeInTheDocument()
      expect(screen.getByText('+1')).toBeInTheDocument()
      expect(screen.queryByText('Feature')).not.toBeInTheDocument()
    })

    it('shows org name from store', () => {
      useOrgStore.setState({ assignedOrgsMap: new Map([[1, [makeOrg({ id: 5, name: 'Acme' })]]]) })
      render(<MobileTaskRow todo={makeTodo({ id: 1 })} />)
      expect(screen.getByText('Acme')).toBeInTheDocument()
    })

    it('shows progress text and bar', () => {
      render(<MobileTaskRow todo={makeTodo({ id: 1, progress: '50%' })} />)
      expect(screen.getByText(/50%/)).toBeInTheDocument()
    })

    it('shows notes icon when notes present', () => {
      const { container } = render(<MobileTaskRow todo={makeTodo({ id: 1, notes: 'Some notes' })} />)
      expect(container.querySelector('[class*="notesIcon"]')).toBeInTheDocument()
    })

    it('renders no notes icon when notes absent', () => {
      const { container } = render(<MobileTaskRow todo={makeTodo({ id: 1 })} />)
      expect(container.querySelector('[class*="notesIcon"]')).not.toBeInTheDocument()
    })
  })

  // ── Callbacks ─────────────────────────────────────────────────────

  describe('callbacks', () => {
    it('calls onSelect with todo id on row click', () => {
      const onSelect = vi.fn()
      render(<MobileTaskRow todo={makeTodo({ id: 7 })} onSelect={onSelect} />)
      fireEvent.click(getRow())
      expect(onSelect).toHaveBeenCalledWith(7, { shift: false, ctrl: false })
    })

    it('calls onOpenDetail on chevron click', () => {
      const onOpenDetail = vi.fn()
      render(<MobileTaskRow todo={makeTodo({ id: 3 })} onOpenDetail={onOpenDetail} />)
      fireEvent.click(screen.getByLabelText('Open task details'))
      expect(onOpenDetail).toHaveBeenCalledWith(3)
    })

    it('calls onToggleExpand on expand button click', () => {
      const onToggleExpand = vi.fn()
      render(<MobileTaskRow todo={makeTodo({ id: 4 })} hasChildren isExpanded onToggleExpand={onToggleExpand} />)
      fireEvent.click(screen.getByLabelText('Toggle subtasks'))
      expect(onToggleExpand).toHaveBeenCalledWith(4)
    })

    it('calls toggleComplete on checkbox click', () => {
      render(<MobileTaskRow todo={makeTodo({ id: 5 })} />)
      fireEvent.click(screen.getByRole('checkbox', { name: 'Toggle complete' }))
      expect(mockToggleComplete).toHaveBeenCalledWith(5)
    })

    it('chevron click does not trigger row onSelect', () => {
      const onSelect = vi.fn()
      render(<MobileTaskRow todo={makeTodo({ id: 1 })} onSelect={onSelect} />)
      fireEvent.click(screen.getByLabelText('Open task details'))
      expect(onSelect).not.toHaveBeenCalled()
    })
  })

  // ── Ghost mode ────────────────────────────────────────────────────

  describe('ghost mode', () => {
    it('does not call toggleComplete', () => {
      render(<MobileTaskRow todo={makeTodo({ id: 1 })} ghost />)
      fireEvent.click(screen.getByRole('checkbox', { name: 'Toggle complete' }))
      expect(mockToggleComplete).not.toHaveBeenCalled()
    })

  })

  // ── Expand toggle and indent ──────────────────────────────────────

  describe('expand and indent', () => {
    it('shows expand toggle when hasChildren', () => {
      render(<MobileTaskRow todo={makeTodo({ id: 1 })} hasChildren isExpanded />)
      expect(screen.getByLabelText('Toggle subtasks')).toBeInTheDocument()
    })

    it('hides expand toggle without children', () => {
      render(<MobileTaskRow todo={makeTodo({ id: 1 })} />)
      expect(screen.queryByLabelText('Toggle subtasks')).not.toBeInTheDocument()
    })

    it('sets aria-expanded to true when expanded', () => {
      render(<MobileTaskRow todo={makeTodo({ id: 1 })} hasChildren isExpanded />)
      expect(screen.getByLabelText('Toggle subtasks')).toHaveAttribute('aria-expanded', 'true')
    })

    it('sets aria-expanded to false when collapsed', () => {
      render(<MobileTaskRow todo={makeTodo({ id: 1 })} hasChildren isExpanded={false} />)
      expect(screen.getByLabelText('Toggle subtasks')).toHaveAttribute('aria-expanded', 'false')
    })

    it('applies indent padding for indentLevel > 0', () => {
      render(<MobileTaskRow todo={makeTodo({ id: 1 })} indentLevel={2} />)
      expect(getRow()).toHaveStyle({ paddingLeft: '36px' })
    })

    it('applies no indent padding for level 0', () => {
      render(<MobileTaskRow todo={makeTodo({ id: 1 })} indentLevel={0} />)
      expect(getRow().getAttribute('style')).toBeNull()
    })
  })
})
