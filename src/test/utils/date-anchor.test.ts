import { describe, expect, it } from 'vitest'
import type { DateAnchor } from '../../models'
import {
  CALENDAR_PRESETS,
  ROLLING_DAYS,
  convertAnchor,
  dateAnchorsEqual,
  entryModeOf,
  fitsCalendar,
  fixedAnchorOn,
  parseRelativeEnd,
  readDateAnchor,
  relativeEndText,
  resolvedEndWords,
  rollingDayLabel,
  switchAnchorMode,
} from '../../utils/date-anchor'
import { resolveDateAnchor } from '../../utils/effective-date'

/**
 * The date entry model behind the panel's Calendar / Relative ends (cr25 P8,
 * D23 board B; typed intervals, board R1): stored anchors ⇄ a Relative end's
 * typed text (`+2w`, `-1m`, `today`, a rolling day, a saved mix's date, no
 * end), the offset's unit resolved with calendar months, the mode a range opens in, switching
 * modes (convert, then restore while unchanged), the presets of both modes
 * and the day under a Relative end. Nothing here changes a stored shape.
 */

const TODAY = new Date(2026, 10, 2) // Mon 2 Nov 2026
const MON = 1 as const
const fixed = (y: number, m: number, d: number): DateAnchor => ({ kind: 'fixed', iso: new Date(y, m - 1, d).toISOString() })
const offset = (days: number, unit?: 'w' | 'm' | 'y'): DateAnchor => (unit ? { kind: 'offset', days, unit } : { kind: 'offset', days })
const token = (t: 'today' | 'end-of-week' | 'start-of-week' | 'end-of-next-month' | 'yesterday'): DateAnchor => ({ kind: 'relative', token: t })

describe('a Relative end ⇄ the stored anchor', () => {
  it('shows an offset signed and compact in its unit; tokens by their words; a date as M/D/YYYY; null as empty', () => {
    expect(relativeEndText(offset(-7))).toBe('-7d')
    expect(relativeEndText(offset(14))).toBe('+14d')
    expect(relativeEndText(offset(2, 'w'))).toBe('+2w')
    expect(relativeEndText(offset(-1, 'm'))).toBe('-1m')
    expect(relativeEndText(offset(1, 'y'))).toBe('+1y')
    expect(relativeEndText(offset(0))).toBe('today')
    expect(relativeEndText(token('end-of-week'))).toBe('end of week')
    expect(relativeEndText(fixed(2026, 10, 1))).toBe('10/1/2026')
    expect(relativeEndText(null)).toBe('')
  })

  it('reads typed text: signed intervals, 0 and today, rolling days, a date; empty is no end', () => {
    expect(parseRelativeEnd('+2w')).toEqual(offset(2, 'w'))
    expect(parseRelativeEnd('-1m')).toEqual(offset(-1, 'm'))
    expect(parseRelativeEnd(' +3D ')).toEqual(offset(3))
    expect(parseRelativeEnd('-1y')).toEqual(offset(-1, 'y'))
    expect(parseRelativeEnd('+3660d')).toEqual(offset(3660))
    expect(parseRelativeEnd('0')).toEqual(token('today'))
    expect(parseRelativeEnd('+0w')).toEqual(token('today'))
    expect(parseRelativeEnd('Today')).toEqual(token('today'))
    expect(parseRelativeEnd('end  of week')).toEqual(token('end-of-week'))
    expect(parseRelativeEnd('yesterday')).toEqual(token('yesterday'))
    expect(parseRelativeEnd('10/1/2026')).toEqual(fixed(2026, 10, 1))
    expect(parseRelativeEnd('')).toBeNull()
  })

  it.each(['2w', '+2', '+2x', '2 weeks', '+1000w', '+3661d', '2/30/2026', 'soon'])('refuses %j', (text) => {
    expect(parseRelativeEnd(text)).toBe('invalid')
  })

  it('round-trips what it shows', () => {
    for (const a of [offset(-7), offset(2, 'w'), offset(-3, 'm'), offset(1, 'y'), token('end-of-week'), fixed(2026, 10, 1)]) {
      expect(parseRelativeEnd(relativeEndText(a))).toEqual(a)
    }
  })

  it('a stored offset reads its unit; an unknown unit is malformed; a day unit is days', () => {
    expect(readDateAnchor({ kind: 'offset', days: 2, unit: 'w' })).toEqual(offset(2, 'w'))
    expect(readDateAnchor({ kind: 'offset', days: -7 })).toEqual(offset(-7))
    expect(readDateAnchor({ kind: 'offset', days: 3, unit: 'd' })).toEqual(offset(3))
    expect(readDateAnchor({ kind: 'offset', days: 2, unit: 'h' })).toBeNull()
  })

  it('an offset with a unit resolves in calendar weeks, months and years', () => {
    const day = (a: DateAnchor) => resolveDateAnchor(a, new Date(2026, 2, 31), MON).toDateString()
    expect(day(offset(-1, 'm'))).toBe('Sat Feb 28 2026')
    expect(day(offset(2, 'w'))).toBe('Tue Apr 14 2026')
    expect(day(offset(1, 'y'))).toBe('Wed Mar 31 2027')
    expect(day(offset(-30))).toBe('Sun Mar 01 2026')
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

  it('to Relative: a date more than 999 days away stays a date — P7–P8 review', () => {
    // Jan 1 2023 is 1401 days back; Feb 7 2024 is 999 back, Jul 28 2029 999 ahead.
    expect(convertAnchor(fixed(2023, 1, 1), 'relative', TODAY, MON)).toEqual(fixed(2023, 1, 1))
    expect(convertAnchor(fixed(2024, 2, 6), 'relative', TODAY, MON)).toEqual(fixed(2024, 2, 6))
    expect(convertAnchor(fixed(2024, 2, 7), 'relative', TODAY, MON)).toEqual(offset(-999))
    expect(convertAnchor(fixed(2029, 7, 28), 'relative', TODAY, MON)).toEqual(offset(999))
    expect(convertAnchor(fixed(2029, 7, 29), 'relative', TODAY, MON)).toEqual(fixed(2029, 7, 29))
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
    expect(dateAnchorsEqual(offset(2, 'w'), offset(2, 'w'))).toBe(true)
    expect(dateAnchorsEqual(offset(2, 'w'), offset(2))).toBe(false)
    expect(dateAnchorsEqual(offset(14), offset(2, 'w'))).toBe(false)
  })
})

describe('the presets', () => {
  it('Relative rolling days: From starts, To ends', () => {
    expect(ROLLING_DAYS.from.map(rollingDayLabel)).toEqual(['today', 'start of week', 'start of month'])
    expect(ROLLING_DAYS.to.map(rollingDayLabel)).toEqual(['today', 'end of week', 'end of month'])
    expect(rollingDayLabel('end-of-month-plus-3')).toBe('end of (month + 3)')
  })

  it('Calendar Set to…: From the starts, To the ends, each a day today (day counts are typed in Relative)', () => {
    const resolved = (side: 'from' | 'to') => CALENDAR_PRESETS[side].map((g) => g.map((p) => [p.label, p.day(TODAY, MON).toDateString()]))
    expect(resolved('from')).toEqual([
      [['Today', 'Mon Nov 02 2026'], ['Start of this week', 'Mon Nov 02 2026'], ['Start of this month', 'Sun Nov 01 2026'], ['Start of last month', 'Thu Oct 01 2026']],
    ])
    expect(resolved('to')).toEqual([
      [['Today', 'Mon Nov 02 2026'], ['End of this week', 'Sun Nov 08 2026'], ['End of this month', 'Mon Nov 30 2026'], ['End of next month', 'Thu Dec 31 2026']],
    ])
    // Start of last month across a year.
    expect(CALENDAR_PRESETS.from[0]?.[3]?.day(new Date(2026, 0, 15), MON).toDateString()).toBe('Mon Dec 01 2025')
  })
})

describe('the day under a Relative end', () => {
  it('its day today; with the other end open, which way the range runs', () => {
    expect(resolvedEndWords('to', offset(-7), null, TODAY, MON)).toBe('Mon, Oct 26 and earlier')
    expect(resolvedEndWords('from', offset(-7), null, TODAY, MON)).toBe('Mon, Oct 26 and later')
    expect(resolvedEndWords('to', token('today'), offset(-7), TODAY, MON)).toBe('Mon, Nov 2')
    expect(resolvedEndWords('to', token('end-of-next-month'), offset(-7), TODAY, MON)).toBe('Thu, Dec 31')
    expect(resolvedEndWords('to', offset(1, 'm'), offset(-7), TODAY, MON)).toBe('Wed, Dec 2')
    expect(resolvedEndWords('from', null, offset(-7), TODAY, MON)).toBeNull()
    // Another year names it.
    expect(resolvedEndWords('to', offset(90), offset(0), TODAY, MON)).toBe('Sun, Jan 31, 2027')
  })
})
