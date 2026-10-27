import { describe, it, expect } from 'vitest'
import { checkPredicateShape, pickPredicate, PREDICATE_ID_LIST_MAX, PREDICATE_SEARCH_TEXT_MAX } from '../../data/predicate-shape'
import { OR_GROUPS_MAX, emptyFilterClauses, emptyPredicate } from '../../models'
import { criteriaToPredicate, predicateToCriteria } from '../../utils/filter-criteria'
import type { TodoPredicate } from '../../models/filter-predicate'

/** The empty predicate without its optional fields (as stored before they existed). */
function requiredOnly(): TodoPredicate {
  const p: Partial<TodoPredicate> = emptyPredicate()
  delete p.markers
  delete p.tags
  return p as TodoPredicate
}

const OCT_1 = { kind: 'fixed', iso: '2026-10-01T00:00:00.000Z' } as const

/** Every predicate shape the app writes. */
const APP_PREDICATES: Array<[string, TodoPredicate]> = [
  ['the empty predicate (new list)', emptyPredicate()],
  ['a screen filter saved as a predicate', criteriaToPredicate(predicateToCriteria(emptyPredicate()))],
  ['every field set', {
    showCompleted: true, personIds: [1, 0], statusIds: [2], searchText: 'invoice',
    dates: {
      deadline: { match: 'unset' },
      followup: { match: 'range', start: OCT_1, end: { kind: 'offset', days: -7 }, includeNoDate: true },
      created: { match: 'range', start: null, end: { kind: 'relative', token: 'today' } },
      modified: { match: 'range', start: { kind: 'offset', days: -30 }, end: null },
    },
    markers: { urgent: true, focus: true }, tags: [3, 4],
  }],
  ['Hot markers and relative dates', {
    ...emptyPredicate(), markers: 'hot',
    dates: { deadline: { match: 'range', start: { kind: 'relative', token: 'start-of-week' }, end: { kind: 'relative', token: 'end-of-month-plus-3' } } },
  }],
  ['a due date that must be set', { ...emptyPredicate(), dates: { deadline: { match: 'set' } } }],
  ['empty id filters (match nothing)', { ...emptyPredicate(), personIds: [], statusIds: [], tags: [], markers: {} }],
  ['a predicate stored before the optional fields existed', requiredOnly()],
  ['"is not" on people, status and tags', {
    ...emptyPredicate(), personIds: [0, 2], statusIds: [1], tags: [3],
    negate: { personIds: true, statusIds: true, tags: true },
  }],
  ['"is not" on one field', { ...emptyPredicate(), statusIds: [1, 0], tags: [3], negate: { statusIds: true } }],
  ['Priority Yes and No', { ...emptyPredicate(), markers: { urgent: true, important: false } }],
  ['Priority No on every marker', { ...emptyPredicate(), markers: { focus: false, urgent: false, important: false } }],
  ['two or groups beside a clause', {
    ...emptyPredicate(), statusIds: [1],
    orGroups: [
      { ...emptyFilterClauses(), markers: 'hot', dates: { deadline: { match: 'range', start: null, end: { kind: 'relative', token: 'today' } } } },
      { ...emptyFilterClauses(), personIds: [2], tags: [0], searchText: 'call', negate: { personIds: true } },
    ],
  }],
  ['an or group written from the runtime filter', criteriaToPredicate(predicateToCriteria({
    ...emptyPredicate(), orGroups: [{ ...emptyFilterClauses(), tags: [3, 4], markers: { urgent: true } }],
  }))],
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

  it.each([
    ['an unknown string', 'warm'], ['hot as a key', { hot: true }], ['a non-boolean value', { urgent: 'yes' }],
    ['a null value', { important: null }], ['a number value', { focus: 0 }], ['a No beside a bad value', { urgent: false, important: 1 }],
    ['an array', ['hot']], ['a number', 1],
  ])(
    'drops a Markers filter that is %s',
    (_name, markers) => {
      expect(pickPredicate({ ...emptyPredicate(), markers })).toEqual({ predicate: emptyPredicate(), fixes: ['priority filter dropped'] })
    },
  )

  it('shortens a text filter over the cap', () => {
    const { predicate, fixes } = pickPredicate({ ...emptyPredicate(), searchText: 'x'.repeat(PREDICATE_SEARCH_TEXT_MAX + 1) })
    expect(predicate.searchText).toBe('x'.repeat(PREDICATE_SEARCH_TEXT_MAX))
    expect(fixes).toEqual(['text filter shortened'])
  })

  it('drops unknown keys (the old single-range keys included, and keys inside clauses and anchors) silently', () => {
    const { predicate, fixes } = pickPredicate({
      ...emptyPredicate(), focus: true, __proto__x: 1, dateField: 'followup', hasDeadline: true,
      dates: { deadline: { match: 'range', start: null, end: { kind: 'offset', days: 3, extra: 'x' }, extra: 1 } },
    })
    expect(predicate).toEqual({ ...emptyPredicate(), dates: { deadline: { match: 'range', start: null, end: { kind: 'offset', days: 3 } } } })
    expect(fixes).toEqual([])
  })

  it('stores a clause in its one form: no clause that filters nothing, includeNoDate only when true on the due date / follow-up, date-type order', () => {
    const { predicate, fixes } = pickPredicate({
      ...emptyPredicate(),
      dates: {
        modified: { match: 'range', start: OCT_1, end: null, includeNoDate: true },
        followup: { match: 'range', start: null, end: null, includeNoDate: true },
        deadline: { match: 'range', start: OCT_1, end: null, includeNoDate: false },
      },
    })
    expect(predicate.dates).toEqual({ deadline: { match: 'range', start: OCT_1, end: null }, modified: { match: 'range', start: OCT_1, end: null } })
    expect(Object.keys(predicate.dates)).toEqual(['deadline', 'modified'])
    expect(fixes).toEqual([])
  })

  it.each([
    ['an unknown date type', { scheduled: { match: 'set' } }, 'unknown date filter dropped'],
    ['an unknown match', { deadline: { match: 'between' } }, 'due date filter dropped'],
    ['a clause that is not an object', { deadline: 'set' }, 'due date filter dropped'],
    ['Has a date on the created date', { created: { match: 'set' } }, 'created date filter dropped'],
    ['No date on the modified date', { modified: { match: 'unset' } }, 'modified date filter dropped'],
    ['a bad range end', { deadline: { match: 'range', start: { kind: 'relative', token: 'someday' }, end: null } }, 'due date filter dropped'],
    ['a range end that is not a date', { deadline: { match: 'range', start: 'soon', end: null } }, 'due date filter dropped'],
    ['a non-boolean includeNoDate', { deadline: { match: 'range', start: OCT_1, end: null, includeNoDate: 'yes' } }, 'due date filter dropped'],
  ])('drops %s (no filter on that type), and says so', (_name, dates, fix) => {
    const { predicate, fixes } = pickPredicate({ ...emptyPredicate(), dates: { ...dates, followup: { match: 'set' } } })
    expect(fixes).toEqual([fix])
    expect(predicate.dates).toEqual({ followup: { match: 'set' } })
  })

  it('reads a legacy ISO-string range end as a fixed anchor', () => {
    const { predicate, fixes } = pickPredicate({ ...emptyPredicate(), dates: { deadline: { match: 'range', start: '2026-10-01T05:00:00.000Z', end: '2026-10-31' } } })
    expect(predicate.dates).toEqual({ deadline: { match: 'range', start: { kind: 'fixed', iso: '2026-10-01T05:00:00.000Z' }, end: { kind: 'fixed', iso: '2026-10-31' } } })
    expect(fixes).toEqual([])
  })

  it('fills a missing required field with its default', () => {
    expect(pickPredicate({ showCompleted: true, searchText: 'a', dates: {} })).toEqual({
      predicate: {
        showCompleted: true, personIds: null, statusIds: null, searchText: 'a', dates: {},
      },
      fixes: [],
    })
  })

  it('resets malformed core fields (rows already stored; import rejects them)', () => {
    const { predicate, fixes } = pickPredicate({ showCompleted: 'yes', searchText: 7, dates: [] })
    expect(predicate).toEqual(requiredOnly())
    expect(fixes).toEqual(['text filter reset', 'date filters reset', 'show completed reset'])
  })

  describe('"is not" switches', () => {
    it('drops a switch on a field that does not filter, and an "is not" with nothing ticked, silently', () => {
      const { predicate, fixes } = pickPredicate({
        ...emptyPredicate(), personIds: [], statusIds: null, tags: [2],
        negate: { personIds: true, statusIds: true, tags: true },
      })
      expect(fixes).toEqual([])
      expect(predicate).toMatchObject({ personIds: null, statusIds: null, tags: [2], negate: { tags: true } })
      expect(predicate.negate).toEqual({ tags: true })
    })

    it('reads false or null as "is", with no fix and no negate key', () => {
      const { predicate, fixes } = pickPredicate({ ...emptyPredicate(), personIds: [1], negate: { personIds: false, statusIds: null } })
      expect(fixes).toEqual([])
      expect(predicate.personIds).toEqual([1])
      expect('negate' in predicate).toBe(false)
      expect(pickPredicate({ ...emptyPredicate(), negate: null })).toEqual({ predicate: emptyPredicate(), fixes: [] })
    })

    it('drops the filter an unreadable switch turned (which way it filtered is unknown), and says so', () => {
      const { predicate, fixes } = pickPredicate({
        ...emptyPredicate(), personIds: [1], statusIds: [2], tags: [3],
        negate: { personIds: 'yes', statusIds: true, tags: 1 },
      })
      expect(predicate).toMatchObject({ personIds: null, statusIds: [2], tags: null, negate: { statusIds: true } })
      expect(fixes).toEqual(['people filter dropped', 'tag filter dropped'])
    })

    it('reports an unreadable switch on a field that does not filter', () => {
      const { predicate, fixes } = pickPredicate({ ...emptyPredicate(), negate: { statusIds: 'on' } })
      expect(predicate).toEqual(emptyPredicate())
      expect(fixes).toEqual(['unknown "is not" switch dropped'])
    })

    it('drops an unknown switch and keeps the rest', () => {
      const { predicate, fixes } = pickPredicate({ ...emptyPredicate(), statusIds: [2], markers: { urgent: true }, negate: { markers: true, statusIds: true } })
      expect(predicate).toMatchObject({ statusIds: [2], markers: { urgent: true }, negate: { statusIds: true } })
      expect(predicate.negate).toEqual({ statusIds: true })
      expect(fixes).toEqual(['unknown "is not" switch dropped'])
    })

    it('a negate that is not an object drops every id filter that is set', () => {
      const { predicate, fixes } = pickPredicate({ ...emptyPredicate(), personIds: [1], tags: [3], negate: 'people' })
      expect(predicate).toMatchObject({ personIds: null, statusIds: null, tags: null })
      expect('negate' in predicate).toBe(false)
      expect(fixes).toEqual(['unknown "is not" switches dropped', 'people filter dropped', 'tag filter dropped'])
    })
  })

  it('turns a missing or non-object predicate into the empty one', () => {
    const required = requiredOnly()
    expect(pickPredicate(undefined)).toEqual({ predicate: required, fixes: ['filters reset'] })
    expect(pickPredicate(5).predicate).toEqual(required)
  })

  describe('or groups', () => {
    const hot = { ...emptyFilterClauses(), markers: 'hot' as const }
    const withGroups = (orGroups: unknown) => ({ ...emptyPredicate(), statusIds: [1], orGroups })

    it('reads an absent or null orGroups as none, with no fix and no key', () => {
      for (const orGroups of [undefined, null]) {
        const picked = pickPredicate(withGroups(orGroups))
        expect(picked).toEqual({ predicate: { ...emptyPredicate(), statusIds: [1] }, fixes: [] })
        expect('orGroups' in picked.predicate).toBe(false)
      }
    })

    it.each([['an object', { 0: hot }], ['a string', 'hot'], ['a number', 1]])('drops an orGroups that is %s, keeping the rest', (_name, bad) => {
      expect(pickPredicate(withGroups(bad))).toEqual({ predicate: { ...emptyPredicate(), statusIds: [1] }, fixes: ['or groups dropped'] })
    })

    it.each([['null', null], ['a number', 3], ['an array', [hot]], ['a string', 'hot']])('drops an or group that is %s, keeping the others', (_name, bad) => {
      expect(pickPredicate(withGroups([bad, hot]))).toEqual({ predicate: withGroups([hot]), fixes: ['or group dropped'] })
    })

    it('counts several or groups dropped in one fix', () => {
      expect(pickPredicate(withGroups([1, 2, hot, 'x'])).fixes).toEqual(['3 or groups dropped'])
    })

    it('drops a malformed clause inside an or group with its own fix; an or group left with no clause goes too', () => {
      const { predicate, fixes } = pickPredicate(withGroups([
        { ...emptyFilterClauses(), personIds: 'x' },
        { ...emptyFilterClauses(), personIds: 'x', tags: [2] },
      ]))
      expect(predicate.orGroups).toEqual([{ ...emptyFilterClauses(), tags: [2] }])
      expect(fixes).toEqual(['people filter dropped', 'or group dropped'])
    })

    it('reads each or group as the predicate reads its clauses: "is not" switches, date clauses, the text cap, unknown keys', () => {
      const { predicate, fixes } = pickPredicate(withGroups([{
        ...emptyFilterClauses(), showCompleted: true, orGroups: [hot], extra: 1,
        statusIds: [], tags: [4], negate: { statusIds: true, tags: true, focus: true },
        dates: { scheduled: { match: 'set' }, followup: { match: 'set' } },
        searchText: 'x'.repeat(PREDICATE_SEARCH_TEXT_MAX + 1),
      }]))
      expect(predicate.orGroups).toEqual([{
        ...emptyFilterClauses(), tags: [4], negate: { tags: true },
        dates: { followup: { match: 'set' } }, searchText: 'x'.repeat(PREDICATE_SEARCH_TEXT_MAX),
      }])
      expect(fixes).toEqual(['text filter shortened', 'unknown date filter dropped', 'unknown "is not" switch dropped'])
    })

    it('drops an or group that filters nothing silently, and the key with the last one', () => {
      const picked = pickPredicate(withGroups([emptyFilterClauses(), { ...emptyFilterClauses(), personIds: [], negate: { personIds: true } }]))
      expect(picked).toEqual({ predicate: { ...emptyPredicate(), statusIds: [1] }, fixes: [] })
      expect('orGroups' in picked.predicate).toBe(false)
    })

    it('reports the same clause fix once for several or groups', () => {
      const bad = { ...emptyFilterClauses(), markers: 'warm', tags: [1] }
      expect(pickPredicate(withGroups([bad, bad])).fixes).toEqual(['priority filter dropped'])
    })

    it(`keeps ${OR_GROUPS_MAX} or groups and drops the rest`, () => {
      const groups = Array.from({ length: OR_GROUPS_MAX + 1 }, (_, i) => ({ ...emptyFilterClauses(), tags: [i + 1] }))
      const { predicate, fixes } = pickPredicate(withGroups(groups))
      expect(predicate.orGroups).toEqual(groups.slice(0, OR_GROUPS_MAX))
      expect(fixes).toEqual(['or groups capped'])
      expect(pickPredicate(withGroups(groups.slice(0, OR_GROUPS_MAX)))).toEqual({ predicate: withGroups(groups.slice(0, OR_GROUPS_MAX)), fixes: [] })
    })

    it('fills an or group\'s missing text filter and date filters, saying so', () => {
      const { predicate, fixes } = pickPredicate(withGroups([{ tags: [1] }]))
      expect(predicate.orGroups).toEqual([{ ...emptyFilterClauses(), tags: [1] }])
      expect(fixes).toEqual(['text filter reset', 'date filters reset'])
    })
  })
})

describe('checkPredicateShape', () => {
  it.each([
    ['showCompleted', { showCompleted: 'yes' }],
    ['searchText', { searchText: 5 }],
    ['dates', { dates: undefined }],
    ['dates', { dates: [] }],
    ['dates', { dates: 'due' }],
  ])('names a malformed %s', (field, patch) => {
    expect(checkPredicateShape({ ...emptyPredicate(), ...patch })).toBe(field)
  })

  it('a predicate in the old single-range shape (no `dates`) is rejected', () => {
    const old = { showCompleted: false, personIds: null, statusIds: null, searchText: '', dateField: 'deadline', dateRangeStart: null, dateRangeEnd: null, dateRangeIncludeNoDate: false, hasDeadline: true }
    expect(checkPredicateShape(old)).toBe('dates')
  })

  it('does not check what pickPredicate sanitises', () => {
    expect(checkPredicateShape({
      ...emptyPredicate(), personIds: 5, tags: 'x', markers: 'warm', searchText: 'x'.repeat(10_000),
      dates: { scheduled: 1, deadline: { match: 'between' } }, orGroups: 'x',
    })).toBe(true)
  })
})
