import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen, fireEvent, cleanup } from '@testing-library/react'
import { TaskRow } from '../../components/task/TaskRow'
import { useStatusStore } from '../../stores/status-store'
import { useUIStore } from '../../stores/ui-store'
import { useSettingsStore } from '../../stores/settings-store'
import { useTodoStore } from '../../stores/todo-store'
import { makeTodo, makePerson, resetEntityStores } from '../helpers'

const mockBulk = {
  toggleComplete: vi.fn(),
  remove: vi.fn(),
  setFocus: vi.fn(),
  setUrgent: vi.fn(),
  setImportant: vi.fn(),
  setDeadline: vi.fn(),
  setFollowup: vi.fn(),
  markFollowedUp: vi.fn(),
  setStatus: vi.fn(),
  quickAssignPerson: vi.fn(),
  quickUnassignPerson: vi.fn(),
  quickAssignTag: vi.fn(),
  quickUnassignTag: vi.fn(),
}

vi.mock('../../hooks/use-bulk-actions', () => ({
  useBulkActions: () => mockBulk,
}))

function getRow(): HTMLElement {
  return document.querySelector('[data-todo-id]') as HTMLElement
}

function resetStores() {
  // Tags too: several tests seed tag assignments for todo 1.
  resetEntityStores({ todos: false })
  useUIStore.setState({ hoveredTodoId: null, selectedTodoIds: new Set() })
  useTodoStore.setState({ todos: [] })
}

// April 16, 2026 (Thursday) — matches `vi.setSystemTime` below.
const TODAY = new Date(2026, 3, 16)

describe('TaskRow', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(TODAY)
    resetStores()
    Object.values(mockBulk).forEach((fn) => (fn as ReturnType<typeof vi.fn>).mockClear())
    // jsdom does not implement showPicker; stub for deadline-inline tests
    HTMLInputElement.prototype.showPicker = vi.fn()
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

  describe('due-date chip', () => {
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

  describe('past/overdue state', () => {
    it('applies the deadlineChipPast class when the deadline is overdue', () => {
      const { container } = render(
        <TaskRow todo={makeTodo({ id: 1, dueDate: new Date(2026, 3, 10) })} />,
      )
      const chip = container.querySelector('[class*="deadlineChip"]') as HTMLElement
      expect(chip.className).toMatch(/deadlineChipPast/i)
    })

    it('does not apply the past class for a future deadline', () => {
      const { container } = render(
        <TaskRow todo={makeTodo({ id: 1, dueDate: new Date(2026, 3, 25) })} />,
      )
      const chip = container.querySelector('[class*="deadlineChip"]') as HTMLElement
      expect(chip.className).not.toMatch(/deadlineChipPast/i)
    })
  })

  describe('empty-state date button', () => {
    it('renders when no due date is set', () => {
      render(<TaskRow todo={makeTodo({ id: 1 })} />)
      expect(screen.getByTitle('Set due date')).toBeInTheDocument()
    })

    it('does not render when a due date is set', () => {
      render(<TaskRow todo={makeTodo({ id: 1, dueDate: new Date(2026, 3, 20) })} />)
      expect(screen.queryByTitle('Set due date')).not.toBeInTheDocument()
    })
  })

  describe('task menu', () => {
    beforeEach(() => {
      useSettingsStore.setState({ urgentDueWithinDays: 3 })
    })

    it('right-click opens the task menu (no priority / project items)', () => {
      render(<TaskRow todo={makeTodo({ id: 1 })} onOpenDetail={vi.fn()} />)
      fireEvent.contextMenu(getRow())
      expect(screen.getByRole('menu', { name: 'Task actions' })).toBeInTheDocument()
      expect(screen.queryByText(/priority/i)).not.toBeInTheDocument()
      expect(screen.queryByText(/project/i)).not.toBeInTheDocument()
      for (const name of ['Open', 'Mark complete', 'Set due date…', 'Followed up', 'Assign people…', 'Add tag…', 'Delete']) {
        expect(screen.getByRole('menuitem', { name })).toBeInTheDocument()
      }
      expect(screen.getByRole('menuitem', { name: /^Follow-up/ })).toHaveAttribute('aria-haspopup', 'menu')
      for (const name of ['Urgent', 'Important', 'Focus']) {
        expect(screen.getByRole('menuitemcheckbox', { name })).toHaveAttribute('aria-checked', 'false')
      }
    })

    it('the ⋯ button opens the same menu; Esc closes it and returns focus to ⋯', () => {
      render(<TaskRow todo={makeTodo({ id: 1 })} />)
      const more = screen.getByRole('button', { name: 'Task actions' })
      act(() => { more.focus() })
      fireEvent.click(more)
      expect(more).toHaveAttribute('aria-expanded', 'true')
      expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Mark complete' }))
      fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' })
      expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Set due date…' }))
      fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
      expect(screen.queryByRole('menu')).toBeNull()
      expect(document.activeElement).toBe(more)
      expect(more).toHaveAttribute('aria-expanded', 'false')
    })

    it('Markers are checkbox items that set the marker on the row task (or its selection)', () => {
      render(<TaskRow todo={makeTodo({ id: 3, focus: true })} />)
      fireEvent.contextMenu(getRow())
      expect(screen.getByRole('menuitemcheckbox', { name: 'Focus' })).toHaveAttribute('aria-checked', 'true')
      fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Focus' }))
      expect(mockBulk.setFocus).toHaveBeenCalledWith(3, false)
      fireEvent.contextMenu(getRow())
      fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Urgent' }))
      expect(mockBulk.setUrgent).toHaveBeenCalledWith(3, true)
      fireEvent.contextMenu(getRow())
      fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Important' }))
      expect(mockBulk.setImportant).toHaveBeenCalledWith(3, true)
    })

    it('a task urgent only by its due date shows Urgent checked; clicking turns it off (which may ask)', () => {
      render(<TaskRow todo={makeTodo({ id: 4, dueDate: new Date(2026, 3, 18) })} />)
      fireEvent.contextMenu(getRow())
      const urgent = screen.getByRole('menuitemcheckbox', { name: 'Urgent' })
      expect(urgent).toHaveAttribute('aria-checked', 'true')
      fireEvent.click(urgent)
      expect(mockBulk.setUrgent).toHaveBeenCalledWith(4, false)
    })

    it('with several rows selected: a count label, Delete N tasks, mixed markers', () => {
      useUIStore.setState({ selectedTodoIds: new Set([1, 2]) })
      useTodoStore.setState({ todos: [makeTodo({ id: 1, important: true }), makeTodo({ id: 2 })] })
      render(<TaskRow todo={makeTodo({ id: 1, important: true })} onOpenDetail={vi.fn()} />)
      fireEvent.contextMenu(getRow())
      expect(screen.getByRole('menu', { name: '2 tasks' })).toBeInTheDocument()
      expect(screen.queryByRole('menuitem', { name: 'Open' })).toBeNull()
      expect(screen.getByRole('menuitem', { name: 'Delete 2 tasks' })).toBeInTheDocument()
      const important = screen.getByRole('menuitemcheckbox', { name: /Important/ })
      expect(important).toHaveAttribute('aria-checked', 'mixed')
      expect(important).toHaveTextContent('1 of 2')
      fireEvent.click(important)
      expect(mockBulk.setImportant).toHaveBeenCalledWith(1, true)
    })

    it('Follow-up › opens with → (focus moves in), ← closes it, and an interval sets the follow-up', async () => {
      render(<TaskRow todo={makeTodo({ id: 5, nextFollowupAt: new Date(2026, 3, 20) })} />)
      fireEvent.contextMenu(getRow())
      const followup = screen.getByRole('menuitem', { name: /^Follow-up/ })
      expect(followup).toHaveTextContent('Mon 20')
      act(() => { followup.focus() })
      fireEvent.keyDown(followup, { key: 'ArrowRight' })
      // The submenu's first item gets focus on the next microtask.
      await act(async () => { await Promise.resolve() })
      expect(followup).toHaveAttribute('aria-expanded', 'true')
      expect(screen.getByRole('menu', { name: 'Follow-up' })).toHaveTextContent('Clear follow-up')
      expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: /^1 week/ }))
      fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' })
      expect(screen.queryByRole('menu', { name: 'Follow-up' })).toBeNull()
      expect(document.activeElement).toBe(followup)
      // Esc with the submenu open closes only the submenu.
      fireEvent.click(followup)
      fireEvent.keyDown(document, { key: 'Escape' })
      expect(screen.queryByRole('menu', { name: 'Follow-up' })).toBeNull()
      expect(screen.getByRole('menu', { name: 'Task actions' })).toBeInTheDocument()
      fireEvent.click(followup)
      fireEvent.click(screen.getByRole('menuitem', { name: /^2 weeks/ }))
      expect(mockBulk.setFollowup).toHaveBeenCalledWith(5, new Date(2026, 3, 30))
      expect(screen.queryByRole('menu')).toBeNull()
    })

    it('Followed up, Set due date…, Assign people… and Add tag… reach their row actions', () => {
      render(<TaskRow todo={makeTodo({ id: 6 })} />)
      fireEvent.contextMenu(getRow())
      fireEvent.click(screen.getByRole('menuitem', { name: 'Followed up' }))
      expect(mockBulk.markFollowedUp).toHaveBeenCalledWith(6)

      fireEvent.contextMenu(getRow())
      fireEvent.click(screen.getByRole('menuitem', { name: 'Set due date…' }))
      act(() => { vi.runOnlyPendingTimers() })
      expect(HTMLInputElement.prototype.showPicker).toHaveBeenCalled()

      fireEvent.contextMenu(getRow())
      fireEvent.click(screen.getByRole('menuitem', { name: 'Assign people…' }))
      expect(screen.getByPlaceholderText('Search or create people…')).toBeInTheDocument()

      fireEvent.contextMenu(getRow())
      fireEvent.click(screen.getByRole('menuitem', { name: 'Add tag…' }))
      expect(screen.getByPlaceholderText('Search tags...')).toBeInTheDocument()
    })

    it('Pick a date or interval… opens the follow-up popover', () => {
      render(<TaskRow todo={makeTodo({ id: 6 })} />)
      fireEvent.contextMenu(getRow())
      fireEvent.click(screen.getByRole('menuitem', { name: /^Follow-up/ }))
      fireEvent.click(screen.getByRole('menuitem', { name: 'Pick a date or interval…' }))
      expect(screen.getByRole('dialog', { name: 'Follow-up' })).toBeInTheDocument()
    })
  })

  describe('markers', () => {
    beforeEach(() => {
      useSettingsStore.setState({ urgentDueWithinDays: 3 })
    })

    it('shows Focus › Urgent › Important before the title, each only when set', () => {
      render(<TaskRow todo={makeTodo({ id: 1, title: 'All three', urgent: true, important: true, focus: true })} />)
      const names = screen.getByTestId('task-markers').querySelectorAll('[role="img"]')
      expect([...names].map((n) => n.getAttribute('aria-label'))).toEqual(['Focus', 'Urgent', 'Important'])
      const title = screen.getByText('All three')
      expect(screen.getByTestId('task-markers').compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    })

    it('a task urgent only by its due date shows the clock; a flagged one the mark', () => {
      const { unmount } = render(<TaskRow todo={makeTodo({ id: 1, title: 'Soon', dueDate: new Date(2026, 3, 18) })} />)
      const clock = screen.getByRole('img', { name: 'Urgent: due soon' })
      // Tooltip: opens after 400 ms of hover, two lines, described-by while open.
      fireEvent.pointerEnter(clock)
      act(() => { vi.advanceTimersByTime(399) })
      expect(screen.queryByRole('tooltip')).toBeNull()
      act(() => { vi.advanceTimersByTime(1) })
      const tip = screen.getByRole('tooltip')
      expect(tip).toHaveTextContent('Urgent: due soonDue Sat 18, within 3 days.')
      expect(clock).toHaveAttribute('aria-describedby', tip.id)
      fireEvent.pointerLeave(clock)
      expect(screen.queryByRole('tooltip')).toBeNull()
      expect(screen.queryByRole('img', { name: 'Urgent' })).toBeNull()
      unmount()
      render(<TaskRow todo={makeTodo({ id: 1, title: 'Soon', urgent: true, dueDate: new Date(2026, 3, 18) })} />)
      expect(screen.getByRole('img', { name: 'Urgent' })).toBeInTheDocument()
      expect(screen.queryByRole('img', { name: 'Urgent: due soon' })).toBeNull()
    })

    it('no clock when the range is off, the date is far, or the task is completed', () => {
      useSettingsStore.setState({ urgentDueWithinDays: null })
      const { unmount } = render(<TaskRow todo={makeTodo({ id: 1, dueDate: new Date(2026, 3, 15) })} />)
      expect(screen.queryByTestId('task-markers')).toBeNull()
      unmount()
      useSettingsStore.setState({ urgentDueWithinDays: 3 })
      const second = render(<TaskRow todo={makeTodo({ id: 1, dueDate: new Date(2026, 3, 30) })} />)
      expect(screen.queryByTestId('task-markers')).toBeNull()
      second.unmount()
      render(<TaskRow todo={makeTodo({ id: 1, isCompleted: true, dueDate: new Date(2026, 3, 15) })} />)
      expect(screen.queryByTestId('task-markers')).toBeNull()
    })
  })

  describe('focus marker', () => {
    it('shows the marker before the title only for a task in focus', () => {
      const { unmount } = render(<TaskRow todo={makeTodo({ id: 1, title: 'Plain' })} />)
      expect(screen.queryByRole('img', { name: 'Focus' })).not.toBeInTheDocument()
      unmount()
      render(<TaskRow todo={makeTodo({ id: 1, title: 'Focused', focus: true })} />)
      const marker = screen.getByRole('img', { name: 'Focus' })
      const title = screen.getByText('Focused')
      expect(marker.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    })
  })

  describe('inline date editing', () => {
    it('clicking the empty-state date button opens the native date picker', () => {
      const onOpenDetail = vi.fn()
      render(<TaskRow todo={makeTodo({ id: 1 })} onOpenDetail={onOpenDetail} />)
      fireEvent.click(screen.getByTitle('Set due date'))
      vi.runAllTimers() // openDeadlinePicker uses setTimeout(…, 0)
      expect(HTMLInputElement.prototype.showPicker).toHaveBeenCalled()
      expect(onOpenDetail).not.toHaveBeenCalled()
    })

    it('clicking the due-date chip opens the native date picker (does not open detail popup)', () => {
      const onOpenDetail = vi.fn()
      const { container } = render(
        <TaskRow todo={makeTodo({ id: 1, dueDate: new Date(2026, 3, 20) })} onOpenDetail={onOpenDetail} />,
      )
      fireEvent.click(container.querySelector('[class*="deadlineChip"]') as HTMLElement)
      vi.runAllTimers() // openDeadlinePicker uses setTimeout(…, 0)
      expect(HTMLInputElement.prototype.showPicker).toHaveBeenCalled()
      expect(onOpenDetail).not.toHaveBeenCalled()
    })

    it('clicking the due-date chip × button clears the due date', () => {
      render(<TaskRow todo={makeTodo({ id: 1, dueDate: new Date(2026, 3, 20) })} />)
      fireEvent.click(screen.getByLabelText('Clear due date'))
      expect(mockBulk.setDeadline).toHaveBeenCalledWith(1, null)
    })
  })

  describe('avatar stack', () => {
    it('renders overlapping avatars for assigned people instead of @name chips', () => {
      const people = [
        makePerson({ id: 1, name: 'Alice', initials: 'AL' }),
        makePerson({ id: 2, name: 'Bob', initials: 'BO' }),
      ]
      render(<TaskRow todo={makeTodo({ id: 1 })} assignedPeople={people} />)
      expect(screen.getByText('AL')).toBeInTheDocument()
      expect(screen.getByText('BO')).toBeInTheDocument()
      expect(screen.queryByText('@Alice')).not.toBeInTheDocument()
    })

    it('shows +N overflow when 4+ people are assigned', () => {
      const people = [1, 2, 3, 4].map((id) => makePerson({ id, name: `P${id}`, initials: `P${id}` }))
      render(<TaskRow todo={makeTodo({ id: 1 })} assignedPeople={people} />)
      expect(screen.getByText('+1')).toBeInTheDocument()
    })

  })

  describe('status slot layout', () => {
    it('reserves min-width on the status wrapper whether status is set or not', () => {
      const { container: a } = render(<TaskRow todo={makeTodo({ id: 1 })} />)
      const noStatus = a.querySelector('[class*="statusWrapper"]') as HTMLElement
      cleanup()

      useStatusStore.setState({
        statuses: [{ id: 10, name: 'Done', icon: 'check', color: '#00ff00', sortOrder: 0 }],
      })
      const { container: b } = render(<TaskRow todo={makeTodo({ id: 1, statusId: 10 })} />)
      const withStatus = b.querySelector('[class*="statusWrapper"]') as HTMLElement

      // Both wrappers carry the status-slot class (min-width reserved in CSS)
      expect(noStatus.className).toMatch(/statusWrapper/)
      expect(withStatus.className).toMatch(/statusWrapper/)
    })
  })

  describe('inline tag chip', () => {
    // Assigned tags render as `#name` chips alongside the people avatars, and
    // a hover-revealed `#` empty trigger mounts when no tags are assigned.
    // Tag toggle goes through bulk actions.
    it('renders #name chips for each assigned tag', async () => {
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
      })
      render(<TaskRow todo={makeTodo({ id: 1, title: 'Prepare deck' })} />)
      expect(screen.getByText('#alpha')).toBeInTheDocument()
      expect(screen.getByText('#beta')).toBeInTheDocument()
    })

    it('renders the empty-state # trigger when no tags are assigned', async () => {
      const { useTagStore } = await import('../../stores/tag-store')
      useTagStore.setState({
        tags: [{ id: 1, name: 'alpha', color: '#111' }],
        assignedTagsMap: new Map(),
      })
      render(<TaskRow todo={makeTodo({ id: 1 })} />)
      expect(screen.getByLabelText('Add tag')).toBeInTheDocument()
    })

    it('clicking an existing tag chip opens the lookup-or-create dropdown', async () => {
      const { useTagStore } = await import('../../stores/tag-store')
      useTagStore.setState({
        tags: [
          { id: 1, name: 'alpha', color: '#111' },
          { id: 2, name: 'beta', color: '#222' },
        ],
        assignedTagsMap: new Map([[1, [{ id: 1, name: 'alpha', color: '#111' }]]]),
      })
      render(<TaskRow todo={makeTodo({ id: 1 })} />)
      fireEvent.click(screen.getByText('#alpha'))
      // The dropdown's input renders with the search placeholder
      expect(screen.getByPlaceholderText('Search tags...')).toBeInTheDocument()
    })

    it('toggling an unassigned tag from the dropdown calls quickAssignTag', async () => {
      const { useTagStore } = await import('../../stores/tag-store')
      useTagStore.setState({
        tags: [
          { id: 1, name: 'alpha', color: '#111' },
          { id: 2, name: 'beta', color: '#222' },
        ],
        assignedTagsMap: new Map([[1, [{ id: 1, name: 'alpha', color: '#111' }]]]),
      })
      render(<TaskRow todo={makeTodo({ id: 1 })} />)
      fireEvent.click(screen.getByText('#alpha'))
      fireEvent.click(screen.getByText('beta'))
      expect(mockBulk.quickAssignTag).toHaveBeenCalledWith(1, 2)
    })

    it('does not render the inline tag chip on a ghost row', async () => {
      const { useTagStore } = await import('../../stores/tag-store')
      useTagStore.setState({
        tags: [],
        assignedTagsMap: new Map(),
      })
      render(<TaskRow todo={makeTodo({ id: 1 })} ghost />)
      expect(screen.queryByLabelText('Add tag')).not.toBeInTheDocument()
    })
  })

  describe('@ trigger placement', () => {
    // The empty-state @ button must render BEFORE the pill bar so it occupies
    // the people-chip slot. When people are populated, the avatar group inside
    // the pill bar takes that slot — same visual position either way.
    it('renders @ trigger before the pill bar in DOM order when no people are assigned', () => {
      const { container } = render(
        <TaskRow todo={makeTodo({ id: 1, dueDate: new Date(2026, 3, 20) })} />,
      )
      const buttons = Array.from(container.querySelectorAll('button')) as HTMLElement[]
      const atIdx = buttons.findIndex((b) => b.textContent?.trim() === '@')
      const deadlineIdx = buttons.findIndex((b) => b.getAttribute('aria-label') === 'Edit due date')
      expect(atIdx).toBeGreaterThanOrEqual(0)
      expect(deadlineIdx).toBeGreaterThanOrEqual(0)
      expect(atIdx).toBeLessThan(deadlineIdx)
    })
  })

  describe('ghost mode', () => {
    // Ghost rows used to be inert: right-click was suppressed entirely and the
    // dim styling had regressed. Now the row carries data-ghosted (CSS dims it)
    // and the same right-click menu opens as on non-ghost rows. The hook stops
    // gating handlers, so menu actions actually run.
    it('marks the row with data-ghosted', () => {
      render(<TaskRow todo={makeTodo({ id: 1 })} ghost />)
      expect(getRow().getAttribute('data-ghosted')).toBe('')
    })

    it('does not mark a non-ghost row with data-ghosted', () => {
      render(<TaskRow todo={makeTodo({ id: 1 })} />)
      expect(getRow().getAttribute('data-ghosted')).toBeNull()
    })

    it('opens the same context menu on right-click as a non-ghost row', () => {
      render(<TaskRow todo={makeTodo({ id: 1, title: 'Foo' })} ghost onOpenDetail={vi.fn()} />)
      act(() => {
        fireEvent.contextMenu(getRow(), { clientX: 50, clientY: 50 })
      })
      expect(screen.getByRole('menuitem', { name: 'Open' })).toBeInTheDocument()
      expect(screen.getByRole('menuitem', { name: 'Mark complete' })).toBeInTheDocument()
      expect(screen.getByRole('menuitemcheckbox', { name: 'Focus' })).toBeInTheDocument()
      expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument()
      // A ghost row renders no pickers, so the menu leaves their items out.
      expect(screen.queryByRole('menuitem', { name: 'Assign people…' })).toBeNull()
      expect(screen.queryByRole('menuitem', { name: 'Set due date…' })).toBeNull()
    })

    it('Mark complete on a ghost row routes through bulk.toggleComplete', () => {
      render(<TaskRow todo={makeTodo({ id: 7, title: 'Foo' })} ghost />)
      act(() => {
        fireEvent.contextMenu(getRow(), { clientX: 50, clientY: 50 })
      })
      fireEvent.click(screen.getByRole('menuitem', { name: 'Mark complete' }))
      expect(mockBulk.toggleComplete).toHaveBeenCalledWith(7)
    })
  })

  describe('hover-sync', () => {
    it('toggles data-hovered-synced when another surface sets hoveredTodoId', () => {
      render(<TaskRow todo={makeTodo({ id: 7 })} />)
      const row = getRow()
      expect(row.getAttribute('data-hovered-synced')).toBeNull()
      act(() => { useUIStore.getState().setHoveredTodoId(7) })
      expect(row.getAttribute('data-hovered-synced')).toBe('true')
      act(() => { useUIStore.getState().setHoveredTodoId(null) })
      expect(row.getAttribute('data-hovered-synced')).toBeNull()
    })

    it('writes hoveredTodoId on mouseenter and clears it on mouseleave', () => {
      render(<TaskRow todo={makeTodo({ id: 7 })} />)
      fireEvent.mouseEnter(getRow())
      expect(useUIStore.getState().hoveredTodoId).toBe(7)
      fireEvent.mouseLeave(getRow())
      expect(useUIStore.getState().hoveredTodoId).toBeNull()
    })
  })
})
