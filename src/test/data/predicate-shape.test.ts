import { describe, it, expect } from 'vitest'
import { checkPredicateShape, pickPredicate, PREDICATE_ID_LIST_MAX, PREDICATE_SEARCH_TEXT_MAX } from '../../data/predicate-shape'
import { emptyPredicate } from '../../models'
import { criteriaToPredicate, predicateToCriteria } from '../../utils/filter-criteria'
import type { TodoPredicate } from '../../models/filter-predicate'

/** The empty predicate without its optional fields (as stored before they existed). */
function requiredOnly(): TodoPredicate {
  const p: Partial<TodoPredicate> = emptyPredicate()
  delete p.hasFollowup
  delete p.markers
  delete p.tags
  return p as TodoPredicate
}

/** Every predicate shape the app writes. */
const APP_PREDICATES: Array<[string, TodoPredicate]> = [
  ['the empty predicate (new list)', emptyPredicate()],
  ['a screen filter saved as a predicate', criteriaToPredicate(predicateToCriteria(emptyPredicate()))],
  ['every field set', {
    showCompleted: true, personIds: [1, 0], statusIds: [2], searchText: 'invoice', dateField: 'followup',
    dateRangeStart: { kind: 'fixed', iso: '2026-10-01T00:00:00.000Z' }, dateRangeEnd: { kind: 'offset', days: -7 },
    dateRangeIncludeNoDate: true, hasDeadline: false, hasFollowup: true, markers: { urgent: true, focus: true }, tags: [3, 4],
  }],
  ['Hot markers and relative dates', {
    ...emptyPredicate(), markers: 'hot',
    dateRangeStart: { kind: 'relative', token: 'start-of-week' }, dateRangeEnd: { kind: 'relative', token: 'end-of-month-plus-3' },
  }],
  ['empty id filters (match nothing)', { ...emptyPredicate(), personIds: [], statusIds: [], tags: [], markers: {} }],
  ['a predicate stored before the optional fields existed', requiredOnly()],
]

describe('pickPredicate', () => {
  it.each(APP_PREDICATES)('leaves %s exactly as it is, with no fixes', (_name, predicate) => {
    expect(checkPredicateShape(JSON.parse(JSON.stringify(predicate)))).toBe(true)
    const picked = pickPredicate(JSON.parse(JSON.stringify(predicate)))
    expect(picked).toEqual({ predicate, fixes: [] })
    expect(Object.keys(picked.predicate).sort()).toEqual(Object.keys(predicate).sort())
  })

  it.each([
    ['a number', 5],
    ['a string', '1,2'],
    ['an object', { 1: true }],
    ['a non-number id', [1, '2']],
    ['a null id', [1, null]],
    ['too many ids', Array.from({ length: PREDICATE_ID_LIST_MAX + 1 }, (_, i) => i)],
  ])('drops an id filter that is %s (no filter), and says so', (_name, bad) => {
    const { predicate, fixes } = pickPredicate({ ...emptyPredicate(), personIds: bad, statusIds: bad, tags: bad })
    expect(predicate).toMatchObject({ personIds: null, statusIds: null, tags: null })
    expect(fixes).toEqual(['people filter dropped', 'status filter dropped', 'tag filter dropped'])
    // The runtime filter can be built from it.
    expect(() => predicateToCriteria(predicate)).not.toThrow()
  })

  it('keeps an id filter at the cap', () => {
    const ids = Array.from({ length: PREDICATE_ID_LIST_MAX }, (_, i) => i)
    expect(pickPredicate({ ...emptyPredicate(), personIds: ids })).toEqual({ predicate: { ...emptyPredicate(), personIds: ids }, fixes: [] })
  })

  it.each([['an unknown string', 'warm'], ['hot as a key', { hot: true }], ['a non-true value', { urgent: 'yes' }], ['an array', ['hot']], ['a number', 1]])(
    'drops a Markers filter that is %s',
    (_name, markers) => {
      expect(pickPredicate({ ...emptyPredicate(), markers })).toEqual({ predicate: emptyPredicate(), fixes: ['markers filter dropped'] })
    },
  )

  it('shortens a text filter over the cap', () => {
    const { predicate, fixes } = pickPredicate({ ...emptyPredicate(), searchText: 'x'.repeat(PREDICATE_SEARCH_TEXT_MAX + 1) })
    expect(predicate.searchText).toBe('x'.repeat(PREDICATE_SEARCH_TEXT_MAX))
    expect(fixes).toEqual(['text filter shortened'])
  })

  it('drops unknown keys (and keys inside date anchors) silently', () => {
    const { predicate, fixes } = pickPredicate({
      ...emptyPredicate(), focus: true, __proto__x: 1, dateRangeEnd: { kind: 'offset', days: 3, extra: 'x' },
    })
    expect(predicate).toEqual({ ...emptyPredicate(), dateRangeEnd: { kind: 'offset', days: 3 } })
    expect(fixes).toEqual([])
  })

  it('fills a missing required field with its default', () => {
    expect(pickPredicate({ showCompleted: true, searchText: 'a', dateRangeIncludeNoDate: false })).toEqual({
      predicate: {
        showCompleted: true, personIds: null, statusIds: null, searchText: 'a', dateField: 'deadline',
        dateRangeStart: null, dateRangeEnd: null, dateRangeIncludeNoDate: false, hasDeadline: null,
      },
      fixes: [],
    })
  })

  it('resets malformed core fields (rows already stored; import rejects them) and reads a legacy ISO date', () => {
    const { predicate, fixes } = pickPredicate({
      showCompleted: 'yes', searchText: 7, dateField: 'scheduled', dateRangeIncludeNoDate: 1,
      dateRangeStart: '2026-10-01T00:00:00.000Z', dateRangeEnd: { kind: 'bogus' }, hasDeadline: 'no', hasFollowup: 3,
    })
    expect(predicate).toEqual({
      ...emptyPredicate(), markers: undefined, tags: undefined,
      dateRangeStart: { kind: 'fixed', iso: '2026-10-01T00:00:00.000Z' },
    })
    expect(fixes).toHaveLength(7)
  })

  it('turns a missing or non-object predicate into the empty one', () => {
    const required = requiredOnly()
    expect(pickPredicate(undefined)).toEqual({ predicate: required, fixes: ['filters reset'] })
    expect(pickPredicate(5).predicate).toEqual(required)
  })
})

describe('checkPredicateShape', () => {
  it.each([
    ['showCompleted', { showCompleted: 'yes' }],
    ['searchText', { searchText: 5 }],
    ['dateRangeIncludeNoDate', { dateRangeIncludeNoDate: undefined }],
    ['dateRangeStart', { dateRangeStart: 'not a date' }],
    ['dateRangeEnd', { dateRangeEnd: { kind: 'relative', token: 'someday' } }],
    ['dateField', { dateField: 'scheduled' }],
    ['hasDeadline', { hasDeadline: 'no' }],
    ['hasFollowup', { hasFollowup: 1 }],
  ])('names a malformed %s', (field, patch) => {
    expect(checkPredicateShape({ ...emptyPredicate(), ...patch })).toBe(field)
  })

  it('accepts the legacy ISO-string date anchor a 2026-04 build stored (pickPredicate makes it fixed)', () => {
    const legacy = { ...emptyPredicate(), dateRangeStart: '2026-10-01T05:00:00.000Z', dateRangeEnd: '2026-10-31' }
    expect(checkPredicateShape(legacy)).toBe(true)
    expect(pickPredicate(legacy).predicate).toMatchObject({
      dateRangeStart: { kind: 'fixed', iso: '2026-10-01T05:00:00.000Z' },
      dateRangeEnd: { kind: 'fixed', iso: '2026-10-31' },
    })
  })

  it('does not check what pickPredicate sanitises', () => {
    expect(checkPredicateShape({ ...emptyPredicate(), personIds: 5, tags: 'x', markers: 'warm', searchText: 'x'.repeat(10_000) })).toBe(true)
  })
})
