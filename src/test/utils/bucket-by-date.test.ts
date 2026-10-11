import { describe, it, expect } from 'vitest'
import { dateBucketBoundaries, dateBucketKey } from '../../utils/bucket-by-date'
import { startOfDay } from '../../utils/date'

describe('dateBucketBoundaries', () => {
  it('honors weekStartsOn = 1 (Mon-first)', () => {
    // 2026-04-15 is a Wednesday. Mon-first week ends Sunday 4/19.
    const today = startOfDay(new Date('2026-04-15T00:00:00'))
    const ctx = dateBucketBoundaries(today, 1)
    const expected = startOfDay(new Date('2026-04-19T00:00:00')).getTime()
    expect(ctx.thisWeekEnd).toBe(expected)
  })

  it('honors weekStartsOn = 0 (Sun-first)', () => {
    // 2026-04-15 is a Wednesday. Sun-first week ends Saturday 4/18.
    const today = startOfDay(new Date('2026-04-15T00:00:00'))
    const ctx = dateBucketBoundaries(today, 0)
    const expected = startOfDay(new Date('2026-04-18T00:00:00')).getTime()
    expect(ctx.thisWeekEnd).toBe(expected)
  })
})

describe('dateBucketKey', () => {
  const today = startOfDay(new Date('2026-04-15T00:00:00')) // Wed

  it('keys overdue / today / week / later', () => {
    const key = (iso: string) => dateBucketKey(new Date(iso), today, 1)
    expect(key('2026-04-14T00:00:00')).toBe('overdue')
    expect(key('2026-04-15T00:00:00')).toBe('today')
    expect(key('2026-04-16T00:00:00')).toBe('week')
    expect(key('2026-04-19T00:00:00')).toBe('week') // Sunday, end of a Mon-first week
    expect(key('2026-04-20T00:00:00')).toBe('later')
  })

  it('overdue and today are never folded into a later bucket', () => {
    expect(dateBucketKey(new Date('2025-01-01T00:00:00'), today, 1)).toBe('overdue')
    expect(dateBucketKey(new Date('2026-04-15T23:30:00'), today, 1)).toBe('today')
  })

  it('a Sunday is this week when weeks start Monday, later when they start Sunday', () => {
    const sunday = new Date('2026-04-19T00:00:00')
    expect(dateBucketKey(sunday, today, 1)).toBe('week')
    expect(dateBucketKey(sunday, today, 0)).toBe('later')
  })

  it('no date → no key', () => {
    expect(dateBucketKey(null, today, 1)).toBeNull()
  })
})
