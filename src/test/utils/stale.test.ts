import { describe, it, expect } from 'vitest'
import {
  DEFAULT_STALE_AFTER_DAYS,
  daysSinceModified,
  isStale,
  isStaleAfterDays,
  parseStaleAfterDays,
  staleTooltipLine,
} from '../../utils/stale'

// Sat 10 Oct 2026.
const today = new Date(2026, 9, 10)
const at = (month: number, day: number, hour = 9) => new Date(2026, month, day, hour)

describe('the stale threshold setting', () => {
  it('defaults to 30 days; takes whole numbers 0–365 (0 = off)', () => {
    expect(DEFAULT_STALE_AFTER_DAYS).toBe(30)
    expect([0, 1, 30, 365].every(isStaleAfterDays)).toBe(true)
    expect([-1, 366, 2.5, Number.NaN, '30', null].some(isStaleAfterDays)).toBe(false)
  })

  it('parses the stored text strictly', () => {
    expect(parseStaleAfterDays('0')).toBe(0)
    expect(parseStaleAfterDays('30')).toBe(30)
    expect(parseStaleAfterDays('365')).toBe(365)
    for (const bad of ['366', '-1', '07', '7.5', '', 'off', ' 30']) expect(parseStaleAfterDays(bad), bad).toBeUndefined()
  })
})

describe('isStale', () => {
  it('an open task last changed the threshold or more days ago, by local day', () => {
    expect(isStale({ isCompleted: false, modifiedAt: at(8, 10, 23) }, today, 30)).toBe(true)
    expect(isStale({ isCompleted: false, modifiedAt: at(8, 11, 0) }, today, 30)).toBe(false)
    expect(isStale({ isCompleted: false, modifiedAt: at(0, 1) }, today, 365)).toBe(false)
    expect(isStale({ isCompleted: false, modifiedAt: at(9, 9) }, today, 1)).toBe(true)
    expect(isStale({ isCompleted: false, modifiedAt: at(9, 10, 1) }, today, 1)).toBe(false)
  })

  it('never with the threshold off, for a completed task, or for an unreadable stamp', () => {
    expect(isStale({ isCompleted: false, modifiedAt: at(0, 1) }, today, 0)).toBe(false)
    expect(isStale({ isCompleted: true, modifiedAt: at(0, 1) }, today, 30)).toBe(false)
    expect(isStale({ isCompleted: false, modifiedAt: new Date('nope') }, today, 30)).toBe(false)
  })
})

describe('daysSinceModified / staleTooltipLine', () => {
  it('counts whole local days; the line names the count and the date', () => {
    expect(daysSinceModified({ modifiedAt: at(8, 4, 18) }, today)).toBe(36)
    expect(daysSinceModified({ modifiedAt: at(9, 9, 23) }, today)).toBe(1)
    expect(daysSinceModified({ modifiedAt: new Date('nope') }, today)).toBeNull()
    expect(staleTooltipLine({ modifiedAt: at(8, 4, 18) }, today)).toBe('Last edited 36 days ago · Sep 4, 2026')
    expect(staleTooltipLine({ modifiedAt: at(9, 9) }, today)).toBe('Last edited 1 day ago · Oct 9, 2026')
  })
})
