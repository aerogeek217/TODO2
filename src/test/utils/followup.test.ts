import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  addFollowupInterval,
  describeFollowupInterval,
  followupPillLabel,
  followupTooltip,
  formatFollowupDate,
  formatFollowupDay,
  formatFollowupInterval,
  isFollowupOverdue,
  isFutureDay,
  lastFollowupLine,
  parseFollowupInput,
  parseFollowupInterval,
  relativeDayPhrase,
} from '../../utils/followup'
import { interpretFollowupText } from '../../hooks/use-followup-input'

// Sat 10 Oct 2026, local time.
const TODAY = new Date(2026, 9, 10)
const day = (y: number, m: number, d: number) => new Date(y, m - 1, d)

beforeEach(() => {
  // The date-phrase grammar (`fri`, `tomorrow`) reads the clock.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 10, 15, 30))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('parseFollowupInterval / format / describe', () => {
  it('accepts d / w / m / y with a count of 1–999, any case and spacing', () => {
    expect(parseFollowupInterval('3d')).toEqual({ count: 3, unit: 'd' })
    expect(parseFollowupInterval(' 2 W ')).toEqual({ count: 2, unit: 'w' })
    expect(parseFollowupInterval('1m')).toEqual({ count: 1, unit: 'm' })
    expect(parseFollowupInterval('999y')).toEqual({ count: 999, unit: 'y' })
  })

  it('rejects zero, too-large counts, unknown units and junk', () => {
    for (const bad of ['0d', '1000d', '2x', 'm', '1.5w', '-1d', '', 'tomorrow']) {
      expect(parseFollowupInterval(bad), bad).toBeNull()
    }
  })

  it('formats compactly and describes in words', () => {
    expect(formatFollowupInterval({ count: 10, unit: 'd' })).toBe('10d')
    expect(describeFollowupInterval({ count: 1, unit: 'm' })).toBe('1 month')
    expect(describeFollowupInterval({ count: 2, unit: 'w' })).toBe('2 weeks')
  })
})

describe('addFollowupInterval', () => {
  it('counts from the day (time of day dropped) and lands on local midnight', () => {
    const r = addFollowupInterval(new Date(2026, 9, 10, 23, 59), { count: 3, unit: 'd' })
    expect(r).toEqual(day(2026, 10, 13))
    expect(r.getHours()).toBe(0)
  })

  it('weeks are 7 days; months clamp to the last day; years are 12 months', () => {
    expect(addFollowupInterval(TODAY, { count: 2, unit: 'w' })).toEqual(day(2026, 10, 24))
    expect(addFollowupInterval(day(2026, 1, 31), { count: 1, unit: 'm' })).toEqual(day(2026, 2, 28))
    expect(addFollowupInterval(day(2028, 1, 31), { count: 1, unit: 'm' })).toEqual(day(2028, 2, 29))
    expect(addFollowupInterval(TODAY, { count: 1, unit: 'm' })).toEqual(day(2026, 11, 10))
    expect(addFollowupInterval(day(2028, 2, 29), { count: 1, unit: 'y' })).toEqual(day(2029, 2, 28))
  })
})

describe('parseFollowupInput', () => {
  const date = (text: string) => {
    const r = parseFollowupInput(text, TODAY)
    return r.kind === 'date' ? r.date : r.kind
  }

  it('empty → empty; unreadable → invalid', () => {
    expect(parseFollowupInput('   ', TODAY)).toEqual({ kind: 'empty' })
    expect(date('whenever')).toBe('invalid')
    expect(date('31 Feb')).toBe('invalid')
  })

  it('intervals resolve from today and report the interval', () => {
    expect(parseFollowupInput('2w', TODAY)).toEqual({
      kind: 'date', date: day(2026, 10, 24), interval: { count: 2, unit: 'w' },
    })
  })

  it('day + month names roll forward to the next occurrence; an explicit year is kept', () => {
    expect(date('24 Oct')).toEqual(day(2026, 10, 24))
    expect(date('Oct 24')).toEqual(day(2026, 10, 24))
    expect(date('9 Oct')).toEqual(day(2027, 10, 9))
    expect(date('10 oct')).toEqual(day(2026, 10, 10))
    expect(date('3 September 2025')).toEqual(day(2025, 9, 3))
    expect(date('sept 3')).toEqual(day(2027, 9, 3))
  })

  it('ignores a leading weekday (the inputs show "Tue 13 Oct")', () => {
    expect(date('Tue 13 Oct')).toEqual(day(2026, 10, 13))
    expect(date('Fri, 24 October 2027')).toEqual(day(2027, 10, 24))
  })

  it('ISO dates and the existing date grammar (MM/DD, day names, keywords)', () => {
    expect(date('2026-12-01')).toEqual(day(2026, 12, 1))
    expect(date('10/24')).toEqual(day(2026, 10, 24))
    expect(date('fri')).toEqual(day(2026, 10, 16))
    expect(date('tomorrow')).toEqual(day(2026, 10, 11))
    expect(date('in 3 days')).toEqual(day(2026, 10, 13))
  })
})

describe('labels', () => {
  it('pill label: Today / same month / other month / other year', () => {
    expect(followupPillLabel({ nextFollowupAt: TODAY, isCompleted: false }, TODAY)).toBe('Today')
    expect(followupPillLabel({ nextFollowupAt: day(2026, 10, 13), isCompleted: false }, TODAY)).toBe('Tue 13')
    expect(followupPillLabel({ nextFollowupAt: day(2026, 11, 10), isCompleted: false }, TODAY)).toBe('Tue 10 Nov')
    expect(formatFollowupDay(day(2027, 1, 5), TODAY)).toBe('Tue 5 Jan 2027')
  })

  it('overdue: the day only (no "late" text) for open tasks; completed tasks are never overdue', () => {
    const t = { nextFollowupAt: day(2026, 10, 9), isCompleted: false }
    expect(isFollowupOverdue(t, TODAY)).toBe(true)
    expect(followupPillLabel(t, TODAY)).toBe('Fri 9')
    const done = { ...t, isCompleted: true }
    expect(isFollowupOverdue(done, TODAY)).toBe(false)
    expect(followupPillLabel(done, TODAY)).toBe('Fri 9')
    expect(isFollowupOverdue({ nextFollowupAt: TODAY, isCompleted: false }, TODAY)).toBe(false)
  })

  it('relative phrases', () => {
    expect(relativeDayPhrase(TODAY, TODAY)).toBe('today')
    expect(relativeDayPhrase(day(2026, 10, 13), TODAY)).toBe('in 3 days')
    expect(relativeDayPhrase(day(2026, 10, 24), TODAY)).toBe('in 2 weeks')
    expect(relativeDayPhrase(day(2026, 11, 10), TODAY)).toBe('in 1 month')
    expect(relativeDayPhrase(day(2026, 9, 13), TODAY)).toBe('4 weeks ago')
    expect(relativeDayPhrase(day(2026, 10, 9), TODAY)).toBe('yesterday')
  })

  it('tooltip: next (or overdue) line, then last follow-up', () => {
    expect(followupTooltip({ nextFollowupAt: day(2026, 10, 13), lastFollowupAt: day(2026, 9, 13), isCompleted: false }, TODAY))
      .toBe('Next follow-up · Tue 13 Oct\nLast followed up Sun 13 Sep, 4 weeks ago')
    expect(followupTooltip({ nextFollowupAt: day(2026, 10, 9), isCompleted: false }, TODAY))
      .toBe('Follow-up overdue · Fri 9 Oct\nNever followed up')
    expect(lastFollowupLine(undefined, TODAY)).toBe('Never followed up')
    expect(formatFollowupDate(day(2027, 3, 1), TODAY)).toBe('Mon 1 Mar 2027')
  })

  it('isFutureDay compares days, not instants', () => {
    expect(isFutureDay(new Date(2026, 9, 10, 23, 0), TODAY)).toBe(false)
    expect(isFutureDay(day(2026, 10, 11), TODAY)).toBe(true)
  })
})

describe('interpretFollowupText', () => {
  it('next: intervals and dates are valid, junk carries the help text', () => {
    expect(interpretFollowupText('1m', 'next', TODAY)).toEqual({ kind: 'valid', date: day(2026, 11, 10) })
    expect(interpretFollowupText('yesterday', 'next', TODAY)).toEqual({ kind: 'valid', date: day(2026, 10, 9) })
    expect(interpretFollowupText('zz', 'next', TODAY)).toEqual({
      kind: 'invalid', message: 'Try 2w, 10d, 1m, fri, 24 Oct or 10/24',
    })
    expect(interpretFollowupText('', 'next', TODAY)).toEqual({ kind: 'empty' })
  })

  it('last: dates only, never in the future; year-less dates resolve backwards', () => {
    expect(interpretFollowupText('13 Sep', 'last', TODAY)).toEqual({ kind: 'valid', date: day(2026, 9, 13) })
    expect(interpretFollowupText('12/24', 'last', TODAY)).toEqual({ kind: 'valid', date: day(2025, 12, 24) })
    expect(interpretFollowupText('Sun 13 Sep', 'last', TODAY)).toEqual({ kind: 'valid', date: day(2026, 9, 13) })
    expect(interpretFollowupText('13 Sep 2026', 'last', TODAY)).toEqual({ kind: 'valid', date: day(2026, 9, 13) })
    expect(interpretFollowupText('tomorrow', 'last', TODAY)).toEqual({
      kind: 'invalid', message: "Last follow-up can't be in the future",
    })
    expect(interpretFollowupText('2w', 'last', TODAY).kind).toBe('invalid')
  })
})
