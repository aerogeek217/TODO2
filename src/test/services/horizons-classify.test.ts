import { describe, it, expect } from 'vitest'
import { classifyByDateSource } from '../../services/horizons'
import { startOfDay } from '../../utils/date'
import { makeTodo } from '../helpers'

describe('classifyByDateSource', () => {
  const today = startOfDay(new Date(2026, 3, 15))

  it("reports 'scheduled' when scheduledDate is set (precise)", () => {
    const t = makeTodo({ id: 1, scheduledDate: { kind: 'date', value: new Date(2026, 3, 16) } })
    expect(classifyByDateSource(t, today, 1)).toBe('scheduled')
  })

  it("reports 'scheduled' when scheduledDate is fuzzy", () => {
    const t = makeTodo({ id: 1, scheduledDate: { kind: 'fuzzy', token: 'this-week', setAt: today } })
    expect(classifyByDateSource(t, today, 1)).toBe('scheduled')
  })

  it("reports 'scheduled' when scheduledDate is in the past (mirrors effectiveDate priority)", () => {
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

  it("reports 'scheduled' as the no-date fallback (someday-style rows)", () => {
    const t = makeTodo({ id: 1 })
    expect(classifyByDateSource(t, today, 1)).toBe('scheduled')
  })

  it('weekStartsOn does not affect classification (date source priority is calendar-agnostic)', () => {
    const t = makeTodo({ id: 1, dueDate: new Date(2026, 3, 16) })
    expect(classifyByDateSource(t, today, 0)).toBe('due')
    expect(classifyByDateSource(t, today, 1)).toBe('due')
  })
})
