import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { CalendarView } from '../../views/CalendarView'
import { useTodoStore } from '../../stores/todo-store'
import { useUIStore } from '../../stores/ui-store'
import { makeTodo, resetEntityStores, clearFilterStore } from '../helpers'

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
vi.mock('../../data/status-repository', () => ({
  statusRepository: { getAll: async () => [] },
}))
vi.mock('../../data/project-repository', () => ({
  projectRepository: { getAll: async () => [] },
}))

function resetStores() {
  resetEntityStores()
  useUIStore.getState().closeEditPopup?.()
  clearFilterStore()
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
    resetStores()
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('tints due-date tasks with the taskItemDeadline class and a due marker', () => {
    useTodoStore.setState({
      todos: [makeTodo({ id: 2, dueDate: new Date(2026, 3, 20) })],
    })
    const { container } = render(<CalendarView />)
    const item = findTaskItem(container, 2)
    expect(item).not.toBeNull()
    expect(item!.className).toMatch(/taskItemDeadline/)
    expect(item!.querySelector('[class*="deadlineMarker"]')).toBeTruthy()
  })

  it('applies the taskItemPastDeadline stamp when the due date is overdue', () => {
    useTodoStore.setState({
      todos: [makeTodo({ id: 4, dueDate: new Date(2026, 3, 10) })],
    })
    const { container } = render(<CalendarView />)
    const item = findTaskItem(container, 4)
    expect(item).not.toBeNull()
    expect(item!.className).toMatch(/taskItemPastDeadline/)
  })

  it('virtual recurring instances inherit the due tint without the past class', () => {
    useTodoStore.setState({
      todos: [
        makeTodo({
          id: 7,
          dueDate: new Date(2026, 3, 18),
          recurrenceRule: { type: 'weekly' },
        }),
      ],
    })
    const { container } = render(<CalendarView />)
    // The primary task renders on Apr 18, and a virtual instance on Apr 25.
    const items = Array.from(container.querySelectorAll('[class*="taskItem"]'))
      .filter((el) => (el.textContent ?? '').includes('Task 7')) as HTMLElement[]
    expect(items.length).toBeGreaterThanOrEqual(2)
    for (const el of items) {
      expect(el.className).toMatch(/taskItemDeadline/)
      expect(el.className).not.toMatch(/taskItemPast/)
    }
  })

  it('places a task on its due day; a follow-up date alone does not place it', () => {
    useTodoStore.setState({
      todos: [
        makeTodo({ id: 9, dueDate: new Date(2026, 3, 25), nextFollowupAt: new Date(2026, 3, 20) }),
        makeTodo({ id: 10, nextFollowupAt: new Date(2026, 3, 21) }),
      ],
    })
    const { container } = render(<CalendarView />)
    const cells = Array.from(container.querySelectorAll('[class*="dayCell"]')) as HTMLElement[]
    const dayOf = (el: HTMLElement) => {
      const numEl = el.querySelector('[class*="dayNumber"]')
      return numEl ? parseInt(numEl.textContent ?? '', 10) : NaN
    }
    const cellWithTask = cells.find((c) => (c.textContent ?? '').includes('Task 9'))
    expect(cellWithTask).toBeDefined()
    expect(dayOf(cellWithTask!)).toBe(25)
    expect(cells.some((c) => (c.textContent ?? '').includes('Task 10'))).toBe(false)
    expect(container.textContent).toContain('1 task without a due date')
  })

  it('wires --date-intensity inline style on each tinted item', () => {
    useTodoStore.setState({
      todos: [
        makeTodo({ id: 8, dueDate: new Date(2026, 3, 20) }),
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
