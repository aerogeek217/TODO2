import { describe, expect, it } from 'vitest'
import {
  addInterval,
  describeInterval,
  formatInterval,
  intervalsEqual,
  parseInterval,
  unitOfWord,
  unitWord,
} from '../../utils/interval'
import { addFollowupInterval, parseFollowupInterval } from '../../utils/followup'

/** `YYYY-MM-DD`, local. */
const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const day = (y: number, m: number, d: number) => new Date(y, m - 1, d)

describe('parseInterval', () => {
  it.each([
    ['1d', 1, 'd'], ['2w', 2, 'w'], ['1m', 1, 'm'], ['1y', 1, 'y'], [' 3 M ', 3, 'm'], ['999d', 999, 'd'],
  ] as const)('reads %j', (text, count, unit) => {
    expect(parseInterval(text)).toEqual({ count, unit })
  })

  it.each(['', '0d', '1000d', '2x', 'w', '2', '1.5w', '-1d', '+2w', '2 weeks'])('refuses %j', (text) => {
    expect(parseInterval(text)).toBeNull()
  })

  it('is the follow-up intervals’ grammar (one parser)', () => {
    expect(parseFollowupInterval).toBe(parseInterval)
  })
})

describe('formatInterval, describeInterval, intervalsEqual, unitWord, unitOfWord', () => {
  it('write and say an interval', () => {
    expect(formatInterval({ count: 2, unit: 'w' })).toBe('2w')
    expect(describeInterval({ count: 2, unit: 'w' })).toBe('2 weeks')
    expect(describeInterval({ count: 1, unit: 'm' })).toBe('1 month')
    expect(unitWord('y', 1)).toBe('year')
    expect(unitWord('d', 3)).toBe('days')
  })

  it('compare by count and unit', () => {
    expect(intervalsEqual({ count: 2, unit: 'w' }, { count: 2, unit: 'w' })).toBe(true)
    expect(intervalsEqual({ count: 14, unit: 'd' }, { count: 2, unit: 'w' })).toBe(false)
    expect(intervalsEqual(null, undefined)).toBe(true)
    expect(intervalsEqual(null, { count: 1, unit: 'd' })).toBe(false)
  })

  it.each([['days', 'd'], ['wk', 'w'], ['weeks', 'w'], ['Month', 'm'], ['mo', 'm'], ['years', 'y'], ['yr', 'y']] as const)('the unit %s names is %s', (word, unit) => {
    expect(unitOfWord(word)).toBe(unit)
  })

  it('a word that names no unit', () => {
    expect(unitOfWord('mon')).toBeNull()
    expect(unitOfWord('fortnight')).toBeNull()
  })
})

describe('addInterval — calendar months, never 30 days', () => {
  it('days and weeks are calendar days', () => {
    expect(fmt(addInterval(day(2026, 11, 19), { count: 3, unit: 'd' }))).toBe('2026-11-22')
    expect(fmt(addInterval(day(2026, 11, 19), { count: 2, unit: 'w' }))).toBe('2026-12-03')
    expect(fmt(addInterval(day(2026, 3, 7), { count: 1, unit: 'w' }))).toBe('2026-03-14') // across a DST change
  })

  it('Jan 31 + 1m is Feb 28, Feb 29 in a leap year', () => {
    expect(fmt(addInterval(day(2026, 1, 31), { count: 1, unit: 'm' }))).toBe('2026-02-28')
    expect(fmt(addInterval(day(2028, 1, 31), { count: 1, unit: 'm' }))).toBe('2028-02-29')
    expect(fmt(addInterval(day(2026, 8, 31), { count: 1, unit: 'm' }))).toBe('2026-09-30')
  })

  it('Feb 29 + 1y is Feb 28; + 4y is Feb 29', () => {
    expect(fmt(addInterval(day(2028, 2, 29), { count: 1, unit: 'y' }))).toBe('2029-02-28')
    expect(fmt(addInterval(day(2028, 2, 29), { count: 4, unit: 'y' }))).toBe('2032-02-29')
  })

  it('a kept day of the month comes back once the month has it (no drift)', () => {
    expect(fmt(addInterval(day(2026, 2, 28), { count: 1, unit: 'm' }, 1, 31))).toBe('2026-03-31')
    expect(fmt(addInterval(day(2026, 2, 28), { count: 1, unit: 'm' }))).toBe('2026-03-28')
    expect(fmt(addInterval(day(2029, 2, 28), { count: 3, unit: 'y' }, 1, 29))).toBe('2032-02-29')
  })

  it('backwards for a negative times: -1m from Mar 31 is Feb 28', () => {
    expect(fmt(addInterval(day(2026, 3, 31), { count: 1, unit: 'm' }, -1))).toBe('2026-02-28')
    expect(fmt(addInterval(day(2026, 11, 19), { count: 2, unit: 'w' }, -1))).toBe('2026-11-05')
    expect(fmt(addInterval(day(2026, 1, 15), { count: 3, unit: 'm' }, -1))).toBe('2025-10-15')
  })

  it('always local midnight', () => {
    const d = addInterval(new Date(2026, 10, 19, 15, 30), { count: 1, unit: 'd' })
    expect([d.getHours(), d.getMinutes()]).toEqual([0, 0])
  })

  it('the follow-up intervals add the same way', () => {
    expect(fmt(addFollowupInterval(day(2026, 1, 31), { count: 1, unit: 'm' }))).toBe('2026-02-28')
  })
})
