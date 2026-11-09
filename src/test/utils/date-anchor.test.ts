import { describe, expect, it } from 'vitest'
import type { DateAnchor } from '../../models'
import {
  CALENDAR_PRESETS,
  DAY_PRESETS,
  ROLLING_DAYS,
  convertAnchor,
  MAX_DAY_COUNT,
  countAnchor,
  dateAnchorsEqual,
  entryModeOf,
  fitsCalendar,
  fixedAnchorOn,
  relativeEndOf,
  resolvedEndWords,
  rollingDayLabel,
  switchAnchorMode,
} from '../../utils/date-anchor'

/**
 * The date entry model behind the panel's Calendar / Relative ends (cr25 P8,
 * D23 board B): stored anchors ⇄ a Relative end (number + count, rolling
 * day, a saved mix's date, no end), the mode a range opens in, switching
 * modes (convert, then restore while unchanged), the presets of both modes
 * and the day under a Relative end. Nothing here changes a stored shape.
 */

const TODAY = new Date(2026, 10, 2) // Mon 2 Nov 2026
const MON = 1 as const
const fixed = (y: number, m: number, d: number): DateAnchor => ({ kind: 'fixed', iso: new Date(y, m - 1, d).toISOString() })
const offset = (days: number): DateAnchor => ({ kind: 'offset', days })
const token = (t: 'today' | 'end-of-week' | 'start-of-week' | 'end-of-next-month' | 'yesterday'): DateAnchor => ({ kind: 'relative', token: t })

describe('a Relative end ⇄ the stored anchor', () => {
  it('reads offsets as an unsigned number and what it counts; tokens as rolling days; a date as itself; null as no end', () => {
    expect(relativeEndOf(offset(-7))).toEqual({ kind: 'count', days: 7, count: 'ago' })
    expect(relativeEndOf(offset(14))).toEqual({ kind: 'count', days: 14, count: 'ahead' })
    expect(relativeEndOf(token('end-of-week'))).toEqual({ kind: 'rolling', token: 'end-of-week' })
    expect(relativeEndOf(fixed(2026, 10, 1))).toEqual({ kind: 'date', iso: new Date(2026, 9, 1).toISOString() })
    expect(relativeEndOf(null)).toEqual({ kind: 'none' })
  })

  it('an offset of 0 counts what was picked last (days ago by default); the today token stays a rolling day', () => {
    expect(relativeEndOf(offset(0))).toEqual({ kind: 'count', days: 0, count: 'ago' })
    expect(relativeEndOf(offset(0), 'ahead')).toEqual({ kind: 'count', days: 0, count: 'ahead' })
    expect(relativeEndOf(token('today'))).toEqual({ kind: 'rolling', token: 'today' })
  })

  it('writes a number and its count as a day offset, never signed in the number', () => {
    expect(countAnchor(7, 'ago')).toEqual(offset(-7))
    expect(countAnchor(7, 'ahead')).toEqual(offset(7))
    expect(countAnchor(0, 'ago')).toEqual(offset(0))
    expect(countAnchor(0, 'ahead')).toEqual(offset(0))
    // Round trip both ways.
    for (const days of [-30, -14, -7, -1, 0, 1, 7, 14, 30, 999]) {
      const end = relativeEndOf(offset(days))
      if (end.kind !== 'count') throw new Error('expected a count')
      expect(end.days).toBeGreaterThanOrEqual(0)
      expect(countAnchor(end.days, end.count)).toEqual(offset(days))
    }
  })

  it('a calendar day is stored at its local midnight', () => {
    expect(fixedAnchorOn(new Date(2026, 10, 2, 15, 30))).toEqual(fixed(2026, 11, 2))
  })
})

describe('which mode a range opens in', () => {
  it('Calendar when every end it has is a date; Relative when any end is a count or a rolling day; a new range Relative', () => {
    expect(entryModeOf(fixed(2026, 10, 1), fixed(2026, 10, 31))).toBe('calendar')
    expect(entryModeOf(null, fixed(2026, 10, 31))).toBe('calendar')
    expect(entryModeOf(null, offset(-7))).toBe('relative')
    expect(entryModeOf(token('start-of-week'), null)).toBe('relative')
    // A saved mix opens in Relative.
    expect(entryModeOf(fixed(2026, 10, 1), token('today'))).toBe('relative')
    expect(entryModeOf(null, null)).toBe('relative')
  })

  it('only a range of dates (or open ends) fits Calendar', () => {
    expect(fitsCalendar(null, null)).toBe(true)
    expect(fitsCalendar(fixed(2026, 10, 1), null)).toBe(true)
    expect(fitsCalendar(fixed(2026, 10, 1), offset(0))).toBe(false)
  })
})

describe('switching modes', () => {
  it('to Calendar: each end its day today as a date', () => {
    expect(convertAnchor(offset(-7), 'calendar', TODAY, MON)).toEqual(fixed(2026, 10, 26))
    expect(convertAnchor(token('end-of-week'), 'calendar', TODAY, MON)).toEqual(fixed(2026, 11, 8))
    expect(convertAnchor(fixed(2026, 10, 1), 'calendar', TODAY, MON)).toEqual(fixed(2026, 10, 1))
    expect(convertAnchor(null, 'calendar', TODAY, MON)).toBeNull()
  })

  it('to Relative: each date as days from today, today itself as the today rolling day; other ends unchanged', () => {
    expect(convertAnchor(fixed(2026, 10, 26), 'relative', TODAY, MON)).toEqual(offset(-7))
    expect(convertAnchor(fixed(2026, 11, 16), 'relative', TODAY, MON)).toEqual(offset(14))
    expect(convertAnchor(fixed(2026, 11, 2), 'relative', TODAY, MON)).toEqual(token('today'))
    expect(convertAnchor(token('end-of-week'), 'relative', TODAY, MON)).toEqual(token('end-of-week'))
    expect(convertAnchor(null, 'relative', TODAY, MON)).toBeNull()
  })

  it('to Relative: a date more than 999 days away stays a date (the number box holds 3 digits) — P7–P8 review', () => {
    // Jan 1 2023 is 1401 days back; Feb 7 2024 is 999 back, Jul 28 2029 999 ahead.
    expect(convertAnchor(fixed(2023, 1, 1), 'relative', TODAY, MON)).toEqual(fixed(2023, 1, 1))
    expect(convertAnchor(fixed(2024, 2, 6), 'relative', TODAY, MON)).toEqual(fixed(2024, 2, 6))
    expect(convertAnchor(fixed(2024, 2, 7), 'relative', TODAY, MON)).toEqual(offset(-999))
    expect(convertAnchor(fixed(2029, 7, 28), 'relative', TODAY, MON)).toEqual(offset(999))
    expect(convertAnchor(fixed(2029, 7, 29), 'relative', TODAY, MON)).toEqual(fixed(2029, 7, 29))
    expect(MAX_DAY_COUNT).toBe(999)
  })

  it('switching back restores the exact end while it is unchanged; edited, it converts again', () => {
    const there = switchAnchorMode(token('end-of-week'), 'relative', 'calendar', undefined, TODAY, MON)
    expect(there.anchor).toEqual(fixed(2026, 11, 8))
    const back = switchAnchorMode(there.anchor, 'calendar', 'relative', there.memo, TODAY, MON)
    // Not `6 days ahead`: the rolling day it was.
    expect(back.anchor).toEqual(token('end-of-week'))
    // And again: the date, restored.
    expect(switchAnchorMode(back.anchor, 'relative', 'calendar', back.memo, TODAY, MON).anchor).toEqual(fixed(2026, 11, 8))
    // Edited after the switch: converted from the new value.
    const edited = switchAnchorMode(fixed(2026, 11, 9), 'calendar', 'relative', there.memo, TODAY, MON)
    expect(edited.anchor).toEqual(offset(7))
  })

  it('a date switched to Relative and back is the same date, and a count to Calendar and back the same count', () => {
    const d = fixed(2026, 10, 1)
    const rel = switchAnchorMode(d, 'calendar', 'relative', undefined, TODAY, MON)
    expect(rel.anchor).toEqual(offset(-32))
    expect(switchAnchorMode(rel.anchor, 'relative', 'calendar', rel.memo, TODAY, MON).anchor).toEqual(d)
    const cal = switchAnchorMode(offset(0), 'relative', 'calendar', undefined, TODAY, MON)
    expect(cal.anchor).toEqual(fixed(2026, 11, 2))
    // Restored as the offset 0 it was, not the today token a fresh conversion makes.
    expect(switchAnchorMode(cal.anchor, 'calendar', 'relative', cal.memo, TODAY, MON).anchor).toEqual(offset(0))
  })

  it('anchors compare by kind and value', () => {
    expect(dateAnchorsEqual(null, null)).toBe(true)
    expect(dateAnchorsEqual(offset(0), token('today'))).toBe(false)
    expect(dateAnchorsEqual(offset(-7), offset(-7))).toBe(true)
    expect(dateAnchorsEqual(fixed(2026, 10, 1), null)).toBe(false)
  })
})

describe('the presets', () => {
  it('Relative Fill in: three weeks / month back and forth, a month 30 days', () => {
    expect(DAY_PRESETS.map((p) => [p.label, p.days])).toEqual([
      ['1 week ago', -7], ['2 weeks ago', -14], ['1 month ago', -30], ['In 1 week', 7], ['In 2 weeks', 14], ['In 1 month', 30],
    ])
  })

  it('Relative rolling days: From starts, To ends', () => {
    expect(ROLLING_DAYS.from.map(rollingDayLabel)).toEqual(['today', 'start of week', 'start of month'])
    expect(ROLLING_DAYS.to.map(rollingDayLabel)).toEqual(['today', 'end of week', 'end of month'])
    expect(rollingDayLabel('end-of-month-plus-3')).toBe('end of (month + 3)')
  })

  it('Calendar Set to…: From the starts and past days, To the ends and future days, each a day today', () => {
    const resolved = (side: 'from' | 'to') => CALENDAR_PRESETS[side].map((g) => g.map((p) => [p.label, p.day(TODAY, MON).toDateString()]))
    expect(resolved('from')).toEqual([
      [['Today', 'Mon Nov 02 2026'], ['Start of this week', 'Mon Nov 02 2026'], ['Start of this month', 'Sun Nov 01 2026'], ['Start of last month', 'Thu Oct 01 2026']],
      [['1 week ago', 'Mon Oct 26 2026'], ['2 weeks ago', 'Mon Oct 19 2026'], ['1 month ago', 'Sat Oct 03 2026']],
    ])
    expect(resolved('to')).toEqual([
      [['Today', 'Mon Nov 02 2026'], ['End of this week', 'Sun Nov 08 2026'], ['End of this month', 'Mon Nov 30 2026'], ['End of next month', 'Thu Dec 31 2026']],
      [['In 1 week', 'Mon Nov 09 2026'], ['In 2 weeks', 'Mon Nov 16 2026'], ['In 1 month', 'Wed Dec 02 2026']],
    ])
    // Start of last month across a year.
    expect(CALENDAR_PRESETS.from[0]?.[3]?.day(new Date(2026, 0, 15), MON).toDateString()).toBe('Mon Dec 01 2025')
  })
})

describe('the day under a Relative end', () => {
  it('its day today; with the other end open, which way the range runs', () => {
    expect(resolvedEndWords('to', offset(-7), null, TODAY, MON)).toBe('10/26 and earlier')
    expect(resolvedEndWords('from', offset(-7), null, TODAY, MON)).toBe('10/26 and later')
    expect(resolvedEndWords('to', token('today'), offset(-7), TODAY, MON)).toBe('Mon 2 Nov')
    expect(resolvedEndWords('to', token('end-of-next-month'), offset(-7), TODAY, MON)).toBe('Thu 31 Dec')
    expect(resolvedEndWords('from', null, offset(-7), TODAY, MON)).toBeNull()
    // Another year names it.
    expect(resolvedEndWords('to', offset(90), offset(0), TODAY, MON)).toBe('Sun 31 Jan 2027')
  })
})
