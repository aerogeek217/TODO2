// A task row's date (D25 D1): `Today`, the weekday for the next six days,
// `Nov 20` in this calendar year, `01/15/27` in another — or `MM/DD`. Runs
// in a DST zone (US Eastern, 2026: clocks go forward Sun 8 Mar, back Sun
// 1 Nov), so the day counts are checked across both transitions.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { formatRowDate } from '../../utils/date'
import { isRowDates } from '../../utils/row-dates'

// Node re-reads TZ when it is assigned, but deleting it keeps the last zone,
// so put back the zone this worker had by name (shared vitest workers).
const originalZone = Intl.DateTimeFormat().resolvedOptions().timeZone

beforeAll(() => {
  process.env.TZ = 'America/New_York'
})

afterAll(() => {
  process.env.TZ = originalZone
})

const rel = (date: Date, today: Date) => formatRowDate(date, today, 'relative')
const num = (date: Date, today: Date) => formatRowDate(date, today, 'numeric')

describe('formatRowDate — relative', () => {
  // Friday 6 Nov 2026, mid-morning.
  const today = new Date(2026, 10, 6, 10, 30)

  it('today is Today, whatever the time of day on either side', () => {
    expect(rel(new Date(2026, 10, 6), today)).toBe('Today')
    expect(rel(new Date(2026, 10, 6, 23, 59), today)).toBe('Today')
    expect(rel(new Date(2026, 10, 6), new Date(2026, 10, 6, 23, 59))).toBe('Today')
  })

  it('tomorrow is its weekday (no Tmrw), and so is each of the next six days', () => {
    expect(rel(new Date(2026, 10, 7), today)).toBe('Sat')
    expect(rel(new Date(2026, 10, 9), today)).toBe('Mon')
    expect(rel(new Date(2026, 10, 12), today)).toBe('Thu')
  })

  it('a week out is the month and day', () => {
    expect(rel(new Date(2026, 10, 13), today)).toBe('Nov 13')
    expect(rel(new Date(2026, 10, 20), today)).toBe('Nov 20')
    expect(rel(new Date(2026, 11, 31), today)).toBe('Dec 31')
  })

  it('a past day (overdue) keeps its month and day — never a weekday', () => {
    expect(rel(new Date(2026, 10, 5), today)).toBe('Nov 5')
    expect(rel(new Date(2026, 9, 27), today)).toBe('Oct 27')
    expect(rel(new Date(2026, 0, 1), today)).toBe('Jan 1')
  })

  it('another calendar year is MM/DD/YY', () => {
    expect(rel(new Date(2027, 0, 15), today)).toBe('01/15/27')
    expect(rel(new Date(2025, 2, 4), today)).toBe('03/04/25')
    expect(rel(new Date(2030, 11, 9), today)).toBe('12/09/30')
  })

  it('across the year end: the next six days stay weekdays, then the other year’s MM/DD/YY', () => {
    const newYearsEve = new Date(2026, 11, 31, 18) // Thursday
    expect(rel(new Date(2026, 11, 31), newYearsEve)).toBe('Today')
    expect(rel(new Date(2027, 0, 1), newYearsEve)).toBe('Fri')
    expect(rel(new Date(2027, 0, 6), newYearsEve)).toBe('Wed')
    expect(rel(new Date(2027, 0, 7), newYearsEve)).toBe('01/07/27')
    expect(rel(new Date(2026, 11, 30), newYearsEve)).toBe('Dec 30')
    // The day before New Year's Day is last year's.
    expect(rel(new Date(2026, 11, 31), new Date(2027, 0, 1, 9))).toBe('12/31/26')
  })

  it('counts calendar days over the 25-hour day (clocks back Sun 1 Nov)', () => {
    const lateSaturday = new Date(2026, 9, 31, 23, 30)
    expect(rel(new Date(2026, 10, 1), lateSaturday)).toBe('Sun')
    expect(rel(new Date(2026, 10, 1, 23), new Date(2026, 9, 31))).toBe('Sun')
    expect(rel(new Date(2026, 10, 6), lateSaturday)).toBe('Fri')
    expect(rel(new Date(2026, 10, 7), lateSaturday)).toBe('Nov 7')
  })

  it('counts calendar days over the 23-hour day (clocks forward Sun 8 Mar)', () => {
    const lateSaturday = new Date(2026, 2, 7, 23, 30)
    expect(rel(new Date(2026, 2, 8), lateSaturday)).toBe('Sun')
    expect(rel(new Date(2026, 2, 13, 23, 59), lateSaturday)).toBe('Fri')
    expect(rel(new Date(2026, 2, 14), lateSaturday)).toBe('Mar 14')
    expect(rel(new Date(2026, 2, 7), new Date(2026, 2, 8, 12))).toBe('Mar 7')
  })
})

describe('formatRowDate — numeric', () => {
  const today = new Date(2026, 10, 6, 10, 30)

  it('is MM/DD for every day: today, the next days, the past, another year', () => {
    expect(num(new Date(2026, 10, 6), today)).toBe('11/06')
    expect(num(new Date(2026, 10, 7), today)).toBe('11/07')
    expect(num(new Date(2026, 10, 12), today)).toBe('11/12')
    expect(num(new Date(2026, 10, 13), today)).toBe('11/13')
    expect(num(new Date(2026, 10, 5), today)).toBe('11/05')
    expect(num(new Date(2027, 0, 15), today)).toBe('01/15')
  })

  it('is MM/DD in a DST-change week', () => {
    const lateSaturday = new Date(2026, 9, 31, 23, 30)
    expect(num(new Date(2026, 10, 1), lateSaturday)).toBe('11/01')
    expect(num(new Date(2026, 10, 6), lateSaturday)).toBe('11/06')
    expect(num(new Date(2026, 2, 8), new Date(2026, 2, 7, 23, 30))).toBe('03/08')
  })
})

describe('isRowDates', () => {
  it('accepts relative and numeric only', () => {
    expect(isRowDates('relative')).toBe(true)
    expect(isRowDates('numeric')).toBe(true)
    expect(isRowDates('short')).toBe(false)
    expect(isRowDates(undefined)).toBe(false)
  })
})
