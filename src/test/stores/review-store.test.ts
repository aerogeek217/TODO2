import { describe, it, expect } from 'vitest'
import { allReviewed, followedUpCount, pruneQueue, shownMark, unrecordedDraftIds, useReviewStore } from '../../stores/review-store'
import { useTodoStore } from '../../stores/todo-store'
import { makeTodo } from '../helpers'

const SOURCE = { kind: 'list' as const, title: 'Aisha 1:1', description: 'list · Manual' }
const store = () => useReviewStore.getState()

function startWith(ids: number[], dividers: { index: number; label: string }[] = []) {
  store().start({ source: SOURCE, ids, dividers })
}

describe('review-store', () => {
  it('opens on the first card, with no marks or drafts', () => {
    startWith([3, 1, 2])
    expect(store()).toMatchObject({ open: true, source: SOURCE, ids: [3, 1, 2], index: 0, marks: {}, drafts: {} })
  })

  it('a new review replaces the open one, starting fresh (no resume)', () => {
    startWith([1, 2])
    store().next()
    store().mark(1, 'done')
    store().setDraft(2, 'half typed')
    startWith([5, 6])
    expect(store()).toMatchObject({ ids: [5, 6], index: 0, marks: {}, drafts: {} })
  })

  it('go / next / back stay inside the queue', () => {
    startWith([1, 2, 3])
    store().back()
    expect(store().index).toBe(0)
    store().next()
    store().next()
    store().next()
    expect(store().index).toBe(2)
    store().go(1)
    expect(store().index).toBe(1)
    store().go(99)
    expect(store().index).toBe(2)
    store().go(-4)
    expect(store().index).toBe(0)
  })

  it('marks: a task followed up stays done, a later skip does not take it back', () => {
    startWith([1, 2])
    store().mark(1, 'done')
    store().mark(1, 'skipped')
    store().mark(2, 'skipped')
    expect(store().marks).toEqual({ 1: 'done', 2: 'skipped' })
    store().mark(2, 'done')
    expect(store().marks).toEqual({ 1: 'done', 2: 'done' })
  })

  it('drafts: kept per task, an empty one removed', () => {
    startWith([1, 2])
    store().setDraft(1, 'Legal has it')
    expect(store().drafts).toEqual({ 1: 'Legal has it' })
    store().setDraft(1, '')
    expect(store().drafts).toEqual({})
  })

  it('close: back to nothing open', () => {
    startWith([1, 2])
    store().mark(1, 'done')
    store().close()
    expect(store()).toMatchObject({ open: false, source: null, ids: [], marks: {}, index: 0 })
  })

  it('counts: the tasks followed up today, and all reviewed once every task is followed up today or skipped', () => {
    const today = (id: number) => id === 1 || id === 3
    expect(followedUpCount({ 2: 'skipped' }, [1, 2, 3], (id) => id === 1)).toBe(1)
    expect(allReviewed({ 2: 'skipped' }, [1, 2, 3], (id) => id === 1)).toBe(false)
    expect(allReviewed({ 2: 'skipped' }, [1, 2, 3], today)).toBe(true)
    expect(allReviewed({}, [], today)).toBe(false)
  })

  it('✓ (item 11): every task followed up today, here or elsewhere; – only while not followed up today', () => {
    const marks = { 2: 'done', 3: 'skipped', 4: 'skipped' } as const
    // 1: followed up today outside the review; 2: followed up here, then undone; 3: skipped; 4: skipped, then followed up today.
    const today = (id: number) => id === 1 || id === 4
    expect([1, 2, 3, 4, 5].map((id) => shownMark(marks, id, today))).toEqual(['done', undefined, 'skipped', 'done', undefined])
    expect(followedUpCount(marks, [1, 2, 3, 4, 5], today)).toBe(2)
    expect(allReviewed(marks, [1, 3, 4], today)).toBe(true)
  })

  it('next drafts: kept per task, null drops one', () => {
    startWith([1, 2])
    store().setNextDraft(1, '2w')
    expect(store().nextDrafts).toEqual({ 1: '2w' })
    store().setNextDraft(1, null)
    expect(store().nextDrafts).toEqual({})
  })
})

describe('unrecordedDraftIds', () => {
  it('the tasks with text typed, in queue order; spaces only, or a task not in the queue, count as none', () => {
    expect(unrecordedDraftIds({ 3: 'later', 1: 'now', 2: '   ', 9: 'gone' }, [1, 2, 3])).toEqual([1, 3])
    expect(unrecordedDraftIds({}, [1, 2])).toEqual([])
  })
})

describe('pruning', () => {
  it('drops gone tasks, moves the dividers with them and drops an emptied group', () => {
    const queue = { ids: [1, 2, 3, 4, 5], dividers: [{ index: 0, label: 'A' }, { index: 2, label: 'B' }, { index: 3, label: 'C' }], index: 4 }
    expect(pruneQueue(queue, new Set([1, 2, 4, 5]))).toEqual({
      ids: [1, 2, 4, 5],
      dividers: [{ index: 0, label: 'A' }, { index: 2, label: 'C' }],
      index: 3,
    })
  })

  it('the current task gone: the card after it (or the last one)', () => {
    expect(pruneQueue({ ids: [1, 2, 3], dividers: [], index: 1 }, new Set([1, 3])).index).toBe(1)
    expect(pruneQueue({ ids: [1, 2, 3], dividers: [], index: 2 }, new Set([1, 2])).index).toBe(1)
    expect(pruneQueue({ ids: [1, 2], dividers: [], index: 1 }, new Set())).toEqual({ ids: [], dividers: [], index: 0 })
  })

  it('a task deleted while the review is open leaves the queue; a completed one stays', () => {
    useTodoStore.setState({ todos: [makeTodo({ id: 1 }), makeTodo({ id: 2 }), makeTodo({ id: 3 })] })
    startWith([1, 2, 3])
    store().go(2)
    useTodoStore.setState({ todos: [makeTodo({ id: 1 }), makeTodo({ id: 3, isCompleted: true })] })
    expect(store().ids).toEqual([1, 3])
    expect(store().index).toBe(1)
  })

  it('closed: the todo store changing touches nothing', () => {
    useTodoStore.setState({ todos: [makeTodo({ id: 1 })] })
    useTodoStore.setState({ todos: [] })
    expect(store().open).toBe(false)
    expect(store().ids).toEqual([])
  })
})
