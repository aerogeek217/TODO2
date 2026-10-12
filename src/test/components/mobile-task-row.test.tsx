import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import { MobileTaskRow } from '../../components/task/MobileTaskRow'
import { useUIStore } from '../../stores/ui-store'
import { useTagStore } from '../../stores/tag-store'
import { makeTodo, makePerson } from '../helpers'

const mockToggleComplete = vi.fn()
const mockRemove = vi.fn()
const mockQuickAssignTag = vi.fn()
const mockQuickUnassignTag = vi.fn()
const mockSetFocus = vi.fn()
vi.mock('../../hooks/use-bulk-actions', () => ({
  useBulkActions: () => ({
    toggleComplete: mockToggleComplete,
    remove: mockRemove,
    setFocus: mockSetFocus,
    setDeadline: vi.fn(),
    setStatus: vi.fn(),
    quickAssignPerson: vi.fn(),
    quickUnassignPerson: vi.fn(),
    quickAssignTag: mockQuickAssignTag,
    quickUnassignTag: mockQuickUnassignTag,
  }),
}))

/** The row is the element with data-todo-id (avoids matching child buttons) */
function getRow(): HTMLElement {
  return document.querySelector('[data-todo-id]') as HTMLElement
}

// April 11, 2026 — matches `vi.setSystemTime`.
const TODAY = new Date(2026, 3, 11)

describe('MobileTaskRow', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(TODAY)
    vi.clearAllMocks()
    // Some tests seed tag assignments for todo 1; no test may inherit them.
    useTagStore.setState(useTagStore.getInitialState(), true)
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

    it('renders no date chip when no due date is set', () => {
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

  // ── Inline tag chip ──────────────────────────────────────────────
  //
  // Assigned tags render as `#name` chips alongside the people avatars.
  // Mobile shows the empty `#` trigger always (no row hover state), so
  // it's renderable even with no other metadata.

  describe('inline tag chip', () => {
    it('renders #name chips for each assigned tag', () => {
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
      render(<MobileTaskRow todo={makeTodo({ id: 1, title: 'Prepare deck' })} />)
      expect(screen.getByText('#alpha')).toBeInTheDocument()
      expect(screen.getByText('#beta')).toBeInTheDocument()
    })

    it('renders the empty-state # trigger when no metadata is set', () => {
      useTagStore.setState({
        tags: [{ id: 1, name: 'alpha', color: '#111' }],
        assignedTagsMap: new Map(),
        loading: false,
        error: null,
      })
      render(<MobileTaskRow todo={makeTodo({ id: 1 })} />)
      expect(screen.getByLabelText('Add tag')).toBeInTheDocument()
    })
  })

  // ── Ghost mode ────────────────────────────────────────────────────
  //
  // Ghost rows used to be inert (checkbox / right-click no-op'd). A ghosted
  // task is still a real task — same checkbox + same context menu as a
  // non-ghost row. Visual dim is the only signal that the task is filtered
  // out (data-ghosted attribute drives the CSS rule).

  describe('ghost mode', () => {
    it('marks the row with data-ghosted', () => {
      render(<MobileTaskRow todo={makeTodo({ id: 1 })} ghost />)
      expect(getRow().getAttribute('data-ghosted')).toBe('')
    })

    it('does not mark a non-ghost row with data-ghosted', () => {
      render(<MobileTaskRow todo={makeTodo({ id: 1 })} />)
      expect(getRow().getAttribute('data-ghosted')).toBeNull()
    })

    it('checkbox toggles complete (ghost is interactive)', () => {
      render(<MobileTaskRow todo={makeTodo({ id: 1 })} ghost />)
      fireEvent.click(screen.getByRole('checkbox', { name: 'Toggle complete' }))
      expect(mockToggleComplete).toHaveBeenCalledWith(1)
    })
  })

  // ── Parity with the desktop row ───────────────────────────────────
  //
  // Mobile gains chip taps, a notes-icon trigger, and an `onContextMenu`
  // handler that mirrors the desktop right-click menu. On real touch devices
  // long-press fires the same `contextmenu` event, so the interactive surface
  // is identical to TaskRow.

  describe('parity with the desktop row', () => {
    it('exposes the due-date chip as a button (tap → opens the date picker)', () => {
      const year = new Date().getFullYear()
      render(<MobileTaskRow todo={makeTodo({ id: 1, dueDate: new Date(year, 3, 11) })} />)
      const chip = screen.getByLabelText('Edit due date')
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
      expect(screen.getByRole('menuitem', { name: 'Mark complete' })).toBeInTheDocument()
      expect(screen.getByRole('menuitemcheckbox', { name: 'Focus' })).toBeInTheDocument()
      expect(screen.queryByRole('menuitem', { name: /project/i })).not.toBeInTheDocument()
      expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument()
    })

    it('the Focus menu item targets the row todo', () => {
      mockSetFocus.mockClear()
      render(<MobileTaskRow todo={makeTodo({ id: 42, title: 'Foo' })} />)
      act(() => {
        fireEvent.contextMenu(getRow(), { clientX: 50, clientY: 50 })
      })
      fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Focus' }))
      expect(mockSetFocus).toHaveBeenCalledWith(42, true)
    })

    it('shows the focus marker only for a task in focus', () => {
      const { unmount } = render(<MobileTaskRow todo={makeTodo({ id: 1, title: 'Foo' })} />)
      expect(screen.queryByRole('img', { name: 'Focus' })).not.toBeInTheDocument()
      unmount()
      render(<MobileTaskRow todo={makeTodo({ id: 1, title: 'Foo', focus: true })} />)
      expect(screen.getByRole('img', { name: 'Focus' })).toBeInTheDocument()
    })

    it('Delete menu action routes through bulk.remove (which queues the confirm dialog)', () => {
      mockRemove.mockClear()
      render(<MobileTaskRow todo={makeTodo({ id: 7, title: 'Foo' })} />)
      act(() => {
        fireEvent.contextMenu(getRow(), { clientX: 50, clientY: 50 })
      })
      fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }))
      expect(mockRemove).toHaveBeenCalledWith(7)
    })

    it('opens the same context menu in ghost mode (parity with non-ghost rows)', () => {
      render(<MobileTaskRow todo={makeTodo({ id: 1, title: 'Foo' })} ghost />)
      act(() => {
        fireEvent.contextMenu(getRow(), { clientX: 50, clientY: 50 })
      })
      expect(screen.getByRole('menuitem', { name: 'Mark complete' })).toBeInTheDocument()
      expect(screen.getByRole('menuitemcheckbox', { name: 'Focus' })).toBeInTheDocument()
      expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument()
    })

    afterEach(() => {
      vi.restoreAllMocks()
      useUIStore.getState().clearBulkConfirmation?.()
    })
  })

  describe('touch follow-up flag', () => {
    it('an empty follow-up slot always shows its flag, which opens the follow-up popover', () => {
      render(<MobileTaskRow todo={makeTodo({ id: 1, title: 'Bare' })} />)
      const flag = screen.getByRole('button', { name: 'Set follow-up' })
      fireEvent.click(flag)
      expect(screen.getByRole('dialog', { name: 'Follow-up' })).toBeInTheDocument()
      expect(flag).toHaveAttribute('aria-expanded', 'true')
    })

    it('rows with other metadata show the flag too, but not when a follow-up is set or the row is a ghost', () => {
      const { unmount } = render(<MobileTaskRow todo={makeTodo({ id: 1, dueDate: new Date(2026, 3, 20) })} />)
      expect(screen.getByRole('button', { name: 'Set follow-up' })).toBeInTheDocument()
      unmount()
      const second = render(<MobileTaskRow todo={makeTodo({ id: 1, nextFollowupAt: new Date(2026, 3, 20) })} />)
      expect(screen.queryByRole('button', { name: 'Set follow-up' })).toBeNull()
      second.unmount()
      render(<MobileTaskRow todo={makeTodo({ id: 1, dueDate: new Date(2026, 3, 20) })} ghost />)
      expect(screen.queryByRole('button', { name: 'Set follow-up' })).toBeNull()
    })
  })

})
