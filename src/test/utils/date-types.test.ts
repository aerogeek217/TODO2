import { describe, it, expect } from 'vitest'
import type { DateMatch, PersistedTodoItem } from '../../models'
import { emptyPredicate } from '../../models'
import { pickPredicate } from '../../data/predicate-shape'
import { admitsCompleted, composeScreenFilter, predicateToCriteria, type FilterCriteria } from '../../utils/filter-criteria'
import { applyFilter, createScreenComposedEvaluator, matchesComposedFilter, matchesDateMatch } from '../../utils/filter-match'
import { isOptionalDateField, normalizeDateFilters } from '../../utils/date-filters'
import { currentFilterSettings } from '../../stores/settings-store'
import type { TodoNameLookups } from '../../utils/filter'
import { makeTodo } from '../helpers'

/**
 * The Last followed up and Completed date types (cr24 P4, D22): matching by
 * local day, Last followed up as an optional date, Completed as a range only
 * that lets the completed tasks it keeps through the completion gate —
 * outside or groups only, from a list's filter, the top bar's chips or its lens.
 */

const today = new Date(2026, 10, 4, 15, 0) // Wed 4 Nov 2026
const at = (d: number, h = 12, m = 0) => new Date(2026, 10, d, h, m)

const todos: PersistedTodoItem[] = [
  makeTodo({ id: 1, title: 'Open, followed up today early', lastFollowupAt: at(4, 0, 5) }),
  makeTodo({ id: 2, title: 'Open, followed up 20 days ago', lastFollowupAt: at(4 - 20) }),
  makeTodo({ id: 3, title: 'Open, never followed up' }),
  makeTodo({ id: 4, title: 'Done Monday late', isCompleted: true, completedAt: at(2, 23, 59) }),
  makeTodo({ id: 5, title: 'Done last week', isCompleted: true, completedAt: at(28 - 31) }),
  makeTodo({ id: 6, title: 'Done today, followed up yesterday', isCompleted: true, completedAt: at(4, 9), lastFollowupAt: at(3, 18) }),
  // A stale completedAt on an open task (reopening clears it): never a completion date.
  makeTodo({ id: 7, title: 'Reopened', completedAt: at(3) }),
]

const lookups: TodoNameLookups = { assignedPeopleMap: new Map(), assignedTagsMap: new Map(), statusesById: new Map() }
const settings = () => ({ ...currentFilterSettings(), weekStartsOn: 1 as const })
const none = (): FilterCriteria => predicateToCriteria(emptyPredicate())
const crit = (patch: Partial<FilterCriteria>): FilterCriteria => ({ ...none(), ...patch })

const thisWeek: DateMatch = { match: 'range', start: { kind: 'relative', token: 'start-of-week' }, end: { kind: 'relative', token: 'today' } }
const todayOnly: DateMatch = { match: 'range', start: { kind: 'offset', days: 0 }, end: { kind: 'offset', days: 0 } }
const upTo14DaysAgoOrNone: DateMatch = { match: 'range', start: null, end: { kind: 'offset', days: -14 }, includeNoDate: true }

const ids = (f: FilterCriteria) => applyFilter(f, todos, undefined, undefined, today, undefined, settings()).map((t) => t.id)
const composedIds = (screen: FilterCriteria, list: FilterCriteria) =>
  todos.filter((t) => matchesComposedFilter(screen, list, t, lookups, today, settings())).map((t) => t.id)

describe('Last followed up', () => {
  it('is optional like the due date and the next follow-up', () => {
    expect(isOptionalDateField('lastFollowup')).toBe(true)
    expect(normalizeDateFilters({ lastFollowup: { match: 'set' } })).toEqual({ lastFollowup: { match: 'set' } })
    expect(normalizeDateFilters({ lastFollowup: upTo14DaysAgoOrNone })).toEqual({ lastFollowup: upTo14DaysAgoOrNone })
  })

  it('compares by local day: a follow-up early today is today', () => {
    const t1 = todos[0]!
    expect(matchesDateMatch(t1, 'lastFollowup', todayOnly, today, 1)).toBe(true)
    expect(matchesDateMatch(t1, 'lastFollowup', { match: 'range', start: null, end: { kind: 'relative', token: 'yesterday' } }, today, 1)).toBe(false)
  })

  it('Has a date / No date / a range with "also never followed up"', () => {
    expect(ids(crit({ dates: { lastFollowup: { match: 'set' } } }))).toEqual([1, 2])
    expect(ids(crit({ dates: { lastFollowup: { match: 'unset' } } }))).toEqual([3, 7])
    expect(ids(crit({ dates: { lastFollowup: upTo14DaysAgoOrNone } }))).toEqual([2, 3, 7])
    expect(ids(crit({ dates: { lastFollowup: { ...upTo14DaysAgoOrNone, includeNoDate: false } } }))).toEqual([2])
  })

  it('never opens the completion gate', () => {
    expect(admitsCompleted(crit({ dates: { lastFollowup: { match: 'set' } } }))).toBe(false)
  })
})

describe('Completed', () => {
  it('is a range only: Has a date / No date and "also no date" are not kept', () => {
    expect(isOptionalDateField('completed')).toBe(false)
    expect(normalizeDateFilters({ completed: { match: 'set' } })).toEqual({})
    expect(normalizeDateFilters({ completed: { match: 'unset' } })).toEqual({})
    expect(normalizeDateFilters({ completed: { ...thisWeek, includeNoDate: true } })).toEqual({ completed: thisWeek })
  })

  it('compares by local day, and an open task never has the date (not even a stale one)', () => {
    expect(matchesDateMatch(todos[3]!, 'completed', { match: 'range', start: { kind: 'fixed', iso: at(2, 0).toISOString() }, end: { kind: 'fixed', iso: at(2, 0).toISOString() } }, today, 1)).toBe(true)
    expect(matchesDateMatch(todos[6]!, 'completed', thisWeek, today, 1)).toBe(false)
  })

  it('a range lets completed tasks through without Show completed, keeping only those completed in it', () => {
    expect(admitsCompleted(crit({ dates: { completed: thisWeek } }))).toBe(true)
    expect(ids(crit({ dates: { completed: thisWeek } }))).toEqual([4, 6])
    expect(ids(crit({ dates: { completed: todayOnly } }))).toEqual([6])
    // With Show completed on, the same.
    expect(ids(crit({ showCompleted: true, dates: { completed: thisWeek } }))).toEqual([4, 6])
    // Composed with another date type: both must hold.
    expect(ids(crit({ dates: { completed: thisWeek, lastFollowup: { match: 'set' } } }))).toEqual([6])
  })

  it('a range with no end filters nothing and opens nothing', () => {
    const open: DateMatch = { match: 'range', start: null, end: null }
    expect(admitsCompleted(crit({ dates: { completed: open } }))).toBe(false)
    expect(ids(crit({ dates: { completed: open } }))).toEqual([1, 2, 3, 7])
  })

  it('inside an or group it is a plain date clause: it never opens the gate', () => {
    const grouped = crit({ orGroups: [{ ...none(), dates: { completed: thisWeek } }] })
    expect(admitsCompleted(grouped)).toBe(false)
    // Every open task fails the group's only clause; the completed ones are stopped at the gate.
    expect(ids(grouped)).toEqual([])
    // One or group "Completed this week or never followed up": open tasks by the second clause only.
    const either = crit({ orGroups: [{ ...none(), dates: { completed: thisWeek, lastFollowup: { match: 'unset' } } }] })
    expect(ids(either)).toEqual([3, 7])
    // Show completed opens the gate; the group then keeps the ones completed this week.
    expect(ids({ ...grouped, showCompleted: true })).toEqual([4, 6])
  })

  describe('the gate wherever the screen filter applies', () => {
    it('from a list’s own filter, under a screen filter without it', () => {
      const list = crit({ dates: { completed: thisWeek } })
      expect(composedIds(none(), list)).toEqual([4, 6])
      // The chips narrow it further.
      expect(composedIds(crit({ dates: { lastFollowup: { match: 'set' } } }), list)).toEqual([6])
      // Through the stored-predicate evaluator list widgets use.
      const evaluate = createScreenComposedEvaluator(none(), lookups, today, settings())
      const predicate = { ...emptyPredicate(), dates: { completed: thisWeek } }
      expect(todos.filter((t) => evaluate(predicate, t)).map((t) => t.id)).toEqual([4, 6])
    })

    it('from the top bar’s chips, over a list without Show completed', () => {
      expect(composedIds(crit({ dates: { completed: thisWeek } }), none())).toEqual([4, 6])
      const [screenStage, listStage] = composeScreenFilter(crit({ dates: { completed: thisWeek } }), none())
      expect(screenStage.showCompleted && listStage.showCompleted).toBe(true)
    })

    it('from the top bar’s lens (whose Show completed is ignored)', () => {
      const lensed = crit({ lens: crit({ dates: { completed: thisWeek } }) })
      expect(admitsCompleted(lensed)).toBe(true)
      expect(ids(lensed)).toEqual([4, 6])
      expect(composedIds(lensed, crit({ dates: { lastFollowup: { match: 'set' } } }))).toEqual([6])
      // A lens's or group never opens it.
      expect(admitsCompleted(crit({ lens: crit({ orGroups: [{ ...none(), dates: { completed: thisWeek } }] }) }))).toBe(false)
    })

    it('without a Completed range anywhere, completed tasks stay hidden', () => {
      expect(composedIds(crit({ dates: { lastFollowup: { match: 'set' } } }), none())).toEqual([1, 2])
    })
  })
})

describe('stored clauses (pickPredicate)', () => {
  it('keeps both new types in reading order', () => {
    const dates = { modified: thisWeek, completed: thisWeek, lastFollowup: upTo14DaysAgoOrNone, deadline: { match: 'set' } }
    const { predicate, fixes } = pickPredicate(JSON.parse(JSON.stringify({ ...emptyPredicate(), dates })))
    expect(fixes).toEqual([])
    expect(Object.keys(predicate.dates)).toEqual(['deadline', 'lastFollowup', 'completed', 'modified'])
    expect(predicate.dates.lastFollowup).toEqual(upTo14DaysAgoOrNone)
  })

  it('drops Has a date / No date on Completed, and its "or none" (keeping the range), each with a fix', () => {
    expect(pickPredicate({ ...emptyPredicate(), dates: { completed: { match: 'set' } } }))
      .toEqual({ predicate: emptyPredicate(), fixes: ['completed date filter dropped'] })
    expect(pickPredicate({ ...emptyPredicate(), dates: { completed: { match: 'unset' } } }))
      .toEqual({ predicate: emptyPredicate(), fixes: ['completed date filter dropped'] })
    expect(pickPredicate(JSON.parse(JSON.stringify({ ...emptyPredicate(), dates: { completed: { ...thisWeek, includeNoDate: true } } }))))
      .toEqual({ predicate: { ...emptyPredicate(), dates: { completed: thisWeek } }, fixes: ['completed date filter\'s "or none" dropped'] })
  })

  it('an unknown date type is still dropped with a fix', () => {
    expect(pickPredicate({ ...emptyPredicate(), dates: { snoozed: thisWeek } }).fixes).toEqual(['unknown date filter dropped'])
  })
})
