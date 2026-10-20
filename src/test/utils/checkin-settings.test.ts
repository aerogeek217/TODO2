import { describe, it, expect } from 'vitest'
import { emptyPredicate } from '../../models/filter-predicate'
import {
  CHECKIN_QUICK_FILTERS,
  DEFAULT_CHECKIN_OPEN_METHOD,
  checkinFilterLabel,
  checkinFilterOf,
  checkinFiltersEqual,
  dueSoonCheckinFilter,
  isCheckinOpenMethod,
  isNoCheckinFilter,
} from '../../utils/checkin-settings'

describe('check-in settings', () => {
  it('default: open in the mail app', () => {
    expect(DEFAULT_CHECKIN_OPEN_METHOD).toBe('mailto')
  })

  it('isCheckinOpenMethod accepts mailto and eml only', () => {
    expect(isCheckinOpenMethod('mailto')).toBe(true)
    expect(isCheckinOpenMethod('eml')).toBe(true)
    for (const bad of ['', 'MAILTO', 'outlook', null, undefined, 1]) expect(isCheckinOpenMethod(bad)).toBe(false)
  })
})

describe('the check-in filter', () => {
  it('is kept without people (nor their “is not”) and with completed tasks off; the other switches stay', () => {
    expect(checkinFilterOf({ ...emptyPredicate(), showCompleted: true, personIds: [1], tags: [2], negate: { personIds: true, tags: true } }))
      .toEqual({ ...emptyPredicate(), tags: [2], negate: { tags: true } })
    expect(checkinFilterOf({ ...emptyPredicate(), personIds: [1], negate: { personIds: true } })).toEqual(emptyPredicate())
  })

  it('no filter: nothing narrows (people and completed tasks don’t count)', () => {
    expect(isNoCheckinFilter(emptyPredicate())).toBe(true)
    expect(isNoCheckinFilter({ ...emptyPredicate(), personIds: [3], showCompleted: true })).toBe(true)
    expect(isNoCheckinFilter({ ...emptyPredicate(), markers: 'hot' })).toBe(false)
  })

  it('two filters are equal when they pick the same tasks (id lists as sets)', () => {
    expect(checkinFiltersEqual({ ...emptyPredicate(), tags: [1, 2] }, { ...emptyPredicate(), tags: [2, 1], personIds: [5] })).toBe(true)
    expect(checkinFiltersEqual({ ...emptyPredicate(), tags: [1] }, emptyPredicate())).toBe(false)
  })

  it('“Overdue + next 2 weeks” is a due range open at the start, ending 14 days from today', () => {
    expect(dueSoonCheckinFilter().dates).toEqual({ deadline: { match: 'range', start: null, end: { kind: 'offset', days: 14 } } })
  })

  it('a quick pick is named by its label; any other filter is “Custom filter”', () => {
    expect(CHECKIN_QUICK_FILTERS.map((q) => checkinFilterLabel(q.filter))).toEqual(['All open tasks', 'Overdue + next 2 weeks', 'Hot'])
    expect(checkinFilterLabel({ ...emptyPredicate(), personIds: [2] })).toBe('All open tasks')
    expect(checkinFilterLabel({ ...emptyPredicate(), statusIds: [2] })).toBe('Custom filter')
  })
})
