import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen, fireEvent, cleanup } from '@testing-library/react'
import { TaskRow } from '../../components/task/TaskRow'
import { useOrgStore } from '../../stores/org-store'
import { useStatusStore } from '../../stores/status-store'
import { useProjectStore } from '../../stores/project-store'
import { useTaskboardStore } from '../../stores/taskboard-store'
import { useUIStore } from '../../stores/ui-store'
import { makeTodo, makePerson, makeProject, makeOrg, resetEntityStores } from '../helpers'

const mockBulk = {
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
}

vi.mock('../../hooks/use-bulk-actions', () => ({
  useBulkActions: () => mockBulk,
}))

function getRow(): HTMLElement {
  return document.querySelector('[data-todo-id]') as HTMLElement
}

function resetStores() {
  resetEntityStores({ todos: false, tags: false })
  useTaskboardStore.setState({ board: null })
  useUIStore.setState({ hoveredTodoId: null })
}

describe('TaskRow (unified scheduling)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 3, 16)) // April 16, 2026 (Thursday)
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

  describe('past/overdue state', () => {
    it('applies the scheduledChipPast class when the scheduled date is in the past', () => {
      const { container } = render(
        <TaskRow todo={makeTodo({ id: 1, scheduledDate: { kind: 'date', value: new Date(2026, 3, 10) } })} />,
      )
      const chip = container.querySelector('[class*="scheduledChip"]') as HTMLElement
      expect(chip.className).toMatch(/scheduledChipPast/i)
    })

    it('does not apply the past class for a future scheduled date', () => {
      const { container } = render(
        <TaskRow todo={makeTodo({ id: 1, scheduledDate: { kind: 'date', value: new Date(2026, 3, 25) } })} />,
      )
      const chip = container.querySelector('[class*="scheduledChip"]') as HTMLElement
      expect(chip.className).not.toMatch(/scheduledChipPast/i)
    })

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

  describe('inline date editing', () => {
    it('clicking the scheduled chip opens an inline menu (does not open detail popup)', () => {
      const onOpenDetail = vi.fn()
      const { container } = render(
        <TaskRow todo={makeTodo({ id: 1, scheduledDate: { kind: 'fuzzy', token: 'today' } })} onOpenDetail={onOpenDetail} />,
      )
      const chip = container.querySelector('[class*="scheduledChip"]') as HTMLElement
      fireEvent.click(chip)
      // Grid presets become visible in the portaled menu
      expect(screen.getByText('Tomorrow')).toBeInTheDocument()
      expect(screen.getByText('Next week')).toBeInTheDocument()
      expect(onOpenDetail).not.toHaveBeenCalled()
    })

    it('picking a fuzzy option in the scheduled menu calls setScheduled', () => {
      const { container } = render(
        <TaskRow todo={makeTodo({ id: 1, scheduledDate: { kind: 'fuzzy', token: 'today' } })} />,
      )
      fireEvent.click(container.querySelector('[class*="scheduledChip"]') as HTMLElement)
      fireEvent.click(screen.getByText('Next week'))
      expect(mockBulk.setScheduled).toHaveBeenCalledWith(1, { kind: 'fuzzy', token: 'next-week' })
    })

    it('scheduled menu shows an "Add deadline" action when dueDate is not set', () => {
      const { container } = render(
        <TaskRow todo={makeTodo({ id: 1, scheduledDate: { kind: 'fuzzy', token: 'today' } })} />,
      )
      fireEvent.click(container.querySelector('[class*="scheduledChip"]') as HTMLElement)
      expect(screen.getByText(/Add deadline/i)).toBeInTheDocument()
    })

    it('scheduled menu hides the "Add deadline" action when a deadline is already set', () => {
      const { container } = render(
        <TaskRow
          todo={makeTodo({
            id: 1,
            scheduledDate: { kind: 'fuzzy', token: 'today' },
            dueDate: new Date(2026, 3, 20),
          })}
        />,
      )
      fireEvent.click(container.querySelector('[class*="scheduledChip"]') as HTMLElement)
      expect(screen.queryByText(/Add deadline/i)).not.toBeInTheDocument()
    })

    it('clicking the empty-state date button opens the scheduled menu inline', () => {
      const onOpenDetail = vi.fn()
      render(<TaskRow todo={makeTodo({ id: 1 })} onOpenDetail={onOpenDetail} />)
      fireEvent.click(screen.getByTitle('Schedule or set deadline'))
      expect(screen.getByText('Today')).toBeInTheDocument()
      expect(screen.getByText(/Add deadline/i)).toBeInTheDocument()
      expect(onOpenDetail).not.toHaveBeenCalled()
    })

    it('clicking the deadline chip opens the native date picker (does not open detail popup)', () => {
      const onOpenDetail = vi.fn()
      const { container } = render(
        <TaskRow todo={makeTodo({ id: 1, dueDate: new Date(2026, 3, 20) })} onOpenDetail={onOpenDetail} />,
      )
      fireEvent.click(container.querySelector('[class*="deadlineChip"]') as HTMLElement)
      vi.runAllTimers() // openDeadlinePicker uses setTimeout(…, 0)
      expect(HTMLInputElement.prototype.showPicker).toHaveBeenCalled()
      expect(onOpenDetail).not.toHaveBeenCalled()
    })

    it('clicking the deadline chip × button clears the deadline', () => {
      render(<TaskRow todo={makeTodo({ id: 1, dueDate: new Date(2026, 3, 20) })} />)
      fireEvent.click(screen.getByLabelText('Clear deadline'))
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

    it('renders orgs as a hollow AvatarStack, not as text chips', () => {
      const org = makeOrg({ id: 9, name: 'Acme', initials: 'AC', color: '#ff00ff' })
      useOrgStore.setState({ assignedOrgsMap: new Map([[1, [org]]]) })
      const { container } = render(<TaskRow todo={makeTodo({ id: 1 })} />)
      // No legacy "@Acme" org chip
      expect(screen.queryByText('@Acme')).not.toBeInTheDocument()
      // Hollow avatar with initials
      const hollow = container.querySelector('[class*="avatarHollow"]')
      expect(hollow).not.toBeNull()
      expect(hollow!.textContent).toBe('AC')
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

  describe('date-stack sizing', () => {
    it('applies the secondary class to the deadline chip only when both dates are present', () => {
      const { container } = render(
        <TaskRow
          todo={makeTodo({
            id: 1,
            scheduledDate: { kind: 'fuzzy', token: 'today' },
            dueDate: new Date(2026, 3, 20),
          })}
        />,
      )
      const deadline = container.querySelector('[class*="deadlineChip"]') as HTMLElement
      expect(deadline.className).toMatch(/dateStackSecondary/i)
    })

    it('does not apply the secondary class when only the deadline is set', () => {
      const { container } = render(
        <TaskRow todo={makeTodo({ id: 1, dueDate: new Date(2026, 3, 20) })} />,
      )
      const deadline = container.querySelector('[class*="deadlineChip"]') as HTMLElement
      expect(deadline.className).not.toMatch(/dateStackSecondary/i)
    })
  })

  describe('showContext sub-line', () => {
    it('renders `in <project name>` when showContext is true and the task has a project', () => {
      useProjectStore.setState({ projects: [makeProject({ id: 5, canvasId: 1, name: 'Launch plan' })] })
      render(<TaskRow todo={makeTodo({ id: 1, projectId: 5 })} showContext />)
      expect(screen.getByText('in Launch plan')).toBeInTheDocument()
    })

    it('does not render the context line when showContext is false', () => {
      useProjectStore.setState({ projects: [makeProject({ id: 5, canvasId: 1, name: 'Launch plan' })] })
      render(<TaskRow todo={makeTodo({ id: 1, projectId: 5 })} />)
      expect(screen.queryByText(/in Launch plan/i)).not.toBeInTheDocument()
    })
  })

  describe('inline tag chip (P2 — item 1)', () => {
    // Triage-2026-04-27 batch 2 P2 inverted the previous "tags never render
    // on the row" rule: now assigned tags render as `#name` chips parallel to
    // the people/org chip pattern, and a hover-revealed `#` empty trigger
    // mounts when no tags are assigned. Tag toggle goes through bulk actions.
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
        loading: false,
        error: null,
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
        loading: false,
        error: null,
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
        loading: false,
        error: null,
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
        loading: false,
        error: null,
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
        loading: false,
        error: null,
      })
      render(<TaskRow todo={makeTodo({ id: 1 })} ghost />)
      expect(screen.queryByLabelText('Add tag')).not.toBeInTheDocument()
    })
  })

  describe('@ trigger placement (item 8)', () => {
    // The empty-state @ button must render BEFORE the pill bar so it occupies
    // the people-chip slot. When people are populated, the avatar group inside
    // the pill bar takes that slot — same visual position either way.
    it('renders @ trigger before the pill bar in DOM order when no people are assigned', () => {
      const { container } = render(
        <TaskRow todo={makeTodo({ id: 1, dueDate: new Date(2026, 3, 20) })} />,
      )
      const buttons = Array.from(container.querySelectorAll('button')) as HTMLElement[]
      const atIdx = buttons.findIndex((b) => b.textContent?.trim() === '@')
      const deadlineIdx = buttons.findIndex((b) => b.getAttribute('aria-label') === 'Edit deadline')
      expect(atIdx).toBeGreaterThanOrEqual(0)
      expect(deadlineIdx).toBeGreaterThanOrEqual(0)
      expect(atIdx).toBeLessThan(deadlineIdx)
    })
  })

  describe('ghost mode (items 7, 9, 10)', () => {
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
      expect(screen.getByRole('menuitem', { name: /Add to Taskboard|Remove from Taskboard/ })).toBeInTheDocument()
      expect(screen.getByRole('menuitem', { name: 'Move to project…' })).toBeInTheDocument()
      expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument()
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
