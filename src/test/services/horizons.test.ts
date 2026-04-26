import { describe, it, expect } from 'vitest'
import { startOfWeek } from '../../services/horizons'
import { startOfDay } from '../../utils/date'

describe('startOfWeek', () => {
  it('returns Monday-of-week when weekStartsOn=1', () => {
    // Wed 2026-04-15.
    const today = startOfDay(new Date(2026, 3, 15))
    const monday = startOfWeek(today, 1)
    expect(monday.toDateString()).toBe(new Date(2026, 3, 13).toDateString())
  })

  it('returns Sunday-of-week when weekStartsOn=0', () => {
    const today = startOfDay(new Date(2026, 3, 15))
    const sunday = startOfWeek(today, 0)
    expect(sunday.toDateString()).toBe(new Date(2026, 3, 12).toDateString())
  })
})

// `classifyByDateSource` is covered in `horizons-classify.test.ts`.
