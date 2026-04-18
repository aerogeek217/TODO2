import { describe, it, expect, afterEach } from 'vitest'
import {
  resolveFuzzy,
  resolveScheduled,
  effectiveDate,
  isScheduledExpired,
  isScheduledPast,
  isDeadlinePast,
  scheduledLabel,
  daysUntil,
  dateIntensity,
  setConfiguredWeekStart,
} from '../../utils/effective-date'
import { startOfDay, MS_PER_DAY } from '../../utils/date'

function d(iso: string): Date {
  return new Date(iso + 'T12:00:00')
}

describe('resolveFuzzy', () => {
  it('resolves today to today at midnight', () => {
    const today = d('2026-04-16')
    const result = resolveFuzzy('today', today)
    expect(result.getTime()).toBe(startOfDay(today).getTime())
  })

  it('resolves tomorrow to today + 1 day', () => {
    const today = d('2026-04-16')
    const result = resolveFuzzy('tomorrow', today)
    const expected = startOfDay(new Date(startOfDay(today).getTime() + MS_PER_DAY))
    expect(result.getTime()).toBe(expected.getTime())
  })

  it('resolves this-week on Thursday to Sunday of the same week', () => {
    const thursday = d('2026-04-16')
    const result = resolveFuzzy('this-week', thursday)
    expect(result.getFullYear()).toBe(2026)
    expect(result.getMonth()).toBe(3)
    expect(result.getDate()).toBe(19)
    expect(result.getDay()).toBe(0)
  })

  it('resolves this-week on Sunday to the same Sunday', () => {
    const sunday = d('2026-04-19')
    const result = resolveFuzzy('this-week', sunday)
    expect(result.getDate()).toBe(19)
    expect(result.getDay()).toBe(0)
  })

  it('resolves this-week on Monday to upcoming Sunday', () => {
    const monday = d('2026-04-13')
    const result = resolveFuzzy('this-week', monday)
    expect(result.getDate()).toBe(19)
  })

  it('resolves next-week to Sunday of the week after the upcoming Sunday', () => {
    const thursday = d('2026-04-16')
    const result = resolveFuzzy('next-week', thursday)
    expect(result.getDate()).toBe(26)
    expect(result.getDay()).toBe(0)
  })

  it('resolves this-month to the last day of the current month', () => {
    const result = resolveFuzzy('this-month', d('2026-04-16'))
    expect(result.getMonth()).toBe(3)
    expect(result.getDate()).toBe(30)
  })

  it('resolves this-month on the last day to the same day', () => {
    const result = resolveFuzzy('this-month', d('2026-04-30'))
    expect(result.getMonth()).toBe(3)
    expect(result.getDate()).toBe(30)
  })

  it('resolves this-month on leap-year Feb 15 to Feb 29', () => {
    const result = resolveFuzzy('this-month', d('2028-02-15'))
    expect(result.getFullYear()).toBe(2028)
    expect(result.getMonth()).toBe(1)
    expect(result.getDate()).toBe(29)
  })

  it('resolves this-month on non-leap Feb 15 to Feb 28', () => {
    const result = resolveFuzzy('this-month', d('2027-02-15'))
    expect(result.getMonth()).toBe(1)
    expect(result.getDate()).toBe(28)
  })

  it('resolves next-month on Jan 31 to Feb 28 (non-leap)', () => {
    const result = resolveFuzzy('next-month', d('2026-01-31'))
    expect(result.getMonth()).toBe(1)
    expect(result.getDate()).toBe(28)
  })

  it('resolves next-month on Dec 15 to Jan 31 of the following year', () => {
    const result = resolveFuzzy('next-month', d('2026-12-15'))
    expect(result.getFullYear()).toBe(2027)
    expect(result.getMonth()).toBe(0)
    expect(result.getDate()).toBe(31)
  })

  describe('week-start configurable', () => {
    afterEach(() => setConfiguredWeekStart(1))

    it('with weekStartsOn=0 (Sunday-first), this-week on Thursday ends Saturday', () => {
      const thursday = d('2026-04-16')
      const result = resolveFuzzy('this-week', thursday, 0)
      expect(result.getDay()).toBe(6)
      expect(result.getDate()).toBe(18)
    })

    it('with weekStartsOn=0, this-week on Saturday ends same Saturday', () => {
      const saturday = d('2026-04-18')
      const result = resolveFuzzy('this-week', saturday, 0)
      expect(result.getDay()).toBe(6)
      expect(result.getDate()).toBe(18)
    })

    it('with weekStartsOn=0, this-week on Sunday goes to next Saturday', () => {
      const sunday = d('2026-04-19')
      const result = resolveFuzzy('this-week', sunday, 0)
      expect(result.getDay()).toBe(6)
      expect(result.getDate()).toBe(25)
    })

    it('with weekStartsOn=0, next-week on Thursday ends Saturday of next week', () => {
      const thursday = d('2026-04-16')
      const result = resolveFuzzy('next-week', thursday, 0)
      expect(result.getDay()).toBe(6)
      expect(result.getDate()).toBe(25)
    })

    it('setConfiguredWeekStart changes the default used when parameter omitted', () => {
      setConfiguredWeekStart(0)
      const thursday = d('2026-04-16')
      expect(resolveFuzzy('this-week', thursday).getDay()).toBe(6)
      setConfiguredWeekStart(1)
      expect(resolveFuzzy('this-week', thursday).getDay()).toBe(0)
    })

    it('explicit parameter overrides configured default', () => {
      setConfiguredWeekStart(0)
      const thursday = d('2026-04-16')
      expect(resolveFuzzy('this-week', thursday, 1).getDay()).toBe(0)
    })
  })
})

describe('resolveScheduled', () => {
  const today = d('2026-04-16')

  it('returns null for undefined input', () => {
    expect(resolveScheduled(undefined, today)).toBeNull()
  })

  it('resolves a precise date to its start-of-day', () => {
    const value = new Date(2026, 3, 20, 10, 30)
    const result = resolveScheduled({ kind: 'date', value }, today)
    expect(result).not.toBeNull()
    expect(result!.getHours()).toBe(0)
    expect(result!.getDate()).toBe(20)
  })

  it('resolves a fuzzy token via resolveFuzzy', () => {
    const result = resolveScheduled({ kind: 'fuzzy', token: 'tomorrow' }, today)
    expect(result).not.toBeNull()
    expect(result!.getDate()).toBe(17)
  })
})

describe('effectiveDate', () => {
  const today = d('2026-04-16')

  it('returns scheduled when earlier than deadline', () => {
    const result = effectiveDate({
      scheduledDate: { kind: 'date', value: new Date(2026, 3, 18) },
      dueDate: new Date(2026, 3, 20),
    }, today)
    expect(result!.getDate()).toBe(18)
  })

  it('returns deadline when earlier than scheduled', () => {
    const result = effectiveDate({
      scheduledDate: { kind: 'date', value: new Date(2026, 3, 25) },
      dueDate: new Date(2026, 3, 20),
    }, today)
    expect(result!.getDate()).toBe(20)
  })

  it('returns scheduled when only scheduled is set (precise)', () => {
    const result = effectiveDate({
      scheduledDate: { kind: 'date', value: new Date(2026, 3, 22) },
    }, today)
    expect(result!.getDate()).toBe(22)
  })

  it('returns resolved fuzzy when only fuzzy scheduled is set', () => {
    const result = effectiveDate({
      scheduledDate: { kind: 'fuzzy', token: 'this-week' },
    }, today)
    expect(result!.getDate()).toBe(19)
  })

  it('returns deadline when only deadline is set', () => {
    const result = effectiveDate({ dueDate: new Date(2026, 3, 24) }, today)
    expect(result!.getDate()).toBe(24)
  })

  it('returns null when neither is set', () => {
    expect(effectiveDate({}, today)).toBeNull()
  })
})

describe('isScheduledExpired', () => {
  // Fuzzy tokens re-resolve against the current `today` each evaluation, so
  // windows containing or following today never precede it. With no stored
  // "set-at" date on ScheduledValue (by design in Phase 1), the function is
  // effectively a placeholder that only fires for contrived edge cases where
  // resolveFuzzy returns a date < today (e.g., none of the current tokens).
  const today = d('2026-04-20')

  it('returns false for precise scheduled in the past', () => {
    const result = isScheduledExpired({
      scheduledDate: { kind: 'date', value: new Date(2026, 3, 1) },
    }, today)
    expect(result).toBe(false)
  })

  it('returns false for fuzzy this-week (always resolves to upcoming Sunday)', () => {
    const mondayAfter = d('2026-04-27')
    const result = isScheduledExpired(
      { scheduledDate: { kind: 'fuzzy', token: 'this-week' } },
      mondayAfter,
    )
    expect(result).toBe(false)
  })

  it('returns false for fuzzy today evaluated on a later day (re-resolves forward)', () => {
    const result = isScheduledExpired(
      { scheduledDate: { kind: 'fuzzy', token: 'today' } },
      d('2026-04-17'),
    )
    expect(result).toBe(false)
  })

  it('returns false for fuzzy tomorrow evaluated on the same day', () => {
    const result = isScheduledExpired(
      { scheduledDate: { kind: 'fuzzy', token: 'tomorrow' } },
      d('2026-04-16'),
    )
    expect(result).toBe(false)
  })

  it('returns false when no scheduled', () => {
    expect(isScheduledExpired({}, today)).toBe(false)
  })
})

describe('isScheduledPast', () => {
  const today = d('2026-04-20')

  it('returns true for precise scheduled date in the past', () => {
    expect(isScheduledPast({ scheduledDate: { kind: 'date', value: new Date(2026, 3, 1) } }, today)).toBe(true)
  })

  it('returns false for precise scheduled date today', () => {
    expect(isScheduledPast({ scheduledDate: { kind: 'date', value: new Date(2026, 3, 20) } }, today)).toBe(false)
  })

  it('returns false for precise scheduled date in the future', () => {
    expect(isScheduledPast({ scheduledDate: { kind: 'date', value: new Date(2026, 3, 25) } }, today)).toBe(false)
  })

  it('returns false for fuzzy this-week (end-of-window always today or later)', () => {
    expect(isScheduledPast({ scheduledDate: { kind: 'fuzzy', token: 'this-week' } }, today)).toBe(false)
  })

  it('returns false when no scheduled', () => {
    expect(isScheduledPast({}, today)).toBe(false)
  })
})

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

describe('scheduledLabel', () => {
  const today = d('2026-04-16')

  it('labels fuzzy today', () => {
    expect(scheduledLabel({ kind: 'fuzzy', token: 'today' }, today)).toBe('Today')
  })

  it('labels fuzzy this-week', () => {
    expect(scheduledLabel({ kind: 'fuzzy', token: 'this-week' }, today)).toBe('This week')
  })

  it('labels fuzzy next-month', () => {
    expect(scheduledLabel({ kind: 'fuzzy', token: 'next-month' }, today)).toBe('Next month')
  })

  it('labels precise today as Today', () => {
    const result = scheduledLabel(
      { kind: 'date', value: new Date(2026, 3, 16) },
      today,
    )
    expect(result).toBe('Today')
  })

  it('labels precise tomorrow as Tomorrow', () => {
    const result = scheduledLabel(
      { kind: 'date', value: new Date(2026, 3, 17) },
      today,
    )
    expect(result).toBe('Tomorrow')
  })

  it('labels precise yesterday as Yesterday', () => {
    const result = scheduledLabel(
      { kind: 'date', value: new Date(2026, 3, 15) },
      today,
    )
    expect(result).toBe('Yesterday')
  })

  it('labels precise dates beyond tomorrow as Mon DD', () => {
    const result = scheduledLabel(
      { kind: 'date', value: new Date(2026, 3, 21) },
      today,
    )
    expect(result).toBe('Apr 21')
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
