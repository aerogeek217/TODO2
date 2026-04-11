import { describe, it, expect, vi, afterEach } from 'vitest'
import { computeNextDueDate, generateRecurringInstances } from '../../services/recurrence'
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
    const rule: RecurrenceRule = { type: 'monthly' }
    const result = computeNextDueDate(localDate(2026, 1, 31), rule)
    expect(fmt(result)).toBe('2026-02-28')
  })

  it('yearly rule: advances by 1 year', () => {
    fakeToday(2026, 3, 15)
    const rule: RecurrenceRule = { type: 'yearly' }
    const result = computeNextDueDate(localDate(2026, 3, 14), rule)
    expect(fmt(result)).toBe('2027-03-14')
  })

  it('yearly rule: Feb 29 clamps to Feb 28 on non-leap year', () => {
    fakeToday(2025, 2, 1)
    const rule: RecurrenceRule = { type: 'yearly' }
    const result = computeNextDueDate(localDate(2024, 2, 29), rule)
    expect(fmt(result)).toBe('2025-02-28')
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
