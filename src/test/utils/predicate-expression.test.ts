import { describe, it, expect } from 'vitest'
import { EXPRESSION_NODES_MAX, emptyPredicate, type FilterExpr, type PersistedTodoItem, type Person, type Status, type Tag, type TodoPredicate } from '../../models'
import type { ListDefinition } from '../../models/list-definition'
import { admitsCompleted, predicateToCriteria } from '../../utils/filter-criteria'
import { applyFilter, createPredicateEvaluator } from '../../utils/filter-match'
import { predicateToFilterDefaults } from '../../utils/filter-defaults'
import { describeFilters, hasNarrowingFilters, predicateLineItems } from '../../utils/filter-chips'
import { predicatesEqual } from '../../utils/list-def-equal'
import { checkinFilterOf, hasCompletedDateClause } from '../../utils/checkin-settings'
import { filterReferences } from '../../utils/unused-entities'
import { paneWrites } from '../../utils/eisenhower-panes'
import { asExpression, asGraphical, topLevelPredicate, withExpression } from '../../utils/predicate-expression'
import { pickPredicate } from '../../data/predicate-shape'
import { applyRuntimeFilter, groupRestrictions } from '../../services/build-list'
import { currentFilterSettings } from '../../stores/settings-store'
import type { TodoNameLookups } from '../../utils/filter'
import { makeTodo, lookupsFor } from '../helpers'

const today = new Date(2026, 9, 14)

const ann: Person = { id: 1, name: 'Ann', initials: 'A' }
const bob: Person = { id: 2, name: 'Bob', initials: 'B' }
const work: Tag = { id: 1, name: 'work', color: '#36c' }
const assigned: Status = { id: 1, name: 'Assigned', color: '#0a0', sortOrder: 0 }
const waiting: Status = { id: 2, name: 'Waiting', color: '#aa0', sortOrder: 1 }

/**
 * 1 focus · Ann · Assigned · next follow-up · "budget"
 * 2 important + urgent · Bob · work
 * 3 focus · Assigned (no follow-up)
 * 4 important only · Waiting
 * 5 completed focus, completed 10/13
 */
const todos: PersistedTodoItem[] = [
  makeTodo({ id: 1, title: 'budget plan', focus: true, statusId: 1, nextFollowupAt: new Date(2026, 9, 20) }),
  makeTodo({ id: 2, title: 'two', important: true, urgent: true }),
  makeTodo({ id: 3, title: 'three', focus: true, statusId: 1 }),
  makeTodo({ id: 4, title: 'four', important: true, statusId: 2 }),
  makeTodo({ id: 5, title: 'five', focus: true, isCompleted: true, completedAt: new Date(2026, 9, 13) }),
]
const lookups: TodoNameLookups = lookupsFor({
  assignedPeopleMap: new Map([[1, [ann]], [2, [bob]]]),
  assignedTagsMap: new Map([[2, [work]]]),
  statusesById: new Map([[1, assigned], [2, waiting]]),
})
const names = { people: [ann, bob], tags: [work], statuses: [assigned, waiting] }

const expr = (e: FilterExpr, patch: Partial<TodoPredicate> = {}): TodoPredicate => ({ ...emptyPredicate(), expression: e, ...patch })
const ids = (p: TodoPredicate) => applyFilter(predicateToCriteria(p), todos, lookups, today, currentFilterSettings()).map((t) => t.id)

/** (Focus OR (Important AND Urgent)) AND NOT (Assigned AND has a next follow-up). */
const RULE: FilterExpr = {
  kind: 'and',
  items: [
    { kind: 'or', items: [{ kind: 'priority', value: 'focus' }, { kind: 'and', items: [{ kind: 'priority', value: 'important' }, { kind: 'priority', value: 'urgent' }] }] },
    { kind: 'not', item: { kind: 'and', items: [{ kind: 'status', id: 1 }, { kind: 'date', field: 'followup', match: { match: 'set' } }] } },
  ],
}

describe('matching an expression', () => {
  it('keeps what the user’s rule says, as its hand-written rewrite does', () => {
    expect(ids(expr(RULE))).toEqual([2, 3])
    // Its hand-written rewrite, distributed and by De Morgan: (F or I) and (F or U) and (not Assigned or no followup).
    const rewritten: FilterExpr = { kind: 'and', items: [
      { kind: 'or', items: [{ kind: 'priority', value: 'focus' }, { kind: 'priority', value: 'important' }] },
      { kind: 'or', items: [{ kind: 'priority', value: 'focus' }, { kind: 'priority', value: 'urgent' }] },
      { kind: 'or', items: [{ kind: 'not', item: { kind: 'status', id: 1 } }, { kind: 'date', field: 'followup', match: { match: 'unset' } }] },
    ] }
    expect(ids(expr(rewritten))).toEqual([2, 3])
  })

  it('reads each atom as its chip does', () => {
    expect(ids(expr({ kind: 'person', id: 1 }))).toEqual([1])
    expect(ids(expr({ kind: 'person', id: 0 }))).toEqual([3, 4])
    expect(ids(expr({ kind: 'not', item: { kind: 'tag', id: 0 } }))).toEqual([2])
    expect(ids(expr({ kind: 'status', id: 0 }))).toEqual([2])
    expect(ids(expr({ kind: 'priority', value: 'none' }))).toEqual([])
    expect(ids(expr({ kind: 'text', text: 'BUDGET' }))).toEqual([1])
    expect(ids(expr({ kind: 'date', field: 'followup', match: { match: 'set' } }))).toEqual([1])
  })

  it('keeps open tasks unless done, or a top-level Completed range, lets completed ones through', () => {
    const focus: FilterExpr = { kind: 'priority', value: 'focus' }
    expect(ids(expr(focus))).toEqual([1, 3])
    expect(ids(expr(focus, { showCompleted: true }))).toEqual([1, 3, 5])
    const doneYesterday: FilterExpr = { kind: 'date', field: 'completed', match: { match: 'range', start: { kind: 'relative', token: 'yesterday' }, end: { kind: 'relative', token: 'yesterday' } } }
    expect(ids(expr({ kind: 'and', items: [focus, doneYesterday] }))).toEqual([5])
    expect(admitsCompleted(predicateToCriteria(expr(doneYesterday)))).toBe(true)
    // Inside an or it doesn't open the gate (as in an or group with other alternatives).
    expect(admitsCompleted(predicateToCriteria(expr({ kind: 'or', items: [focus, doneYesterday] })))).toBe(false)
  })

  it('composes under a stored list evaluator', () => {
    const evaluate = createPredicateEvaluator(lookups, today, currentFilterSettings())
    expect(todos.filter((t) => evaluate(expr(RULE), t)).map((t) => t.id)).toEqual([2, 3])
  })
})

describe('reading a stored expression', () => {
  it('keeps a well-formed one in normal form', () => {
    const { predicate, fixes } = pickPredicate(expr({ kind: 'and', items: [{ kind: 'and', items: [{ kind: 'person', id: 1 }] }, { kind: 'not', item: { kind: 'not', item: { kind: 'tag', id: 1 } } }] }))
    expect(fixes).toEqual([])
    expect(predicate.expression).toEqual({ kind: 'and', items: [{ kind: 'person', id: 1 }, { kind: 'tag', id: 1 }] })
  })

  it('drops one it can’t read, whole', () => {
    const { predicate, fixes } = pickPredicate({ ...emptyPredicate(), expression: { kind: 'and', items: [{ kind: 'person', id: 1 }, { kind: 'colour', id: 2 }] } })
    expect(predicate.expression).toBeUndefined()
    expect(fixes).toEqual(['expression dropped'])
  })

  it('turns a date atom’s is not / or none into not / or nodes', () => {
    const range = { match: 'range' as const, start: { kind: 'relative' as const, token: 'today' as const }, end: null }
    const { predicate } = pickPredicate({ ...emptyPredicate(), expression: { kind: 'date', field: 'deadline', match: { ...range, includeNoDate: true } } })
    expect(predicate.expression).toEqual({ kind: 'or', items: [{ kind: 'date', field: 'deadline', match: range }, { kind: 'date', field: 'deadline', match: { match: 'unset' } }] })
  })

  it('folds clauses and or groups beside it into it', () => {
    const { predicate } = pickPredicate({
      ...emptyPredicate(),
      personIds: [1],
      orGroups: [{ ...emptyPredicate(), statusIds: [2], tags: [1] }],
      expression: { kind: 'priority', value: 'focus' },
    })
    expect(predicate.personIds).toBeNull()
    expect('orGroups' in predicate).toBe(false)
    expect(predicate.expression).toEqual({
      kind: 'and',
      items: [{ kind: 'person', id: 1 }, { kind: 'or', items: [{ kind: 'tag', id: 1 }, { kind: 'status', id: 2 }] }, { kind: 'priority', value: 'focus' }],
    })
  })
})

describe('the readers of the top level', () => {
  const mixed = expr({ kind: 'and', items: [{ kind: 'person', id: 1 }, { kind: 'status', id: 2 }, { kind: 'priority', value: 'urgent' }, { kind: 'or', items: [{ kind: 'tag', id: 1 }, { kind: 'person', id: 2 }] }] })

  it('seed a new task from the top-level chips only', () => {
    expect(predicateToFilterDefaults(mixed)).toEqual({ personIds: [1], tagIds: [], statusId: 2, markers: { urgent: true } })
    expect(topLevelPredicate(mixed).expression).toBeUndefined()
  })

  it('a Prompt for pick joins as one more term', () => {
    const picked = applyRuntimeFilter(expr({ kind: 'priority', value: 'focus' }), { field: 'person' }, [1, 2])
    expect(picked.expression).toEqual({ kind: 'and', items: [{ kind: 'priority', value: 'focus' }, { kind: 'or', items: [{ kind: 'person', id: 1 }, { kind: 'person', id: 2 }] }] })
  })

  it('narrow People groups by the top-level person pick, its own and its lens’s', () => {
    expect(groupRestrictions('personIds', mixed, undefined)).toEqual([[1]])
    const lens = predicateToCriteria(expr({ kind: 'and', items: [{ kind: 'person', id: 2 }, { kind: 'priority', value: 'focus' }] }))
    expect(groupRestrictions('personIds', undefined, { ...predicateToCriteria(emptyPredicate()), lens })).toEqual([[2]])
  })

  it('write a pane drop from the top-level chips', () => {
    expect(paneWrites(mixed, names)).toMatchObject({ statusId: 2, personId: 1, markers: { urgent: true } })
  })
})

describe('an expression elsewhere', () => {
  it('reads as one line item, its text', () => {
    const items = predicateLineItems(expr(RULE), names)
    expect(items).toEqual([{ kind: 'expression', text: '(/focus or (/important and /urgent)) and not (!Assigned and followup any)' }])
    expect(describeFilters(items)).toBe('(/focus or (/important and /urgent)) and not (!Assigned and followup any)')
    expect(hasNarrowingFilters(expr(RULE))).toBe(true)
  })

  it('compares by its normal form', () => {
    expect(predicatesEqual(expr({ kind: 'and', items: [{ kind: 'person', id: 1 }] }), expr({ kind: 'person', id: 1 }))).toBe(true)
    expect(predicatesEqual(expr({ kind: 'person', id: 1 }), expr({ kind: 'person', id: 2 }))).toBe(false)
  })

  it('names the people and tags it filters by', () => {
    const list = { id: 1, name: 'L', membership: { kind: 'custom', predicate: expr({ kind: 'or', items: [{ kind: 'person', id: 2 }, { kind: 'tag', id: 1 }] }) } } as unknown as ListDefinition
    const refs = filterReferences({ lists: [list], panes: {}, checkinFilter: emptyPredicate() }, 'person')
    expect([...refs.keys()]).toEqual([2])
  })

  it('a check-in drops its terms that name a person or a Completed date', () => {
    const filter = expr({ kind: 'and', items: [
      { kind: 'priority', value: 'focus' },
      { kind: 'or', items: [{ kind: 'person', id: 1 }, { kind: 'tag', id: 1 }] },
      { kind: 'date', field: 'completed', match: { match: 'range', start: null, end: { kind: 'relative', token: 'today' } } },
    ] }, { showCompleted: true })
    expect(hasCompletedDateClause(filter)).toBe(true)
    expect(checkinFilterOf(filter)).toEqual(expr({ kind: 'priority', value: 'focus' }))
  })

  it('switches Graphical ↔ Expression', () => {
    const graphical: TodoPredicate = { ...emptyPredicate(), personIds: [1], statusIds: [2], negate: { statusIds: true }, showCompleted: true }
    const asExpr = asExpression(graphical)
    if (!asExpr) throw new Error('refused')
    expect(asExpr.personIds).toBeNull()
    expect(asExpr.showCompleted).toBe(true)
    expect(asExpr.expression).toEqual({ kind: 'and', items: [{ kind: 'person', id: 1 }, { kind: 'not', item: { kind: 'status', id: 2 } }] })
    expect(predicatesEqual(asGraphical(asExpr) ?? emptyPredicate(), graphical)).toBe(true)
    expect(asGraphical(expr(RULE))).toBeNull()
    expect(withExpression(graphical, null).expression).toBeUndefined()
    expect(asExpression(emptyPredicate())?.expression).toBeUndefined()
  })

  it('refuses a switch past the expression cap, and writes one at the cap (cr33 M1)', () => {
    // An or of n tags is n + 1 nodes.
    const tags = (n: number): TodoPredicate => ({ ...emptyPredicate(), tags: Array.from({ length: n }, (_, i) => i + 1) })
    expect(asExpression(tags(EXPRESSION_NODES_MAX - 1))?.expression).toBeDefined()
    expect(asExpression(tags(EXPRESSION_NODES_MAX))).toBeNull()
    // 250 tags — past the old cap of 200 — switch, and the written filter reads back whole.
    const written = asExpression(tags(250))
    if (!written) throw new Error('refused')
    const read = pickPredicate(JSON.parse(JSON.stringify(written)))
    expect(read.fixes).toEqual([])
    expect(read.predicate.expression).toEqual(written.expression)
  })
})
