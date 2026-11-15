import { describe, expect, it } from 'vitest'
import type { FilterExpr, PersistedTodoItem, Person, Tag } from '../../models'
import { emptyPredicate } from '../../models'
import { groupRestrictions } from '../../services/build-list'
import { screenReviewFilter } from '../../services/review'
import { fieldFilter, screenFilterOf, useFilterStore } from '../../stores/filter-store'
import { currentFilterSettings } from '../../stores/settings-store'
import { countActiveFilters, predicateToCriteria } from '../../utils/filter-criteria'
import { getFilterDefaults } from '../../utils/filter-defaults'
import { matchesComposedFilter } from '../../utils/filter-match'
import type { TodoNameLookups } from '../../utils/filter'
import { lookupsFor, makeTodo } from '../helpers'

// The top bar's typed filter (feedback P2): a typed expression is split into
// the chips it can say and an expression held beside them, ANDed.

const alice: Person = { id: 1, name: 'Alice', initials: 'A' }
const bob: Person = { id: 2, name: 'Bob', initials: 'B' }
const work: Tag = { id: 1, name: 'work', color: '#36c' }
const home: Tag = { id: 2, name: 'home', color: '#c84' }

const A: FilterExpr = { kind: 'person', id: 1 }
const B: FilterExpr = { kind: 'person', id: 2 }
const WORK: FilterExpr = { kind: 'tag', id: 1 }
const HOME: FilterExpr = { kind: 'tag', id: 2 }
const and = (...items: FilterExpr[]): FilterExpr => ({ kind: 'and', items })
const or = (...items: FilterExpr[]): FilterExpr => ({ kind: 'or', items })

const todos: PersistedTodoItem[] = [
  makeTodo({ id: 1, title: 'Alice work' }),
  makeTodo({ id: 2, title: 'Bob home' }),
  makeTodo({ id: 3, title: 'Alice home' }),
  makeTodo({ id: 4, title: 'Nobody' }),
  makeTodo({ id: 5, title: 'Bob work done', isCompleted: true }),
]
const lookups: TodoNameLookups = lookupsFor({
  assignedPeopleMap: new Map([[1, [alice]], [2, [bob]], [3, [alice]], [5, [bob]]]),
  assignedTagsMap: new Map([[1, [work]], [2, [home]], [3, [home]], [5, [work]]]),
})
const today = new Date(2026, 10, 15)
const none = () => predicateToCriteria(emptyPredicate())
const shown = () => todos
  .filter((t) => matchesComposedFilter(useFilterStore.getState().filters, none(), t, lookups, today, currentFilterSettings()))
  .map((t) => t.id)

describe('the top bar’s typed filter — chips and an expression', () => {
  it('makes chips of an and of one value per kind, holding no expression', () => {
    const f = screenFilterOf(and(or(A, B), WORK), false)
    expect([...(f.personIds ?? [])]).toEqual([1, 2])
    expect([...(f.tags ?? [])]).toEqual([1])
    expect(f.expression).toBeUndefined()
  })

  it('holds what no chip says as an expression beside the chips', () => {
    const f = screenFilterOf(and(WORK, or(A, HOME)), true)
    expect([...(f.tags ?? [])]).toEqual([1])
    expect(f.personIds).toBeNull()
    expect(f.expression).toEqual(or(A, HOME))
    expect(f.showCompleted).toBe(true)
    // A second term of a field that has its chip already: the expression too.
    const g = screenFilterOf(and(A, B), false)
    expect([...(g.personIds ?? [])]).toEqual([1])
    expect(g.expression).toEqual(B)
  })

  it('narrows every screen-filtered task by the chips and the expression together', () => {
    useFilterStore.getState().applyExpression(or(A, HOME), false)
    expect(shown()).toEqual([1, 2, 3])
    useFilterStore.getState().applyExpression(and(or(A, HOME), { kind: 'not', item: WORK }), false)
    expect(shown()).toEqual([2, 3])
    useFilterStore.getState().applyExpression(or(B, HOME), true)
    expect(shown()).toEqual([2, 3, 5])
    expect(useFilterStore.getState().isActive).toBe(true)
    expect(countActiveFilters(useFilterStore.getState().filters)).toBe(2)
  })

  it('shows the filter as typed while it is the store’s, else the chips then the expression', () => {
    useFilterStore.getState().applyExpression(and(or(A, HOME), WORK), false)
    const s = useFilterStore.getState()
    expect(fieldFilter(s.filters, s.typed)).toEqual({ expression: and(or(A, HOME), WORK), showCompleted: false })
    // A picker's change: the store's own order.
    s.setShowCompleted(true)
    const t = useFilterStore.getState()
    expect(fieldFilter(t.filters, t.typed)).toEqual({ expression: and(WORK, or(A, HOME)), showCompleted: true })
  })

  it('clears the expression with every chip (Clear all, the funnel)', () => {
    useFilterStore.getState().applyExpression(and(or(A, HOME), WORK), true)
    useFilterStore.getState().clearAll()
    const s = useFilterStore.getState()
    expect(s.filters.expression).toBeUndefined()
    expect(s.isActive).toBe(false)
    expect(s.typed).toBeNull()
    expect(shown()).toEqual([1, 2, 3, 4])
  })

  it('sends the chips and the expression to a review, and narrows groups by their top-level picks only', () => {
    useFilterStore.getState().applyExpression(and(WORK, or(A, B)), false)
    expect(screenReviewFilter().expression).toEqual(and(WORK, or(A, B)))
    useFilterStore.getState().applyExpression(and(A, B), false)
    // The expression's top-level @B and the chip (@A): two picks.
    expect(groupRestrictions('personIds', undefined, useFilterStore.getState().filters)).toEqual([[2], [1]])
    useFilterStore.getState().applyExpression(and(WORK, or(A, HOME)), false)
    expect(groupRestrictions('personIds', undefined, useFilterStore.getState().filters)).toEqual([])
  })

  it('seeds a new task from the chips and the expression’s top-level picks, not its or', () => {
    useFilterStore.getState().applyExpression(and(A, B, or(WORK, A)), false)
    expect(getFilterDefaults(useFilterStore.getState().filters)).toMatchObject({ personIds: [1, 2], tagIds: [] })
  })
})
