import { describe, it, expect } from 'vitest'
import {
  buildEntries,
  calendarEntryState,
  calendarEntryLevel,
  dayDots,
  dayOverdueWash,
  isEntryMissed,
  isEntryOverdue,
} from '../../services/calendar-entries'
import { dayKey, startOfDay, MS_PER_DAY } from '../../utils/date'
import { makeTodo } from '../helpers'

const DUE = { due: true, followup: false, plan: false }
const today = startOfDay(new Date('2026-04-15T00:00:00')) // Wed
const days = Array.from({ length: 7 }, (_, i) =>
  startOfDay(new Date(today.getTime() + (i - 3) * MS_PER_DAY)),
)

describe('buildEntries (shared)', () => {
  it('places a todo on its due day', () => {
    const t = makeTodo({ id: 1, dueDate: today })
    const map = buildEntries([t], days, { dateTypes: DUE })
    const entries = map.get(dayKey(today)) ?? []
    expect(entries.map((e) => e.todo.id)).toEqual([1])
    expect(entries[0]!.isVirtual).toBe(false)
  })

  it('places a due date with a time of day on that day', () => {
    const t = makeTodo({ id: 1, dueDate: new Date(today.getTime() + 12 * 60 * 60 * 1000) })
    const map = buildEntries([t], days, { dateTypes: DUE })
    expect((map.get(dayKey(today)) ?? []).map((e) => e.todo.id)).toEqual([1])
  })

  it('does not place a todo that only has a next follow-up', () => {
    const t = makeTodo({ id: 1, nextFollowupAt: today })
    const map = buildEntries([t], days, { dateTypes: DUE })
    expect([...map.values()].flat()).toHaveLength(0)
  })

  it('skips todos whose due day is outside the visible range', () => {
    const farOff = startOfDay(new Date(today.getTime() + 30 * MS_PER_DAY))
    const t = makeTodo({ id: 1, dueDate: farOff })
    const map = buildEntries([t], days, { dateTypes: DUE })
    expect([...map.values()].flat()).toHaveLength(0)
  })

  it('orders same-day entries by sortOrder, regardless of input order', () => {
    const a = makeTodo({ id: 1, dueDate: today, sortOrder: 30 })
    const b = makeTodo({ id: 2, dueDate: today, sortOrder: 10 })
    const c = makeTodo({ id: 3, dueDate: today, sortOrder: 20 })
    for (const input of [[a, b, c], [c, a, b]]) {
      const entries = buildEntries(input, days, { dateTypes: DUE }).get(dayKey(today)) ?? []
      expect(entries.map((e) => e.todo.id)).toEqual([2, 3, 1])
    }
  })

  it('adds virtual entries for the other recurrences in range', () => {
    const start = days[0]!
    const t = makeTodo({ id: 1, dueDate: start, recurrenceRule: { every: { count: 1, unit: 'd' as const } } })
    const map = buildEntries([t], days, { dateTypes: DUE })
    expect(map.get(dayKey(start))?.[0]?.isVirtual).toBe(false)
    for (const d of days.slice(1)) {
      const [entry] = map.get(dayKey(d)) ?? []
      expect(entry?.isVirtual, d.toDateString()).toBe(true)
      expect(entry?.todo.id).toBe(1)
    }
  })

  it('emits no entries for empty days array', () => {
    const t = makeTodo({ id: 1, dueDate: today })
    const map = buildEntries([t], [], { dateTypes: DUE })
    expect(map.size).toBe(0)
  })
})

const both = { due: true, followup: true, plan: false }

describe('buildEntries — date types', () => {
  it('places a task once per shown date type, due before follow-up on a shared day', () => {
    const t = makeTodo({ id: 1, dueDate: today, nextFollowupAt: today, sortOrder: 5 })
    const u = makeTodo({ id: 2, nextFollowupAt: today, sortOrder: 1 })
    const entries = buildEntries([u, t], days, { dateTypes: both }).get(dayKey(today)) ?? []
    expect(entries.map((e) => [e.todo.id, e.kind])).toEqual([[1, 'due'], [2, 'followup'], [1, 'followup']])
    expect(new Set(entries.map((e) => e.key)).size).toBe(3)
  })

  it('follow-ups only: due dates and occurrences are left out', () => {
    const t = makeTodo({ id: 1, dueDate: days[0], recurrenceRule: { every: { count: 1, unit: 'd' as const } }, nextFollowupAt: days[2] })
    const all = [...buildEntries([t], days, { dateTypes: { due: false, followup: true, plan: false } }).values()].flat()
    expect(all.map((e) => [e.kind, e.day.toISOString()])).toEqual([['followup', days[2]!.toISOString()]])
  })

  it('entries carry their day at midnight', () => {
    const t = makeTodo({ id: 1, nextFollowupAt: new Date(today.getTime() + 15 * 3_600_000) })
    const [entry] = buildEntries([t], days, { dateTypes: both }).get(dayKey(today)) ?? []
    expect(entry?.day.getTime()).toBe(today.getTime())
  })
})

const plans = { due: false, followup: false, plan: true }
const all = { due: true, followup: true, plan: true }

describe('buildEntries — plans', () => {
  it('places a task on its planned day (doDate), after its due and follow-up entries', () => {
    const t = makeTodo({ id: 1, dueDate: today, nextFollowupAt: today, doDate: today, sortOrder: 1 })
    const u = makeTodo({ id: 2, doDate: today, sortOrder: 0 })
    const entries = buildEntries([u, t], days, { dateTypes: all }).get(dayKey(today)) ?? []
    expect(entries.map((e) => [e.todo.id, e.kind])).toEqual([[1, 'due'], [1, 'followup'], [2, 'plan'], [1, 'plan']])
    expect(entries.find((e) => e.kind === 'plan')?.key).toBe('plan-2')
  })

  it('a task held in Unplanned has no plan entry; nor one with no planned day', () => {
    const held = makeTodo({ id: 1, unplanned: true, dueDate: today })
    const none = makeTodo({ id: 2, dueDate: today })
    const entries = [...buildEntries([held, none], days, { dateTypes: plans }).values()].flat()
    expect(entries).toHaveLength(0)
  })

  it('plans off: no plan entries', () => {
    const t = makeTodo({ id: 1, doDate: today })
    expect([...buildEntries([t], days, { dateTypes: { due: true, followup: true, plan: false } }).values()].flat()).toHaveLength(0)
  })

  it('a completed task’s plan is placed as an open one’s', () => {
    const t = makeTodo({ id: 1, doDate: today, isCompleted: true })
    expect((buildEntries([t], days, { dateTypes: plans }).get(dayKey(today)) ?? []).map((e) => e.kind)).toEqual(['plan'])
  })

  it('a plan never recurs: a recurring task’s plan is one entry, and not an occurrence', () => {
    const t = makeTodo({ id: 1, doDate: days[4], dueDate: days[0], recurrenceRule: { every: { count: 1, unit: 'd' as const } } })
    const entries = [...buildEntries([t], days, { dateTypes: plans }).values()].flat()
    expect(entries.map((e) => [e.kind, e.isVirtual, e.day.getTime()])).toEqual([['plan', false, days[4]!.getTime()]])
  })

  it('a missed plan (its day passed, the task open) is drawn faded, never overdue: no wash, never late', () => {
    const yesterday = days[2]!
    const [missed] = buildEntries([makeTodo({ id: 1, doDate: yesterday })], days, { dateTypes: plans }).get(dayKey(yesterday)) ?? []
    expect(isEntryMissed(missed!, today)).toBe(true)
    expect(isEntryOverdue(missed!, today)).toBe(false)
    expect(calendarEntryState(missed!, today)).toBe('plan-missed')
    expect(calendarEntryLevel(missed!, today, 1)).toBe('later')
    expect(dayOverdueWash([missed!], today)).toBeNull()
    const [done] = buildEntries([makeTodo({ id: 2, doDate: yesterday, isCompleted: true })], days, { dateTypes: plans }).get(dayKey(yesterday)) ?? []
    expect(isEntryMissed(done!, today)).toBe(false)
    const [todayPlan] = buildEntries([makeTodo({ id: 3, doDate: today })], days, { dateTypes: plans }).get(dayKey(today)) ?? []
    expect(isEntryMissed(todayPlan!, today)).toBe(false)
    expect(calendarEntryState(todayPlan!, today)).toBe('plan-today')
  })
})

describe('entry state, overdue washes and dots', () => {
  const yesterday = days[2]!
  const tomorrow = days[4]!
  const entriesOn = (d: Date, todos: Parameters<typeof buildEntries>[0]) =>
    buildEntries(todos, days, { dateTypes: both }).get(dayKey(d)) ?? []

  it('states: due / due today / overdue due / follow-up / follow-up today / overdue follow-up', () => {
    const [future] = entriesOn(tomorrow, [makeTodo({ id: 1, dueDate: tomorrow })])
    const [todayDue] = entriesOn(today, [makeTodo({ id: 2, dueDate: today })])
    const [late] = entriesOn(yesterday, [makeTodo({ id: 3, dueDate: yesterday })])
    const [fu] = entriesOn(tomorrow, [makeTodo({ id: 4, nextFollowupAt: tomorrow })])
    const [todayFu] = entriesOn(today, [makeTodo({ id: 6, nextFollowupAt: today })])
    const [lateFu] = entriesOn(yesterday, [makeTodo({ id: 5, nextFollowupAt: yesterday })])
    expect([future, todayDue, late, fu, todayFu, lateFu].map((e) => calendarEntryState(e!, today)))
      .toEqual(['due', 'due-today', 'due-overdue', 'followup', 'followup-today', 'followup-overdue'])
  })

  it('levels (the bar strength a row date shares): late when overdue, soon for a follow-up today or a due date in the range, else later', () => {
    const far = days[6]!
    const level = (d: Date, todo: Parameters<typeof buildEntries>[0][number], range: number | null = 1) =>
      calendarEntryLevel(entriesOn(d, [todo])[0]!, today, range)
    expect(level(yesterday, makeTodo({ id: 1, dueDate: yesterday }))).toBe('late')
    expect(level(today, makeTodo({ id: 2, dueDate: today }))).toBe('soon')
    expect(level(tomorrow, makeTodo({ id: 3, dueDate: tomorrow }))).toBe('soon')
    expect(level(far, makeTodo({ id: 4, dueDate: far }))).toBe('later')
    expect(level(today, makeTodo({ id: 5, dueDate: today }), null)).toBe('later')
    expect(level(yesterday, makeTodo({ id: 6, nextFollowupAt: yesterday }))).toBe('late')
    expect(level(today, makeTodo({ id: 7, nextFollowupAt: today }))).toBe('soon')
    expect(level(tomorrow, makeTodo({ id: 8, nextFollowupAt: tomorrow }))).toBe('later')
    expect(level(yesterday, makeTodo({ id: 9, dueDate: yesterday, isCompleted: true }))).toBe('later')
    expect(level(today, makeTodo({ id: 10, nextFollowupAt: today, isCompleted: true }))).toBe('later')
  })

  it('completed tasks and occurrences are never overdue', () => {
    const [done] = entriesOn(yesterday, [makeTodo({ id: 1, dueDate: yesterday, isCompleted: true })])
    expect(isEntryOverdue(done!, today)).toBe(false)
    const occurrences = entriesOn(yesterday, [makeTodo({ id: 2, dueDate: days[0], recurrenceRule: { every: { count: 1, unit: 'd' as const } } })])
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
    const occ = entriesOn(tomorrow, [makeTodo({ id: 5, dueDate: days[0], recurrenceRule: { every: { count: 1, unit: 'd' as const } } })])
    expect(dayDots(occ)).toEqual(['occurrence'])
  })
})
