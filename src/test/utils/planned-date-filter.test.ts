import { describe, expect, it } from 'vitest'
import type { FilterExpr } from '../../models/filter-expression'
import { emptyFilterClauses, emptyPredicate, type DateAnchor, type DateMatch, type DateRangeMatch, type TodoItem } from '../../models'
import {
  clausesToExpression,
  expressionToClauses,
  expressionWords,
  parseExpression,
  printExpression,
  type ExpressionNames,
  type ExpressionParse,
} from '../../utils/filter-expression'
import { activeDateFields, normalizeDateFilters, normalizeDateMatch, offeredDateFields, freeDateField } from '../../utils/date-filters'
import { matchesDateMatch, matchesFilter, type FilterSettings } from '../../utils/filter-match'
import { predicateToCriteria } from '../../utils/filter-criteria'
import { filterChips } from '../../utils/filter-chips'
import { filterHistoryFields, historyExactness } from '../../services/stats/filter-history'
import { pickPredicate } from '../../data/predicate-shape'

/**
 * The planned date (`doDate`, the Planner's planned day) as a date type of
 * the filters: the `planned` word of the expression in every form the other
 * date words take, what a clause keeps, its chip and its words. A plan is a
 * planned day or none: there is no "held in Unplanned" clause.
 */

const names: ExpressionNames = { person: () => undefined, tag: () => undefined, status: () => undefined }
const resolver = { person: () => undefined, tag: () => undefined, status: () => undefined }

// Friday 6 Nov 2026.
const TODAY = new Date(2026, 10, 6)
const day = (n: number) => new Date(2026, 10, 6 + n)

function parse(text: string): ExpressionParse {
  return parseExpression(text, { today: TODAY, names: resolver })
}

function tree(text: string): FilterExpr | null {
  const r = parse(text)
  if (!r.ok) throw new Error(`${text}: ${r.error.message}`)
  return r.expression
}

function match(text: string): DateMatch {
  const e = tree(text)
  if (e?.kind !== 'date' || e.field !== 'planned') throw new Error(`${text}: not a planned clause`)
  return e.match
}

const CHIP_NAMES = { people: [], tags: [], statuses: [] }

const print = (e: FilterExpr | null) => printExpression(e, false, names)
const canonical = (text: string) => print(tree(text))
const words = (text: string) => {
  const e = tree(text)
  if (!e) throw new Error(`${text}: no expression`)
  return expressionWords(e, names).text
}

const rel = (token: string): DateAnchor => ({ kind: 'relative', token } as DateAnchor)
const off = (days: number, unit?: 'w' | 'm' | 'y'): DateAnchor => (unit ? { kind: 'offset', days, unit } : { kind: 'offset', days })
const fixed = (y: number, m: number, d: number): DateAnchor => ({ kind: 'fixed', iso: new Date(y, m - 1, d).toISOString() })
const range = (start: DateAnchor | null, end: DateAnchor | null): DateRangeMatch => ({ match: 'range', start, end })

describe('the expression’s `planned` word', () => {
  it('takes every form the other date words take', () => {
    expect(match('planned any')).toEqual({ match: 'set' })
    expect(match('planned none')).toEqual({ match: 'unset' })
    expect(match('no planned')).toEqual({ match: 'unset' })
    expect(match('planned today')).toEqual(range(rel('today'), rel('today')))
    // A bare weekday and a year-less date look ahead, as Due's do.
    expect(match('planned fri')).toEqual(range(fixed(2026, 11, 13), fixed(2026, 11, 13)))
    expect(match('planned 11/2')).toEqual(range(fixed(2027, 11, 2), fixed(2027, 11, 2)))
    expect(match('planned <= today')).toEqual(range(null, rel('today')))
    expect(match('planned < today')).toEqual(range(null, rel('yesterday')))
    expect(match('planned >= +2w')).toEqual(range(off(2, 'w'), null))
    expect(match('planned -3d..+7d')).toEqual(range(off(-3), off(7)))
    expect(match('planned this week')).toEqual(range(rel('today'), rel('end-of-week')))
    expect(match('planned next week')).toEqual(range(rel('start-of-next-week'), rel('end-of-next-week')))
    expect(match('planned within 3 days')).toEqual(range(rel('today'), off(3)))
    expect(match('planned within last 7 days')).toEqual(range(off(-7), rel('today')))
    expect(match('planned by fri')).toEqual(range(null, fixed(2026, 11, 13)))
  })

  it('`unplanned` is no keyword: it reads as text, like any word', () => {
    expect(tree('unplanned')).toEqual({ kind: 'text', text: 'unplanned' })
    expect(tree('not unplanned')).toEqual({ kind: 'not', item: { kind: 'text', text: 'unplanned' } })
    expect(tree('report unplanned')).toEqual({ kind: 'text', text: 'report unplanned' })
    expect(tree('UNPLANNED and planned none')).toEqual({ kind: 'and', items: [
      { kind: 'text', text: 'UNPLANNED' },
      { kind: 'date', field: 'planned', match: { match: 'unset' } },
    ] })
  })

  it('`planned` is a keyword: it ends a text phrase', () => {
    // Side by side with text, it needs an and / or, as any term does.
    expect(parse('report planned any').ok).toBe(false)
    expect(tree('"planned work"')).toEqual({ kind: 'text', text: 'planned work' })
    expect(tree('report and planned any')).toEqual({ kind: 'and', items: [{ kind: 'text', text: 'report' }, { kind: 'date', field: 'planned', match: { match: 'set' } }] })
  })

  it('refuses what it can’t read, as the other date words do', () => {
    expect(parse('planned').ok).toBe(false)
    expect(parse('planned late').ok).toBe(false)
    expect(parse('planned +7d..-3d').ok).toBe(false)
  })

  it('prints in its canonical form, which reads back as the same clause', () => {
    const forms: Array<[string, string]> = [
      ['planned any', 'planned any'],
      ['planned none', 'planned none'],
      ['no planned', 'planned none'],
      ['planned today', 'planned today'],
      ['planned <= today', 'planned <= today'],
      ['planned < today', 'planned <= yesterday'],
      ['planned -3d..+7d', 'planned -3d..+7d'],
      ['planned >= +2w', 'planned >= +2w'],
      ['planned this week', 'planned this week'],
      ['planned within 3 days', 'planned within 3 days'],
      ['planned fri', 'planned 11/13/2026'],
    ]
    for (const [typed, printed] of forms) {
      expect(canonical(typed), typed).toBe(printed)
      expect(tree(printed), printed).toEqual(tree(typed))
    }
    // A range "or" none, as Graphical's "Also tasks not planned" converts.
    const orNone = clausesToExpression({ ...emptyFilterClauses(), dates: { planned: { match: 'range', start: null, end: rel('today'), includeNoDate: true } } })
    expect(print(orNone)).toBe('planned <= today or planned none')
    expect(tree(print(orNone))).toEqual(orNone)
  })

  it('reads back in words', () => {
    expect(words('planned any')).toBe('Planned')
    expect(words('planned none')).toBe('Not planned')
    expect(words('planned this week')).toBe('Planned this week')
    expect(words('planned <= yesterday')).toBe('Planned before today')
    expect(words('planned within 3 days')).toBe('Planned within the next 3 days')
    expect(words('planned <= today or planned none')).toBe('Planned today or earlier, or none')
  })
})

describe('Graphical ↔ expression', () => {
  it('a planned clause and its "is not" are chips', () => {
    expect(expressionToClauses(tree('planned any'))?.dates).toEqual({ planned: { match: 'set' } })
    expect(expressionToClauses(tree('not planned this week'))?.dates).toEqual({ planned: { ...range(rel('today'), rel('end-of-week')), not: true } })
    expect(expressionToClauses(tree('planned none'))?.dates).toEqual({ planned: { match: 'unset' } })
    expect(clausesToExpression({ ...emptyFilterClauses(), dates: { planned: { match: 'unset' } } })).toEqual({ kind: 'date', field: 'planned', match: { match: 'unset' } })
  })

  it('a stored `held` clause is malformed: the repair drops it, or the expression that holds it', () => {
    const graphical = pickPredicate({ showCompleted: false, dates: { planned: { match: 'held' }, deadline: { match: 'set' } } })
    expect(graphical.predicate.dates).toEqual({ deadline: { match: 'set' } })
    expect(graphical.fixes).toContain('planned date filter dropped')
    const typed = pickPredicate({ showCompleted: false, expression: { kind: 'and', items: [{ kind: 'date', field: 'planned', match: { match: 'held' } }, { kind: 'text', text: 'x' }] } })
    expect(typed.predicate.expression).toBeUndefined()
    expect(typed.fixes).toContain('expression dropped')
  })

  it('Planned is an optional, negatable type', () => {
    expect(normalizeDateMatch('planned', { match: 'set' })).toEqual({ match: 'set' })
    expect(normalizeDateMatch('planned', { match: 'unset' })).toEqual({ match: 'unset' })
    expect(normalizeDateMatch('planned', { ...range(null, rel('today')), not: true, includeNoDate: true })).toEqual({ ...range(null, rel('today')), not: true })
    expect(normalizeDateMatch('planned', { ...range(null, rel('today')), includeNoDate: true })).toEqual({ ...range(null, rel('today')), includeNoDate: true })
    // Stored in reading order: Due, then Planned, then the follow-ups.
    expect(Object.keys(normalizeDateFilters({ followup: { match: 'set' }, planned: { match: 'unset' }, deadline: { match: 'set' } }))).toEqual(['deadline', 'planned', 'followup'])
    expect(activeDateFields({ planned: { match: 'unset' } })).toEqual(['planned'])
  })

  it('the date panel offers Planned second, and adding a date opens on it once Due filters', () => {
    expect(offeredDateFields().indexOf('planned')).toBe(1)
    expect(offeredDateFields(['completed'])).toContain('planned')
    expect(freeDateField({ deadline: { match: 'set' } })).toBe('planned')
  })

  it('a planned chip reads Planned and its clause', () => {
    const chips = filterChips({ ...emptyFilterClauses(), dates: { planned: { match: 'set' }, deadline: { match: 'set' } } }, CHIP_NAMES)
    expect(chips.map((c) => [c.dateField, c.label, c.value])).toEqual([['deadline', 'Due', 'any date'], ['planned', 'Planned', 'any date']])
    const none = filterChips({ ...emptyFilterClauses(), dates: { planned: { match: 'unset' } } }, CHIP_NAMES)
    expect(none.map((c) => c.value)).toEqual(['none'])
  })
})

describe('what a planned clause keeps', () => {
  const task = (over: Partial<TodoItem>): TodoItem => ({ uid: 'u', title: 'T', isCompleted: false, sortOrder: 0, createdAt: day(-30), modifiedAt: day(-1), ...over })
  const planned = task({ doDate: day(2) })
  const missed = task({ doDate: day(-2) })
  // No planned day but a due date: the Planner may show it, yet it has no plan.
  const dueOnly = task({ dueDate: day(1) })
  const none = task({})
  const keeps = (m: DateMatch) => [planned, missed, dueOnly, none].map((t) => matchesDateMatch(t, 'planned', m, TODAY, 0))

  it('reads the planned day; Any / None by whether there is one', () => {
    expect(keeps({ match: 'set' })).toEqual([true, true, false, false])
    expect(keeps({ match: 'unset' })).toEqual([false, false, true, true])
  })

  it('a range by the planned day; "or none" and "is not" keep the tasks without one', () => {
    expect(keeps(range(rel('today'), off(7)))).toEqual([true, false, false, false])
    expect(keeps(range(null, rel('yesterday')))).toEqual([false, true, false, false])
    expect(keeps({ ...range(rel('today'), off(7)), includeNoDate: true })).toEqual([true, false, true, true])
    expect(keeps({ ...range(rel('today'), off(7)), not: true })).toEqual([false, true, true, true])
  })

  it('through the whole filter: a clause, the expression', () => {
    const settings: FilterSettings = { weekStartsOn: 0, urgentRange: null, staleAfterDays: 30 }
    const run = (p: Parameters<typeof predicateToCriteria>[0]) => [planned, missed, dueOnly, none].map((t) => matchesFilter(predicateToCriteria(p), t, [], TODAY, undefined, [], settings))
    expect(run({ ...emptyPredicate(), dates: { planned: { match: 'unset' } } })).toEqual([false, false, true, true])
    expect(run({ ...emptyPredicate(), expression: tree('not planned none') ?? undefined })).toEqual([true, true, false, false])
    expect(run({ ...emptyPredicate(), expression: tree('planned <= yesterday or planned none') ?? undefined })).toEqual([false, true, true, true])
  })
})

describe('the history log', () => {
  it('logs no plan: a planned filter reads as now, so its history is approximate', () => {
    const criteria = predicateToCriteria({ ...emptyPredicate(), dates: { planned: { match: 'set' } } })
    expect(filterHistoryFields(criteria).has('planned')).toBe(true)
    expect(historyExactness(criteria, day(-13), day(-100))).toEqual({ exact: false, approximate: ['planned'] })
    const typed = predicateToCriteria({ ...emptyPredicate(), expression: tree('planned this week') ?? undefined })
    expect(historyExactness(typed, day(-13), day(-100)).approximate).toEqual(['planned'])
  })
})
