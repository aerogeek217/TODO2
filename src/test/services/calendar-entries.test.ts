import { describe, it, expect } from 'vitest'
import {
  buildEntries,
  calendarEntryState,
  dayDots,
  dayOverdueWash,
  isEntryOverdue,
} from '../../services/calendar-entries'
import { dayKey, startOfDay, MS_PER_DAY } from '../../utils/date'
import { makeTodo } from '../helpers'

const today = startOfDay(new Date('2026-04-15T00:00:00')) // Wed
const days = Array.from({ length: 7 }, (_, i) =>
  startOfDay(new Date(today.getTime() + (i - 3) * MS_PER_DAY)),
)

describe('buildEntries (shared)', () => {
  it('places a todo on its due day', () => {
    const t = makeTodo({ id: 1, dueDate: today })
    const map = buildEntries([t], days, {})
    const entries = map.get(dayKey(today)) ?? []
    expect(entries.map((e) => e.todo.id)).toEqual([1])
    expect(entries[0]!.isVirtual).toBe(false)
  })

  it('places a due date with a time of day on that day', () => {
    const t = makeTodo({ id: 1, dueDate: new Date(today.getTime() + 12 * 60 * 60 * 1000) })
    const map = buildEntries([t], days, {})
    expect((map.get(dayKey(today)) ?? []).map((e) => e.todo.id)).toEqual([1])
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
      const entries = buildEntries(input, days, {}).get(dayKey(today)) ?? []
      expect(entries.map((e) => e.todo.id)).toEqual([2, 3, 1])
    }
  })

  it('adds virtual entries for the other recurrences in range', () => {
    const start = days[0]!
    const t = makeTodo({ id: 1, dueDate: start, recurrenceRule: { type: 'daily' } })
    const map = buildEntries([t], days, {})
    expect(map.get(dayKey(start))?.[0]?.isVirtual).toBe(false)
    for (const d of days.slice(1)) {
      const [entry] = map.get(dayKey(d)) ?? []
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

const both = { due: true, followup: true }

describe('buildEntries — date types', () => {
  it('places a task once per shown date type, due before follow-up on a shared day', () => {
    const t = makeTodo({ id: 1, dueDate: today, nextFollowupAt: today, sortOrder: 5 })
    const u = makeTodo({ id: 2, nextFollowupAt: today, sortOrder: 1 })
    const entries = buildEntries([u, t], days, { dateTypes: both }).get(dayKey(today)) ?? []
    expect(entries.map((e) => [e.todo.id, e.kind])).toEqual([[1, 'due'], [2, 'followup'], [1, 'followup']])
    expect(new Set(entries.map((e) => e.key)).size).toBe(3)
  })

  it('follow-ups only: due dates and occurrences are left out', () => {
    const t = makeTodo({ id: 1, dueDate: days[0], recurrenceRule: { type: 'daily' }, nextFollowupAt: days[2] })
    const all = [...buildEntries([t], days, { dateTypes: { due: false, followup: true } }).values()].flat()
    expect(all.map((e) => [e.kind, e.day.toISOString()])).toEqual([['followup', days[2]!.toISOString()]])
  })

  it('entries carry their day at midnight', () => {
    const t = makeTodo({ id: 1, nextFollowupAt: new Date(today.getTime() + 15 * 3_600_000) })
    const [entry] = buildEntries([t], days, { dateTypes: both }).get(dayKey(today)) ?? []
    expect(entry?.day.getTime()).toBe(today.getTime())
  })
})

describe('entry state, overdue washes and dots', () => {
  const yesterday = days[2]!
  const tomorrow = days[4]!
  const entriesOn = (d: Date, todos: Parameters<typeof buildEntries>[0]) =>
    buildEntries(todos, days, { dateTypes: both }).get(dayKey(d)) ?? []

  it('states: due / due today / overdue due / follow-up / overdue follow-up', () => {
    const [future] = entriesOn(tomorrow, [makeTodo({ id: 1, dueDate: tomorrow })])
    const [todayDue] = entriesOn(today, [makeTodo({ id: 2, dueDate: today })])
    const [late] = entriesOn(yesterday, [makeTodo({ id: 3, dueDate: yesterday })])
    const [fu] = entriesOn(today, [makeTodo({ id: 4, nextFollowupAt: today })])
    const [lateFu] = entriesOn(yesterday, [makeTodo({ id: 5, nextFollowupAt: yesterday })])
    expect([future, todayDue, late, fu, lateFu].map((e) => calendarEntryState(e!, today)))
      .toEqual(['due', 'due-today', 'due-overdue', 'followup', 'followup-overdue'])
  })

  it('completed tasks and occurrences are never overdue', () => {
    const [done] = entriesOn(yesterday, [makeTodo({ id: 1, dueDate: yesterday, isCompleted: true })])
    expect(isEntryOverdue(done!, today)).toBe(false)
    const occurrences = entriesOn(yesterday, [makeTodo({ id: 2, dueDate: days[0], recurrenceRule: { type: 'daily' } })])
    expect(occurrences[0]?.isVirtual).toBe(true)
    expect(isEntryOverdue(occurrences[0]!, today)).toBe(false)
  })

  it('a past day washes due over follow-up; follow-up-only days wash yellow', () => {
    expect(dayOverdueWash(entriesOn(yesterday, [
      makeTodo({ id: 1, nextFollowupAt: yesterday }),
      makeTodo({ id: 2, dueDate: yesterday }),
    ]), today)).toBe('due')
    expect(dayOverdueWash(entriesOn(yesterday, [makeTodo({ id: 1, nextFollowupAt: yesterday })]), today)).toBe('followup')
    expect(dayOverdueWash(entriesOn(yesterday, [makeTodo({ id: 1, dueDate: yesterday, isCompleted: true })]), today)).toBeNull()
  })

  it('dots: up to three, a follow-up always among them', () => {
    const e = entriesOn(today, [
      makeTodo({ id: 1, dueDate: today, sortOrder: 1 }),
      makeTodo({ id: 2, dueDate: today, sortOrder: 2 }),
      makeTodo({ id: 3, dueDate: today, sortOrder: 3, isCompleted: true }),
      makeTodo({ id: 4, nextFollowupAt: today, sortOrder: 4 }),
    ])
    expect(dayDots(e)).toEqual(['due', 'due', 'followup'])
    expect(dayDots(e.slice(0, 3))).toEqual(['due', 'due', 'due-done'])
    const occ = entriesOn(tomorrow, [makeTodo({ id: 5, dueDate: days[0], recurrenceRule: { type: 'daily' } })])
    expect(dayDots(occ)).toEqual(['occurrence'])
  })
})
