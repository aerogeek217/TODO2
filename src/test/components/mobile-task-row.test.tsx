import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act, within } from '@testing-library/react'
import { MobileTaskRow } from '../../components/task/MobileTaskRow'
import { FollowupPopoverHost } from '../../components/overlays/FollowupPopoverHost'
import { useUIStore } from '../../stores/ui-store'
import { useTagStore } from '../../stores/tag-store'
import { useTodoStore } from '../../stores/todo-store'
import { useSettingsStore } from '../../stores/settings-store'
import { useStatusUpdateStore } from '../../stores/status-update-store'
import { makeTodo, makePerson } from '../helpers'
import { escapeRegExp } from '../helpers/escape-reg-exp'

const mockToggleComplete = vi.fn()
const mockRemove = vi.fn()
const mockSetFocus = vi.fn()
const mockMarkFollowedUp = vi.fn()
vi.mock('../../hooks/use-bulk-actions', () => ({
  useBulkActions: () => ({
    toggleComplete: mockToggleComplete,
    remove: mockRemove,
    setFocus: mockSetFocus,
    markFollowedUp: mockMarkFollowedUp,
    setFollowup: vi.fn(),
    setDeadline: vi.fn(),
    setStatus: vi.fn(),
    quickAssignPerson: vi.fn(),
    quickUnassignPerson: vi.fn(),
    quickAssignTag: vi.fn(),
    quickUnassignTag: vi.fn(),
  }),
}))

/** The row is the element with data-todo-id (avoids matching child buttons) */
function getRow(): HTMLElement {
  return document.querySelector('[data-todo-id]') as HTMLElement
}

/** The details line, or null when the row has nothing to say under its title. */
function details(): HTMLElement | null {
  return document.querySelector('[data-row-details]')
}

function part(name: string): HTMLElement | null {
  return document.querySelector(`[data-row-part="${name}"]`)
}

function longPress(): void {
  act(() => { fireEvent.contextMenu(getRow(), { clientX: 50, clientY: 50 }) })
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
    it('renders the title as the row’s one button, marked with data-task-title as the desktop row', () => {
      render(<MobileTaskRow todo={makeTodo({ id: 1, title: 'Buy groceries' })} />)
      expect(screen.getAllByRole('button')).toEqual([screen.getByRole('button', { name: 'Buy groceries' })])
      expect(getRow().querySelector('[data-task-title]')).toHaveAttribute('data-task-title', 'Buy groceries')
    })

    it('renders the checkbox, checked for a completed task', () => {
      const { unmount } = render(<MobileTaskRow todo={makeTodo({ id: 1 })} />)
      expect(screen.getByRole('checkbox', { name: 'Toggle complete' })).not.toBeChecked()
      unmount()
      render(<MobileTaskRow todo={makeTodo({ id: 1, isCompleted: true })} />)
      expect(screen.getByRole('checkbox', { name: 'Toggle complete' })).toBeChecked()
      expect(getRow().className).toMatch(/completed/)
    })

    it('sets data-todo-id on the row', () => {
      render(<MobileTaskRow todo={makeTodo({ id: 42 })} />)
      expect(getRow()).toHaveAttribute('data-todo-id', '42')
    })

    it('has no pills, flag, status ring or ▸ to tap: only the title and the checkbox', () => {
      useTagStore.setState({
        tags: [{ id: 1, name: 'alpha', color: '#111' }],
        assignedTagsMap: new Map([[1, [{ id: 1, name: 'alpha', color: '#111' }]]]),
      })
      render(
        <MobileTaskRow
          todo={makeTodo({ id: 1, title: 'Busy', dueDate: TODAY, nextFollowupAt: new Date(2026, 3, 1), notes: 'n', statusId: 2 })}
          assignedPeople={[makePerson({ id: 1, name: 'Alice', initials: 'AL' })]}
        />,
      )
      expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Busy'])
      for (const name of ['Open task details', 'Set status', 'Set follow-up', 'Edit due date', 'Add tag', 'Edit status and notes']) {
        expect(screen.queryByRole('button', { name })).toBeNull()
      }
    })

    it('a bare task has no details line', () => {
      render(<MobileTaskRow todo={makeTodo({ id: 1 })} />)
      expect(details()).toBeNull()
    })

    it('marks a stale task (untouched past Settings’ threshold) for the fade', () => {
      useSettingsStore.setState({ staleAfterDays: 30 })
      render(<MobileTaskRow todo={makeTodo({ id: 1, modifiedAt: new Date(2026, 0, 1) })} />)
      expect(getRow()).toHaveAttribute('data-stale', 'true')
    })
  })

  // ── Tapping ───────────────────────────────────────────────────────

  describe('tapping', () => {
    it('a tap on the row (its title’s button) opens the task', () => {
      const onOpenDetail = vi.fn()
      render(<MobileTaskRow todo={makeTodo({ id: 3, title: 'Call plumber' })} onOpenDetail={onOpenDetail} />)
      fireEvent.click(screen.getByRole('button', { name: 'Call plumber' }))
      expect(onOpenDetail).toHaveBeenCalledOnce()
      expect(onOpenDetail).toHaveBeenCalledWith(3)
    })

    it('the checkbox completes the task and doesn’t open it', () => {
      const onOpenDetail = vi.fn()
      render(<MobileTaskRow todo={makeTodo({ id: 5 })} onOpenDetail={onOpenDetail} />)
      fireEvent.click(screen.getByRole('checkbox', { name: 'Toggle complete' }))
      expect(mockToggleComplete).toHaveBeenCalledWith(5)
      expect(onOpenDetail).not.toHaveBeenCalled()
    })

    it('a tap that closes an open popover goes no further; the next one opens the task', () => {
      const onOpenDetail = vi.fn()
      render(<MobileTaskRow todo={makeTodo({ id: 3, title: 'Call plumber' })} onOpenDetail={onOpenDetail} />)
      const popover = document.createElement('div')
      popover.setAttribute('data-popover-level', '1')
      document.body.appendChild(popover)
      const title = screen.getByRole('button', { name: 'Call plumber' })
      fireEvent.pointerDown(title)
      // The popover closes on the press (its outside-click handler), before the click lands.
      popover.remove()
      fireEvent.click(title)
      expect(onOpenDetail).not.toHaveBeenCalled()
      fireEvent.pointerDown(title)
      fireEvent.click(title)
      expect(onOpenDetail).toHaveBeenCalledWith(3)
    })
  })

  // ── The details line ──────────────────────────────────────────────

  describe('details line', () => {
    it('shows the due date in words (D25 D1): Today, the next days’ weekday, then MM/DD', () => {
      const due = (d: Date) => {
        const { unmount } = render(<MobileTaskRow todo={makeTodo({ id: 1, dueDate: d })} />)
        const text = part('due')?.textContent
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
      expect(part('due')).toHaveTextContent('04/11')
    })

    it('colours the due date only when it needs action: past (bold) or due soon; later stays muted', () => {
      useSettingsStore.setState({ urgentDueWithinDays: 3 })
      const flags = (d: Date) => {
        const { unmount } = render(<MobileTaskRow todo={makeTodo({ id: 1, dueDate: d })} />)
        const el = part('due')!
        const out = { past: el.hasAttribute('data-due-past'), soon: el.hasAttribute('data-due-soon') }
        unmount()
        return out
      }
      expect(flags(new Date(2026, 3, 9)).past).toBe(true)
      expect(flags(new Date(2026, 3, 12))).toEqual({ past: false, soon: true })
      expect(flags(new Date(2026, 3, 30))).toEqual({ past: false, soon: false })
    })

    it('a repeating task’s due date carries the repeat glyph', () => {
      render(<MobileTaskRow todo={makeTodo({ id: 1, dueDate: TODAY, recurrenceRule: { type: 'weekly' } })} />)
      expect(part('due')!.querySelector('svg')).not.toBeNull()
      expect(part('due')).toHaveTextContent('Today')
    })

    it('shows the follow-up only while it is today or late, in the follow-up colour', () => {
      const shown = (d: Date, extra: Partial<Parameters<typeof makeTodo>[0]> = {}) => {
        const { unmount } = render(<MobileTaskRow todo={makeTodo({ id: 1, nextFollowupAt: d, ...extra })} />)
        const el = part('followup')
        const out = el ? `${el.getAttribute('data-followup')} ${el.textContent}` : null
        unmount()
        return out
      }
      expect(shown(new Date(2026, 3, 8))).toBe('late 04/08')
      expect(shown(TODAY)).toBe('today Today')
      expect(shown(new Date(2026, 3, 14))).toBeNull()
      // A completed task's follow-up asks nothing.
      expect(shown(TODAY, { isCompleted: true })).toBeNull()
    })

    it('shows people’s initials, three then +N', () => {
      const people = [
        makePerson({ id: 1, initials: 'A' }),
        makePerson({ id: 2, initials: 'B' }),
        makePerson({ id: 3, initials: 'C' }),
        makePerson({ id: 4, initials: 'D' }),
      ]
      render(<MobileTaskRow todo={makeTodo({ id: 1 })} assignedPeople={people} />)
      expect(part('people')).toHaveTextContent('ABC+1')
    })

    it('shows the first tag and +N', () => {
      useTagStore.setState({
        tags: [{ id: 1, name: 'alpha', color: '#111' }, { id: 2, name: 'beta', color: '#222' }, { id: 3, name: 'gamma', color: '#333' }],
        assignedTagsMap: new Map([[1, [
          { id: 1, name: 'alpha', color: '#111' },
          { id: 2, name: 'beta', color: '#222' },
          { id: 3, name: 'gamma', color: '#333' },
        ]]]),
      })
      render(<MobileTaskRow todo={makeTodo({ id: 1 })} />)
      expect(part('tags')).toHaveTextContent('#alpha+2')
      expect(screen.queryByText('#beta')).toBeNull()
    })

    it('shows a notes mark for notes or a status update, none without', () => {
      const { unmount } = render(<MobileTaskRow todo={makeTodo({ id: 1, notes: 'Some notes' })} />)
      expect(part('notes')).not.toBeNull()
      unmount()
      const date = new Date(2026, 3, 10)
      useStatusUpdateStore.setState({ byTodo: new Map([[1, [{ id: 1, todoId: 1, date, text: 'drafted', createdAt: date }]]]) })
      const second = render(<MobileTaskRow todo={makeTodo({ id: 1 })} />)
      expect(part('notes')).not.toBeNull()
      // The update's text stays in the editor: only the mark here.
      expect(screen.queryByText(/drafted/)).toBeNull()
      second.unmount()
      useStatusUpdateStore.setState({ byTodo: new Map() })
      render(<MobileTaskRow todo={makeTodo({ id: 1, dueDate: TODAY })} />)
      expect(part('notes')).toBeNull()
    })

    it('is drawn only; the title’s description says it in words', () => {
      render(
        <MobileTaskRow
          todo={makeTodo({ id: 1, title: 'Call', dueDate: new Date(2026, 3, 9) })}
          assignedPeople={[makePerson({ id: 1, name: 'Alice', initials: 'AL' })]}
        />,
      )
      expect(details()).toHaveAttribute('aria-hidden', 'true')
      const title = screen.getByRole('button', { name: 'Call' })
      expect(title.getAttribute('aria-description')).toMatch(/^Due .+ \(late\) · Alice$/)
    })

    it('rolls its due date over at midnight without new props (cr33 M10)', () => {
      vi.setSystemTime(new Date(2026, 3, 11, 23, 59))
      render(<MobileTaskRow todo={makeTodo({ id: 1, dueDate: new Date(2026, 3, 11) })} />)
      expect(part('due')?.textContent).toBe('Today')
      act(() => { vi.advanceTimersByTime(10 * 60_000) })
      expect(part('due')?.textContent).toBe('04/11')
    })
  })

  // ── Priority ──────────────────────────────────────────────────────

  it('shows the priority as the ring on the checkbox, named (none without one or once completed)', () => {
    const { unmount } = render(<MobileTaskRow todo={makeTodo({ id: 1, title: 'Foo' })} />)
    expect(document.querySelector('[data-priority-ring]')).toBeNull()
    // No ring, still named (cr33 U14).
    expect(screen.getByRole('img', { name: 'No priority' })).toBeInTheDocument()
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
    expect(screen.getByRole('img', { name: 'Priority: Urgent' })).toBeInTheDocument()
  })

  // ── The long-press menu: every row action without opening the task ─

  describe('long-press menu', () => {
    afterEach(() => {
      useUIStore.getState().clearBulkConfirmation?.()
    })

    it('opens the task menu with Open, the dates, people, tags, subtasks, the priorities and Delete', () => {
      render(<MobileTaskRow todo={makeTodo({ id: 1, title: 'Foo' })} onOpenDetail={vi.fn()} />)
      longPress()
      for (const name of ['Open', 'Mark complete', 'Set due date…', 'Follow-up', 'Mark followed up', 'Assign people…', 'Add tag…', 'Add subtask…', 'Delete']) {
        expect(screen.getByRole('menuitem', { name: new RegExp(`^${escapeRegExp(name)}`) })).toBeInTheDocument()
      }
      expect(screen.getByRole('menuitemcheckbox', { name: 'Focus' })).toBeInTheDocument()
    })

    it('Open opens the task; a pick in the menu doesn’t also open it', () => {
      const onOpenDetail = vi.fn()
      render(<MobileTaskRow todo={makeTodo({ id: 9, title: 'Foo' })} onOpenDetail={onOpenDetail} />)
      longPress()
      fireEvent.click(screen.getByRole('menuitem', { name: 'Open' }))
      expect(onOpenDetail).toHaveBeenCalledOnce()
      expect(onOpenDetail).toHaveBeenCalledWith(9)
    })

    it('the Focus item and Mark followed up target the row’s task; Delete routes through bulk.remove', () => {
      render(<MobileTaskRow todo={makeTodo({ id: 42, title: 'Foo' })} />)
      longPress()
      fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Focus' }))
      expect(mockSetFocus).toHaveBeenCalledWith(42, true)
      longPress()
      fireEvent.click(screen.getByRole('menuitem', { name: /^Mark followed up/ }))
      expect(mockMarkFollowedUp).toHaveBeenCalledWith(42)
      longPress()
      fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }))
      expect(mockRemove).toHaveBeenCalledWith(42)
    })

    it('Assign people… and Add tag… open their pickers at the row', () => {
      useTagStore.setState({ tags: [{ id: 1, name: 'alpha', color: '#111' }], assignedTagsMap: new Map() })
      render(<MobileTaskRow todo={makeTodo({ id: 1, title: 'Foo' })} />)
      longPress()
      fireEvent.click(screen.getByRole('menuitem', { name: 'Assign people…' }))
      expect(document.querySelector('[data-anchored-picker]')).not.toBeNull()
      expect(within(document.querySelector('[data-anchored-picker]') as HTMLElement).getByRole('combobox')).toHaveAttribute('placeholder', 'Search or create people…')
      fireEvent.keyDown(document.activeElement ?? document, { key: 'Escape' })
      longPress()
      fireEvent.click(screen.getByRole('menuitem', { name: 'Add tag…' }))
      expect(screen.getByText('alpha')).toBeInTheDocument()
    })

    it('Follow-up › Pick a date or interval… opens the follow-up popover', () => {
      const bare = makeTodo({ id: 1, title: 'Bare' })
      useTodoStore.setState({ todos: [bare] })
      render(<><MobileTaskRow todo={bare} /><FollowupPopoverHost /></>)
      longPress()
      fireEvent.click(screen.getByRole('menuitem', { name: /^Follow-up/ }))
      fireEvent.click(screen.getByRole('menuitem', { name: 'Pick a date or interval…' }))
      expect(screen.getByRole('dialog', { name: 'Follow-up' })).toBeInTheDocument()
    })
  })
})
