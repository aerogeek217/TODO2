import { describe, it, expect } from 'vitest'
import {
  isDeadlinePast,
  daysUntil,
  pickTodoDate,
  compareTodosByDate,
  dateIntensity,
  resolveDateAnchor,
  resolveRelativeToken,
  dueTooltip,
} from '../../utils/effective-date'
import { makeTodo } from '../helpers'

function d(iso: string): Date {
  return new Date(iso + 'T12:00:00')
}

describe('isDeadlinePast', () => {
  const today = d('2026-04-20')

  it('returns true for deadline before today', () => {
    expect(isDeadlinePast({ dueDate: new Date(2026, 3, 19) }, today)).toBe(true)
  })

  it('returns false for deadline today', () => {
    expect(isDeadlinePast({ dueDate: new Date(2026, 3, 20) }, today)).toBe(false)
  })

  it('returns false for deadline in the future', () => {
    expect(isDeadlinePast({ dueDate: new Date(2026, 3, 21) }, today)).toBe(false)
  })

  it('returns false when no deadline', () => {
    expect(isDeadlinePast({}, today)).toBe(false)
  })
})

describe('daysUntil', () => {
  const today = d('2026-04-16')

  it('returns null for null/undefined input', () => {
    expect(daysUntil(null, today)).toBeNull()
    expect(daysUntil(undefined, today)).toBeNull()
  })

  it('returns 0 for same day', () => {
    expect(daysUntil(d('2026-04-16'), today)).toBe(0)
  })

  it('returns positive for future dates', () => {
    expect(daysUntil(d('2026-04-23'), today)).toBe(7)
  })

  it('returns negative for past dates', () => {
    expect(daysUntil(d('2026-04-13'), today)).toBe(-3)
  })
})

describe('dateIntensity', () => {
  it('returns 1 when null (no date = full color, treated as Someday-neutral caller responsibility)', () => {
    expect(dateIntensity(null)).toBe(1)
    expect(dateIntensity(undefined)).toBe(1)
  })

  it('returns 1 for today or past dates', () => {
    expect(dateIntensity(0)).toBe(1)
    expect(dateIntensity(-3)).toBe(1)
    expect(dateIntensity(-100)).toBe(1)
  })

  it('fades linearly over the 14-day window', () => {
    expect(dateIntensity(7)).toBeCloseTo(0.5, 3)
    expect(dateIntensity(3)).toBeCloseTo(1 - 3 / 14, 3)
  })

  it('floors at 0.15 for distant future dates', () => {
    expect(dateIntensity(14)).toBe(0.15)
    expect(dateIntensity(30)).toBe(0.15)
    expect(dateIntensity(365)).toBe(0.15)
  })
})

describe('resolveRelativeToken', () => {
  const wed = d('2026-04-15') // Wednesday

  it('yesterday, today and tomorrow', () => {
    expect(resolveRelativeToken('yesterday', wed, 1).getDate()).toBe(14)
    expect(resolveRelativeToken('today', wed, 1).getDate()).toBe(15)
    expect(resolveRelativeToken('tomorrow', wed, 1).getDate()).toBe(16)
  })

  it('start-of-week / end-of-week with Monday-first', () => {
    const start = resolveRelativeToken('start-of-week', wed, 1)
    expect(start.getDate()).toBe(13)      // Monday
    expect(start.getDay()).toBe(1)
    const end = resolveRelativeToken('end-of-week', wed, 1)
    expect(end.getDate()).toBe(19)        // Sunday
    expect(end.getDay()).toBe(0)
  })

  it('start-of-week / end-of-week with Sunday-first', () => {
    const start = resolveRelativeToken('start-of-week', wed, 0)
    expect(start.getDate()).toBe(12)      // Sunday
    expect(start.getDay()).toBe(0)
    const end = resolveRelativeToken('end-of-week', wed, 0)
    expect(end.getDate()).toBe(18)        // Saturday
    expect(end.getDay()).toBe(6)
  })

  it('start-of-next-week / end-of-next-week add 7 days to this-week boundaries', () => {
    expect(resolveRelativeToken('start-of-next-week', wed, 1).getDate()).toBe(20)
    expect(resolveRelativeToken('end-of-next-week', wed, 1).getDate()).toBe(26)
  })

  it('start-of-month / end-of-month use calendar month', () => {
    expect(resolveRelativeToken('start-of-month', wed, 1).getDate()).toBe(1)
    const end = resolveRelativeToken('end-of-month', wed, 1)
    expect(end.getMonth()).toBe(3)
    expect(end.getDate()).toBe(30)
  })

  it('start-of-next-month / end-of-next-month step one calendar month', () => {
    const sm = resolveRelativeToken('start-of-next-month', wed, 1)
    expect(sm.getMonth()).toBe(4)
    expect(sm.getDate()).toBe(1)
    const em = resolveRelativeToken('end-of-next-month', wed, 1)
    expect(em.getMonth()).toBe(4)
    expect(em.getDate()).toBe(31)
  })

  it('end-of-month-plus-3 covers current month + 3', () => {
    const end = resolveRelativeToken('end-of-month-plus-3', wed, 1)
    // Wednesday 2026-04-15 + 3 months = July; end of July is the 31st.
    expect(end.getMonth()).toBe(6)
    expect(end.getDate()).toBe(31)
  })

  it('month boundaries still work when today is the last day of the month', () => {
    const lastDay = d('2026-04-30')
    const end = resolveRelativeToken('end-of-month', lastDay, 1)
    expect(end.getMonth()).toBe(3)
    expect(end.getDate()).toBe(30)
    const sm = resolveRelativeToken('start-of-next-month', lastDay, 1)
    expect(sm.getMonth()).toBe(4)
    expect(sm.getDate()).toBe(1)
  })
})

describe('resolveDateAnchor', () => {
  const today = d('2026-04-15')

  it('resolves a fixed anchor to the ISO date', () => {
    const result = resolveDateAnchor({ kind: 'fixed', iso: '2026-05-01T12:00:00' }, today, 1)
    expect(result.getFullYear()).toBe(2026)
    expect(result.getMonth()).toBe(4)
    expect(result.getDate()).toBe(1)
  })

  it('resolves a relative anchor via resolveRelativeToken', () => {
    const result = resolveDateAnchor({ kind: 'relative', token: 'end-of-week' }, today, 1)
    expect(result.getDate()).toBe(19)
  })

  it('resolves an offset anchor to today + days', () => {
    const ahead = resolveDateAnchor({ kind: 'offset', days: 7 }, today, 1)
    expect(ahead.getDate()).toBe(22)
    expect(ahead.getMonth()).toBe(3)
    const behind = resolveDateAnchor({ kind: 'offset', days: -7 }, today, 1)
    expect(behind.getDate()).toBe(8)
    expect(behind.getMonth()).toBe(3)
    const same = resolveDateAnchor({ kind: 'offset', days: 0 }, today, 1)
    expect(same.getDate()).toBe(15)
    expect(same.getMonth()).toBe(3)
  })
})

describe('pickTodoDate / compareTodosByDate', () => {
  it('picks the due date or next follow-up at midnight, null when absent', () => {
    const t = makeTodo({ id: 1, dueDate: d('2026-04-10'), nextFollowupAt: d('2026-04-12') })
    expect(pickTodoDate(t, 'deadline')).toEqual(new Date(2026, 3, 10))
    expect(pickTodoDate(t, 'followup')).toEqual(new Date(2026, 3, 12))
    expect(pickTodoDate(makeTodo({ id: 2 }), 'deadline')).toBeNull()
  })

  it('sorts ascending with undated tasks last and sortOrder breaking ties', () => {
    const a = makeTodo({ id: 1, sortOrder: 2, dueDate: d('2026-04-10') })
    const b = makeTodo({ id: 2, sortOrder: 1, dueDate: d('2026-04-10') })
    const c = makeTodo({ id: 3, sortOrder: 0 })
    const e = makeTodo({ id: 4, sortOrder: 3, dueDate: d('2026-04-01') })
    const sorted = [a, b, c, e].sort(compareTodosByDate('deadline'))
    expect(sorted.map((t) => t.id)).toEqual([4, 2, 1, 3])
  })
})

describe('dueTooltip', () => {
  const today = new Date(2026, 9, 17)
  it('full date with weekday and year, the distance, and the repeat rule', () => {
    expect(dueTooltip({ dueDate: new Date(2026, 9, 20) }, today)).toBe('Tuesday, October 20, 2026\nIn 3 days')
    expect(dueTooltip({ dueDate: new Date(2026, 9, 17) }, today)).toBe('Saturday, October 17, 2026\nDue today')
    expect(dueTooltip({ dueDate: new Date(2026, 9, 18) }, today)).toBe('Sunday, October 18, 2026\nDue tomorrow')
    expect(dueTooltip({ dueDate: new Date(2026, 9, 16) }, today)).toBe('Friday, October 16, 2026\n1 day overdue')
    expect(dueTooltip({ dueDate: new Date(2027, 0, 4), recurrenceRule: { type: 'weekly' } }, today))
      .toBe('Monday, January 4, 2027\nIn 79 days\nRepeats every Monday')
    expect(dueTooltip({}, today)).toBe('')
  })
})
