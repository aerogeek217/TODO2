import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import { MobileTaskRow } from '../../components/task/MobileTaskRow'
import { useOrgStore } from '../../stores/org-store'
import { useTaskboardStore } from '../../stores/taskboard-store'
import { useUIStore } from '../../stores/ui-store'
import { makeTodo, makePerson, makeOrg } from '../helpers'

const mockToggleComplete = vi.fn()
const mockRemove = vi.fn()
vi.mock('../../hooks/use-bulk-actions', () => ({
  useBulkActions: () => ({
    toggleComplete: mockToggleComplete,
    remove: mockRemove,
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

    it('shows overflow count for 4+ people (avatar stack shows 3)', () => {
      const people = [
        makePerson({ id: 1, initials: 'A' }),
        makePerson({ id: 2, initials: 'B' }),
        makePerson({ id: 3, initials: 'C' }),
        makePerson({ id: 4, initials: 'D' }),
      ]
      render(<MobileTaskRow todo={makeTodo({ id: 1 })} assignedPeople={people} />)
      expect(screen.getByText('A')).toBeInTheDocument()
      expect(screen.getByText('B')).toBeInTheDocument()
      expect(screen.getByText('C')).toBeInTheDocument()
      expect(screen.getByText('+1')).toBeInTheDocument()
      expect(screen.queryByText('D')).not.toBeInTheDocument()
    })

    it('shows org initials from store via hollow AvatarStack', () => {
      useOrgStore.setState({
        assignedOrgsMap: new Map([[1, [makeOrg({ id: 5, name: 'Acme', initials: 'AC' })]]]),
      })
      const { container } = render(<MobileTaskRow todo={makeTodo({ id: 1 })} />)
      const hollow = container.querySelector('[class*="avatarHollow"]') as HTMLElement
      expect(hollow).not.toBeNull()
      expect(hollow.textContent).toBe('AC')
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

  // ── Tags display rule ─────────────────────────────────────────────

  describe('tags display rule', () => {
    // Display rule: tags power search / filter / grouping only. They must
    // never surface in the row. Regression-locked against accidental chip
    // additions that would read from the tag registry + assignedTagsMap.
    it('renders no text matching any tag name when the registry has assignments for the row', async () => {
      const { useTagStore } = await import('../../stores/tag-store')
      useTagStore.setState({
        tags: [
          { id: 1, name: 'alpha', color: '#111' },
          { id: 2, name: 'beta', color: '#222' },
        ],
        assignedTagsMap: new Map([
          [1, [
            { id: 1, name: 'alpha', color: '#111' },
            { id: 2, name: 'beta', color: '#222' },
          ]],
        ]),
        loading: false,
        error: null,
      })

      const { container } = render(
        <MobileTaskRow todo={makeTodo({ id: 1, title: 'Prepare deck' })} />,
      )
      expect(container.textContent ?? '').not.toMatch(/alpha/i)
      expect(container.textContent ?? '').not.toMatch(/beta/i)
      expect(screen.queryByText(/^#?alpha$/)).toBeNull()
      expect(screen.queryByText(/^#?beta$/)).toBeNull()
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

  // ── Phase 6 parity ────────────────────────────────────────────────
  //
  // Mobile gains chip taps, a notes-icon trigger, and an `onContextMenu`
  // handler that mirrors the desktop right-click menu. On real touch devices
  // long-press fires the same `contextmenu` event, so the interactive surface
  // is identical to TaskRow.

  describe('Phase 6 parity', () => {
    beforeEach(() => {
      useTaskboardStore.setState({ board: null, loading: false, error: null })
    })

    it('exposes scheduled chip as a button (tap → opens scheduled menu)', () => {
      render(<MobileTaskRow todo={makeTodo({ id: 1, scheduledDate: { kind: 'fuzzy', token: 'today' } })} />)
      const chip = screen.getByLabelText('Edit scheduled')
      expect(chip.tagName).toBe('BUTTON')
    })

    it('exposes deadline chip as a button (tap → opens deadline picker)', () => {
      const year = new Date().getFullYear()
      render(<MobileTaskRow todo={makeTodo({ id: 1, dueDate: new Date(year, 3, 11) })} />)
      const chip = screen.getByLabelText('Edit deadline')
      expect(chip.tagName).toBe('BUTTON')
    })

    it('exposes the notes icon as a button (tap → opens notes popover)', () => {
      const { container } = render(<MobileTaskRow todo={makeTodo({ id: 1, notes: 'note text' })} />)
      const notes = container.querySelector('[class*="notesIcon"]') as HTMLElement
      expect(notes.tagName).toBe('BUTTON')
    })

    it('opens the context menu on right-click / long-press', () => {
      render(<MobileTaskRow todo={makeTodo({ id: 1, title: 'Foo' })} />)
      act(() => {
        fireEvent.contextMenu(getRow(), { clientX: 50, clientY: 50 })
      })
      expect(screen.getByRole('button', { name: 'Mark complete' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /Add to Taskboard|Remove from Taskboard/ })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Move to project…' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument()
    })

    it('Add to Taskboard menu action targets the row todo', () => {
      const add = vi.fn()
      vi.spyOn(useTaskboardStore, 'getState').mockReturnValue({ has: () => false, add } as never)
      render(<MobileTaskRow todo={makeTodo({ id: 42, title: 'Foo' })} />)
      act(() => {
        fireEvent.contextMenu(getRow(), { clientX: 50, clientY: 50 })
      })
      fireEvent.click(screen.getByRole('button', { name: 'Add to Taskboard' }))
      expect(add).toHaveBeenCalledWith(42)
    })

    it('Delete menu action routes through bulk.remove (which queues the confirm dialog)', () => {
      mockRemove.mockClear()
      vi.spyOn(useTaskboardStore, 'getState').mockReturnValue({ has: () => false, add: vi.fn(), removeEntry: vi.fn() } as never)
      render(<MobileTaskRow todo={makeTodo({ id: 7, title: 'Foo' })} />)
      act(() => {
        fireEvent.contextMenu(getRow(), { clientX: 50, clientY: 50 })
      })
      fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
      expect(mockRemove).toHaveBeenCalledWith(7)
    })

    it('does not open the context menu in ghost mode', () => {
      render(<MobileTaskRow todo={makeTodo({ id: 1, title: 'Foo' })} ghost />)
      act(() => {
        fireEvent.contextMenu(getRow(), { clientX: 50, clientY: 50 })
      })
      expect(screen.queryByRole('button', { name: 'Mark complete' })).toBeNull()
    })

    afterEach(() => {
      vi.restoreAllMocks()
      useUIStore.getState().clearBulkConfirmation?.()
    })
  })

})
