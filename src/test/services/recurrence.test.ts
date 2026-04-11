import { describe, it, expect, vi, afterEach } from 'vitest'
import { computeNextDueDate, generateRecurringInstances, makeRecurrenceRule } from '../../services/recurrence'
import type { RecurrenceRule } from '../../models/recurrence'

/** Create a local midnight date (avoids UTC timezone issues) */
function localDate(y: number, m: number, d: number): Date {
  return new Date(y, m - 1, d)
}

/** Format as YYYY-MM-DD using local time */
function fmt(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

describe('computeNextDueDate', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  function fakeToday(y: number, m: number, d: number) {
    vi.useFakeTimers()
    vi.setSystemTime(localDate(y, m, d))
  }

  it('daily rule: advances by 1 day', () => {
    fakeToday(2026, 1, 15)
    const rule: RecurrenceRule = { type: 'daily' }
    const result = computeNextDueDate(localDate(2026, 1, 14), rule)
    expect(fmt(result)).toBe('2026-01-15')
  })

  it('weekly rule: advances by 7 days', () => {
    fakeToday(2026, 1, 15)
    const rule: RecurrenceRule = { type: 'weekly' }
    const result = computeNextDueDate(localDate(2026, 1, 10), rule)
    expect(fmt(result)).toBe('2026-01-17')
  })

  it('biweekly rule: advances by 14 days', () => {
    fakeToday(2026, 1, 15)
    const rule: RecurrenceRule = { type: 'biweekly' }
    const result = computeNextDueDate(localDate(2026, 1, 10), rule)
    expect(fmt(result)).toBe('2026-01-24')
  })

  it('monthly rule: advances by 1 month', () => {
    fakeToday(2026, 1, 15)
    const rule: RecurrenceRule = { type: 'monthly' }
    const result = computeNextDueDate(localDate(2026, 1, 14), rule)
    expect(fmt(result)).toBe('2026-02-14')
  })

  it('monthly rule: Jan 31 clamps to Feb 28', () => {
    fakeToday(2026, 2, 1)
    const rule: RecurrenceRule = { type: 'monthly', originalDayOfMonth: 31 }
    const result = computeNextDueDate(localDate(2026, 1, 31), rule)
    expect(fmt(result)).toBe('2026-02-28')
  })

  it('monthly rule: no day-of-month drift (Jan 31 → Feb 28 → Mar 31)', () => {
    fakeToday(2026, 3, 1)
    const rule: RecurrenceRule = { type: 'monthly', originalDayOfMonth: 31 }
    // Start from Jan 31, should skip Feb 28 and land on Mar 31
    const result = computeNextDueDate(localDate(2026, 1, 31), rule)
    expect(fmt(result)).toBe('2026-03-31')
  })

  it('monthly rule: without originalDayOfMonth still works (legacy)', () => {
    fakeToday(2026, 2, 1)
    const rule: RecurrenceRule = { type: 'monthly' }
    const result = computeNextDueDate(localDate(2026, 1, 15), rule)
    expect(fmt(result)).toBe('2026-02-15')
  })

  it('yearly rule: advances by 1 year', () => {
    fakeToday(2026, 3, 15)
    const rule: RecurrenceRule = { type: 'yearly' }
    const result = computeNextDueDate(localDate(2026, 3, 14), rule)
    expect(fmt(result)).toBe('2027-03-14')
  })

  it('yearly rule: Feb 29 clamps to Feb 28 on non-leap year', () => {
    fakeToday(2025, 2, 1)
    const rule: RecurrenceRule = { type: 'yearly', originalDayOfMonth: 29 }
    const result = computeNextDueDate(localDate(2024, 2, 29), rule)
    expect(fmt(result)).toBe('2025-02-28')
  })

  it('yearly rule: Feb 29 restores to Feb 29 on next leap year', () => {
    fakeToday(2028, 1, 1)
    const rule: RecurrenceRule = { type: 'yearly', originalDayOfMonth: 29 }
    const result = computeNextDueDate(localDate(2027, 2, 28), rule)
    expect(fmt(result)).toBe('2028-02-29')
  })

  it('skips past dates: keeps advancing until result >= today', () => {
    fakeToday(2026, 3, 1)
    const rule: RecurrenceRule = { type: 'weekly' }
    const result = computeNextDueDate(localDate(2026, 1, 1), rule)
    expect(result >= localDate(2026, 3, 1)).toBe(true)
    expect(result <= localDate(2026, 3, 8)).toBe(true)
  })
})

describe('generateRecurringInstances', () => {
  it('returns instances within date range', () => {
    const rule: RecurrenceRule = { type: 'weekly' }
    const instances = generateRecurringInstances(
      localDate(2026, 1, 1),
      rule,
      localDate(2026, 1, 1),
      localDate(2026, 1, 22),
    )
    expect(instances).toHaveLength(3) // Jan 1, 8, 15
  })

  it('skips instances before rangeStart', () => {
    const rule: RecurrenceRule = { type: 'daily' }
    const instances = generateRecurringInstances(
      localDate(2026, 1, 1),
      rule,
      localDate(2026, 1, 5),
      localDate(2026, 1, 8),
    )
    expect(instances).toHaveLength(3) // Jan 5, 6, 7
    expect(fmt(instances[0])).toBe('2026-01-05')
  })

  it('stops at rangeEnd (exclusive)', () => {
    const rule: RecurrenceRule = { type: 'daily' }
    const instances = generateRecurringInstances(
      localDate(2026, 1, 1),
      rule,
      localDate(2026, 1, 1),
      localDate(2026, 1, 4),
    )
    expect(instances).toHaveLength(3) // Jan 1, 2, 3
    expect(fmt(instances[2])).toBe('2026-01-03')
  })

  it('returns empty array when dueDate is after rangeEnd', () => {
    const rule: RecurrenceRule = { type: 'weekly' }
    const instances = generateRecurringInstances(
      localDate(2026, 2, 1),
      rule,
      localDate(2026, 1, 1),
      localDate(2026, 1, 31),
    )
    expect(instances).toHaveLength(0)
  })
})

describe('makeRecurrenceRule', () => {
  it('monthly: captures originalDayOfMonth from due date', () => {
    const rule = makeRecurrenceRule('monthly', localDate(2026, 1, 31))
    expect(rule).toEqual({ type: 'monthly', originalDayOfMonth: 31 })
  })

  it('yearly: captures originalDayOfMonth from due date', () => {
    const rule = makeRecurrenceRule('yearly', localDate(2024, 2, 29))
    expect(rule).toEqual({ type: 'yearly', originalDayOfMonth: 29 })
  })

  it('daily: does not set originalDayOfMonth', () => {
    const rule = makeRecurrenceRule('daily', localDate(2026, 1, 31))
    expect(rule).toEqual({ type: 'daily' })
  })

  it('weekly: does not set originalDayOfMonth', () => {
    const rule = makeRecurrenceRule('weekly', localDate(2026, 1, 31))
    expect(rule).toEqual({ type: 'weekly' })
  })

  it('no due date: does not set originalDayOfMonth', () => {
    const rule = makeRecurrenceRule('monthly', null)
    expect(rule).toEqual({ type: 'monthly' })
  })
})
