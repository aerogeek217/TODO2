import { describe, it, expect } from 'vitest'
import { emptyFilterClauses, emptyPredicate, type FilterClauses } from '../../models/filter-predicate'
import { formatCheckinFilterSetting, readCheckinFilterSetting } from '../../data/checkin-filter-shape'
import {
  DEFAULT_CHECKIN_OPEN_METHOD,
  checkinFilterOf,
  checkinFiltersEqual,
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

  it('drops people inside or groups too; an or group left with nothing goes', () => {
    const kept: FilterClauses = { ...emptyFilterClauses(), tags: [2], negate: { tags: true } }
    expect(checkinFilterOf({
      ...emptyPredicate(),
      orGroups: [{ ...emptyFilterClauses(), personIds: [1], negate: { personIds: true } }, { ...kept, personIds: [3] }],
    })).toEqual({ ...emptyPredicate(), orGroups: [kept] })
    expect(checkinFilterOf({ ...emptyPredicate(), orGroups: [{ ...emptyFilterClauses(), personIds: [1] }] })).toEqual(emptyPredicate())
  })

  it('reading the stored filter says when people went from an or group', () => {
    const stored = JSON.stringify({ ...emptyPredicate(), orGroups: [{ ...emptyFilterClauses(), personIds: [1], markers: 'hot' }] })
    expect(readCheckinFilterSetting(stored)).toEqual({
      filter: { ...emptyPredicate(), orGroups: [{ ...emptyFilterClauses(), markers: 'hot' }] },
      fixes: ['people filter dropped'],
    })
    const clean = formatCheckinFilterSetting({ ...emptyPredicate(), orGroups: [{ ...emptyFilterClauses(), markers: 'hot' }] })
    expect(readCheckinFilterSetting(clean).fixes).toEqual([])
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
})
