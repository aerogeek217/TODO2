import { describe, it, expect, vi, afterEach } from 'vitest'
import { computeNextDueDate, generateRecurringInstances, makeRecurrenceRule, advanceRecurring } from '../../utils/recurrence'
import type { RecurrenceRule } from '../../models/recurrence'
import type { TodoItem } from '../../models/todo-item'

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

  it('yearly leap-day: chained advances elevate back across multiple non-leap years', () => {
    // From the Feb 29 anchor, walking 4 yearly steps must land back on Feb 29
    // 4 years later — never silently lock to Feb 28. The advance reads
    // originalDayOfMonth on every step (not getDate from the prior result).
    // Anchor `today` BEFORE Feb 29 2028 so the iterator stops on the leap-year
    // landing rather than rolling past it.
    fakeToday(2028, 2, 1)
    const rule: RecurrenceRule = { type: 'yearly', originalDayOfMonth: 29 }
    const result = computeNextDueDate(localDate(2024, 2, 29), rule)
    expect(fmt(result)).toBe('2028-02-29')
  })

  it('DST forward-spring (US 2026-03-08): re-anchors to local midnight', () => {
    // Pre-DST anchor at 23:30 local on the day before spring-forward. Without
    // setHours(0,0,0,0) the resulting timestamp can shift by an hour. The
    // local-midnight reset means fmt() (which reads local Y/M/D) is stable.
    fakeToday(2026, 3, 9)
    const rule: RecurrenceRule = { type: 'daily' }
    const preDst = new Date(2026, 2, 7, 23, 30, 0, 0) // March 7, 2026 23:30 local
    const result = computeNextDueDate(preDst, rule)
    // March 8 is the spring-forward day. The advance + setHours(0,0,0,0)
    // pin the result to local midnight on March 9 (>= today).
    expect(fmt(result)).toBe('2026-03-09')
    expect(result.getHours()).toBe(0)
    expect(result.getMinutes()).toBe(0)
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
    expect(fmt(instances[0]!)).toBe('2026-01-05')
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
    expect(fmt(instances[2]!)).toBe('2026-01-03')
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

  it('a daily task due 30 years ago still shows this month', () => {
    const instances = generateRecurringInstances(localDate(1996, 3, 4), { type: 'daily' }, localDate(2026, 10, 1), localDate(2026, 10, 4))
    expect(instances.map(fmt)).toEqual(['2026-10-01', '2026-10-02', '2026-10-03'])
  })

  it('a far range is reached without walking every occurrence before it', () => {
    // Weekly from 1900: tens of thousands of weeks before the range.
    const instances = generateRecurringInstances(localDate(1900, 1, 1), { type: 'weekly' }, localDate(2026, 10, 1), localDate(2026, 10, 15))
    expect(instances.map(fmt)).toEqual(['2026-10-05', '2026-10-12'])
  })

  // The range reached arithmetically shows exactly what walking every
  // occurrence from the due date shows (the due date's own time of day, the
  // clamped month ends, Feb 29, a legacy rule that drifts).
  const cases: Array<[string, Date, RecurrenceRule]> = [
    ['daily at 09:30', new Date(2019, 4, 6, 9, 30), { type: 'daily' }],
    ['weekly', localDate(2020, 2, 29), { type: 'weekly' }],
    ['biweekly', localDate(2021, 12, 31), { type: 'biweekly' }],
    ['monthly on the 31st', localDate(2019, 1, 31), { type: 'monthly', originalDayOfMonth: 31 }],
    ['monthly on the 30th, no day kept (drifts at February)', localDate(2019, 1, 30), { type: 'monthly' }],
    ['monthly on the 15th, no day kept', localDate(2019, 1, 15), { type: 'monthly' }],
    ['quarterly on the 31st', localDate(2018, 8, 31), { type: 'quarterly', originalDayOfMonth: 31 }],
    ['yearly on Feb 29', localDate(2004, 2, 29), { type: 'yearly', originalDayOfMonth: 29 }],
    ['yearly on Feb 29, no day kept', localDate(2004, 2, 29), { type: 'yearly' }],
  ]
  it.each(cases)('%s: the same occurrences as a walk from the due date', (_name, due, rule) => {
    const walkedAll = generateRecurringInstances(due, rule, due, localDate(2029, 1, 1))
    for (const [from, to] of [[localDate(2026, 3, 1), localDate(2026, 6, 1)], [localDate(2028, 2, 1), localDate(2028, 3, 5)], [due, localDate(2019, 6, 1)]] as const) {
      const expected = walkedAll.filter((d) => d >= from && d < to).map((d) => d.getTime())
      expect(generateRecurringInstances(due, rule, from, to).map((d) => d.getTime())).toEqual(expected)
    }
  })
})

describe('computeNextDueDate — long overdue', () => {
  afterEach(() => vi.useRealTimers())

  it('a daily task overdue for 30 years moves to today', () => {
    vi.useFakeTimers()
    vi.setSystemTime(localDate(2026, 10, 21))
    expect(fmt(computeNextDueDate(localDate(1996, 3, 4), { type: 'daily' }))).toBe('2026-10-21')
    expect(fmt(computeNextDueDate(localDate(1996, 1, 31), { type: 'monthly', originalDayOfMonth: 31 }))).toBe('2026-10-31')
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

describe('advanceRecurring', () => {
  afterEach(() => vi.useRealTimers())

  function fakeToday(y: number, m: number, d: number) {
    vi.useFakeTimers()
    vi.setSystemTime(localDate(y, m, d))
  }

  const partial = <T extends Partial<TodoItem>>(t: T) => t

  it('returns null without a rule', () => {
    expect(advanceRecurring(partial({ dueDate: localDate(2026, 1, 10) }))).toBeNull()
  })

  it('advances the due date', () => {
    fakeToday(2026, 1, 15)
    const result = advanceRecurring(partial({
      dueDate: localDate(2026, 1, 10),
      recurrenceRule: { type: 'weekly' },
    }))
    expect(fmt(result!.dueDate)).toBe('2026-01-17')
  })

  it('returns null without a due date', () => {
    const result = advanceRecurring(partial({
      nextFollowupAt: localDate(2026, 1, 10),
      recurrenceRule: { type: 'weekly' },
    }))
    expect(result).toBeNull()
  })
})
