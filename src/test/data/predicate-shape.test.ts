import { describe, it, expect } from 'vitest'
import { checkPredicateShape, pickPredicate, PREDICATE_ID_LIST_MAX, PREDICATE_SEARCH_TEXT_MAX } from '../../data/predicate-shape'
import { EXPRESSION_DEPTH_MAX, EXPRESSION_NODES_MAX, MARKER_CLAUSES_MAX, emptyFilterClauses, emptyPredicate } from '../../models'
import { prepareImport } from '../../data/import-pipeline'
import { SCHEMA_VERSION_KEY } from '../../data/file-version'
import { CURRENT_DB_VERSION } from '../../data/database'
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
    markers: [{ values: ['focus'] }, { values: ['urgent'] }], tags: [3, 4],
  }],
  ['Hot markers and relative dates', {
    ...emptyPredicate(), markers: [{ values: ['focus'] }],
    dates: { deadline: { match: 'range', start: { kind: 'relative', token: 'start-of-week' }, end: { kind: 'relative', token: 'end-of-month-plus-3' } } },
  }],
  ['a due date that must be set', { ...emptyPredicate(), dates: { deadline: { match: 'set' } } }],
  ['empty id filters (match nothing)', { ...emptyPredicate(), personIds: [], statusIds: [], tags: [], markers: [] }],
  ['a predicate stored before the optional fields existed', requiredOnly()],
  ['"is not" on people, status and tags', {
    ...emptyPredicate(), personIds: [0, 2], statusIds: [1], tags: [3],
    negate: { personIds: true, statusIds: true, tags: true },
  }],
  ['"is not" on one field', { ...emptyPredicate(), statusIds: [1, 0], tags: [3], negate: { statusIds: true } }],
  ['Priority of several values', { ...emptyPredicate(), markers: [{ values: ['urgent', 'important'] }] }],
  ['Priority is not every marker', { ...emptyPredicate(), markers: [{ values: ['focus', 'urgent', 'important'], not: true }] }],
  ['an expression', {
    ...emptyPredicate(), showCompleted: true,
    expression: {
      kind: 'and',
      items: [
        { kind: 'status', id: 1 },
        { kind: 'or', items: [{ kind: 'priority', value: 'focus' }, { kind: 'date', field: 'deadline', match: { match: 'range', start: null, end: { kind: 'relative', token: 'today' } } }] },
        { kind: 'not', item: { kind: 'and', items: [{ kind: 'person', id: 2 }, { kind: 'tag', id: 0 }, { kind: 'text', text: 'call' }] } },
      ],
    },
  }],
  ['an expression written from the runtime filter', criteriaToPredicate(predicateToCriteria({
    ...emptyPredicate(), expression: { kind: 'or', items: [{ kind: 'tag', id: 3 }, { kind: 'priority', value: 'urgent' }] },
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

  it('a Priority filter past the cap is stored capped, as reported; a condition naming nothing and a repeated value go', () => {
    const many = Array.from({ length: MARKER_CLAUSES_MAX + 1 }, (_, i) => ({ values: [i % 2 === 0 ? 'urgent' : 'focus'] }))
    const capped = pickPredicate({ ...emptyPredicate(), markers: many })
    expect(capped.fixes).toEqual(['priority filter capped'])
    expect(capped.predicate.markers).toEqual(many.slice(0, MARKER_CLAUSES_MAX))
    // Read again, nothing is left to fix (the audit's cleanup sticks).
    expect(pickPredicate(capped.predicate).fixes).toEqual([])
    // An empty condition doesn't count towards the cap.
    expect(pickPredicate({ ...emptyPredicate(), markers: [...many.slice(0, MARKER_CLAUSES_MAX), { values: [] }] }).fixes).toEqual([])
    expect(pickPredicate({ ...emptyPredicate(), markers: [{ values: [] }, { values: ['urgent', 'urgent', 'focus'], not: true }] }))
      .toEqual({ predicate: { ...emptyPredicate(), markers: [{ values: ['urgent', 'focus'], not: true }] }, fixes: [] })
    expect(pickPredicate({ ...emptyPredicate(), markers: [{ values: [] }] }).predicate.markers).toBeNull()
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
      const { predicate, fixes } = pickPredicate({ ...emptyPredicate(), statusIds: [2], markers: [{ values: ['urgent'] }], negate: { markers: true, statusIds: true } })
      expect(predicate).toMatchObject({ statusIds: [2], markers: [{ values: ['urgent'] }], negate: { statusIds: true } })
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

  describe('or groups stored before v75', () => {
    const hot = { ...emptyFilterClauses(), markers: [{ values: ['focus'] }] }
    const two = { ...emptyFilterClauses(), markers: [{ values: ['focus'] }], tags: [9] }
    const withGroups = (orGroups: unknown) => ({ ...emptyPredicate(), statusIds: [1], orGroups })
    const twoTerm = { kind: 'or', items: [{ kind: 'priority', value: 'focus' }, { kind: 'tag', id: 9 }] }

    it('reads an absent or null orGroups as none, with no fix and no key', () => {
      for (const orGroups of [undefined, null]) {
        const picked = pickPredicate(withGroups(orGroups))
        expect(picked).toEqual({ predicate: { ...emptyPredicate(), statusIds: [1] }, fixes: [] })
        expect('orGroups' in picked.predicate).toBe(false)
      }
    })

    it('folds them into an expression with the clauses beside them, each group an or of its clauses', () => {
      const picked = pickPredicate(withGroups([hot, two]))
      expect(picked.fixes).toEqual([])
      expect('orGroups' in picked.predicate).toBe(false)
      expect(picked.predicate.statusIds).toBeNull()
      expect(picked.predicate.expression).toEqual({ kind: 'and', items: [{ kind: 'status', id: 1 }, { kind: 'priority', value: 'focus' }, twoTerm] })
    })

    it.each([['an object', { 0: hot }], ['a string', 'hot'], ['a number', 1]])('drops an orGroups that is %s, keeping the rest', (_name, bad) => {
      expect(pickPredicate(withGroups(bad))).toEqual({ predicate: { ...emptyPredicate(), statusIds: [1] }, fixes: ['or groups dropped'] })
    })

    it.each([['null', null], ['a number', 3], ['an array', [hot]], ['a string', 'hot']])('drops an or group that is %s, keeping the others', (_name, bad) => {
      const picked = pickPredicate(withGroups([bad, two]))
      expect(picked.fixes).toEqual(['or group dropped'])
      expect(picked.predicate.expression).toEqual({ kind: 'and', items: [{ kind: 'status', id: 1 }, twoTerm] })
    })

    it('drops a malformed clause inside one with its own fix; one left with no clause goes too', () => {
      const { predicate, fixes } = pickPredicate(withGroups([
        { ...emptyFilterClauses(), personIds: 'x' },
        { ...emptyFilterClauses(), personIds: 'x', tags: [2], searchText: 'a' },
      ]))
      expect(predicate.expression).toEqual({ kind: 'and', items: [{ kind: 'status', id: 1 }, { kind: 'or', items: [{ kind: 'tag', id: 2 }, { kind: 'text', text: 'a' }] }] })
      expect(fixes).toEqual(['people filter dropped', 'or group dropped'])
    })

    it('drops one that filters nothing silently', () => {
      const picked = pickPredicate(withGroups([emptyFilterClauses(), { ...emptyFilterClauses(), personIds: [], negate: { personIds: true } }]))
      expect(picked).toEqual({ predicate: { ...emptyPredicate(), statusIds: [1] }, fixes: [] })
    })

    it('reads at most 30 of them', () => {
      const groups = Array.from({ length: 31 }, (_, i) => ({ ...emptyFilterClauses(), tags: [i + 1], searchText: 'a' }))
      const { predicate, fixes } = pickPredicate(withGroups(groups))
      expect(fixes).toEqual(['or groups capped'])
      expect(predicate.expression?.kind === 'and' ? predicate.expression.items : []).toHaveLength(31)
    })
  })

  it('keeps several Priority conditions as chips (Graphical repeats Priority, ANDed)', () => {
    const p = { ...emptyPredicate(), markers: [{ values: ['urgent' as const] }, { values: ['important' as const], not: true as const }] }
    expect(pickPredicate(p)).toEqual({ predicate: p, fixes: [] })
  })
})

describe('stored expressions past the caps (cr33 M1, S3)', () => {
  const tag = (id: number) => ({ kind: 'tag', id })
  const withExpr = (expression: unknown) => ({ ...emptyPredicate(), expression })
  const notChain = (depth: number): unknown => {
    let deep: unknown = tag(1)
    for (let i = 0; i < depth; i++) deep = { kind: 'not', item: deep }
    return deep
  }

  it('reads one of EXPRESSION_NODES_MAX nodes, and drops one past it with a fix', () => {
    const at = { kind: 'or', items: Array.from({ length: EXPRESSION_NODES_MAX - 1 }, (_, i) => tag(i + 1)) }
    expect(pickPredicate(withExpr(at)).fixes).toEqual([])
    const picked = pickPredicate(withExpr({ kind: 'and', items: [at, tag(1)] }))
    expect(picked.fixes).toEqual(['expression dropped'])
    expect(picked.predicate.expression).toBeUndefined()
  })

  it('refuses a deep one (a 20,000-deep not chain) with a fix, never a RangeError', () => {
    const picked = pickPredicate(withExpr(notChain(20_000)))
    expect(picked.fixes).toEqual(['expression dropped'])
    expect(picked.predicate.expression).toBeUndefined()
  })

  it('refuses one past the depth cap before reading its leaves', () => {
    let deep: unknown = { kind: 'bogus' }
    for (let i = 0; i < EXPRESSION_DEPTH_MAX; i++) deep = { kind: 'and', items: [tag(1), deep] }
    expect(pickPredicate(withExpr(deep)).fixes).toEqual(['expression dropped'])
  })

  it('refuses a very wide one (200 ands of 200 ands of 4 tags) with a fix, never a RangeError', () => {
    const four = { kind: 'and', items: [tag(1), tag(2), tag(3), tag(4)] }
    const mid = { kind: 'and', items: Array.from({ length: 200 }, () => four) }
    const wide = { kind: 'and', items: Array.from({ length: 200 }, () => mid) }
    expect(pickPredicate(withExpr(wide)).fixes).toEqual(['expression dropped'])
  })

  it('an import of a file holding a deep one goes on: that list loses its filter, with a warning', () => {
    const file = {
      [SCHEMA_VERSION_KEY]: CURRENT_DB_VERSION,
      todos: [],
      settings: [],
      listDefinitions: [{ id: 1, name: 'Deep', sortOrder: 0, sort: 'manual', grouping: 'none', membership: { kind: 'custom', predicate: withExpr(notChain(20_000)) } }],
    }
    const result = prepareImport(file)
    if (!result.ok) throw new Error(result.error)
    expect(result.warnings.join(' ')).toContain('expression dropped')
  })
})

describe('chips beside an expression that fold into one past the caps (cr34 S3)', () => {
  const tag = (id: number) => ({ kind: 'tag', id })
  /** 2,500 tag ids as a chip — within what a chip holds — beside a one-term expression. */
  const stored = () => ({ ...emptyPredicate(), tags: Array.from({ length: 2500 }, (_, i) => i + 1), personIds: [4], expression: { kind: 'status', id: 2 } })

  it('the fold within the caps is unchanged: the chips join the expression, no fix', () => {
    const picked = pickPredicate({ ...emptyPredicate(), tags: [1, 2], expression: tag(9) })
    expect(picked.fixes).toEqual([])
    expect(picked.predicate.tags ?? null).toBeNull()
    expect(picked.predicate.expression).toEqual({ kind: 'and', items: [{ kind: 'or', items: [tag(1), tag(2)] }, tag(9)] })
  })

  it('past them, the expression goes on this read with a fix and the chips stay chips', () => {
    const picked = pickPredicate(stored())
    expect(picked.fixes).toEqual(['expression dropped'])
    expect(picked.predicate.expression).toBeUndefined()
    expect(picked.predicate.tags).toHaveLength(2500)
    expect(picked.predicate.personIds).toEqual([4])
  })

  it('what the first read stores reads back the same, with nothing more to fix', () => {
    const first = pickPredicate(stored())
    const again = pickPredicate(JSON.parse(JSON.stringify(first.predicate)))
    expect(again.fixes).toEqual([])
    expect(again.predicate).toEqual(first.predicate)
  })

  it('old or groups that take the fold past the caps go the same way', () => {
    const groups = Array.from({ length: 3 }, (_, g) => ({ ...emptyFilterClauses(), tags: Array.from({ length: 900 }, (_, i) => g * 1000 + i + 1) }))
    const picked = pickPredicate({ ...emptyPredicate(), statusIds: [1], orGroups: groups })
    expect(picked.fixes).toEqual(['or groups dropped'])
    expect(picked.predicate).toEqual({ ...emptyPredicate(), statusIds: [1] })
    expect(pickPredicate(picked.predicate).fixes).toEqual([])
  })

  it('an import of a file holding one warns, and the list it stores is one the next read leaves alone', () => {
    const file = {
      [SCHEMA_VERSION_KEY]: CURRENT_DB_VERSION,
      todos: [],
      settings: [],
      listDefinitions: [{ id: 1, name: 'Wide', sortOrder: 0, sort: 'manual', grouping: 'none', membership: { kind: 'custom', predicate: stored() } }],
    }
    const result = prepareImport(file)
    if (!result.ok) throw new Error(result.error)
    expect(result.warnings).toEqual(['Fixed 1 list: "Wide" (expression dropped)'])
    const predicate = (result.data.listDefinitions[0]!.membership as { predicate: TodoPredicate }).predicate
    expect(predicate.tags).toHaveLength(2500)
    expect(pickPredicate(JSON.parse(JSON.stringify(predicate))).fixes).toEqual([])
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
