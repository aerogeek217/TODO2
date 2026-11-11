import { describe, it, expect, beforeEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { reviewFilterPredicate, useReviewWidgetQueue } from '../../hooks/use-review-widget-queue'
import { WidgetLensContext } from '../../hooks/use-widget-lens'
import { emptyPredicate, type FilterExpr, type Person, type Status, type Tag } from '../../models'
import type { ReviewFilter } from '../../stores/list-widget-store'
import { usePersonStore } from '../../stores/person-store'
import { useSettingsStore } from '../../stores/settings-store'
import { useStatusStore } from '../../stores/status-store'
import { useTagStore } from '../../stores/tag-store'
import { useTodoStore } from '../../stores/todo-store'
import { useUIStore } from '../../stores/ui-store'
import { clearFilterStore, makeTodo, patchScreenFilter, resetEntityStores } from '../helpers'

/**
 * A Review widget's queue (widget feedback 2A): the open tasks its filter —
 * an expression — keeps, in `sortOrder`, under the screen filter and the
 * widget's lens switch, with what the lens hides there.
 */

const aisha: Person = { id: 1, name: 'Aisha', initials: 'A' }
const ben: Person = { id: 2, name: 'Ben', initials: 'B' }
const cy: Person = { id: 3, name: 'Cy', initials: 'C' }
const legal: Tag = { id: 1, name: 'legal', color: '#7ec4bc' }
const q4: Tag = { id: 2, name: 'q4', color: '#c8743a' }
const waiting: Status = { id: 1, name: 'Waiting', color: '#4caf50', sortOrder: 1 }
const blocked: Status = { id: 2, name: 'Blocked', color: '#e06c75', sortOrder: 2 }

const LENS = { id: 'lens-q4', name: 'Q4', predicate: { ...emptyPredicate(), tags: [2] } }

const person = (id: number): FilterExpr => ({ kind: 'person', id })
const tag = (id: number): FilterExpr => ({ kind: 'tag', id })
const status = (id: number): FilterExpr => ({ kind: 'status', id })
const or = (...items: FilterExpr[]): FilterExpr => ({ kind: 'or', items })
const and = (...items: FilterExpr[]): FilterExpr => ({ kind: 'and', items })
const f = (expression: FilterExpr): ReviewFilter => ({ expression, showCompleted: false })

beforeEach(() => {
  resetEntityStores()
  clearFilterStore()
  useSettingsStore.setState({ lenses: [LENS], activeLensId: null })
  useUIStore.setState({ lensLifted: false })
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

/** The queue of `filter` — in a widget that ignores the top bar's lens with `ignoreLens`. */
function queueOf(filter: ReviewFilter | null, ignoreLens = false) {
  const wrapper = ({ children }: { children: ReactNode }) => <WidgetLensContext.Provider value={ignoreLens}>{children}</WidgetLensContext.Provider>
  return renderHook(({ value }) => useReviewWidgetQueue(value), { initialProps: { value: filter }, wrapper })
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
    expect(result.current).toEqual({ ids: [], dividers: [], hides: 0 })
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
    expect(both.dividers).toEqual([])
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

  it('the top bar’s lens narrows it, with what it hides; a widget that ignores the lens keeps every task and still says what it would hide', () => {
    useSettingsStore.setState({ activeLensId: 'lens-q4' })
    const lensed = queueOf(f(or(person(1), person(2)))).result.current
    expect(lensed.ids).toEqual([2, 4])
    expect(lensed.hides).toBe(2)
    const ignoring = queueOf(f(or(person(1), person(2))), true).result.current
    expect(ignoring.ids).toEqual([1, 2, 3, 4])
    expect(ignoring.hides).toBe(2)
  })
})
