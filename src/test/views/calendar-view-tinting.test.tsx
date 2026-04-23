import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { CalendarView } from '../../views/CalendarView'
import { useTodoStore } from '../../stores/todo-store'
import { usePersonStore } from '../../stores/person-store'
import { useOrgStore } from '../../stores/org-store'
import { useStatusStore } from '../../stores/status-store'
import { useProjectStore } from '../../stores/project-store'
import { useFilterStore } from '../../stores/filter-store'
import { useUIStore } from '../../stores/ui-store'
import { makeTodo } from '../helpers'

vi.mock('../../data/todo-repository', () => ({
  todoRepository: {
    getAll: async () => [],
    getById: async () => undefined,
    insert: async () => 1,
    update: async () => {},
    remove: async () => {},
    bulkUpdate: async () => {},
    bulkDelete: async () => {},
    purgeExpired: async () => 0,
  },
}))
vi.mock('../../data/person-repository', () => ({
  personRepository: {
    getAll: async () => [],
    getAssignedPeopleForTodos: async () => new Map(),
    assignPerson: async () => {},
    unassignPerson: async () => {},
  },
}))
vi.mock('../../data/org-repository', () => ({
  orgRepository: {
    getAll: async () => [],
    getAssignedOrgsForTodos: async () => new Map(),
    getPersonOrgMap: async () => new Map(),
    assignOrg: async () => {},
    unassignOrg: async () => {},
  },
}))
vi.mock('../../data/status-repository', () => ({
  statusRepository: { getAll: async () => [] },
}))
vi.mock('../../data/project-repository', () => ({
  projectRepository: { getAll: async () => [] },
}))

function resetStores() {
  useTodoStore.setState({ todos: [] })
  usePersonStore.setState({ people: [], assignedPeopleMap: new Map() })
  useOrgStore.setState({ orgs: [], assignedOrgsMap: new Map(), personOrgMap: new Map() })
  useStatusStore.setState({ statuses: [] })
  useProjectStore.setState({ projects: [] })
  useUIStore.getState().closeEditPopup?.()
  useFilterStore.getState().setAllFilters({
    showCompleted: false,
    showHiddenStatuses: false,
    personIds: null,
    personFilterMode: 'include-orgs',
    orgIds: null,
    orgFilterMode: 'include-people',
    projectIds: null,
    statusIds: null,
    searchText: '',
    dateField: 'date',
    dateRangeStart: null,
    dateRangeEnd: null,
    dateRangeIncludeNoDate: false,
    hasScheduled: null,
    hasDeadline: null,
    tags: null,
  })
}

function findTaskItem(container: HTMLElement, todoId: number): HTMLElement | null {
  // Find by a displayKey-derived signature. Easier: find .taskItem whose inner
  // span text matches the todo title, since makeTodo titles are stable.
  const items = Array.from(container.querySelectorAll('[class*="taskItem"]')) as HTMLElement[]
  for (const item of items) {
    if (item.textContent?.includes(`Task ${todoId}`)) return item
  }
  return null
}

describe('CalendarView — date-type tinting', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // Mid-month reference date so same-month neighbours fall inside the grid.
    vi.setSystemTime(new Date(2026, 3, 16)) // Thu Apr 16 2026
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }),
    })
    resetStores()
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('tints scheduled-only tasks with the taskItemScheduled class', () => {
    useTodoStore.setState({
      todos: [makeTodo({ id: 1, scheduledDate: { kind: 'date', value: new Date(2026, 3, 20) } })],
    })
    const { container } = render(<CalendarView />)
    const item = findTaskItem(container, 1)
    expect(item).not.toBeNull()
    expect(item!.className).toMatch(/taskItemScheduled/)
    expect(item!.className).not.toMatch(/taskItemDeadline/)
  })

  it('tints deadline-only tasks with the taskItemDeadline class', () => {
    useTodoStore.setState({
      todos: [makeTodo({ id: 2, dueDate: new Date(2026, 3, 20) })],
    })
    const { container } = render(<CalendarView />)
    const item = findTaskItem(container, 2)
    expect(item).not.toBeNull()
    expect(item!.className).toMatch(/taskItemDeadline/)
    expect(item!.className).not.toMatch(/taskItemScheduled/)
  })

  it('tints both-set tasks with the taskItemBoth class and shows both marker icons', () => {
    useTodoStore.setState({
      todos: [
        makeTodo({
          id: 3,
          scheduledDate: { kind: 'date', value: new Date(2026, 3, 20) },
          dueDate: new Date(2026, 3, 22),
        }),
      ],
    })
    const { container } = render(<CalendarView />)
    const item = findTaskItem(container, 3)
    expect(item).not.toBeNull()
    expect(item!.className).toMatch(/taskItemBoth/)
    expect(item!.className).not.toMatch(/taskItemScheduled\b/)
    expect(item!.querySelector('[class*="scheduledMarker"]')).toBeTruthy()
    expect(item!.querySelector('[class*="deadlineMarker"]')).toBeTruthy()
    expect(item!.querySelector('[class*="deadlineBadge"]')).toBeNull()
  })

  it('applies the taskItemPastDeadline stamp when the deadline is overdue', () => {
    useTodoStore.setState({
      todos: [makeTodo({ id: 4, dueDate: new Date(2026, 3, 10) })],
    })
    const { container } = render(<CalendarView />)
    const item = findTaskItem(container, 4)
    expect(item).not.toBeNull()
    expect(item!.className).toMatch(/taskItemPastDeadline/)
  })

  it('applies the taskItemPastScheduled class when only the scheduled date is past', () => {
    useTodoStore.setState({
      todos: [makeTodo({ id: 5, scheduledDate: { kind: 'date', value: new Date(2026, 3, 10) } })],
    })
    const { container } = render(<CalendarView />)
    const item = findTaskItem(container, 5)
    expect(item).not.toBeNull()
    expect(item!.className).toMatch(/taskItemPastScheduled/)
  })

  it('past-deadline wins when both scheduled + deadline are in the past', () => {
    useTodoStore.setState({
      todos: [
        makeTodo({
          id: 6,
          scheduledDate: { kind: 'date', value: new Date(2026, 3, 5) },
          dueDate: new Date(2026, 3, 10),
        }),
      ],
    })
    const { container } = render(<CalendarView />)
    const item = findTaskItem(container, 6)
    expect(item).not.toBeNull()
    expect(item!.className).toMatch(/taskItemPastDeadline/)
    expect(item!.className).not.toMatch(/taskItemPastScheduled/)
  })

  it('virtual recurring instances inherit the scheduled tint without past-class', () => {
    useTodoStore.setState({
      todos: [
        makeTodo({
          id: 7,
          scheduledDate: { kind: 'date', value: new Date(2026, 3, 18) },
          recurrenceRule: { type: 'weekly' },
        }),
      ],
    })
    const { container } = render(<CalendarView />)
    // The primary task renders on Apr 18, and a virtual instance on Apr 25.
    // Both should be tinted scheduled; neither carries a past class.
    const items = Array.from(container.querySelectorAll('[class*="taskItem"]'))
      .filter((el) => (el.textContent ?? '').includes('Task 7')) as HTMLElement[]
    expect(items.length).toBeGreaterThanOrEqual(2)
    for (const el of items) {
      expect(el.className).toMatch(/taskItemScheduled/)
      expect(el.className).not.toMatch(/taskItemPast/)
    }
  })

  it('renders both-set tasks on their scheduled day even when scheduled > deadline', () => {
    // Regression: effectiveDate = min(sched, due) previously clamped a
    // dragged both-set task back to the deadline cell, making drag feel
    // broken. Render primary = scheduledDay when set.
    useTodoStore.setState({
      todos: [
        makeTodo({
          id: 9,
          scheduledDate: { kind: 'date', value: new Date(2026, 3, 25) },
          dueDate: new Date(2026, 3, 20),
        }),
      ],
    })
    const { container } = render(<CalendarView />)
    const cells = Array.from(container.querySelectorAll('[class*="dayCell"]')) as HTMLElement[]
    const dayOf = (el: HTMLElement) => {
      // Each cell's first child is the day number span.
      const numEl = el.querySelector('[class*="dayNumber"]')
      return numEl ? parseInt(numEl.textContent ?? '', 10) : NaN
    }
    const cellWithTask = cells.find((c) => (c.textContent ?? '').includes('Task 9'))
    expect(cellWithTask).toBeDefined()
    expect(dayOf(cellWithTask!)).toBe(25)
  })

  it('wires --date-intensity inline style on each tinted item', () => {
    useTodoStore.setState({
      todos: [
        makeTodo({ id: 8, scheduledDate: { kind: 'date', value: new Date(2026, 3, 20) } }),
      ],
    })
    const { container } = render(<CalendarView />)
    const item = findTaskItem(container, 8)
    expect(item).not.toBeNull()
    // Style property names are case-insensitive; jsdom lowercases custom
    // property names so we read via getPropertyValue.
    const v = item!.style.getPropertyValue('--date-intensity')
    expect(v).not.toBe('')
    const n = parseFloat(v)
    expect(n).toBeGreaterThan(0)
    expect(n).toBeLessThanOrEqual(1)
  })
})
