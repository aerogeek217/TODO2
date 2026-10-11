import { describe, it, expect } from 'vitest'
import {
  addDays,
  calendarRange,
  calendarRangeLabel,
  calendarRangeName,
  convertCalendarOffset,
  monthCellFit,
  monthCellOverflow,
  weekStartOf,
  weekdayLabels,
} from '../../utils/calendar-grid'

const sun11Oct = new Date(2026, 9, 11) // a Sunday
const wed14Oct = new Date(2026, 9, 14)

describe('weeks follow weekStartsOn', () => {
  it('week start: Monday or Sunday', () => {
    expect(weekStartOf(sun11Oct, 1)).toEqual(new Date(2026, 9, 5))
    expect(weekStartOf(sun11Oct, 0)).toEqual(new Date(2026, 9, 11))
    expect(weekStartOf(wed14Oct, 0)).toEqual(new Date(2026, 9, 11))
  })

  it('weekday labels start on the week start', () => {
    expect(weekdayLabels(1)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'])
    expect(weekdayLabels(0)).toEqual(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'])
  })

  it('day arithmetic stays on midnight across DST changes', () => {
    const start = new Date(2026, 2, 1)
    for (let i = 0; i < 400; i++) {
      const d = addDays(start, i)
      expect(d.getHours()).toBe(0)
    }
  })
})

describe('calendarRange', () => {
  it('month: six weeks from the week holding the 1st', () => {
    const r = calendarRange('month', 0, wed14Oct, 1)
    expect(r.days).toHaveLength(42)
    expect(r.start).toEqual(new Date(2026, 9, 1))
    expect(r.days[0]).toEqual(new Date(2026, 8, 28))
    expect(r.days[41]).toEqual(new Date(2026, 10, 8))
    expect(calendarRange('month', 0, wed14Oct, 0).days[0]).toEqual(new Date(2026, 8, 27))
  })

  it('month offsets step whole months, across years', () => {
    expect(calendarRange('month', 3, wed14Oct, 1).start).toEqual(new Date(2027, 0, 1))
    expect(calendarRange('month', -10, wed14Oct, 1).start).toEqual(new Date(2025, 11, 1))
  })

  it('week: the seven days of the week holding today + offset weeks', () => {
    const r = calendarRange('week', 1, sun11Oct, 1)
    expect(r.days[0]).toEqual(new Date(2026, 9, 12))
    expect(r.days[6]).toEqual(new Date(2026, 9, 18))
  })
})

describe('labels', () => {
  it('month: long or short', () => {
    const r = calendarRange('month', 0, wed14Oct, 1)
    expect(calendarRangeLabel(r, false)).toBe('October 2026')
    expect(calendarRangeLabel(r, true)).toBe('Oct 2026')
  })

  it('week: same month, spanning months, spanning years', () => {
    expect(calendarRangeLabel(calendarRange('week', 0, sun11Oct, 1), false)).toBe('Oct 5 – 11, 2026')
    expect(calendarRangeLabel(calendarRange('week', 0, sun11Oct, 1), true)).toBe('Oct 5 – 11')
    expect(calendarRangeLabel(calendarRange('week', -1, new Date(2026, 9, 1), 1), true)).toBe('Sep 21 – 27')
    expect(calendarRangeLabel(calendarRange('week', 0, new Date(2026, 9, 1), 1), false)).toBe('Sep 28 – Oct 4, 2026')
    expect(calendarRangeLabel(calendarRange('week', 0, new Date(2026, 11, 30), 1), false)).toBe('Dec 28, 2026 – Jan 3, 2027')
  })

  it('range names for the empty note', () => {
    expect(calendarRangeName(calendarRange('month', 0, wed14Oct, 1), wed14Oct, 1)).toBe('October')
    expect(calendarRangeName(calendarRange('month', 3, wed14Oct, 1), wed14Oct, 1)).toBe('January 2027')
    expect(calendarRangeName(calendarRange('week', 0, wed14Oct, 1), wed14Oct, 1)).toBe('this week')
    expect(calendarRangeName(calendarRange('week', 1, wed14Oct, 1), wed14Oct, 1)).toBe('the week of Oct 19')
  })
})

describe('convertCalendarOffset', () => {
  it('keeps 0 and same-view offsets', () => {
    expect(convertCalendarOffset('month', 'week', 0, wed14Oct, 1)).toBe(0)
    expect(convertCalendarOffset('week', 'week', 4, wed14Oct, 1)).toBe(4)
  })

  it('month → the week holding its 1st; week → the month holding its middle', () => {
    const weeks = convertCalendarOffset('month', 'week', 1, wed14Oct, 1)
    expect(calendarRange('week', weeks, wed14Oct, 1).days).toContainEqual(new Date(2026, 10, 1))
    expect(convertCalendarOffset('week', 'month', 3, wed14Oct, 1)).toBe(1)
    expect(convertCalendarOffset('week', 'month', -2, wed14Oct, 1)).toBe(0)
    expect(convertCalendarOffset('week', 'month', -3, wed14Oct, 1)).toBe(-1)
  })
})

describe('month cell fit', () => {
  it('fits floor((h − 22) / 19) entries; unbounded before measuring', () => {
    expect(monthCellFit(80)).toBe(3)
    expect(monthCellFit(60)).toBe(2)
    expect(monthCellFit(20)).toBe(0)
    expect(monthCellFit(0)).toBe(Number.POSITIVE_INFINITY)
  })

  it('overflow: everything when it fits, else fit − 1 entries and +N more', () => {
    expect(monthCellOverflow(3, 3)).toEqual({ shown: 3, more: 0 })
    expect(monthCellOverflow(6, 3)).toEqual({ shown: 2, more: 4 })
    expect(monthCellOverflow(2, 0)).toEqual({ shown: 0, more: 2 })
    expect(monthCellOverflow(5, Number.POSITIVE_INFINITY)).toEqual({ shown: 5, more: 0 })
  })
})
