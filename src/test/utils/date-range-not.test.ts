import { describe, it, expect } from 'vitest'
import type { DateField, DateMatch, DateRangeMatch, PersistedTodoItem, TodoPredicate } from '../../models'
import { emptyFilterClauses, emptyPredicate, NEGATABLE_DATE_FIELDS } from '../../models'
import { pickPredicate } from '../../data/predicate-shape'
import { admitsCompleted, criteriaToPredicate, predicateToCriteria, type FilterCriteria } from '../../utils/filter-criteria'
import { applyFilter, matchesDateMatch } from '../../utils/filter-match'
import { dateFiltersEqual, dateRangeOf, isNegatableDateField, normalizeDateMatch, readDateFilters, withDateMatch } from '../../utils/date-filters'
import { currentFilterSettings } from '../../stores/settings-store'
import { makeTodo } from '../helpers'

/**
 * "Is not" on a date range (cr25 P4, schema v71): the date, as a day, is
 * outside [start, end], and a task without the date passes. Every type but
 * Completed; `includeNoDate` isn't stored beside it.
 */

const today = new Date(2026, 10, 4, 15, 0) // Wed 4 Nov 2026
const at = (d: number, h = 12, m = 0) => new Date(2026, 10, d, h, m)
const settings = () => ({ ...currentFilterSettings(), weekStartsOn: 1 as const })

/** [−7 days, today] / [today, +14 days], "is not". */
const notLastWeek: DateRangeMatch = { match: 'range', start: { kind: 'offset', days: -7 }, end: { kind: 'relative', token: 'today' }, not: true }
const notNext2Weeks: DateRangeMatch = { match: 'range', start: { kind: 'relative', token: 'today' }, end: { kind: 'offset', days: 14 }, not: true }

const followupAt = (d: Date | undefined) => makeTodo({ id: 1, nextFollowupAt: d })
const createdAt = (d: Date) => makeTodo({ id: 1, createdAt: d })

describe('matchesDateMatch: an "is not" range', () => {
  const range = (start: number | null, end: number | null, not: boolean): DateMatch => ({
    match: 'range',
    start: start == null ? null : { kind: 'offset', days: start },
    end: end == null ? null : { kind: 'offset', days: end },
    ...(not ? { not: true as const } : {}),
  })
  const m = (field: DateField, todo: PersistedTodoItem, clause: DateMatch) => matchesDateMatch(todo, field, clause, today, 1)

  it.each([
    ['inside', at(6), false],
    ['on the first day (late)', at(4 - 2, 23, 59), false],
    ['on the last day (early)', at(4 + 5, 0, 1), false],
    ['the day before', at(4 - 3, 23, 59), true],
    ['the day after', at(4 + 6, 0, 1), true],
  ])('optional type (next follow-up), bounded [−2, +5]: %s → %s', (_what, date, passes) => {
    expect(m('followup', followupAt(date), range(-2, 5, true))).toBe(passes)
    // The "is" range keeps exactly the others.
    expect(m('followup', followupAt(date), range(-2, 5, false))).toBe(!passes)
  })

  it.each([
    ['inside', at(6), false],
    ['on the bound', at(4 - 2, 0, 1), false],
    ['the day before', at(4 - 3, 23, 59), true],
    ['the day after', at(4 + 6), true],
  ])('Created, bounded [−2, +5]: %s → %s', (_what, date, passes) => {
    expect(m('created', createdAt(date), range(-2, 5, true))).toBe(passes)
    expect(m('created', createdAt(date), range(-2, 5, false))).toBe(!passes)
  })

  it('open-ended either side: not "from 2 days ago" keeps only earlier days; not "up to 2 days ago" only later', () => {
    expect(m('followup', followupAt(at(4 - 3)), range(-2, null, true))).toBe(true)
    expect(m('followup', followupAt(at(4 - 2, 0, 1)), range(-2, null, true))).toBe(false)
    expect(m('followup', followupAt(at(30)), range(-2, null, true))).toBe(false)
    expect(m('followup', followupAt(at(4 - 1)), range(null, -2, true))).toBe(true)
    expect(m('followup', followupAt(at(4 - 2, 23, 59)), range(null, -2, true))).toBe(false)
    expect(m('created', createdAt(at(4 - 3)), range(-2, null, true))).toBe(true)
    expect(m('created', createdAt(at(4)), range(-2, null, true))).toBe(false)
  })

  it('a task without the date passes (with or without includeNoDate beside it)', () => {
    expect(m('followup', followupAt(undefined), range(-2, 5, true))).toBe(true)
    expect(m('followup', followupAt(undefined), { ...range(-2, 5, true), includeNoDate: true } as DateMatch)).toBe(true)
    expect(m('lastFollowup', makeTodo({ id: 1 }), notLastWeek)).toBe(true)
    expect(m('deadline', makeTodo({ id: 1 }), range(0, 0, true))).toBe(true)
    // "Is": without includeNoDate it fails.
    expect(m('followup', followupAt(undefined), range(-2, 5, false))).toBe(false)
  })

  it('a range with neither end passes every task, "is not" or not', () => {
    expect(m('followup', followupAt(at(6)), { match: 'range', start: null, end: null, not: true })).toBe(true)
  })

  it('"not" on Completed (never stored) is read as "is"', () => {
    const done = makeTodo({ id: 1, isCompleted: true, completedAt: at(4) })
    expect(m('completed', done, { match: 'range', start: { kind: 'offset', days: 0 }, end: { kind: 'offset', days: 0 }, not: true })).toBe(true)
  })
})

describe('the stored form (date-filters)', () => {
  it('offers "is not" on every type but Completed', () => {
    expect(NEGATABLE_DATE_FIELDS).toEqual(['deadline', 'followup', 'lastFollowup', 'created', 'modified'])
    expect(isNegatableDateField('completed')).toBe(false)
    expect(isNegatableDateField('created')).toBe(true)
  })

  it('keeps `not` only when true, drops `includeNoDate` beside it, never on Completed; a range with neither end goes', () => {
    expect(normalizeDateMatch('followup', { ...notNext2Weeks, includeNoDate: true })).toEqual(notNext2Weeks)
    expect(normalizeDateMatch('created', notLastWeek)).toEqual(notLastWeek)
    expect(normalizeDateMatch('completed', notLastWeek)).toEqual({ match: 'range', start: notLastWeek.start, end: notLastWeek.end })
    expect(normalizeDateMatch('followup', { match: 'range', start: null, end: null, not: true })).toBeNull()
    const off = normalizeDateMatch('followup', { match: 'range', start: null, end: { kind: 'offset', days: 3 }, not: undefined, includeNoDate: true })
    expect(off).toEqual({ match: 'range', start: null, end: { kind: 'offset', days: 3 }, includeNoDate: true })
    expect(off && 'not' in off).toBe(false)
    expect(withDateMatch({}, 'followup', notNext2Weeks)).toEqual({ followup: notNext2Weeks })
    expect(readDateFilters({ followup: notNext2Weeks })).toEqual({ followup: notNext2Weeks })
  })

  it('dateRangeOf and dateFiltersEqual carry it', () => {
    expect(dateRangeOf(notNext2Weeks)).toEqual({ start: notNext2Weeks.start, end: notNext2Weeks.end, includeNoDate: false, not: true })
    expect(dateRangeOf({ match: 'set' }).not).toBe(false)
    const is: DateMatch = { match: 'range', start: notNext2Weeks.start, end: notNext2Weeks.end }
    expect(dateFiltersEqual({ followup: notNext2Weeks }, { followup: is })).toBe(false)
    expect(dateFiltersEqual({ followup: notNext2Weeks }, { followup: { ...notNext2Weeks, includeNoDate: true } })).toBe(true)
    expect(dateFiltersEqual({ completed: notLastWeek }, { completed: { ...notLastWeek, not: undefined } })).toBe(true)
  })

  it('predicate ↔ criteria round-trips it, outside and inside or groups', () => {
    const p: TodoPredicate = {
      ...emptyPredicate(),
      dates: { created: notLastWeek },
      orGroups: [{ ...emptyFilterClauses(), dates: { lastFollowup: notLastWeek } }, { ...emptyFilterClauses(), dates: { followup: notNext2Weeks } }],
    }
    const c = predicateToCriteria(p)
    expect(c.dates.created).toEqual(notLastWeek)
    expect(c.orGroups?.[1]?.dates.followup).toEqual(notNext2Weeks)
    expect(criteriaToPredicate(c)).toEqual(p)
  })

  it('admitsCompleted ignores every "is not" range (none can be on Completed)', () => {
    const f = predicateToCriteria({
      ...emptyPredicate(),
      dates: { deadline: notLastWeek, followup: notNext2Weeks, lastFollowup: notLastWeek, created: notLastWeek, modified: notLastWeek, completed: notLastWeek },
    })
    // The Completed one was read as "is" — the gate opens for it as before, no more.
    expect(f.dates.completed).toEqual({ match: 'range', start: notLastWeek.start, end: notLastWeek.end })
    expect(admitsCompleted(f)).toBe(true)
    expect(admitsCompleted({ ...f, dates: withDateMatch(f.dates, 'completed', null) })).toBe(false)
  })
})

describe('pickPredicate reads `not`', () => {
  const pick = (dates: Record<string, unknown>) => pickPredicate({ ...emptyPredicate(), dates })

  it('keeps `true`, reads false / absent as "is", drops includeNoDate beside it silently', () => {
    expect(pick({ followup: notNext2Weeks })).toEqual({ predicate: { ...emptyPredicate(), dates: { followup: notNext2Weeks } }, fixes: [] })
    expect(pick({ followup: { ...notNext2Weeks, not: false } }).predicate.dates.followup).toEqual({ match: 'range', start: notNext2Weeks.start, end: notNext2Weeks.end })
    expect(pick({ lastFollowup: { ...notLastWeek, includeNoDate: true } })).toEqual({ predicate: { ...emptyPredicate(), dates: { lastFollowup: notLastWeek } }, fixes: [] })
    expect(pick({ modified: notLastWeek }).predicate.dates.modified).toEqual(notLastWeek)
  })

  it('drops a clause whose `not` isn\'t a boolean, and an "is not" Completed range, with a fix', () => {
    expect(pick({ followup: { ...notNext2Weeks, not: 'yes' } })).toEqual({ predicate: { ...emptyPredicate(), dates: {} }, fixes: ['follow-up date filter dropped'] })
    expect(pick({ completed: notLastWeek })).toEqual({ predicate: { ...emptyPredicate(), dates: {} }, fixes: ['completed date filter dropped'] })
  })

  it('a negated range with neither end is no filter', () => {
    expect(pick({ followup: { match: 'range', start: null, end: null, not: true } })).toEqual({ predicate: { ...emptyPredicate(), dates: {} }, fixes: [] })
  })

  it('reads it inside or groups', () => {
    const p = pickPredicate({ ...emptyPredicate(), orGroups: [{ ...emptyFilterClauses(), tags: [1], dates: { followup: notNext2Weeks } }] })
    expect(p.fixes).toEqual([])
    expect(p.predicate.orGroups?.[0]?.dates.followup).toEqual(notNext2Weeks)
  })
})

describe('the user\'s lens: last follow-up not in the past week OR next follow-up not in the next two weeks', () => {
  // One or group, its two alternatives.
  const lens = predicateToCriteria({
    ...emptyPredicate(),
    orGroups: [{ ...emptyFilterClauses(), dates: { lastFollowup: notLastWeek, followup: notNext2Weeks } }],
  })
  const todos: PersistedTodoItem[] = [
    makeTodo({ id: 1, title: 'Followed up 2 days ago, next in 5 days', lastFollowupAt: at(2), nextFollowupAt: at(9) }),
    makeTodo({ id: 2, title: 'Followed up 2 days ago, next yesterday', lastFollowupAt: at(2), nextFollowupAt: at(3) }),
    makeTodo({ id: 3, title: 'Followed up 20 days ago, next in 5 days', lastFollowupAt: at(4 - 20), nextFollowupAt: at(9) }),
    makeTodo({ id: 4, title: 'Never followed up, no next' }),
    makeTodo({ id: 5, title: 'Followed up 2 days ago, no next', lastFollowupAt: at(2) }),
    makeTodo({ id: 6, title: 'Never followed up, next in 5 days', nextFollowupAt: at(9) }),
  ]

  it('hides only the tasks followed up lately with a follow-up soon', () => {
    const shown = applyFilter(lens as FilterCriteria, todos, undefined, undefined, today, undefined, settings()).map((t) => t.id)
    expect(shown).toEqual([2, 3, 4, 5, 6])
  })
})
