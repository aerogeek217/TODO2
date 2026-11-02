import { describe, it, expect } from 'vitest'
import type { DateFilters } from '../../models'
import {
  activeDateFields,
  dateFiltersEqual,
  dateRangeOf,
  freeDateField,
  hasDateFilters,
  isDateMatchOn,
  normalizeDateFilters,
  offeredDateFields,
  readDateFilters,
  withDateMatch,
} from '../../utils/date-filters'

const TODAY = { kind: 'relative', token: 'today' } as const
const WEEK = { kind: 'offset', days: 7 } as const

describe('date filters', () => {
  it('a clause filters when it is Has a date / No date, or a range with an end', () => {
    expect(isDateMatchOn({ match: 'set' })).toBe(true)
    expect(isDateMatchOn({ match: 'unset' })).toBe(true)
    expect(isDateMatchOn({ match: 'range', start: TODAY, end: null })).toBe(true)
    expect(isDateMatchOn({ match: 'range', start: null, end: null, includeNoDate: true })).toBe(false)
    expect(isDateMatchOn(undefined)).toBe(false)
  })

  it('lists the filtering types in Due · Follow-up · Created · Modified order', () => {
    const dates: DateFilters = {
      modified: { match: 'range', start: TODAY, end: null },
      followup: { match: 'range', start: null, end: null },
      deadline: { match: 'set' },
    }
    expect(activeDateFields(dates)).toEqual(['deadline', 'modified'])
    expect(hasDateFilters(dates)).toBe(true)
    expect(hasDateFilters({})).toBe(false)
    expect(hasDateFilters(undefined)).toBe(false)
  })

  it('normalises to the stored form', () => {
    expect(normalizeDateFilters({
      created: { match: 'set' },
      modified: { match: 'range', start: null, end: WEEK, includeNoDate: true },
      followup: { match: 'range', start: TODAY, end: null, includeNoDate: false },
      deadline: { match: 'range', start: null, end: null },
    })).toEqual({
      followup: { match: 'range', start: TODAY, end: null },
      modified: { match: 'range', start: null, end: WEEK },
    })
  })

  it('withDateMatch replaces one type and leaves the others; null or an off clause removes it', () => {
    const one = withDateMatch({}, 'deadline', { match: 'range', start: TODAY, end: WEEK, includeNoDate: true })
    expect(one).toEqual({ deadline: { match: 'range', start: TODAY, end: WEEK, includeNoDate: true } })
    const two = withDateMatch(one, 'created', { match: 'range', start: TODAY, end: null })
    expect(Object.keys(two)).toEqual(['deadline', 'created'])
    expect(withDateMatch(two, 'deadline', null)).toEqual({ created: { match: 'range', start: TODAY, end: null } })
    expect(withDateMatch(two, 'created', { match: 'range', start: null, end: null })).toEqual(one)
  })

  it('reads a clause’s range', () => {
    expect(dateRangeOf({ match: 'range', start: TODAY, end: null, includeNoDate: true })).toEqual({ start: TODAY, end: null, includeNoDate: true, not: false })
    expect(dateRangeOf({ match: 'set' })).toEqual({ start: null, end: null, includeNoDate: false, not: false })
  })

  it('compares maps by what they filter', () => {
    expect(dateFiltersEqual({}, { deadline: { match: 'range', start: null, end: null } })).toBe(true)
    expect(dateFiltersEqual({ deadline: { match: 'range', start: TODAY, end: WEEK, includeNoDate: false } }, { deadline: { match: 'range', start: TODAY, end: WEEK } })).toBe(true)
    expect(dateFiltersEqual({ deadline: { match: 'range', start: TODAY, end: WEEK } }, { deadline: { match: 'range', start: TODAY, end: { kind: 'offset', days: 8 } } })).toBe(false)
    expect(dateFiltersEqual({ deadline: { match: 'set' } }, { followup: { match: 'set' } })).toBe(false)
    expect(dateFiltersEqual({ deadline: { match: 'set' } }, { deadline: { match: 'unset' } })).toBe(false)
  })

  it('readDateFilters reads legacy ISO-string ends as fixed anchors and unreadable ones as open', () => {
    expect(readDateFilters({
      deadline: { match: 'range', start: '2026-10-01' as never, end: { kind: 'bogus' } as never },
      followup: { match: 'range', start: { kind: 'nope' } as never, end: null },
    })).toEqual({ deadline: { match: 'range', start: { kind: 'fixed', iso: '2026-10-01' }, end: null } })
  })
})

describe('the date types a scope can still take (cr25 P4b)', () => {
  it('a panel offers every type in tab order, or all but its host’s left-out ones', () => {
    expect(offeredDateFields()).toEqual(['deadline', 'followup', 'lastFollowup', 'completed', 'created', 'modified'])
    expect(offeredDateFields([])).toEqual(offeredDateFields())
    expect(offeredDateFields(['completed'])).toEqual(['deadline', 'followup', 'lastFollowup', 'created', 'modified'])
  })

  it('the first offered type that does not filter yet, in tab order; none when every one does', () => {
    expect(freeDateField({})).toBe('deadline')
    expect(freeDateField(undefined)).toBe('deadline')
    expect(freeDateField({ lastFollowup: { match: 'range', start: { kind: 'offset', days: -7 }, end: TODAY, not: true } })).toBe('deadline')
    expect(freeDateField({ deadline: { match: 'set' }, followup: { match: 'unset' } })).toBe('lastFollowup')
    // A range without an end doesn't filter: its type is still free.
    expect(freeDateField({ deadline: { match: 'range', start: null, end: null } })).toBe('deadline')
    const all: DateFilters = {
      deadline: { match: 'set' },
      followup: { match: 'set' },
      lastFollowup: { match: 'set' },
      created: { match: 'range', start: null, end: WEEK },
      modified: { match: 'range', start: null, end: WEEK },
    }
    expect(freeDateField(all)).toBe('completed')
    expect(freeDateField(all, offeredDateFields(['completed']))).toBeUndefined()
    expect(freeDateField({ ...all, completed: { match: 'range', start: null, end: TODAY } })).toBeUndefined()
  })
})
