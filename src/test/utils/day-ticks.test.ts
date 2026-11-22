import { describe, expect, it } from 'vitest'
import { DAY_TICKS_MAX, dayTicks, entryDayMarks } from '../../utils/day-ticks'

describe('dayTicks', () => {
  it('draws the real dates as solid ticks, then the plans as hollow ones: at most eight, then how many more', () => {
    expect(DAY_TICKS_MAX).toBe(8)
    expect(dayTicks({ dates: ['due', 'followup'], plans: 2 })).toEqual({ dates: ['due', 'followup'], plans: 2, more: 0 })
    expect(dayTicks({ dates: [], plans: 0 })).toEqual({ dates: [], plans: 0, more: 0 })
    expect(dayTicks({ dates: [], plans: 11 })).toEqual({ dates: [], plans: 8, more: 3 })
    // The real dates first: the plans take what room is left.
    expect(dayTicks({ dates: ['due', 'due', 'due', 'followup', 'followup', 'followup'], plans: 5 }))
      .toEqual({ dates: ['due', 'due', 'due', 'followup', 'followup', 'followup'], plans: 2, more: 3 })
    const many = Array.from({ length: 10 }, () => 'due' as const)
    expect(dayTicks({ dates: many, plans: 1 })).toEqual({ dates: many.slice(0, 8), plans: 0, more: 3 })
  })
})

describe('entryDayMarks', () => {
  it('counts a calendar day’s entries: due dates first, then follow-ups, and the plans', () => {
    const entries = [{ kind: 'plan' }, { kind: 'followup' }, { kind: 'due' }, { kind: 'plan' }, { kind: 'due' }] as const
    expect(entryDayMarks(entries)).toEqual({ dates: ['due', 'due', 'followup'], plans: 2 })
    expect(entryDayMarks([])).toEqual({ dates: [], plans: 0 })
  })
})
