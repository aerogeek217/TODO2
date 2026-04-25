import { describe, it, expect } from 'vitest'
import {
  HORIZON_GRAIN,
  HORIZON_KEYS,
  horizonBinRanges,
  horizonBins,
  horizonSomedayCount,
} from '../../services/horizons'
import { MS_PER_DAY, startOfDay } from '../../utils/date'
import { makeTodo } from '../helpers'

describe('HORIZON_KEYS + HORIZON_GRAIN', () => {
  it('has 5 keys in the canonical order', () => {
    expect(HORIZON_KEYS).toEqual(['thisweek', 'nextweek', 'thismonth', 'later', 'someday'])
  })

  it('assigns the expected grain per key', () => {
    expect(HORIZON_GRAIN.thisweek).toBe('day')
    expect(HORIZON_GRAIN.nextweek).toBe('day')
    expect(HORIZON_GRAIN.thismonth).toBe('week')
    expect(HORIZON_GRAIN.later).toBe('month')
    expect(HORIZON_GRAIN.someday).toBeNull()
  })
})

describe('horizonBinRanges', () => {
  // Wed 2026-04-15 12:00 — mid-week, mid-month.
  const today = startOfDay(new Date('2026-04-15T12:00:00'))

  it('thisweek returns 7 day bins starting at start-of-week (Mon)', () => {
    const ranges = horizonBinRanges('thisweek', today, 1)
    expect(ranges).toHaveLength(7)
    // Monday of that week = 2026-04-13
    expect(ranges[0]!.start.toDateString()).toBe(new Date(2026, 3, 13).toDateString())
    // Last bin = Sunday 2026-04-19
    expect(ranges[6]!.start.toDateString()).toBe(new Date(2026, 3, 19).toDateString())
    // isToday marked on Wed cell only.
    expect(ranges.filter((r) => r.isToday)).toHaveLength(1)
    expect(ranges[2]!.isToday).toBe(true)
  })

  it('thisweek honors Sunday-first week start', () => {
    const ranges = horizonBinRanges('thisweek', today, 0)
    // Sunday of that week = 2026-04-12
    expect(ranges[0]!.start.toDateString()).toBe(new Date(2026, 3, 12).toDateString())
    expect(ranges[6]!.start.toDateString()).toBe(new Date(2026, 3, 18).toDateString())
  })

  it('nextweek returns 7 bins one week ahead of thisweek', () => {
    const thisweek = horizonBinRanges('thisweek', today, 1)
    const nextweek = horizonBinRanges('nextweek', today, 1)
    expect(nextweek[0]!.start.getTime()).toBe(thisweek[6]!.start.getTime() + MS_PER_DAY)
  })

  it('thismonth weekly bins cover up to end of month, may be <5 bins', () => {
    const ranges = horizonBinRanges('thismonth', today, 1)
    expect(ranges.length).toBeGreaterThanOrEqual(2)
    expect(ranges.length).toBeLessThanOrEqual(6)
    // Last bin must not extend past end-of-month (exclusive).
    const firstOfNextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 1).getTime()
    expect(ranges[ranges.length - 1]!.end.getTime()).toBeLessThanOrEqual(firstOfNextMonth)
  })

  it('later returns exactly 3 monthly bins starting next month', () => {
    const ranges = horizonBinRanges('later', today, 1)
    expect(ranges).toHaveLength(3)
    expect(ranges[0]!.start.getMonth()).toBe(4) // May
    expect(ranges[1]!.start.getMonth()).toBe(5) // Jun
    expect(ranges[2]!.start.getMonth()).toBe(6) // Jul
  })

  it('someday returns zero ranges (grain null)', () => {
    expect(horizonBinRanges('someday', today, 1)).toEqual([])
  })
})

describe('horizonBinRanges — boundary cases', () => {
  it('thismonth on last day of month still produces at least one bin that contains today', () => {
    const lastOfApr = startOfDay(new Date(2026, 3, 30))
    const ranges = horizonBinRanges('thismonth', lastOfApr, 1)
    expect(ranges.length).toBeGreaterThanOrEqual(1)
    expect(ranges.some((r) => r.isToday)).toBe(true)
  })
})

describe('horizonBins', () => {
  const today = startOfDay(new Date('2026-04-15T12:00:00'))

  it('bins tasks by their effective date (precise scheduled)', () => {
    const t1 = makeTodo({ id: 1, scheduledDate: { kind: 'date', value: today } })
    const t2 = makeTodo({ id: 2, scheduledDate: { kind: 'date', value: new Date(today.getTime() + 2 * MS_PER_DAY) } })
    const bins = horizonBins('thisweek', [t1, t2], today, 1)
    expect(bins.reduce((s, b) => s + b.load, 0)).toBe(2)
  })

  it('flags overdue tasks (effective < today)', () => {
    const yesterday = new Date(today.getTime() - MS_PER_DAY)
    const t = makeTodo({ id: 1, scheduledDate: { kind: 'date', value: yesterday } })
    const bins = horizonBins('thisweek', [t], today, 1)
    const totalOverdue = bins.reduce((s, b) => s + b.overdue, 0)
    expect(totalOverdue).toBe(1)
  })

  it('counts tasks with deadlines toward hasDeadline', () => {
    const t = makeTodo({
      id: 1,
      scheduledDate: { kind: 'date', value: today },
      dueDate: new Date(today.getTime() + MS_PER_DAY),
    })
    const bins = horizonBins('thisweek', [t], today, 1)
    const total = bins.reduce((s, b) => s + b.hasDeadline, 0)
    expect(total).toBe(1)
  })

  it('ignores tasks outside the horizon range', () => {
    // Task 30 days out — falls in "later", not "thisweek".
    const t = makeTodo({ id: 1, scheduledDate: { kind: 'date', value: new Date(today.getTime() + 30 * MS_PER_DAY) } })
    const bins = horizonBins('thisweek', [t], today, 1)
    expect(bins.reduce((s, b) => s + b.load, 0)).toBe(0)
  })

  it('someday returns empty (caller uses horizonSomedayCount instead)', () => {
    const t = makeTodo({ id: 1 })
    expect(horizonBins('someday', [t], today, 1)).toEqual([])
  })

  it('later horizon buckets tasks into the correct month', () => {
    const may = makeTodo({ id: 1, scheduledDate: { kind: 'date', value: new Date(2026, 4, 10) } })
    const jun = makeTodo({ id: 2, scheduledDate: { kind: 'date', value: new Date(2026, 5, 15) } })
    const bins = horizonBins('later', [may, jun], today, 1)
    expect(bins[0]!.load).toBe(1) // May
    expect(bins[1]!.load).toBe(1) // Jun
    expect(bins[2]!.load).toBe(0) // Jul
  })
})

describe('horizonSomedayCount', () => {
  it('returns only tasks with neither scheduledDate nor dueDate', () => {
    const someday = makeTodo({ id: 1 })
    const scheduled = makeTodo({ id: 2, scheduledDate: { kind: 'fuzzy', token: 'next-month' } })
    const deadline = makeTodo({ id: 3, dueDate: new Date() })
    expect(horizonSomedayCount([someday, scheduled, deadline])).toBe(1)
  })

  it('returns 0 for empty input', () => {
    expect(horizonSomedayCount([])).toBe(0)
  })
})
