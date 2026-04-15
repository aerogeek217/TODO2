import { describe, it, expect } from 'vitest'
import { scoreTask, buildDashboardLists } from '../../views/DashboardView'
import { Priority } from '../../models'
import type { PersistedTodoItem } from '../../models'
import { MS_PER_DAY } from '../../utils/date'

/** Helper to create a minimal PersistedTodoItem with defaults */
function makeTodo(overrides: Partial<PersistedTodoItem> & { id: number }): PersistedTodoItem {
  return {
    title: `Task ${overrides.id}`,
    canvasId: 1,
    isCompleted: false,
    isStarred: false,
    isAssigned: false,
    isHardDeadline: false,
    priority: Priority.Normal,
    sortOrder: overrides.id * 1000,
    createdAt: new Date(),
    modifiedAt: new Date(),
    ...overrides,
  } as PersistedTodoItem
}

describe('scoreTask', () => {
  const now = new Date('2026-04-12T00:00:00').getTime()

  it('returns 0 for a normal priority task with no due date', () => {
    const todo = makeTodo({ id: 1 })
    expect(scoreTask(todo, now)).toBe(0)
  })

  it('adds 20 for High priority', () => {
    const todo = makeTodo({ id: 1, priority: Priority.High })
    expect(scoreTask(todo, now)).toBe(20)
  })

  it('adds 10 for Medium priority', () => {
    const todo = makeTodo({ id: 1, priority: Priority.Medium })
    expect(scoreTask(todo, now)).toBe(10)
  })

  it('adds 500 for hard deadline so it always outranks soft', () => {
    const todo = makeTodo({ id: 1, isHardDeadline: true })
    expect(scoreTask(todo, now)).toBe(500)
  })

  it('hard-deadline-future task outranks soft-deadline-overdue', () => {
    const hardFuture = makeTodo({
      id: 1,
      dueDate: new Date(now + 365 * MS_PER_DAY),
      isHardDeadline: true,
    })
    const softOverdue = makeTodo({
      id: 2,
      dueDate: new Date(now - 365 * MS_PER_DAY),
    })
    expect(scoreTask(hardFuture, now)).toBeGreaterThan(scoreTask(softOverdue, now))
  })

  it('scores overdue tasks with 100 + days overdue', () => {
    // 5 days overdue
    const dueDate = new Date(now - 5 * MS_PER_DAY)
    const todo = makeTodo({ id: 1, dueDate })
    expect(scoreTask(todo, now)).toBe(105) // 100 + 5
  })

  it('caps overdue days at 365', () => {
    const dueDate = new Date(now - 400 * MS_PER_DAY)
    const todo = makeTodo({ id: 1, dueDate })
    expect(scoreTask(todo, now)).toBe(465) // 100 + 365
  })

  it('scores upcoming due dates: closer = higher', () => {
    const dueSoon = makeTodo({ id: 1, dueDate: new Date(now + 2 * MS_PER_DAY) })
    const dueLater = makeTodo({ id: 2, dueDate: new Date(now + 30 * MS_PER_DAY) })
    expect(scoreTask(dueSoon, now)).toBeGreaterThan(scoreTask(dueLater, now))
  })

  it('returns 0 for due date proximity when more than 60 days out', () => {
    const dueDate = new Date(now + 90 * MS_PER_DAY)
    const todo = makeTodo({ id: 1, dueDate })
    expect(scoreTask(todo, now)).toBe(0) // max(0, 60 - 90) = 0
  })

  it('combines priority, due date, and hard deadline', () => {
    const dueDate = new Date(now + 5 * MS_PER_DAY)
    const todo = makeTodo({ id: 1, priority: Priority.High, dueDate, isHardDeadline: true })
    // 20 (high) + 55 (60-5 due) + 500 (hard deadline) = 575
    expect(scoreTask(todo, now)).toBe(575)
  })
})

describe('buildDashboardLists', () => {
  // Use a fixed "today" by crafting todos relative to a known date
  const today = new Date('2026-04-12T00:00:00')

  it('returns 4 lists with correct keys', () => {
    const lists = buildDashboardLists([])
    expect(lists).toHaveLength(4)
    expect(lists.map(l => l.key)).toEqual(['mine', 'followup', 'assigned', 'stale'])
  })

  it('returns empty lists when no todos', () => {
    const lists = buildDashboardLists([])
    for (const list of lists) {
      expect(list.todos).toHaveLength(0)
    }
  })

  it('excludes completed tasks from all lists', () => {
    const todos = [
      makeTodo({ id: 1, isCompleted: true }),
      makeTodo({ id: 2, isCompleted: true, isStarred: true }),
    ]
    const lists = buildDashboardLists(todos)
    for (const list of lists) {
      expect(list.todos).toHaveLength(0)
    }
  })

  it('puts non-assigned, non-starred tasks in "mine"', () => {
    const todo = makeTodo({ id: 1 })
    const lists = buildDashboardLists([todo])
    const mine = lists.find(l => l.key === 'mine')!
    expect(mine.todos).toHaveLength(1)
    expect(mine.todos[0].id).toBe(1)
  })

  it('puts starred tasks in "followup"', () => {
    const todo = makeTodo({ id: 1, isStarred: true })
    const lists = buildDashboardLists([todo])
    const followup = lists.find(l => l.key === 'followup')!
    expect(followup.todos).toHaveLength(1)
    expect(followup.todos[0].id).toBe(1)
  })

  it('puts assigned tasks in "assigned"', () => {
    const todo = makeTodo({ id: 1, isAssigned: true })
    const lists = buildDashboardLists([todo])
    const assigned = lists.find(l => l.key === 'assigned')!
    expect(assigned.todos).toHaveLength(1)
    expect(assigned.todos[0].id).toBe(1)
  })

  it('puts all incomplete tasks in "stale" sorted by oldest modifiedAt', () => {
    const todos = [
      makeTodo({ id: 1, modifiedAt: new Date('2026-04-10T00:00:00Z') }),
      makeTodo({ id: 2, modifiedAt: new Date('2026-04-01T00:00:00Z') }),
      makeTodo({ id: 3, modifiedAt: new Date('2026-04-12T00:00:00Z') }),
    ]
    const lists = buildDashboardLists(todos)
    const stale = lists.find(l => l.key === 'stale')!
    expect(stale.todos.map(t => t.id)).toEqual([2, 1, 3])
  })

  it('limits each list to 10 items', () => {
    const todos = Array.from({ length: 15 }, (_, i) =>
      makeTodo({ id: i + 1, modifiedAt: new Date(today.getTime() - i * MS_PER_DAY) })
    )
    const lists = buildDashboardLists(todos)
    const mine = lists.find(l => l.key === 'mine')!
    const stale = lists.find(l => l.key === 'stale')!
    expect(mine.todos.length).toBeLessThanOrEqual(10)
    expect(stale.todos.length).toBeLessThanOrEqual(10)
  })

  it('ranks "mine" tasks by score descending', () => {
    const todos = [
      makeTodo({ id: 1, priority: Priority.Normal }),
      makeTodo({ id: 2, priority: Priority.High }),
      makeTodo({ id: 3, priority: Priority.Medium }),
    ]
    const lists = buildDashboardLists(todos)
    const mine = lists.find(l => l.key === 'mine')!
    expect(mine.todos.map(t => t.id)).toEqual([2, 3, 1])
  })

  it('a task can appear in both assigned and stale', () => {
    const todo = makeTodo({ id: 1, isAssigned: true, modifiedAt: new Date('2020-01-01T00:00:00Z') })
    const lists = buildDashboardLists([todo])
    const assigned = lists.find(l => l.key === 'assigned')!
    const stale = lists.find(l => l.key === 'stale')!
    expect(assigned.todos).toHaveLength(1)
    expect(stale.todos).toHaveLength(1)
  })

  it('a starred+assigned task appears in followup and assigned but not mine', () => {
    const todo = makeTodo({ id: 1, isStarred: true, isAssigned: true })
    const lists = buildDashboardLists([todo])
    expect(lists.find(l => l.key === 'mine')!.todos).toHaveLength(0)
    expect(lists.find(l => l.key === 'followup')!.todos).toHaveLength(1)
    expect(lists.find(l => l.key === 'assigned')!.todos).toHaveLength(1)
  })
})
