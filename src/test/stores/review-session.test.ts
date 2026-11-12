import { describe, it, expect } from 'vitest'
import { allReviewed, createReviewSession, followedUpCount, shownMark } from '../../stores/review-session'

function sessionOf(ids: number[]) {
  const session = createReviewSession({ ids, order: ids })
  return () => session.getState()
}

describe('review-session', () => {
  it('starts on the first card, with no marks or drafts', () => {
    const store = sessionOf([3, 1, 2])
    expect(store()).toMatchObject({ ids: [3, 1, 2], index: 0, marks: {}, drafts: {} })
  })

  it('go / next / back stay inside the queue', () => {
    const store = sessionOf([1, 2, 3])
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
    const store = sessionOf([1, 2])
    store().mark(1, 'done')
    store().mark(1, 'skipped')
    store().mark(2, 'skipped')
    expect(store().marks).toEqual({ 1: 'done', 2: 'skipped' })
    store().mark(2, 'done')
    expect(store().marks).toEqual({ 1: 'done', 2: 'done' })
  })

  it('drafts: kept per task, an empty one removed', () => {
    const store = sessionOf([1, 2])
    store().setDraft(1, 'Legal has it')
    expect(store().drafts).toEqual({ 1: 'Legal has it' })
    store().setDraft(1, '')
    expect(store().drafts).toEqual({})
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
    const store = sessionOf([1, 2])
    store().setNextDraft(1, '2w')
    expect(store().nextDrafts).toEqual({ 1: '2w' })
    store().setNextDraft(1, null)
    expect(store().nextDrafts).toEqual({})
  })
})
