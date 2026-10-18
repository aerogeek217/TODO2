// Day stepping must be calendar-based: on a DST day (23 or 25 hours) adding
// 24 h lands on the wrong date. Runs in a DST zone (US Eastern, 2026: clocks
// go forward Sun 8 Mar, back Sun 1 Nov).
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { addDays } from '../../utils/date'
import { parseDatePhrase } from '../../utils/date-phrase'
import { resolveDateAnchor, startOfWeek } from '../../utils/effective-date'
import { dateBucketKey } from '../../utils/bucket-by-date'

// Node re-reads TZ when it is assigned, but deleting it keeps the last zone,
// so put back the zone this worker had by name (shared vitest workers).
const originalZone = Intl.DateTimeFormat().resolvedOptions().timeZone

beforeAll(() => {
  process.env.TZ = 'America/New_York'
})

afterAll(() => {
  process.env.TZ = originalZone
})

const ymd = (d: Date) => [d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours()]

describe('day math across DST', () => {
  it('addDays steps calendar days over both transitions', () => {
    expect(ymd(addDays(new Date(2026, 10, 1), 1))).toEqual([2026, 11, 2, 0])
    expect(ymd(addDays(new Date(2026, 2, 9), -1))).toEqual([2026, 3, 8, 0])
  })

  it('"tomorrow" on the 25-hour day is the next day', () => {
    expect(ymd(parseDatePhrase('tomorrow', new Date(2026, 10, 1, 10))!)).toEqual([2026, 11, 2, 0])
  })

  it('"yesterday" after the 23-hour day is that day', () => {
    expect(ymd(parseDatePhrase('yesterday', new Date(2026, 2, 9, 10))!)).toEqual([2026, 3, 8, 0])
  })

  it('startOfWeek is midnight of the first day when the week holds a DST day', () => {
    expect(ymd(startOfWeek(new Date(2026, 2, 10, 15), 0))).toEqual([2026, 3, 8, 0])
    expect(ymd(startOfWeek(new Date(2026, 10, 4, 15), 0))).toEqual([2026, 11, 1, 0])
  })

  it('an offset anchor of +1 day on the 25-hour day is the next day', () => {
    expect(ymd(resolveDateAnchor({ kind: 'offset', days: 1 }, new Date(2026, 10, 1, 9), 1))).toEqual([2026, 11, 2, 0])
  })

  it('a task due tomorrow is not bucketed as today on the 23-hour day', () => {
    const today = new Date(2026, 2, 8, 9) // Sunday, last day of a Monday-first week
    expect(dateBucketKey(new Date(2026, 2, 9), today, 1)).toBe('later')
    expect(dateBucketKey(new Date(2026, 2, 8), today, 1)).toBe('today')
  })

  it('the last day of a Sunday-first week holding the 23-hour day is still this week', () => {
    const today = new Date(2026, 2, 9, 9) // Monday; week Sun 8 – Sat 14 Mar
    expect(dateBucketKey(new Date(2026, 2, 14), today, 0)).toBe('week')
    expect(dateBucketKey(new Date(2026, 2, 15), today, 0)).toBe('later')
  })
})
