import { describe, it, expect } from 'vitest'
import { buildEntries } from '../../services/calendar-entries'
import { startOfDay, MS_PER_DAY } from '../../utils/date'
import { makeTodo } from '../helpers'

const today = startOfDay(new Date('2026-04-15T00:00:00')) // Wed
const days = Array.from({ length: 7 }, (_, i) =>
  startOfDay(new Date(today.getTime() + (i - 3) * MS_PER_DAY)),
)

describe('buildEntries (shared)', () => {
  it('places a todo on its due day', () => {
    const t = makeTodo({ id: 1, dueDate: today })
    const map = buildEntries([t], days, {})
    const entries = map.get(today.toISOString()) ?? []
    expect(entries.map((e) => e.todo.id)).toEqual([1])
    expect(entries[0]!.isVirtual).toBe(false)
  })

  it('places a due date with a time of day on that day', () => {
    const t = makeTodo({ id: 1, dueDate: new Date(today.getTime() + 12 * 60 * 60 * 1000) })
    const map = buildEntries([t], days, {})
    expect((map.get(today.toISOString()) ?? []).map((e) => e.todo.id)).toEqual([1])
  })

  it('does not place a todo that only has a next follow-up', () => {
    const t = makeTodo({ id: 1, nextFollowupAt: today })
    const map = buildEntries([t], days, {})
    expect([...map.values()].flat()).toHaveLength(0)
  })

  it('skips todos whose due day is outside the visible range', () => {
    const farOff = startOfDay(new Date(today.getTime() + 30 * MS_PER_DAY))
    const t = makeTodo({ id: 1, dueDate: farOff })
    const map = buildEntries([t], days, {})
    expect([...map.values()].flat()).toHaveLength(0)
  })

  it('orders same-day entries by sortOrder, regardless of input order', () => {
    const a = makeTodo({ id: 1, dueDate: today, sortOrder: 30 })
    const b = makeTodo({ id: 2, dueDate: today, sortOrder: 10 })
    const c = makeTodo({ id: 3, dueDate: today, sortOrder: 20 })
    for (const input of [[a, b, c], [c, a, b]]) {
      const entries = buildEntries(input, days, {}).get(today.toISOString()) ?? []
      expect(entries.map((e) => e.todo.id)).toEqual([2, 3, 1])
    }
  })

  it('adds virtual entries for the other recurrences in range', () => {
    const start = days[0]!
    const t = makeTodo({ id: 1, dueDate: start, recurrenceRule: { type: 'daily' } })
    const map = buildEntries([t], days, {})
    expect(map.get(start.toISOString())?.[0]?.isVirtual).toBe(false)
    for (const d of days.slice(1)) {
      const [entry] = map.get(d.toISOString()) ?? []
      expect(entry?.isVirtual, d.toDateString()).toBe(true)
      expect(entry?.todo.id).toBe(1)
    }
  })

  it('emits no entries for empty days array', () => {
    const t = makeTodo({ id: 1, dueDate: today })
    const map = buildEntries([t], [], {})
    expect(map.size).toBe(0)
  })
})
