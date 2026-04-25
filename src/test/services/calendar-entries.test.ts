import { describe, it, expect } from 'vitest'
import type { PersistedTodoItem } from '../../models'
import { buildEntries } from '../../services/calendar-entries'
import { startOfDay, MS_PER_DAY } from '../../utils/date'

function makeTodo(overrides: Partial<PersistedTodoItem> & { id: number }): PersistedTodoItem {
  return {
    title: `Task ${overrides.id}`,
    isCompleted: false,
    sortOrder: overrides.id * 10,
    createdAt: new Date(),
    modifiedAt: new Date(),
    ...overrides,
  } as PersistedTodoItem
}

const today = startOfDay(new Date('2026-04-15T00:00:00')) // Wed
const days = Array.from({ length: 7 }, (_, i) =>
  startOfDay(new Date(today.getTime() + (i - 3) * MS_PER_DAY)),
)

describe('buildEntries (shared)', () => {
  it('places a precise-scheduled todo on its scheduled day', () => {
    const t = makeTodo({
      id: 1,
      scheduledDate: { kind: 'date', value: today },
    })
    const map = buildEntries([t], days, { today, weekStartsOn: 1, sortMode: 'sortOrder' })
    const entries = map.get(today.toISOString()) ?? []
    expect(entries.map((e) => e.todo.id)).toEqual([1])
    expect(entries[0]!.isVirtual).toBe(false)
  })

  it('places a deadline-only todo on its deadline day', () => {
    const t = makeTodo({ id: 1, dueDate: today })
    const map = buildEntries([t], days, { today, weekStartsOn: 1, sortMode: 'sortOrder' })
    const entries = map.get(today.toISOString()) ?? []
    expect(entries.map((e) => e.todo.id)).toEqual([1])
  })

  it('skips todos whose primary day is outside the visible range', () => {
    const farOff = startOfDay(new Date(today.getTime() + 30 * MS_PER_DAY))
    const t = makeTodo({ id: 1, dueDate: farOff })
    const map = buildEntries([t], days, { today, weekStartsOn: 1, sortMode: 'sortOrder' })
    expect([...map.values()].flat()).toHaveLength(0)
  })

  it('sortMode = effective sorts by effective date then sortOrder', () => {
    const day = today
    const a = makeTodo({ id: 1, scheduledDate: { kind: 'date', value: day }, sortOrder: 30 })
    const b = makeTodo({ id: 2, scheduledDate: { kind: 'date', value: day }, sortOrder: 10 })
    const map = buildEntries([a, b], days, { today, weekStartsOn: 1, sortMode: 'effective' })
    const entries = map.get(day.toISOString()) ?? []
    expect(entries.map((e) => e.todo.id)).toEqual([2, 1])
  })

  it('sortMode = sortOrder ignores effective date when sortOrder differs', () => {
    const earlier = startOfDay(new Date(today.getTime() - MS_PER_DAY))
    const later = today
    const a = makeTodo({ id: 1, scheduledDate: { kind: 'date', value: earlier }, sortOrder: 30 })
    const b = makeTodo({ id: 2, scheduledDate: { kind: 'date', value: later }, sortOrder: 10 })
    const map = buildEntries([a, b], days, { today, weekStartsOn: 1, sortMode: 'sortOrder' })
    // Each lands on a different day; sort within each day-bucket is by sortOrder
    expect(map.get(earlier.toISOString())?.[0]?.todo.id).toBe(1)
    expect(map.get(later.toISOString())?.[0]?.todo.id).toBe(2)
  })

  it('emits no entries for empty days array', () => {
    const t = makeTodo({ id: 1, dueDate: today })
    const map = buildEntries([t], [], { today, weekStartsOn: 1, sortMode: 'sortOrder' })
    expect(map.size).toBe(0)
  })
})
