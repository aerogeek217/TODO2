import { describe, it, expect } from 'vitest'
import { Priority } from '../../models'
import type { PersistedTodoItem } from '../../models'
import { byHardDeadlineThenDate } from '../../views/ListView'

// CalendarView's entriesByDay memo runs inside the component; this test asserts the
// shape of the sort it now performs on each day bucket so the behavior is locked in.

interface CalendarEntry {
  todo: PersistedTodoItem
  isVirtual: boolean
  displayKey: string
}

function makeTodo(overrides: Partial<PersistedTodoItem> & { id: number }): PersistedTodoItem {
  return {
    title: `Task ${overrides.id}`,
    priority: Priority.Normal,
    isCompleted: false,
    createdAt: new Date(),
    modifiedAt: new Date(),
    sortOrder: overrides.id,
    ...overrides,
  }
}

function sortDayBucket(arr: CalendarEntry[]): CalendarEntry[] {
  return [...arr].sort((a, b) => byHardDeadlineThenDate(a.todo, b.todo))
}

describe('CalendarView day-bucket sort', () => {
  it('places hard deadlines before soft deadlines on the same day', () => {
    const due = new Date(2026, 3, 20)
    const entries: CalendarEntry[] = [
      { todo: makeTodo({ id: 1, title: 'soft', dueDate: due }), isVirtual: false, displayKey: 'a' },
      { todo: makeTodo({ id: 2, title: 'hard', dueDate: due, isHardDeadline: true }), isVirtual: false, displayKey: 'b' },
    ]
    const sorted = sortDayBucket(entries)
    expect(sorted.map((e) => e.todo.id)).toEqual([2, 1])
  })

  it('falls back to deterministic id order when everything else is equal', () => {
    const due = new Date(2026, 3, 20)
    const entries: CalendarEntry[] = [
      { todo: makeTodo({ id: 3, title: 'c', dueDate: due }), isVirtual: false, displayKey: 'a' },
      { todo: makeTodo({ id: 1, title: 'a', dueDate: due }), isVirtual: false, displayKey: 'b' },
      { todo: makeTodo({ id: 2, title: 'b', dueDate: due }), isVirtual: false, displayKey: 'c' },
    ]
    const sorted = sortDayBucket(entries)
    expect(sorted.map((e) => e.todo.id)).toEqual([1, 2, 3])
  })

  it('is deterministic across shuffled input', () => {
    const due = new Date(2026, 3, 20)
    const base: CalendarEntry[] = [
      { todo: makeTodo({ id: 3, title: 'c', dueDate: due, isHardDeadline: true }), isVirtual: false, displayKey: 'c' },
      { todo: makeTodo({ id: 1, title: 'a', dueDate: due }), isVirtual: false, displayKey: 'a' },
      { todo: makeTodo({ id: 2, title: 'b', dueDate: due, isHardDeadline: true }), isVirtual: false, displayKey: 'b' },
    ]
    const first = sortDayBucket(base)
    const shuffled = [base[2], base[0], base[1]]
    const second = sortDayBucket(shuffled)
    expect(first.map((e) => e.todo.id)).toEqual(second.map((e) => e.todo.id))
  })
})
