import { describe, it, expect } from 'vitest'
import type { PersistedTodoItem } from '../../models'
import { joinOrder, keepPlace, reviewOrder, setReviewQueue, setReviewSort, type ReviewOrderEnv } from '../../services/review-queue'
import { createReviewSession } from '../../stores/review-session'
import { addDays, startOfToday } from '../../utils/date'
import { makeTodo } from '../helpers'

/**
 * The review's queue and stepping (D26, items 7 and 12): the rail's sorts,
 * the place kept when the queue changes, and a live queue's current task
 * staying until the review moves on.
 */

const today = startOfToday()
const day = (n: number) => addDays(today, n)

function envOf(todos: PersistedTodoItem[]): ReviewOrderEnv {
  return { todoById: new Map(todos.map((t) => [t.id, t])), today, urgentRange: null }
}

// Queue order 1..5; each sort keys on its own field.
const TODOS = [
  makeTodo({ id: 1, title: 'Delta', dueDate: day(3), nextFollowupAt: day(1), lastFollowupAt: day(-2) }),
  makeTodo({ id: 2, title: 'alpha', dueDate: day(1), lastFollowupAt: day(-10), important: true }),
  makeTodo({ id: 3, title: 'Charlie', nextFollowupAt: day(-1), focus: true }),
  makeTodo({ id: 4, title: 'Bravo', dueDate: day(1), nextFollowupAt: day(1), urgent: true, important: true }),
  makeTodo({ id: 5, title: 'Echo', lastFollowupAt: day(-5), urgent: true }),
]
const IDS = [1, 2, 3, 4, 5]

describe('reviewOrder (item 7)', () => {
  const env = envOf(TODOS)

  it('Queue order: the queue as given', () => {
    expect(reviewOrder(IDS, 'queue', env)).toEqual(IDS)
  })

  it('Due and Next follow-up: soonest first, none last, ties in queue order', () => {
    expect(reviewOrder(IDS, 'due', env)).toEqual([2, 4, 1, 3, 5])
    expect(reviewOrder(IDS, 'next', env)).toEqual([3, 1, 4, 2, 5])
  })

  it('Last follow-up: oldest first, never followed up last', () => {
    expect(reviewOrder(IDS, 'last', env)).toEqual([2, 5, 1, 3, 4])
  })

  it('Priority: Focus, Urgent + Important, Urgent, Important, none', () => {
    expect(reviewOrder(IDS, 'priority', env)).toEqual([3, 4, 5, 2, 1])
  })

  it('Title: A–Z, case aside', () => {
    expect(reviewOrder(IDS, 'title', env)).toEqual([2, 4, 3, 1, 5])
  })

  it('a task not loaded keeps its place at the end', () => {
    expect(reviewOrder([9, ...IDS], 'title', env)).toEqual([2, 4, 3, 1, 5, 9])
  })
})

describe('keepPlace', () => {
  const old = { order: [1, 2, 3, 4], index: 1 }

  it('on the current task while it is still there', () => {
    expect(keepPlace(old, [4, 2, 1])).toEqual({ order: [4, 2, 1], index: 1 })
  })

  it('the current task gone: the one after it in the old order that is still there, else the one before', () => {
    expect(keepPlace(old, [1, 4, 3])).toEqual({ order: [1, 4, 3], index: 2 })
    expect(keepPlace({ order: [1, 2, 3], index: 2 }, [1, 2])).toEqual({ order: [1, 2], index: 1 })
    expect(keepPlace(old, [])).toEqual({ order: [], index: 0 })
  })

  it('a live queue keeps a current task that left it, at its place, while the task exists', () => {
    expect(keepPlace(old, [1, 3, 4], { keepCurrent: true, exists: () => true })).toEqual({ order: [1, 2, 3, 4], index: 1 })
    expect(keepPlace(old, [], { keepCurrent: true, exists: () => true })).toEqual({ order: [2], index: 0 })
    // Deleted: no longer kept.
    expect(keepPlace(old, [1, 3, 4], { keepCurrent: true, exists: () => false })).toEqual({ order: [1, 3, 4], index: 1 })
  })
})

describe('a session', () => {
  it('sorting keeps the current task current; Back and Skip step in the order shown', () => {
    const session = createReviewSession({ ids: IDS, order: IDS, index: 3 })
    setReviewSort(session, 'title', envOf(TODOS))
    expect(session.getState()).toMatchObject({ sort: 'title', order: [2, 4, 3, 1, 5], index: 1 })
    session.getState().skip()
    expect(session.getState().order[session.getState().index]).toBe(3)
    expect(session.getState().marks).toEqual({ 4: 'skipped' })
    session.getState().back()
    expect(session.getState().order[session.getState().index]).toBe(4)
    setReviewSort(session, 'queue', envOf(TODOS))
    expect(session.getState()).toMatchObject({ order: IDS, index: 3 })
  })

  it('a live queue: a task leaving it leaves the rail; the current one stays until the review moves on', () => {
    const session = createReviewSession({ ids: [1, 2, 3], order: [1, 2, 3], index: 1 })
    const env = envOf(TODOS)
    setReviewQueue(session, { ids: [1, 3] }, { keepCurrent: true, env })
    expect(session.getState()).toMatchObject({ ids: [1, 3], order: [1, 2, 3], index: 1 })
    session.getState().next()
    expect(session.getState()).toMatchObject({ order: [1, 3], index: 1 })
  })

  it('a new task in a live queue takes its sorted place, the current card staying', () => {
    const session = createReviewSession({ ids: [1, 3], order: [3, 1], sort: 'next', index: 1 })
    setReviewQueue(session, { ids: [1, 3, 4] }, { keepCurrent: true, env: envOf(TODOS) })
    expect(session.getState()).toMatchObject({ order: [3, 1, 4], index: 1 })
  })

  it('a new review’s first queue comes in sorted', () => {
    const session = createReviewSession({ sort: 'title' })
    setReviewQueue(session, { ids: IDS }, { env: envOf(TODOS) })
    expect(session.getState()).toMatchObject({ ids: IDS, order: [2, 4, 3, 1, 5], index: 0 })
  })

  it('the order is taken when the sort is picked: a card edited since keeps its place when the queue’s members change (F3)', () => {
    // Sorted by due date: 2, 4, 1, 3, 5 — on the first card.
    const session = createReviewSession({ sort: 'due' })
    setReviewQueue(session, { ids: IDS }, { env: envOf(TODOS) })
    expect(session.getState()).toMatchObject({ order: [2, 4, 1, 3, 5], index: 0 })
    // The current card's due date is moved after every other task's (an edit on the card: the rail stays).
    const edited = TODOS.map((t) => (t.id === 2 ? { ...t, dueDate: day(30) } : t))
    // Then a task leaves the queue (completed from its checkbox).
    setReviewQueue(session, { ids: [1, 2, 3, 4] }, { keepCurrent: true, env: envOf(edited) })
    expect(session.getState()).toMatchObject({ order: [2, 4, 1, 3], index: 0 })
    // Skip reaches every card after it: none was passed over.
    session.getState().skip()
    expect(session.getState().order[session.getState().index]).toBe(4)
    // A task that joins takes its sorted place among the rest (5 has no due date: last), not the edited card's.
    setReviewQueue(session, { ids: IDS }, { keepCurrent: true, env: envOf(edited) })
    expect(session.getState()).toMatchObject({ order: [2, 4, 1, 3, 5], index: 1 })
    // Picking a sort takes the order again from the tasks as they are now.
    setReviewSort(session, 'title', envOf(edited))
    setReviewSort(session, 'due', envOf(edited))
    expect(session.getState()).toMatchObject({ order: [4, 1, 2, 3, 5], index: 0 })
  })
})

describe('joinOrder', () => {
  const env = envOf(TODOS)

  it('the tasks shown stay as they are, the ones that left go, a joining task goes after the last one the sort puts before it', () => {
    // Shown out of the sort's order (title: 2, 4, 3, 1, 5).
    expect(joinOrder([1, 5, 2], [1, 2, 5], 'title', env)).toEqual([1, 5, 2])
    expect(joinOrder([1, 5, 2], [1, 2], 'title', env)).toEqual([1, 2])
    // Charlie (3) after alpha (2), the last shown that sorts before it; Bravo (4) likewise, before Charlie.
    expect(joinOrder([1, 5, 2], [1, 2, 3, 4, 5], 'title', env)).toEqual([1, 5, 2, 4, 3])
    // Nothing shown sorts before it: first.
    expect(joinOrder([3, 1], [1, 2, 3], 'title', env)).toEqual([2, 3, 1])
  })

  it('Queue order: a joining task goes after the last one before it in the queue', () => {
    expect(joinOrder([1, 3, 5], [1, 2, 3, 4, 5], 'queue', env)).toEqual([1, 2, 3, 4, 5])
    expect(joinOrder([5, 1], [1, 2, 5], 'queue', env)).toEqual([5, 1, 2])
  })

  it('nothing shown yet: the whole queue in the sort’s order; a task not loaded last', () => {
    expect(joinOrder([], IDS, 'title', env)).toEqual([2, 4, 3, 1, 5])
    expect(joinOrder([9], IDS, 'title', env)).toEqual([2, 4, 3, 1, 5])
    expect(joinOrder([2, 1], [1, 2, 9], 'title', env)).toEqual([2, 1, 9])
  })
})
