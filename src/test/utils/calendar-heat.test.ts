import { describe, it, expect } from 'vitest'
import {
  dayHeat,
  heatHue,
  heatLegendLabel,
  heatStep,
  heatSummary,
  latestLateDay,
  type HeatEntry,
} from '../../utils/calendar-heat'

const TODAY = new Date(2026, 9, 25) // Sun 25 Oct 2026
const PAST = new Date(2026, 9, 22)
const FUTURE = new Date(2026, 9, 28)

const entry = (kind: HeatEntry['kind'], over: { done?: boolean; virtual?: boolean } = {}): HeatEntry => ({
  kind,
  isVirtual: over.virtual ?? false,
  todo: { isCompleted: over.done ?? false },
})
const many = (n: number, kind: HeatEntry['kind'] = 'due') => Array.from({ length: n }, () => entry(kind))

describe('heatStep', () => {
  it('four fixed steps: 0 · 1–2 · 3–5 · 6+', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 40].map(heatStep)).toEqual([0, 1, 1, 2, 2, 2, 3, 3, 3])
  })
})

describe('heatHue', () => {
  it('the follow-up colour only when follow-ups alone are shown', () => {
    expect(heatHue({ due: true, followup: false })).toBe('due')
    expect(heatHue({ due: false, followup: true })).toBe('followup')
    expect(heatHue({ due: true, followup: true })).toBe('due')
    expect(heatHue({ due: false, followup: false })).toBe('due')
  })
})

describe('dayHeat', () => {
  it('counts every entry, by date type and open', () => {
    const heat = dayHeat([...many(4), entry('due', { done: true }), entry('followup')], FUTURE, TODAY)
    expect(heat).toEqual({ count: 6, step: 3, due: 5, followup: 1, open: 5, late: null })
  })

  it('an empty day is step 0', () => {
    expect(dayHeat([], PAST, TODAY)).toEqual({ count: 0, step: 0, due: 0, followup: 0, open: 0, late: null })
  })

  it('a past day with an open task’s own date is late: due before follow-up', () => {
    expect(dayHeat([entry('followup'), entry('due')], PAST, TODAY).late).toBe('due')
    expect(dayHeat([entry('followup'), entry('due', { done: true })], PAST, TODAY).late).toBe('followup')
  })

  it('a past day fully done, or holding only occurrences, is not late', () => {
    expect(dayHeat([entry('due', { done: true })], PAST, TODAY).late).toBeNull()
    expect(dayHeat([entry('due', { virtual: true })], PAST, TODAY).late).toBeNull()
  })

  it('today and later days are never late', () => {
    expect(dayHeat([entry('due')], new Date(2026, 9, 25, 18), TODAY).late).toBeNull()
    expect(dayHeat([entry('due')], FUTURE, TODAY).late).toBeNull()
  })
})

describe('heatSummary', () => {
  it('names the date types; open only when some are completed', () => {
    expect(heatSummary(dayHeat(many(6), FUTURE, TODAY))).toBe('6 due')
    expect(heatSummary(dayHeat([...many(5), entry('due', { done: true })], PAST, TODAY))).toBe('6 due · 5 open')
    expect(heatSummary(dayHeat(many(2, 'followup'), FUTURE, TODAY))).toBe('2 follow-ups')
    expect(heatSummary(dayHeat([...many(4), entry('followup')], FUTURE, TODAY))).toBe('4 due · 1 follow-up')
    expect(heatSummary(dayHeat([], FUTURE, TODAY))).toBe('')
  })
})

describe('heatLegendLabel', () => {
  it('says what the tint counts', () => {
    expect(heatLegendLabel({ due: true, followup: false })).toBe('Tasks due')
    expect(heatLegendLabel({ due: false, followup: true })).toBe('Follow-ups')
    expect(heatLegendLabel({ due: true, followup: true })).toBe('Due and follow-ups')
  })
})

describe('latestLateDay', () => {
  it('the month’s latest late day; days outside the month are skipped', () => {
    const days = [new Date(2026, 8, 30), new Date(2026, 9, 5), new Date(2026, 9, 20), new Date(2026, 9, 22), new Date(2026, 9, 28)]
    const byKey = new Map<number, HeatEntry[]>([
      [days[0]!.getTime(), [entry('due')]],
      [days[1]!.getTime(), [entry('followup')]],
      [days[2]!.getTime(), [entry('due')]],
      [days[3]!.getTime(), [entry('due', { done: true })]],
      [days[4]!.getTime(), [entry('due')]],
    ])
    const of = (d: Date) => byKey.get(d.getTime()) ?? []
    expect(latestLateDay(days, 9, of, TODAY)).toEqual({ day: days[2], late: 'due' })
    expect(latestLateDay(days, 8, of, TODAY)).toEqual({ day: days[0], late: 'due' })
    expect(latestLateDay(days.slice(3), 9, of, TODAY)).toBeNull()
  })
})
