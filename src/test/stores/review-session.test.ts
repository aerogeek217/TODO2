import { describe, it, expect } from 'vitest'
import {
  allReviewed,
  clearReviewSessions,
  createReviewSession,
  followedUpCount,
  keepReviewSessions,
  reviewWidgetSession,
  shownMark,
} from '../../stores/review-session'

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

  it('marks: the last one made stands — a skip takes a follow-up’s place, a follow-up a skip’s', () => {
    const store = sessionOf([1, 2])
    store().mark(1, 'done')
    store().mark(1, 'skipped')
    store().mark(2, 'skipped')
    expect(store().marks).toEqual({ 1: 'skipped', 2: 'skipped' })
    store().mark(2, 'done')
    expect(store().marks).toEqual({ 1: 'skipped', 2: 'done' })
  })

  it('followed up here, undone, then skipped: the task shows its – and counts as reviewed (F8 / U7)', () => {
    const store = sessionOf([1, 2])
    // Mark followed up on card 1 (the review moves on), then its undo: no longer followed up today.
    store().mark(1, 'done')
    store().next()
    const today = () => false
    expect(shownMark(store().marks, 1, today)).toBeUndefined()
    store().back()
    store().skip()
    expect(shownMark(store().marks, 1, today)).toBe('skipped')
    store().skip()
    expect(allReviewed(store().marks, store().order, today)).toBe(true)
    // While it is followed up today the ✓ shows, whatever the mark.
    expect(shownMark(store().marks, 1, (id) => id === 1)).toBe('done')
  })

  it('a new review (`restart`): no queue, the first card, no marks — the sort and the typed text stay; `reset` keeps only the sort', () => {
    const session = createReviewSession({ ids: [1, 2, 3], order: [1, 2, 3], index: 2, sort: 'title', marks: { 1: 'skipped' }, filterKey: '@p1' })
    session.getState().setDraft(2, 'typed')
    session.getState().setNextDraft(2, '2w')
    session.getState().restart('#t1')
    expect(session.getState()).toMatchObject({ ids: [], order: [], index: 0, marks: {}, sort: 'title', filterKey: '#t1', drafts: { 2: 'typed' }, nextDrafts: { 2: '2w' } })
    session.getState().reset()
    expect(session.getState()).toMatchObject({ ids: [], order: [], index: 0, marks: {}, sort: 'title', filterKey: null, drafts: {}, nextDrafts: {} })
  })

  it('the widgets’ sessions: cleared in place on a data replace; a closed tab’s is dropped', () => {
    const a = reviewWidgetSession('tab-a', () => ({ sort: 'due' }))
    a.setState({ ids: [7], order: [7], marks: { 7: 'skipped' }, drafts: { 7: 'typed for task 7' }, nextDrafts: { 7: 'fri' }, filterKey: '@p7' })
    const b = reviewWidgetSession('tab-b')
    clearReviewSessions()
    // The same session object (a mounted widget holds it), back to nothing but its sort.
    expect(reviewWidgetSession('tab-a')).toBe(a)
    expect(a.getState()).toMatchObject({ ids: [], order: [], marks: {}, drafts: {}, nextDrafts: {}, filterKey: null, sort: 'due' })
    keepReviewSessions(new Set(['tab-a']))
    expect(reviewWidgetSession('tab-a')).toBe(a)
    expect(reviewWidgetSession('tab-b')).not.toBe(b)
  })

  it('`N followed up` counts a task followed up here that left the queue, while it is still followed up today (U8)', () => {
    // Task 1 was followed up here and left the queue; task 2 is in the queue, followed up elsewhere today.
    const marks = { 1: 'done', 3: 'skipped' } as const
    expect(followedUpCount(marks, [2, 3], (id) => id === 1 || id === 2)).toBe(2)
    // Its follow-up undone: not counted, though the mark is still there.
    expect(followedUpCount(marks, [2, 3], (id) => id === 2)).toBe(1)
    // Still in the queue and marked: counted once.
    expect(followedUpCount({ 2: 'done' }, [2, 3], (id) => id === 2)).toBe(1)
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
