import { describe, it, expect } from 'vitest'
import type { PersistedTodoItem } from '../../models'
import { effectiveDate } from '../../utils/effective-date'
import { startOfToday } from '../../utils/date'

interface CalendarEntry {
  todo: PersistedTodoItem
  isVirtual: boolean
  displayKey: string
}

function makeTodo(overrides: Partial<PersistedTodoItem> & { id: number }): PersistedTodoItem {
  return {
    title: `Task ${overrides.id}`,
    isCompleted: false,
    createdAt: new Date(),
    modifiedAt: new Date(),
    sortOrder: overrides.id,
    ...overrides,
  }
}

// Matches CalendarView's same-day sort (ascending effectiveDate, sortOrder tiebreak).
function sortDayBucket(arr: CalendarEntry[]): CalendarEntry[] {
  const today = startOfToday()
  return [...arr].sort((a, b) => {
    const ae = effectiveDate(a.todo, today, 1)
    const be = effectiveDate(b.todo, today, 1)
    if (ae && be && ae.getTime() !== be.getTime()) return ae.getTime() - be.getTime()
    return a.todo.sortOrder - b.todo.sortOrder
  })
}

describe('CalendarView day-bucket sort', () => {
  it('orders same-day tasks by sortOrder when effective dates match', () => {
    const due = new Date(2026, 3, 20)
    const entries: CalendarEntry[] = [
      { todo: makeTodo({ id: 3, title: 'c', dueDate: due, sortOrder: 30 }), isVirtual: false, displayKey: 'a' },
      { todo: makeTodo({ id: 1, title: 'a', dueDate: due, sortOrder: 10 }), isVirtual: false, displayKey: 'b' },
      { todo: makeTodo({ id: 2, title: 'b', dueDate: due, sortOrder: 20 }), isVirtual: false, displayKey: 'c' },
    ]
    const sorted = sortDayBucket(entries)
    expect(sorted.map((e) => e.todo.id)).toEqual([1, 2, 3])
  })

  it('is deterministic across shuffled input', () => {
    const due = new Date(2026, 3, 20)
    const base: CalendarEntry[] = [
      { todo: makeTodo({ id: 3, title: 'c', dueDate: due, sortOrder: 30 }), isVirtual: false, displayKey: 'c' },
      { todo: makeTodo({ id: 1, title: 'a', dueDate: due, sortOrder: 10 }), isVirtual: false, displayKey: 'a' },
      { todo: makeTodo({ id: 2, title: 'b', dueDate: due, sortOrder: 20 }), isVirtual: false, displayKey: 'b' },
    ]
    const first = sortDayBucket(base)
    const shuffled = [base[2]!, base[0]!, base[1]!]
    const second = sortDayBucket(shuffled)
    expect(first.map((e) => e.todo.id)).toEqual(second.map((e) => e.todo.id))
  })
})
