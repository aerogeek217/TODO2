import { describe, it, expect } from 'vitest'
import { classifyByDateSource, startOfWeek } from '../../services/horizons'
import { startOfDay } from '../../utils/date'
import { makeTodo } from '../helpers'

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

describe('classifyByDateSource', () => {
  const today = startOfDay(new Date(2026, 3, 15))

  it("reports 'scheduled' when scheduledDate is set (precise)", () => {
    const t = makeTodo({ id: 1, scheduledDate: { kind: 'date', value: new Date(2026, 3, 16) } })
    expect(classifyByDateSource(t, today, 1)).toBe('scheduled')
  })

  it("reports 'scheduled' when scheduledDate is fuzzy", () => {
    const t = makeTodo({ id: 1, scheduledDate: { kind: 'fuzzy', token: 'this-week' } })
    expect(classifyByDateSource(t, today, 1)).toBe('scheduled')
  })

  it("reports 'scheduled' even when scheduledDate is in the past (mirrors effectiveDate priority)", () => {
    const t = makeTodo({
      id: 1,
      scheduledDate: { kind: 'date', value: new Date(2026, 3, 1) },
      dueDate: new Date(2026, 3, 20),
    })
    expect(classifyByDateSource(t, today, 1)).toBe('scheduled')
  })

  it("reports 'due' when only dueDate is set", () => {
    const t = makeTodo({ id: 1, dueDate: new Date(2026, 3, 16) })
    expect(classifyByDateSource(t, today, 1)).toBe('due')
  })

  it("reports 'scheduled' as the no-date fallback (someday rows)", () => {
    const t = makeTodo({ id: 1 })
    expect(classifyByDateSource(t, today, 1)).toBe('scheduled')
  })
})
