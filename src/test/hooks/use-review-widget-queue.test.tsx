import { describe, it, expect, beforeEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { reviewFilterPredicate, useReviewWidgetQueue } from '../../hooks/use-review-widget-queue'
import { emptyPredicate, type FilterExpr, type Person, type Status, type Tag } from '../../models'
import type { ReviewFilter } from '../../stores/list-widget-store'
import { usePersonStore } from '../../stores/person-store'
import { useSettingsStore } from '../../stores/settings-store'
import { useStatusStore } from '../../stores/status-store'
import { useTagStore } from '../../stores/tag-store'
import { useTodoStore } from '../../stores/todo-store'
import { clearFilterStore, makeTodo, patchScreenFilter, resetEntityStores } from '../helpers'

/**
 * A Review widget's queue (widget feedback 2A): the open tasks its filter —
 * an expression — keeps, in `sortOrder`, under the screen filter.
 */

const aisha: Person = { id: 1, name: 'Aisha', initials: 'A' }
const ben: Person = { id: 2, name: 'Ben', initials: 'B' }
const cy: Person = { id: 3, name: 'Cy', initials: 'C' }
const legal: Tag = { id: 1, name: 'legal', color: '#7ec4bc' }
const q4: Tag = { id: 2, name: 'q4', color: '#c8743a' }
const waiting: Status = { id: 1, name: 'Waiting', color: '#4caf50', sortOrder: 1 }
const blocked: Status = { id: 2, name: 'Blocked', color: '#e06c75', sortOrder: 2 }

const person = (id: number): FilterExpr => ({ kind: 'person', id })
const tag = (id: number): FilterExpr => ({ kind: 'tag', id })
const status = (id: number): FilterExpr => ({ kind: 'status', id })
const or = (...items: FilterExpr[]): FilterExpr => ({ kind: 'or', items })
const and = (...items: FilterExpr[]): FilterExpr => ({ kind: 'and', items })
const f = (expression: FilterExpr): ReviewFilter => ({ expression, showCompleted: false })

beforeEach(() => {
  resetEntityStores()
  clearFilterStore()
  useTodoStore.setState({
    todos: [
      // Out of `sortOrder` on purpose: the queue sorts.
      makeTodo({ id: 4, title: 'Ben’s own', sortOrder: 4, statusId: 1 }),
      makeTodo({ id: 1, title: 'Vendor contract', sortOrder: 1, statusId: 1 }),
      makeTodo({ id: 2, title: 'Headcount plan', sortOrder: 2, statusId: 2 }),
      makeTodo({ id: 3, title: 'Onboarding', sortOrder: 3 }),
      makeTodo({ id: 5, title: 'Done already', sortOrder: 5, isCompleted: true, statusId: 1 }),
      makeTodo({ id: 6, title: 'Cy’s', sortOrder: 6 }),
    ],
  })
  usePersonStore.setState({
    people: [aisha, ben, cy],
    assignedPeopleMap: new Map([[1, [aisha]], [2, [aisha]], [3, [aisha, ben]], [4, [ben]], [5, [aisha]], [6, [cy]]]),
  })
  useTagStore.setState({ tags: [legal, q4], assignedTagsMap: new Map([[1, [legal]], [2, [q4]], [4, [legal, q4]], [5, [legal]]]) })
  useStatusStore.setState({ statuses: [waiting, blocked] })
})

/** The queue of `filter`. */
function queueOf(filter: ReviewFilter | null) {
  return renderHook(({ value }) => useReviewWidgetQueue(value), { initialProps: { value: filter } })
}

describe('reviewFilterPredicate', () => {
  it('the expression as a predicate, its `done` kept', () => {
    expect(reviewFilterPredicate(f(person(1)))).toEqual({ ...emptyPredicate(), expression: person(1) })
    expect(reviewFilterPredicate({ expression: tag(2), showCompleted: true })).toEqual({ ...emptyPredicate(), showCompleted: true, expression: tag(2) })
  })
})

describe('useReviewWidgetQueue', () => {
  it('no filter: an empty queue, the same one each time', () => {
    const { result, rerender } = queueOf(null)
    expect(result.current).toEqual({ ids: [] })
    const first = result.current
    rerender({ value: null })
    expect(result.current).toBe(first)
  })

  it('people: the open tasks the filter keeps, each once, in sortOrder', () => {
    expect(queueOf(f(person(1))).result.current.ids).toEqual([1, 2, 3])
    expect(queueOf(f(person(2))).result.current.ids).toEqual([3, 4])
    // Task 3 is both Aisha's and Ben's: once. The completed task 5 is no one's to review.
    const both = queueOf(f(or(person(2), person(1)))).result.current
    expect(both.ids).toEqual([1, 2, 3, 4])
  })

  it('any expression: tags, statuses, and / not', () => {
    expect(queueOf(f(or(tag(1), tag(2)))).result.current.ids).toEqual([1, 2, 4])
    expect(queueOf(f(status(1))).result.current.ids).toEqual([1, 4])
    expect(queueOf(f(and(person(1), status(2)))).result.current.ids).toEqual([2])
    expect(queueOf(f(and(person(1), { kind: 'not', item: tag(1) }))).result.current.ids).toEqual([2, 3])
  })

  it('done in the filter still reviews open tasks only', () => {
    expect(queueOf({ expression: status(1), showCompleted: true }).result.current.ids).toEqual([1, 4])
  })

  it('stays current: a task leaving the filter leaves the queue', () => {
    const { result } = queueOf(f(or(person(1), person(2))))
    act(() => { usePersonStore.setState({ assignedPeopleMap: new Map([[1, [aisha]], [4, [cy]]]) }) })
    expect(result.current.ids).toEqual([1])
  })

  it('the screen filter’s chips narrow it', () => {
    const { result } = queueOf(f(or(person(1), person(2))))
    act(() => { patchScreenFilter({ tags: new Set([1]) }) })
    expect(result.current.ids).toEqual([1, 4])
  })
})

describe('the filter words that read Settings, live', () => {
  const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000)
  const inDays = (n: number) => new Date(Date.now() + n * 86_400_000)

  beforeEach(() => {
    useTodoStore.setState({
      todos: [
        makeTodo({ id: 1, title: 'Old, due soon', sortOrder: 1, modifiedAt: daysAgo(20), dueDate: inDays(2) }),
        makeTodo({ id: 2, title: 'Old, follow-up late', sortOrder: 2, modifiedAt: daysAgo(40), nextFollowupAt: daysAgo(1) }),
        makeTodo({ id: 3, title: 'Fresh, due soon', sortOrder: 3, modifiedAt: daysAgo(1), dueDate: inDays(1) }),
        makeTodo({ id: 4, title: 'Old, due later', sortOrder: 4, modifiedAt: daysAgo(40), dueDate: inDays(20) }),
      ],
    })
  })

  // Slipping, as the Neglect map's Review writes it.
  const slipping: ReviewFilter = f(and(or({ kind: 'soon', field: 'deadline' }, { kind: 'soon', field: 'followup' }), { kind: 'stale' }))

  it('a Stale after or due-soon change re-runs the queue at once', async () => {
    await act(() => useSettingsStore.getState().setStaleAfterDays(30))
    await act(() => useSettingsStore.getState().setUrgentDueWithinDays(3))
    const { result } = queueOf(slipping)
    expect(result.current.ids).toEqual([2])
    await act(() => useSettingsStore.getState().setStaleAfterDays(14))
    expect(result.current.ids).toEqual([1, 2])
    await act(() => useSettingsStore.getState().setUrgentDueWithinDays(null))
    expect(result.current.ids).toEqual([2])
  })

  it('Stale after 0 (off): `stale` keeps nothing', async () => {
    await act(() => useSettingsStore.getState().setStaleAfterDays(0))
    expect(queueOf(slipping).result.current.ids).toEqual([])
    expect(queueOf(f({ kind: 'not', item: { kind: 'stale' } })).result.current.ids).toEqual([1, 2, 3, 4])
  })
})
