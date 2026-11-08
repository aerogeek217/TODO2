import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import { MobileTaskRow } from '../../components/task/MobileTaskRow'
import { FollowupPopoverHost } from '../../components/overlays/FollowupPopoverHost'
import { useUIStore } from '../../stores/ui-store'
import { useTagStore } from '../../stores/tag-store'
import { useTodoStore } from '../../stores/todo-store'
import { useSettingsStore } from '../../stores/settings-store'
import { useStatusStore } from '../../stores/status-store'
import { useStatusUpdateStore } from '../../stores/status-update-store'
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

  // ── The status button ─────────────────────────────────────────────

  describe('status button', () => {
    const waiting = { id: 2, name: 'Waiting', color: '#888', sortOrder: 0 }
    const doing = { id: 3, name: 'Doing', color: '#3a3', sortOrder: 1 }
    let update: ReturnType<typeof vi.fn>
    beforeEach(() => {
      update = vi.fn()
      useTodoStore.setState({ update } as unknown as Partial<ReturnType<typeof useTodoStore.getState>>)
      useStatusStore.setState({ statuses: [waiting, doing] })
    })

    it('gives a task without a status the default status (Settings › Tasks)', () => {
      useSettingsStore.setState({ defaultStatusId: 3 })
      render(<MobileTaskRow todo={makeTodo({ id: 1 })} />)
      fireEvent.click(screen.getByRole('button', { name: 'Set status' }))
      expect(update).toHaveBeenCalledWith(1, { statusId: 3 })
    })

    it('without a default status — or with a deleted one — it sets nothing', () => {
      useSettingsStore.setState({ defaultStatusId: null })
      render(<MobileTaskRow todo={makeTodo({ id: 1 })} />)
      fireEvent.click(screen.getByRole('button', { name: 'Set status' }))
      cleanup()
      useSettingsStore.setState({ defaultStatusId: 9 })
      render(<MobileTaskRow todo={makeTodo({ id: 1 })} />)
      fireEvent.click(screen.getByRole('button', { name: 'Set status' }))
      expect(update).not.toHaveBeenCalled()
    })

    it('clears a task’s status', () => {
      useSettingsStore.setState({ defaultStatusId: 3 })
      render(<MobileTaskRow todo={makeTodo({ id: 1, statusId: 2 })} />)
      fireEvent.click(screen.getByRole('button', { name: 'Status: Waiting' }))
      expect(update).toHaveBeenCalledWith(1, { statusId: undefined })
    })
  })

  // ── Rendering basics ──────────────────────────────────────────────

  describe('rendering', () => {
    it('renders task title', () => {
      render(<MobileTaskRow todo={makeTodo({ id: 1, title: 'Buy groceries' })} />)
      expect(screen.getByText('Buy groceries')).toBeInTheDocument()
    })

    it('marks its title with data-task-title, as the desktop row does', () => {
      render(<MobileTaskRow todo={makeTodo({ id: 1, title: 'Buy groceries' })} />)
      expect(getRow().querySelector('[data-task-title]')).toHaveAttribute('data-task-title', 'Buy groceries')
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
    it('shows the due date in words (D25 D1): Today, the next days’ weekday, then MM/DD', () => {
      const due = (d: Date) => {
        const { container, unmount } = render(<MobileTaskRow todo={makeTodo({ id: 1, dueDate: d })} />)
        const text = container.querySelector('[data-pill="due"]')?.textContent
        unmount()
        return text
      }
      expect(due(new Date(2026, 3, 11))).toBe('Today')
      expect(due(new Date(2026, 3, 12))).toBe('Sun')
      expect(due(new Date(2026, 3, 18))).toBe('04/18')
      expect(due(new Date(2026, 3, 2))).toBe('04/02')
      expect(due(new Date(2027, 1, 3))).toBe('02/03')
    })

    it('shows the due date as MM/DD under Settings’ MM/DD', () => {
      useSettingsStore.setState({ rowDates: 'numeric' })
      render(<MobileTaskRow todo={makeTodo({ id: 1, dueDate: new Date(2026, 3, 11) })} />)
      expect(screen.getByText(/04\/11$/)).toBeInTheDocument()
    })

    it('renders no date chip when no due date is set', () => {
      render(<MobileTaskRow todo={makeTodo({ id: 1 })} />)
      expect(screen.queryByText(/Apr/)).not.toBeInTheDocument()
      expect(screen.queryByText('Today')).not.toBeInTheDocument()
    })

    it('shows recurrence indicator inside deadline chip when recurrenceRule is set', () => {
      render(<MobileTaskRow todo={makeTodo({ id: 1, dueDate: new Date(2026, 3, 11), recurrenceRule: { type: 'weekly' } })} />)
      const chip = screen.getByText(/Today/)
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

    it('shows the newest status update (MM/DD text) with a bar for a percentage in it, and the notes icon', () => {
      const date = new Date(2026, 9, 28)
      useStatusUpdateStore.setState({ byTodo: new Map([[1, [
        { id: 2, todoId: 1, date, text: 'drafted, 50% done', createdAt: date },
        { id: 1, todoId: 1, date: new Date(2026, 9, 20), text: 'older', createdAt: date },
      ]]]) })
      const { container } = render(<MobileTaskRow todo={makeTodo({ id: 1 })} />)
      const chip = container.querySelector('[data-status-chip]')
      expect(chip).toHaveTextContent('10/28 drafted, 50% done')
      expect(chip?.querySelector('[class*="progressBarFill"]')).toHaveStyle({ width: '50%' })
      expect(screen.queryByText(/older/)).toBeNull()
      expect(screen.getByRole('button', { name: 'Edit status and notes' })).toBeInTheDocument()
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

    it('the title is the row’s button: the keyboard selects through it, and the row holds its controls without being a button', () => {
      const onSelect = vi.fn()
      render(<MobileTaskRow todo={makeTodo({ id: 7, title: 'Call plumber' })} onSelect={onSelect} isSelected={false} />)
      expect(getRow()).not.toHaveAttribute('role')
      expect(getRow()).not.toHaveAttribute('tabindex')
      const title = screen.getByRole('button', { name: 'Call plumber' })
      expect(title).toHaveAttribute('aria-pressed', 'false')
      // The checkbox and the status button are no longer inside a button.
      expect(screen.getByRole('checkbox', { name: 'Toggle complete' }).closest('[role="button"]')).toBeNull()
      fireEvent.click(title)
      expect(onSelect).toHaveBeenCalledOnce()
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
      })
      render(<MobileTaskRow todo={makeTodo({ id: 1, title: 'Prepare deck' })} />)
      expect(screen.getByText('#alpha')).toBeInTheDocument()
      expect(screen.getByText('#beta')).toBeInTheDocument()
    })

    it('renders the empty-state # trigger when no metadata is set', () => {
      useTagStore.setState({
        tags: [{ id: 1, name: 'alpha', color: '#111' }],
        assignedTagsMap: new Map(),
      })
      render(<MobileTaskRow todo={makeTodo({ id: 1 })} />)
      expect(screen.getByLabelText('Add tag')).toBeInTheDocument()
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

    it('shows the priority as the ring on the checkbox, named (none without one or once completed)', () => {
      const { unmount } = render(<MobileTaskRow todo={makeTodo({ id: 1, title: 'Foo' })} />)
      expect(document.querySelector('[data-priority-ring]')).toBeNull()
      unmount()
      const second = render(<MobileTaskRow todo={makeTodo({ id: 1, title: 'Foo', focus: true })} />)
      // Focus alone: the glow (named), no ring.
      const glow = screen.getByRole('img', { name: 'Priority: Focus' })
      expect(glow).toHaveAttribute('data-focus-glow')
      expect(glow.parentElement).toContainElement(screen.getByRole('checkbox'))
      expect(document.querySelector('[data-priority-ring]')).toBeNull()
      second.unmount()
      // Focus with another priority: that ring, and the glow around it.
      const third = render(<MobileTaskRow todo={makeTodo({ id: 1, title: 'Foo', focus: true, important: true })} />)
      expect(screen.getByRole('img', { name: 'Priority: Focus, Important' })).toHaveAttribute('data-priority-ring', 'important')
      expect(document.querySelector('[data-focus-glow]')).not.toBeNull()
      third.unmount()
      render(<MobileTaskRow todo={makeTodo({ id: 1, title: 'Foo', urgent: true, isCompleted: true })} />)
      expect(document.querySelector('[data-priority-ring]')).toBeNull()
    })

    it('rolls its due date over at midnight without new props (cr33 M10)', () => {
      vi.setSystemTime(new Date(2026, 3, 11, 23, 59))
      render(<MobileTaskRow todo={makeTodo({ id: 1, dueDate: new Date(2026, 3, 11) })} />)
      const chip = () => document.querySelector('[data-pill="due"]')?.textContent
      expect(chip()).toBe('Today')
      act(() => { vi.advanceTimersByTime(10 * 60_000) })
      expect(chip()).toBe('04/11')
    })

    it('shows a set follow-up as its flag only (the day in its name)', () => {
      render(<MobileTaskRow todo={makeTodo({ id: 1, nextFollowupAt: new Date(2026, 3, 20) })} />)
      const pill = screen.getByRole('button', { name: /^Follow-up: / })
      expect(pill.textContent).toBe('')
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

    afterEach(() => {
      vi.restoreAllMocks()
      useUIStore.getState().clearBulkConfirmation?.()
    })
  })

  describe('touch follow-up flag', () => {
    it('an empty follow-up slot always shows its flag, which opens the follow-up popover', () => {
      const bare = makeTodo({ id: 1, title: 'Bare' })
      useTodoStore.setState({ todos: [bare] })
      render(<><MobileTaskRow todo={bare} /><FollowupPopoverHost /></>)
      const flag = screen.getByRole('button', { name: 'Set follow-up' })
      fireEvent.click(flag)
      expect(screen.getByRole('dialog', { name: 'Follow-up' })).toBeInTheDocument()
      expect(flag).toHaveAttribute('aria-expanded', 'true')
    })

    it('rows with other metadata show the flag too, but not when a follow-up is set', () => {
      const { unmount } = render(<MobileTaskRow todo={makeTodo({ id: 1, dueDate: new Date(2026, 3, 20) })} />)
      expect(screen.getByRole('button', { name: 'Set follow-up' })).toBeInTheDocument()
      unmount()
      render(<MobileTaskRow todo={makeTodo({ id: 1, nextFollowupAt: new Date(2026, 3, 20) })} />)
      expect(screen.queryByRole('button', { name: 'Set follow-up' })).toBeNull()
    })
  })

})
