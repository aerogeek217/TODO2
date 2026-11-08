import { describe, it, expect } from 'vitest'
import { allReviewed, followedUpCount, pruneQueue, useReviewStore } from '../../stores/review-store'
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

  it('counts: followed up, and all reviewed once every task has a mark', () => {
    expect(followedUpCount({ 1: 'done', 2: 'skipped' }, [1, 2, 3])).toBe(1)
    expect(allReviewed({ 1: 'done', 2: 'skipped' }, [1, 2, 3])).toBe(false)
    expect(allReviewed({ 1: 'done', 2: 'skipped', 3: 'done' }, [1, 2, 3])).toBe(true)
    expect(allReviewed({}, [])).toBe(false)
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
