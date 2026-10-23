import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import { TaskRow } from '../../components/task/TaskRow'
import { useStatusStore } from '../../stores/status-store'
import { useUIStore } from '../../stores/ui-store'
import { useSettingsStore } from '../../stores/settings-store'
import { useTodoStore } from '../../stores/todo-store'
import { useTagStore } from '../../stores/tag-store'
import { TaskRowColumnsContext } from '../../components/task/task-row-grid-context'
import { createValueStore } from '../../utils/value-store'
import { taskRowColumns } from '../../utils/task-row-columns'
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

  describe('due column', () => {
    it('shows the due date as MM/DD (tabular), named with the full day', () => {
      render(<TaskRow todo={makeTodo({ id: 1, dueDate: new Date(2026, 3, 20) })} />)
      const due = screen.getByRole('button', { name: 'Due Mon 20 Apr' })
      expect(due).toHaveTextContent('04/20')
    })

    it('the date follows a clock; a repeating task shows the repeat glyph in its place', () => {
      const { unmount } = render(<TaskRow todo={makeTodo({ id: 1, dueDate: new Date(2026, 3, 20) })} />)
      const once = screen.getByRole('button', { name: 'Due Mon 20 Apr' })
      expect(once.querySelectorAll('svg')).toHaveLength(1)
      expect(once.querySelector('circle')).not.toBeNull()
      unmount()
      render(<TaskRow todo={makeTodo({ id: 1, dueDate: new Date(2026, 3, 20), recurrenceRule: { type: 'weekly' } })} />)
      const repeating = screen.getByRole('button', { name: 'Due Mon 20 Apr' })
      expect(repeating).toHaveTextContent('04/20')
      expect(repeating.querySelector('circle')).toBeNull()
    })

    it('marks an overdue date (text colour + bold, no fill), not a future one', () => {
      const { unmount } = render(<TaskRow todo={makeTodo({ id: 1, dueDate: new Date(2026, 3, 10) })} />)
      expect(screen.getByRole('button', { name: /^Due / })).toHaveAttribute('data-due-past', 'true')
      unmount()
      render(<TaskRow todo={makeTodo({ id: 1, dueDate: new Date(2026, 3, 25) })} />)
      expect(screen.getByRole('button', { name: /^Due / })).not.toHaveAttribute('data-due-past')
    })

    it('an empty due cell is the Set due date button with a hidden placeholder', () => {
      render(<TaskRow todo={makeTodo({ id: 1 })} />)
      const empty = screen.getByRole('button', { name: 'Set due date' })
      expect(empty.querySelector('[aria-hidden="true"]')).not.toBeNull()
      expect(empty.textContent).toBe('')
    })

    it('the tooltip gives the full date, the distance and the repeat rule', () => {
      render(<TaskRow todo={makeTodo({ id: 1, dueDate: new Date(2026, 3, 20), recurrenceRule: { type: 'weekly' } })} />)
      fireEvent.pointerEnter(screen.getByRole('button', { name: 'Due Mon 20 Apr' }))
      act(() => { vi.advanceTimersByTime(400) })
      expect(screen.getByRole('tooltip')).toHaveTextContent('Monday, April 20, 2026In 4 daysRepeats every Monday')
    })
  })

  describe('every column always there', () => {
    it('renders one cell per column in order, filled or empty', () => {
      const { container } = render(<TaskRow todo={makeTodo({ id: 1 })} />)
      const cells = Array.from(container.querySelectorAll('[data-row-cell]')).map((el) => el.getAttribute('data-row-cell'))
      expect(cells).toEqual(['markers', 'checkbox', 'notes', 'people', 'tags', 'dates', 'due', 'followup', 'status'])
      for (const name of ['Add progress or notes', 'Assign people', 'Add tag', 'Set due date', 'Set follow-up', 'Set status']) {
        expect(screen.getByRole('button', { name })).toBeInTheDocument()
      }
    })

    it('no progress on the row (it stays in the editor) and no drag grip', () => {
      const { container } = render(<TaskRow todo={makeTodo({ id: 1, progress: '50%' })} />)
      expect(screen.queryByText('50%')).toBeNull()
      expect(container.querySelector('[class*="dragHandle"]')).toBeNull()
    })

    it('squeezed details remove the tags column once the dates are icons, then people; their pickers then open at the row', () => {
      const tags = [{ id: 1, name: 'alpha', color: '#111' }]
      useTagStore.setState({ tags, assignedTagsMap: new Map([[1, tags]]) })
      // The dates as icons: F = 149 − 74 − 20 = 55, just under the split.
      render(
        <TaskRowColumnsContext.Provider value={createValueStore(taskRowColumns(528, 149))}>
          <TaskRow todo={makeTodo({ id: 1 })} />
        </TaskRowColumnsContext.Provider>,
      )
      expect(screen.queryByRole('button', { name: 'Tags: alpha' })).toBeNull()
      expect(screen.getByRole('button', { name: 'Assign people' })).toBeInTheDocument()
      fireEvent.contextMenu(getRow())
      fireEvent.click(screen.getByRole('menuitem', { name: 'Add tag…' }))
      expect(screen.getByPlaceholderText('Search tags...')).toBeInTheDocument()
    })
  })

  describe('dates cell', () => {
    const dated = () => makeTodo({ id: 1, dueDate: new Date(2026, 3, 20), nextFollowupAt: new Date(2026, 3, 24) })
    const inList = (width: number) => (
      <TaskRowColumnsContext.Provider value={createValueStore(taskRowColumns(width))}>
        <TaskRow todo={dated()} />
      </TaskRowColumnsContext.Provider>
    )

    it('shows both dates beside their icons, each part its own button', () => {
      render(inList(528))
      expect(screen.getByRole('button', { name: 'Due Mon 20 Apr' })).toHaveTextContent('04/20')
      expect(screen.getByRole('button', { name: 'Follow-up: Fri 24' })).toHaveTextContent('04/24')
      expect(document.querySelector('[data-row-cell="dates"]')).toHaveAttribute('data-dates-tier', 'both')
    })

    it('a narrower list drops the follow-up date first, then the due date (the icons and names stay)', () => {
      const { unmount } = render(inList(330))
      expect(screen.getByRole('button', { name: 'Due Mon 20 Apr' })).toHaveTextContent('04/20')
      expect(screen.getByRole('button', { name: 'Follow-up: Fri 24' }).textContent).toBe('')
      expect(screen.queryByRole('button', { name: 'Clear follow-up' })).toBeNull()
      unmount()
      render(inList(300))
      const due = screen.getByRole('button', { name: 'Due Mon 20 Apr' })
      expect(due.textContent).toBe('')
      expect(due.querySelector('svg')).not.toBeNull()
      expect(screen.getByRole('button', { name: 'Follow-up: Fri 24' }).textContent).toBe('')
      expect(screen.queryByRole('button', { name: 'Clear due date' })).toBeNull()
    })

    it('an icons-only part still gives its date in the tooltip', () => {
      render(inList(300))
      fireEvent.pointerEnter(screen.getByRole('button', { name: 'Follow-up: Fri 24' }))
      act(() => { vi.advanceTimersByTime(400) })
      expect(screen.getByRole('tooltip')).toHaveTextContent('Next follow-up · Fri 24')
    })

    it('each part has its own clear ×', () => {
      render(inList(528))
      fireEvent.click(screen.getByRole('button', { name: 'Clear follow-up' }))
      expect(mockBulk.setFollowup).toHaveBeenCalledWith(1, null)
      expect(mockBulk.setDeadline).not.toHaveBeenCalled()
      fireEvent.click(screen.getByRole('button', { name: 'Clear due date' }))
      expect(mockBulk.setDeadline).toHaveBeenCalledWith(1, null)
    })

    it('a task without dates: the clock and flag placeholders, Set due date / Set follow-up', () => {
      render(<TaskRow todo={makeTodo({ id: 1 })} />)
      for (const name of ['Set due date', 'Set follow-up']) {
        const part = screen.getByRole('button', { name })
        expect(part.querySelector('[class*="ph"] svg')).not.toBeNull()
        expect(part.textContent).toBe('')
      }
      expect(screen.queryByRole('button', { name: /^Clear/ })).toBeNull()
    })
  })

  describe('task menu', () => {
    beforeEach(() => {
      useSettingsStore.setState({ urgentDueWithinDays: 3 })
    })

    it('right-click opens the task menu (markers under Priority, no project items)', () => {
      render(<TaskRow todo={makeTodo({ id: 1 })} onOpenDetail={vi.fn()} />)
      fireEvent.contextMenu(getRow())
      const menu = screen.getByRole('menu', { name: 'Task actions' })
      expect(within(menu).getByText('Priority')).toBeInTheDocument()
      expect(screen.queryByText(/project/i)).not.toBeInTheDocument()
      for (const name of ['Open', 'Mark complete', 'Set due date…', 'Mark followed up', 'Assign people…', 'Add tag…', 'Delete']) {
        expect(screen.getByRole('menuitem', { name })).toBeInTheDocument()
      }
      expect(screen.getByRole('menuitem', { name: /^Follow-up/ })).toHaveAttribute('aria-haspopup', 'menu')
      for (const name of ['Urgent', 'Important', 'Focus']) {
        expect(screen.getByRole('menuitemcheckbox', { name })).toHaveAttribute('aria-checked', 'false')
      }
    })

    it('has no ⋯ button: the context-menu key on a focused cell opens the menu; Esc returns focus to the cell', () => {
      render(<TaskRow todo={makeTodo({ id: 1 })} />)
      expect(screen.queryByRole('button', { name: 'Task actions' })).toBeNull()
      expect(getRow().querySelector('[data-row-cell="more"]')).toBeNull()
      const status = screen.getByRole('button', { name: 'Set status' })
      act(() => { status.focus() })
      fireEvent.contextMenu(status)
      expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Mark complete' }))
      fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' })
      expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Copy' }))
      fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' })
      expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Set due date…' }))
      fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
      expect(screen.queryByRole('menu')).toBeNull()
      expect(document.activeElement).toBe(status)
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

    it('a task urgent only by its due date shows Urgent unchecked, by due date; clicking flags it', () => {
      render(<TaskRow todo={makeTodo({ id: 4, dueDate: new Date(2026, 3, 18) })} />)
      fireEvent.contextMenu(getRow())
      const urgent = screen.getByRole('menuitemcheckbox', { name: /^Urgent/ })
      expect(urgent).toHaveAttribute('aria-checked', 'false')
      expect(urgent).toHaveTextContent('By due date')
      fireEvent.click(urgent)
      expect(mockBulk.setUrgent).toHaveBeenCalledWith(4, true)
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

    it('Mark followed up, Set due date…, Assign people… and Add tag… reach their row actions', () => {
      render(<TaskRow todo={makeTodo({ id: 6 })} />)
      fireEvent.contextMenu(getRow())
      fireEvent.click(screen.getByRole('menuitem', { name: 'Mark followed up' }))
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

  describe('marker gutter', () => {
    beforeEach(() => {
      useSettingsStore.setState({ urgentDueWithinDays: 3 })
    })

    it('three dots Focus · Urgent · Important in one button named by the markers, before the checkbox', () => {
      render(<TaskRow todo={makeTodo({ id: 1, title: 'All three', urgent: true, important: true, focus: true })} />)
      const gutter = screen.getByRole('button', { name: 'Priority: Focus, Urgent, Important' })
      const dots = Array.from(gutter.querySelectorAll('[data-dot]'))
      expect(dots.map((d) => [d.getAttribute('data-dot'), d.getAttribute('data-on')])).toEqual([
        ['focus', 'true'], ['urgent', 'flag'], ['important', 'true'],
      ])
      expect(gutter.compareDocumentPosition(screen.getByRole('checkbox')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    })

    it('urgent only by its due date is the ring, named and explained in the tooltip', () => {
      render(<TaskRow todo={makeTodo({ id: 1, title: 'Soon', dueDate: new Date(2026, 3, 18) })} />)
      const gutter = screen.getByRole('button', { name: 'Priority: Urgent (due soon)' })
      expect(gutter.querySelector('[data-dot="urgent"]')).toHaveAttribute('data-on', 'date')
      fireEvent.pointerEnter(gutter)
      act(() => { vi.advanceTimersByTime(400) })
      expect(screen.getByRole('tooltip')).toHaveTextContent('Priority: Urgent (due soon)Due Sat 18, within 3 days.')
    })

    it('no marker: No markers (range off, a far date, a completed task)', () => {
      useSettingsStore.setState({ urgentDueWithinDays: null })
      const { unmount } = render(<TaskRow todo={makeTodo({ id: 1, dueDate: new Date(2026, 3, 15) })} />)
      expect(screen.getByRole('button', { name: 'No priority' })).toBeInTheDocument()
      unmount()
      useSettingsStore.setState({ urgentDueWithinDays: 3 })
      const second = render(<TaskRow todo={makeTodo({ id: 1, dueDate: new Date(2026, 3, 30) })} />)
      expect(screen.getByRole('button', { name: 'No priority' })).toBeInTheDocument()
      second.unmount()
      render(<TaskRow todo={makeTodo({ id: 1, isCompleted: true, dueDate: new Date(2026, 3, 15) })} />)
      expect(screen.getByRole('button', { name: 'No priority' })).toBeInTheDocument()
    })

    it('a click opens the markers menu; its items flip the flags (urgent by date: unchecked, a click flags it)', () => {
      render(<TaskRow todo={makeTodo({ id: 4, focus: true, dueDate: new Date(2026, 3, 18) })} onOpenDetail={vi.fn()} />)
      fireEvent.click(screen.getByRole('button', { name: 'Priority: Focus, Urgent (due soon)' }))
      const menu = screen.getByRole('menu', { name: 'Priority' })
      expect(within(menu).getByRole('menuitemcheckbox', { name: 'Focus' })).toHaveAttribute('aria-checked', 'true')
      expect(within(menu).getByRole('menuitemcheckbox', { name: 'Important' })).toHaveAttribute('aria-checked', 'false')
      expect(within(menu).getByRole('menuitemcheckbox', { name: /^Urgent/ })).toHaveAttribute('aria-checked', 'false')
      fireEvent.click(within(menu).getByRole('menuitemcheckbox', { name: /^Urgent/ }))
      expect(mockBulk.setUrgent).toHaveBeenCalledWith(4, true)
      fireEvent.click(screen.getByRole('button', { name: /^Priority:/ }))
      fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Important' }))
      expect(mockBulk.setImportant).toHaveBeenCalledWith(4, true)
    })
  })

  describe('cells open their pickers', () => {
    it('the empty due cell and a filled one open the native date picker (not the editor)', () => {
      const onOpenDetail = vi.fn()
      const { unmount } = render(<TaskRow todo={makeTodo({ id: 1 })} onOpenDetail={onOpenDetail} />)
      fireEvent.click(screen.getByRole('button', { name: 'Set due date' }))
      act(() => { vi.runAllTimers() }) // openDeadlinePicker uses setTimeout(…, 0)
      expect(HTMLInputElement.prototype.showPicker).toHaveBeenCalledTimes(1)
      unmount()
      render(<TaskRow todo={makeTodo({ id: 1, dueDate: new Date(2026, 3, 20) })} onOpenDetail={onOpenDetail} />)
      fireEvent.click(screen.getByRole('button', { name: 'Due Mon 20 Apr' }))
      act(() => { vi.runAllTimers() })
      expect(HTMLInputElement.prototype.showPicker).toHaveBeenCalledTimes(2)
      expect(onOpenDetail).not.toHaveBeenCalled()
    })

    it('the due cell’s × clears the due date', () => {
      render(<TaskRow todo={makeTodo({ id: 1, dueDate: new Date(2026, 3, 20) })} />)
      fireEvent.click(screen.getByRole('button', { name: 'Clear due date' }))
      expect(mockBulk.setDeadline).toHaveBeenCalledWith(1, null)
    })

    it('a double-click on a cell opens its picker once and not the editor; on the title it opens the editor', () => {
      const onOpenDetail = vi.fn()
      render(<TaskRow todo={makeTodo({ id: 1, title: 'Foo' })} onOpenDetail={onOpenDetail} />)
      const status = screen.getByRole('button', { name: 'Set status' })
      fireEvent.click(status, { detail: 1 })
      fireEvent.click(status, { detail: 2 })
      fireEvent.doubleClick(status)
      expect(screen.getByText('No Status')).toBeInTheDocument()
      expect(status).toHaveAttribute('aria-expanded', 'true')
      expect(onOpenDetail).not.toHaveBeenCalled()
      fireEvent.doubleClick(screen.getByText('Foo'))
      expect(onOpenDetail).toHaveBeenCalledWith(1)
    })

    it('the status cell opens the status menu; the follow-up cell names the day and opens the popover', () => {
      useStatusStore.setState({ statuses: [{ id: 10, name: 'Done', icon: 'check', color: '#00ff00', sortOrder: 0 }] })
      render(<TaskRow todo={makeTodo({ id: 1, statusId: 10, nextFollowupAt: new Date(2026, 3, 20) })} />)
      fireEvent.click(screen.getByRole('button', { name: 'Status: Done' }))
      fireEvent.click(screen.getByText('No Status'))
      expect(mockBulk.setStatus).toHaveBeenCalledWith(1, undefined)
      const followup = screen.getByRole('button', { name: 'Follow-up: Mon 20' })
      expect(followup).toHaveAttribute('data-followup', 'upcoming')
      expect(followup.textContent).toBe('04/20')
      fireEvent.click(followup)
      const popover = screen.getByRole('dialog', { name: 'Follow-up' })
      // Its Mark followed up hands the row's action the field's date (here: cleared → none).
      fireEvent.click(within(popover).getByRole('button', { name: 'Clear next follow-up' }))
      fireEvent.click(within(popover).getByRole('button', { name: 'Mark followed up' }))
      expect(mockBulk.markFollowedUp).toHaveBeenCalledWith(1, null)
    })

    it('a late follow-up is the filled, late flag; today’s is filled', () => {
      const { unmount } = render(<TaskRow todo={makeTodo({ id: 1, nextFollowupAt: new Date(2026, 3, 10) })} />)
      expect(screen.getByRole('button', { name: /, late$/ })).toHaveAttribute('data-followup', 'late')
      unmount()
      render(<TaskRow todo={makeTodo({ id: 1, nextFollowupAt: new Date(2026, 3, 16) })} />)
      expect(screen.getByRole('button', { name: 'Follow-up: Today' })).toHaveAttribute('data-followup', 'today')
    })

    it('the notes cell: Add progress or notes when empty; Edit progress and notes with either', () => {
      const { unmount } = render(<TaskRow todo={makeTodo({ id: 1 })} />)
      const empty = screen.getByRole('button', { name: 'Add progress or notes' })
      // Empty: the placeholder glyph only (hidden until hover / focus).
      expect(empty.querySelector('[class*="ph"]')).not.toBeNull()
      unmount()
      for (const fields of [{ notes: 'Some notes' }, { progress: '50%' }, { notes: 'n', progress: 'p' }]) {
        const { unmount: u } = render(<TaskRow todo={makeTodo({ id: 1, ...fields })} />)
        const cell = screen.getByRole('button', { name: 'Edit progress and notes' })
        // Filled: the glyph itself, not a placeholder.
        expect(cell.querySelector('svg')).not.toBeNull()
        expect(cell.querySelector('[class*="ph"]')).toBeNull()
        u()
      }
      // Spaces only is no progress.
      render(<TaskRow todo={makeTodo({ id: 1, progress: '  ' })} />)
      expect(screen.getByRole('button', { name: 'Add progress or notes' })).toBeInTheDocument()
    })

    it('hovering the notes cell previews the progress and the notes', () => {
      render(<TaskRow todo={makeTodo({ id: 1, progress: '50% done', notes: '## Call\n- ask about **budget**' })} />)
      fireEvent.pointerEnter(screen.getByRole('button', { name: 'Edit progress and notes' }))
      act(() => { vi.advanceTimersByTime(400) })
      const tip = screen.getByRole('tooltip')
      expect(tip).toHaveTextContent('Progress: 50% done')
      expect(tip).toHaveTextContent('Notes')
      expect(tip).toHaveTextContent('Call')
      expect(tip).toHaveTextContent('• ask about budget')
      expect(tip.textContent).not.toContain('**')
    })

    it('an empty notes cell shows no preview', () => {
      render(<TaskRow todo={makeTodo({ id: 1 })} />)
      fireEvent.pointerEnter(screen.getByRole('button', { name: 'Add progress or notes' }))
      act(() => { vi.advanceTimersByTime(400) })
      expect(screen.queryByRole('tooltip')).toBeNull()
    })

    it('a click opens the progress and notes popover; no preview while it is open', () => {
      useTodoStore.setState({ todos: [makeTodo({ id: 1, progress: '50%' })] })
      render(<TaskRow todo={makeTodo({ id: 1, progress: '50%' })} />)
      const cell = screen.getByRole('button', { name: 'Edit progress and notes' })
      fireEvent.click(cell)
      expect(screen.getByRole('dialog', { name: 'Progress and notes' })).toBeInTheDocument()
      expect(cell).toHaveAttribute('aria-expanded', 'true')
      fireEvent.pointerEnter(cell)
      act(() => { vi.advanceTimersByTime(400) })
      expect(screen.queryByRole('tooltip')).toBeNull()
    })
  })

  describe('people column', () => {
    it('renders overlapping avatars for assigned people, named in the cell', () => {
      const people = [
        makePerson({ id: 1, name: 'Alice', initials: 'AL' }),
        makePerson({ id: 2, name: 'Bob', initials: 'BO' }),
      ]
      render(<TaskRow todo={makeTodo({ id: 1 })} assignedPeople={people} />)
      expect(screen.getByRole('button', { name: 'People: Alice, Bob' })).toBeInTheDocument()
      expect(screen.getByText('AL')).toBeInTheDocument()
      expect(screen.getByText('BO')).toBeInTheDocument()
    })

    it('as many avatars as fit the column, then +N', () => {
      const people = [1, 2, 3, 4].map((id) => makePerson({ id, name: `P${id}`, initials: `P${id}` }))
      render(<TaskRow todo={makeTodo({ id: 1 })} assignedPeople={people} />)
      // The default people column (55px) fits two avatars and "+2".
      expect(screen.getByText('P2')).toBeInTheDocument()
      expect(screen.queryByText('P3')).toBeNull()
      expect(screen.getByText('+2')).toBeInTheDocument()
    })

    it('right-click on an avatar: Show tasks · Edit… · Delete… for that person', () => {
      const people = [makePerson({ id: 1, name: 'Alice', initials: 'AL' }), makePerson({ id: 2, name: 'Bob', initials: 'BO' })]
      render(<TaskRow todo={makeTodo({ id: 1 })} assignedPeople={people} />)
      fireEvent.contextMenu(screen.getByText('AL'))
      const menu = screen.getByRole('menu', { name: '@Alice' })
      expect(screen.queryByRole('menu', { name: 'Task actions' })).toBeNull()
      expect(within(menu).getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Show tasks', 'Edit…', 'Delete…'])
      fireEvent.click(within(menu).getByRole('menuitem', { name: 'Show tasks' }))
      expect(useUIStore.getState().taskDialog).toMatchObject({ personId: 1, title: 'Alice' })

      fireEvent.contextMenu(screen.getByText('AL'))
      fireEvent.click(screen.getByRole('menuitem', { name: 'Edit…' }))
      expect(useUIStore.getState().entityAction).toEqual({ kind: 'person', id: 1, action: 'edit' })
      fireEvent.contextMenu(screen.getByText('AL'))
      fireEvent.click(screen.getByRole('menuitem', { name: 'Delete…' }))
      expect(useUIStore.getState().entityAction).toEqual({ kind: 'person', id: 1, action: 'delete' })
    })

    it('a context menu on the cell itself (the keyboard’s) lists each person with their actions', () => {
      const people = [makePerson({ id: 1, name: 'Alice', initials: 'AL' }), makePerson({ id: 2, name: 'Bob', initials: 'BO' })]
      render(<TaskRow todo={makeTodo({ id: 1 })} assignedPeople={people} />)
      fireEvent.contextMenu(screen.getByRole('button', { name: 'People: Alice, Bob' }))
      const menu = screen.getByRole('menu', { name: 'People' })
      expect(within(menu).getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['@Alice', '@Bob'])
      expect(within(menu).getByRole('menuitem', { name: '@Bob' })).toHaveAttribute('aria-haspopup', 'menu')
    })

    it('an empty people cell keeps the task menu', () => {
      render(<TaskRow todo={makeTodo({ id: 1 })} assignedPeople={[]} />)
      fireEvent.contextMenu(screen.getByRole('button', { name: 'Assign people' }))
      expect(screen.getByRole('menu', { name: 'Task actions' })).toBeInTheDocument()
    })
  })

  describe('tags column', () => {
    it('coloured #name text, whole tags while they fit, then +N; the cell names them all', () => {
      const tags = [
        { id: 1, name: 'alpha', color: '#ff0000' },
        { id: 2, name: 'beta', color: '#222' },
      ]
      useTagStore.setState({ tags, assignedTagsMap: new Map([[1, tags]]) })
      render(<TaskRow todo={makeTodo({ id: 1, title: 'Prepare deck' })} />)
      const cell = screen.getByRole('button', { name: 'Tags: alpha, beta' })
      expect(within(cell).getByText('#alpha')).toHaveStyle({ color: '#ff0000' })
      expect(within(cell).queryByText('#beta')).toBeNull()
      expect(within(cell).getByText('+1')).toBeInTheDocument()
    })

    it('right-click on a tag: Show tasks opens the tag’s task dialog; Edit… / Delete… act on it', () => {
      const tags = [{ id: 1, name: 'alpha', color: '#ff0000' }]
      useTagStore.setState({ tags, assignedTagsMap: new Map([[1, tags]]) })
      render(<TaskRow todo={makeTodo({ id: 1 })} />)
      fireEvent.contextMenu(screen.getByText('#alpha'))
      const menu = screen.getByRole('menu', { name: '#alpha' })
      fireEvent.click(within(menu).getByRole('menuitem', { name: 'Show tasks' }))
      expect(useUIStore.getState().taskDialog).toMatchObject({
        title: '#alpha',
        source: { kind: 'predicate', predicate: expect.objectContaining({ tags: [1] }) },
      })
      fireEvent.contextMenu(screen.getByText('#alpha'))
      fireEvent.click(screen.getByRole('menuitem', { name: 'Edit…' }))
      expect(useUIStore.getState().entityAction).toEqual({ kind: 'tag', id: 1, action: 'edit' })
    })

    it('an empty tags cell is Add tag', () => {
      useTagStore.setState({ tags: [{ id: 1, name: 'alpha', color: '#111' }], assignedTagsMap: new Map() })
      render(<TaskRow todo={makeTodo({ id: 1 })} />)
      expect(screen.getByRole('button', { name: 'Add tag' })).toBeInTheDocument()
    })

    it('clicking the tags cell opens the lookup-or-create picker; picking a tag assigns it', () => {
      useTagStore.setState({
        tags: [{ id: 1, name: 'alpha', color: '#111' }, { id: 2, name: 'beta', color: '#222' }],
        assignedTagsMap: new Map([[1, [{ id: 1, name: 'alpha', color: '#111' }]]]),
      })
      render(<TaskRow todo={makeTodo({ id: 1 })} />)
      fireEvent.click(screen.getByRole('button', { name: 'Tags: alpha' }))
      expect(screen.getByPlaceholderText('Search tags...')).toBeInTheDocument()
      fireEvent.click(screen.getByText('beta'))
      expect(mockBulk.quickAssignTag).toHaveBeenCalledWith(1, 2)
    })

    it('a ghost row has no cells', () => {
      useTagStore.setState({ tags: [], assignedTagsMap: new Map() })
      render(<TaskRow todo={makeTodo({ id: 1 })} ghost />)
      expect(screen.queryByLabelText('Add tag')).not.toBeInTheDocument()
      expect(screen.queryByLabelText('Set due date')).not.toBeInTheDocument()
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
