import { describe, it, expect } from 'vitest'
import { emptyPredicate } from '../../models/filter-predicate'
import type { FilterExpr } from '../../models/filter-expression'
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

  it('drops an expression’s top-level terms that name a person, whole', () => {
    const kept = { kind: 'not' as const, item: { kind: 'tag' as const, id: 2 } }
    expect(checkinFilterOf({
      ...emptyPredicate(),
      expression: { kind: 'and', items: [{ kind: 'not', item: { kind: 'person', id: 1 } }, { kind: 'or', items: [kept, { kind: 'person', id: 3 }] }, kept] },
    })).toEqual({ ...emptyPredicate(), expression: kept })
    expect(checkinFilterOf({ ...emptyPredicate(), expression: { kind: 'person', id: 1 } })).toEqual(emptyPredicate())
  })

  it('drops a Completed date range (a check-in takes open tasks only), in an expression too; reading the stored filter says so', () => {
    const range = { match: 'range' as const, start: { kind: 'relative' as const, token: 'start-of-week' as const }, end: null }
    const due = { match: 'set' as const }
    expect(checkinFilterOf({ ...emptyPredicate(), dates: { deadline: due, completed: range } }))
      .toEqual({ ...emptyPredicate(), dates: { deadline: due } })
    // In an expression a Completed date folds away where the term allows it: inside an or it is false.
    expect(checkinFilterOf({ ...emptyPredicate(), expression: { kind: 'and', items: [{ kind: 'or', items: [{ kind: 'date', field: 'completed', match: range }, { kind: 'tag', id: 4 }] }, { kind: 'priority', value: 'focus' }] } }))
      .toEqual({ ...emptyPredicate(), expression: { kind: 'and', items: [{ kind: 'tag', id: 4 }, { kind: 'priority', value: 'focus' }] } })
    expect(isNoCheckinFilter({ ...emptyPredicate(), dates: { completed: range } })).toBe(true)
    const stored = JSON.stringify({ ...emptyPredicate(), dates: { deadline: due, completed: range } })
    expect(readCheckinFilterSetting(stored)).toEqual({
      filter: { ...emptyPredicate(), dates: { deadline: due } },
      fixes: ['completed date filter dropped'],
    })
    expect(JSON.parse(formatCheckinFilterSetting({ ...emptyPredicate(), dates: { completed: range } }))).toEqual(emptyPredicate())
  })

  it('folds no person and Completed dates by what they are over a person’s open tasks, never widening a term (cr33 F11)', () => {
    const range = { match: 'range' as const, start: { kind: 'relative' as const, token: 'start-of-week' as const }, end: null }
    const completed = { kind: 'date' as const, field: 'completed' as const, match: range }
    const q4 = { kind: 'tag' as const, id: 4 }
    const noPerson = { kind: 'person' as const, id: 0 }
    const of = (expression: FilterExpr) => checkinFilterOf({ ...emptyPredicate(), expression })
    // `(#q4 or no person)` keeps what #q4 keeps: it stays #q4, not no filter.
    expect(of({ kind: 'or', items: [q4, noPerson] })).toEqual({ ...emptyPredicate(), expression: q4 })
    expect(of({ kind: 'or', items: [q4, completed] })).toEqual({ ...emptyPredicate(), expression: q4 })
    // Always true over open tasks: the term goes, exactly.
    expect(of({ kind: 'and', items: [q4, { kind: 'not', item: completed }, { kind: 'not', item: noPerson }] })).toEqual({ ...emptyPredicate(), expression: q4 })
    // Always false: kept as it is (it keeps no task, as it says), never dropped into no filter.
    const never: FilterExpr = { kind: 'and', items: [q4, noPerson] }
    expect(of(never)).toEqual({ ...emptyPredicate(), expression: never })
    expect(isNoCheckinFilter({ ...emptyPredicate(), expression: never })).toBe(false)
    expect(of({ kind: 'and', items: [completed, { kind: 'priority', value: 'focus' }] }).expression).toEqual({ kind: 'and', items: [completed, { kind: 'priority', value: 'focus' }] })
  })

  it('reading a stored filter reports the person terms an expression drops (cr33 D3)', () => {
    const stored = JSON.stringify({ ...emptyPredicate(), expression: { kind: 'and', items: [{ kind: 'person', id: 1 }, { kind: 'status', id: 2 }] } })
    expect(readCheckinFilterSetting(stored)).toEqual({
      filter: { ...emptyPredicate(), expression: { kind: 'status', id: 2 } },
      fixes: ['people filter dropped'],
    })
    // Folded Completed dates are named too; a filter with nothing to take reads with no fix.
    const folded = JSON.stringify({ ...emptyPredicate(), expression: { kind: 'or', items: [{ kind: 'tag', id: 4 }, { kind: 'date', field: 'completed', match: { match: 'range', start: null, end: { kind: 'relative', token: 'today' } } }] } })
    expect(readCheckinFilterSetting(folded).fixes).toEqual(['completed date filter dropped'])
    expect(readCheckinFilterSetting(JSON.stringify({ ...emptyPredicate(), expression: { kind: 'tag', id: 4 } })).fixes).toEqual([])
  })

  it('no filter: nothing narrows (people and completed tasks don’t count)', () => {
    expect(isNoCheckinFilter(emptyPredicate())).toBe(true)
    expect(isNoCheckinFilter({ ...emptyPredicate(), personIds: [3], showCompleted: true })).toBe(true)
    expect(isNoCheckinFilter({ ...emptyPredicate(), markers: [{ values: ['focus'] }] })).toBe(false)
  })

  it('two filters are equal when they pick the same tasks (id lists as sets)', () => {
    expect(checkinFiltersEqual({ ...emptyPredicate(), tags: [1, 2] }, { ...emptyPredicate(), tags: [2, 1], personIds: [5] })).toBe(true)
    expect(checkinFiltersEqual({ ...emptyPredicate(), tags: [1] }, emptyPredicate())).toBe(false)
  })
})
