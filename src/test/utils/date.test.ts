import { describe, it, expect } from 'vitest'
import {
  MS_PER_DAY,
  startOfDay,
  startOfToday,
  isSameDay,
  formatDate,
  formatDateShort,
  formatRelativeTime,
  toDateInputValue,
} from '../../utils/date'

describe('MS_PER_DAY', () => {
  it('equals 86400000 milliseconds', () => {
    expect(MS_PER_DAY).toBe(86_400_000)
  })
})

describe('startOfDay', () => {
  it('returns midnight of the given date', () => {
    const d = new Date(2024, 5, 15, 14, 30, 45, 999)
    const result = startOfDay(d)
    expect(result.getHours()).toBe(0)
    expect(result.getMinutes()).toBe(0)
    expect(result.getSeconds()).toBe(0)
    expect(result.getMilliseconds()).toBe(0)
  })

  it('preserves the calendar date', () => {
    const d = new Date(2024, 5, 15, 23, 59, 59)
    const result = startOfDay(d)
    expect(result.getFullYear()).toBe(2024)
    expect(result.getMonth()).toBe(5)
    expect(result.getDate()).toBe(15)
  })

  it('does not mutate the input date', () => {
    const d = new Date(2024, 5, 15, 10, 20, 30)
    startOfDay(d)
    expect(d.getHours()).toBe(10)
  })

  it('already-midnight date returns same midnight', () => {
    const d = new Date(2024, 0, 1, 0, 0, 0, 0)
    const result = startOfDay(d)
    expect(result.getTime()).toBe(d.getTime())
  })
})

describe('startOfToday', () => {
  it('returns today at midnight', () => {
    const result = startOfToday()
    const now = new Date()
    expect(result.getFullYear()).toBe(now.getFullYear())
    expect(result.getMonth()).toBe(now.getMonth())
    expect(result.getDate()).toBe(now.getDate())
    expect(result.getHours()).toBe(0)
    expect(result.getMinutes()).toBe(0)
    expect(result.getSeconds()).toBe(0)
  })
})

describe('isSameDay', () => {
  it('returns true for dates on the same calendar day', () => {
    const a = new Date(2024, 3, 10, 8, 0, 0)
    const b = new Date(2024, 3, 10, 22, 59, 59)
    expect(isSameDay(a, b)).toBe(true)
  })

  it('returns false for dates on different days', () => {
    const a = new Date(2024, 3, 10)
    const b = new Date(2024, 3, 11)
    expect(isSameDay(a, b)).toBe(false)
  })

  it('returns false for same day different months', () => {
    const a = new Date(2024, 3, 10)
    const b = new Date(2024, 4, 10)
    expect(isSameDay(a, b)).toBe(false)
  })

  it('returns false for same day different years', () => {
    const a = new Date(2023, 3, 10)
    const b = new Date(2024, 3, 10)
    expect(isSameDay(a, b)).toBe(false)
  })

  it('returns true when comparing identical date objects', () => {
    const a = new Date(2024, 0, 1)
    expect(isSameDay(a, a)).toBe(true)
  })
})

describe('formatDate', () => {
  it('formats a date as "Mon DD, YYYY"', () => {
    const d = new Date(2024, 0, 5) // Jan 5, 2024
    expect(formatDate(d)).toBe('Jan 5, 2024')
  })

  it('formats end of year correctly', () => {
    const d = new Date(2023, 11, 31) // Dec 31, 2023
    expect(formatDate(d)).toBe('Dec 31, 2023')
  })
})

describe('formatDateShort', () => {
  it('omits the year when the date is in the current year', () => {
    const now = new Date()
    const d = new Date(now.getFullYear(), 0, 5) // Jan 5 of this year
    expect(formatDateShort(d)).toBe('Jan 5')
  })

  it('includes the year when the date is in a different year', () => {
    const now = new Date()
    const d = new Date(now.getFullYear() + 1, 0, 5) // Jan 5 of next year
    expect(formatDateShort(d)).toBe(`Jan 5, ${now.getFullYear() + 1}`)
  })

  it('includes the year for past years', () => {
    const now = new Date()
    const d = new Date(now.getFullYear() - 2, 11, 31)
    expect(formatDateShort(d)).toBe(`Dec 31, ${now.getFullYear() - 2}`)
  })
})

describe('formatRelativeTime', () => {
  it('returns "just now" for a date less than 1 minute ago', () => {
    const d = new Date(Date.now() - 30_000)
    expect(formatRelativeTime(d)).toBe('just now')
  })

  it('returns "Xm ago" for minutes ago', () => {
    const d = new Date(Date.now() - 5 * 60_000)
    expect(formatRelativeTime(d)).toBe('5m ago')
  })

  it('returns "Xh ago" for hours ago', () => {
    const d = new Date(Date.now() - 3 * 60 * 60_000)
    expect(formatRelativeTime(d)).toBe('3h ago')
  })

  it('returns "Xd ago" for days ago', () => {
    const d = new Date(Date.now() - 2 * MS_PER_DAY)
    expect(formatRelativeTime(d)).toBe('2d ago')
  })

  it('returns "59m ago" for 59 minutes ago', () => {
    const d = new Date(Date.now() - 59 * 60_000)
    expect(formatRelativeTime(d)).toBe('59m ago')
  })
})

describe('toDateInputValue', () => {
  it('returns YYYY-MM-DD string for a date', () => {
    const d = new Date('2024-06-15T12:00:00Z')
    expect(toDateInputValue(d)).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('returns empty string for undefined', () => {
    expect(toDateInputValue(undefined)).toBe('')
  })

  it('formats Jan 5, 2024 as "2024-01-05"', () => {
    // Use UTC to avoid timezone shifting the date
    const d = new Date('2024-01-05T12:00:00Z')
    expect(toDateInputValue(d)).toBe('2024-01-05')
  })

  it('uses local date, not UTC (no date shift for evening times)', () => {
    // 11:30 PM local time — toISOString() would shift to next day for UTC- timezones
    const d = new Date(2024, 0, 5, 23, 30, 0) // Jan 5, 2024 at 11:30 PM local
    expect(toDateInputValue(d)).toBe('2024-01-05')
  })
})
