import { describe, expect, it } from 'vitest'
import type { PersistedTodoItem, Status, Tag, TodoEvent, TodoEventType } from '../../../models'
import { computeChanges, type Change, type ChangeId } from '../../../services/stats/changes'
import { eventsWindowRead, STUCK_STATUS_DAYS } from '../../../utils/trend-window'
import { makeTodo } from '../../helpers'

const today = new Date(2026, 10, 11) // Wed 11 Nov; the week (Sunday first) began Sun 8 Nov
const day = (n: number, hour = 12) => new Date(2026, 10, 11 + n, hour)
const OLD = new Date(2026, 0, 1)

let seq = 0
function ev(todoId: number, type: TodoEventType, at: Date, fromValue: string | number | null = null, toValue: string | number | null = null): TodoEvent {
  return { id: ++seq, todoId, type, fromValue, toValue, timestamp: at.toISOString() }
}

/** A task there since long before the window. */
function task(overrides: Partial<PersistedTodoItem> & { id: number }): PersistedTodoItem {
  return makeTodo({ createdAt: OLD, modifiedAt: OLD, ...overrides })
}

const ATLAS: Tag = { id: 1, name: 'Project: Atlas', color: '#4f8cff' }
const HOME: Tag = { id: 2, name: 'Home', color: '#34c759' }
const BETA: Tag = { id: 3, name: 'Project: Beta', color: '#e05050' }
const WAITING: Status = { id: 10, name: 'Waiting', color: '#888', sortOrder: 0 } as Status
const BLOCKED: Status = { id: 11, name: 'Blocked', color: '#888', sortOrder: 1 } as Status

function ctxWith(tags: Record<number, Tag[]> = {}, statuses: Status[] = [WAITING, BLOCKED]) {
  return {
    today,
    weekStartsOn: 0 as const,
    assignedTagsMap: new Map(Object.entries(tags).map(([id, t]) => [Number(id), t])),
    statuses,
  }
}

const ids = (changes: readonly Change[]) => changes.map((c) => c.id)
const of = (changes: readonly Change[], id: ChangeId) => changes.find((c) => c.id === id)
const drillIds = (c: Change | undefined) => (c?.drill?.source.kind === 'todos' ? c.drill.source.todoIds : null)

describe('computeChanges', () => {
  it('no tasks and no events: nothing to say', () => {
    expect(computeChanges([], [], ctxWith(), [])).toEqual([])
  })

  it('a fresh install (every task made today): no late tasks, no stuck status, no weekly average', () => {
    const tasks = [
      makeTodo({ id: 1, createdAt: day(0, 9), modifiedAt: day(0, 9), dueDate: today, statusId: 10 }),
      makeTodo({ id: 2, createdAt: day(0, 9), modifiedAt: day(0, 9), isCompleted: true, completedAt: day(0, 10) }),
    ]
    const events = [ev(1, 'created', day(0, 9)), ev(1, 'status', day(0, 9), null, 10), ev(2, 'created', day(0, 9)), ev(2, 'completed', day(0, 10))]
    const changes = computeChanges(tasks, events, ctxWith(), [])
    expect(ids(changes)).toEqual(['dueToday', 'closed'])
    expect(of(changes, 'dueToday')?.text).toBe('1 task is due today.')
    expect(of(changes, 'closed')?.text).toBe('1 closed this week.')
  })

  describe('went late since yesterday', () => {
    it('without events: a task due yesterday went late; one due before it was late already', () => {
      const tasks = [task({ id: 1, dueDate: day(-1) }), task({ id: 2, dueDate: day(-3) }), task({ id: 3, dueDate: today })]
      const c = of(computeChanges(tasks, [], ctxWith(), []), 'late')
      expect(c?.text).toBe('1 task went late since yesterday.')
      expect(drillIds(c)).toEqual([1])
    })

    it('a due date moved today: into the past goes late; from one late day to another doesn’t', () => {
      const tasks = [task({ id: 1, dueDate: day(-2) }), task({ id: 2, dueDate: day(-3) })]
      const events = [
        ev(1, 'deadline', day(0, 9), day(5).toISOString(), day(-2).toISOString()),
        ev(2, 'deadline', day(0, 9), day(-6).toISOString(), day(-3).toISOString()),
      ]
      expect(drillIds(of(computeChanges(tasks, events, ctxWith(), []), 'late'))).toEqual([1])
    })

    it('a task reopened today that is late went late; completed ones never count', () => {
      const tasks = [
        task({ id: 1, dueDate: day(-4) }),
        task({ id: 3, dueDate: day(-1), isCompleted: true, completedAt: day(0, 9) }),
      ]
      const events = [ev(1, 'completed', day(-6)), ev(1, 'reopened', day(0, 9))]
      const c = of(computeChanges(tasks, events, ctxWith(), []), 'late')
      expect(c?.text).toBe('1 task went late since yesterday.')
      expect(drillIds(c)).toEqual([1])
    })

    it('a task that wasn’t there at yesterday’s end came in late: a duplicate, a Quick Add with a past date, an append import', () => {
      const tasks = [
        // A duplicate of a late task, or a Quick Add due yesterday: created today.
        makeTodo({ id: 2, createdAt: day(0, 8), modifiedAt: day(0, 8), dueDate: day(-1) }),
        // An append import: its own old createdAt, its `created` event today.
        task({ id: 4, dueDate: day(-1) }),
        // The one that did go late.
        task({ id: 5, dueDate: day(-1) }),
      ]
      const events = [ev(2, 'created', day(0, 8)), ev(4, 'created', day(0, 9))]
      const c = of(computeChanges(tasks, events, ctxWith(), []), 'late')
      expect(c?.text).toBe('1 task went late since yesterday.')
      expect(drillIds(c)).toEqual([5])
    })
  })

  describe('follow-ups due', () => {
    const fu = (id: number, next: Date | undefined, last?: Date) => task({ id, nextFollowupAt: next, lastFollowupAt: last })

    it('how many are due today or late, and how many of them are late; no comparison with yesterday', () => {
      const tasks = [fu(1, day(-2)), fu(2, today), fu(3, today), fu(4, day(7), today)]
      const c = of(computeChanges(tasks, [], ctxWith(), []), 'followups')
      expect(c?.text).toBe('3 follow-ups are due (1 late).')
      expect(drillIds(c)).toEqual([1, 2, 3])
      expect(of(computeChanges([fu(1, today)], [], ctxWith(), []), 'followups')?.text).toBe('1 follow-up is due.')
    })

    it('the sentence doesn’t move through the day: following up today’s or completing a late one only lowers the count', () => {
      // Morning: 2 late, 1 due today.
      const morning = [fu(1, day(-2)), fu(2, day(-1)), fu(3, today)]
      expect(of(computeChanges(morning, [], ctxWith(), []), 'followups')?.text).toBe('3 follow-ups are due (2 late).')
      // Today's followed up, a late one completed.
      const evening = [fu(1, day(-2)), task({ id: 2, nextFollowupAt: day(-1), isCompleted: true, completedAt: day(0, 15) }), fu(3, day(7), today)]
      expect(of(computeChanges(evening, [], ctxWith(), []), 'followups')?.text).toBe('1 follow-up is due (1 late).')
    })

    it('none due: no sentence, even after following some up today', () => {
      expect(of(computeChanges([fu(1, day(3), today)], [], ctxWith(), []), 'followups')).toBeUndefined()
      expect(of(computeChanges([fu(1, day(3))], [], ctxWith(), []), 'followups')).toBeUndefined()
    })
  })

  describe('the tag with the most late tasks', () => {
    const late = (id: number) => task({ id, dueDate: day(-3) })

    it('the picked tag with the most; an unpicked tag never wins', () => {
      const tasks = [late(1), late(2), late(3), late(4)]
      const tags = { 1: [ATLAS, HOME], 2: [HOME], 3: [HOME], 4: [BETA] }
      const c = of(computeChanges(tasks, [], ctxWith(tags), [1, 3]), 'tag')
      expect(c?.text).toBe('#Project: Atlas has the most late tasks (1).')
      expect(drillIds(c)).toEqual([1])
    })

    it('a tie goes to the first picked', () => {
      const tags = { 1: [ATLAS], 2: [BETA] }
      expect(of(computeChanges([late(1), late(2)], [], ctxWith(tags), [3, 1]), 'tag')?.text).toBe('#Project: Beta has the most late tasks (1).')
    })

    it('no picks, or picked tags with no late (or no) tasks: no sentence', () => {
      expect(of(computeChanges([late(1)], [], ctxWith({ 1: [ATLAS] }), []), 'tag')).toBeUndefined()
      expect(of(computeChanges([late(1), task({ id: 2 })], [], ctxWith({ 2: [ATLAS] }), [1, 99]), 'tag')).toBeUndefined()
    })
  })

  describe('a stuck status', () => {
    it('held since before the window (no event) or by an event 3+ weeks ago is stuck; a recent change isn’t', () => {
      const tasks = [
        task({ id: 1, statusId: 10 }),
        task({ id: 2, statusId: 10 }),
        task({ id: 3, statusId: 10 }),
        makeTodo({ id: 4, createdAt: day(-10), modifiedAt: day(-10), statusId: 10 }),
        task({ id: 5, statusId: 10, isCompleted: true }),
      ]
      const events = [ev(2, 'status', day(-STUCK_STATUS_DAYS, 8), 11, 10), ev(3, 'status', day(-5), 11, 10)]
      const c = of(computeChanges(tasks, events, ctxWith(), []), 'status')
      expect(c?.text).toBe('Waiting has held 2 tasks for 3+ weeks.')
      expect(drillIds(c)).toEqual([1, 2])
    })

    it('the status with the most stuck tasks; a tie by status order; an unknown status is skipped', () => {
      const tasks = [task({ id: 1, statusId: 11 }), task({ id: 2, statusId: 10 }), task({ id: 3, statusId: 99 }), task({ id: 4, statusId: 99 })]
      expect(of(computeChanges(tasks, [], ctxWith(), []), 'status')?.text).toBe('Waiting has held 1 task for 3+ weeks.')
      expect(of(computeChanges([...tasks, task({ id: 5, statusId: 11 })], [], ctxWith(), []), 'status')?.text).toBe('Blocked has held 2 tasks for 3+ weeks.')
    })
  })

  describe('closed this week against the weekly average', () => {
    const done = (id: number, at: Date) => task({ id, isCompleted: true, completedAt: at, modifiedAt: at })
    /** `n` completions in the week starting `weeksAgo` weeks before this one (on its Monday). */
    const week = (weeksAgo: number, n: number, first: number) =>
      Array.from({ length: n }, (_, i) => done(first + i, new Date(2026, 10, 8 - 7 * weeksAgo + 1)))

    it('the week begins on its first day: a completion that day counts, the day before is last week', () => {
      const tasks = [done(1, new Date(2026, 10, 8, 0, 5)), done(2, new Date(2026, 10, 7, 23, 50))]
      const c = of(computeChanges(tasks, [], ctxWith(), []), 'closed')
      expect(drillIds(c)).toEqual([1])
    })

    it('about, above and below the usual (the last four full weeks)', () => {
      const past = [...week(1, 4, 100), ...week(2, 4, 200), ...week(3, 4, 300), ...week(4, 4, 400)]
      const now = (n: number) => Array.from({ length: n }, (_, i) => done(i + 1, day(0, 9)))
      expect(of(computeChanges([...past, ...now(4)], [], ctxWith(), []), 'closed')?.text).toBe('4 closed this week, about your usual 4 a week.')
      expect(of(computeChanges([...past, ...now(8)], [], ctxWith(), []), 'closed')?.text).toBe('8 closed this week, above your usual 4 a week.')
      expect(of(computeChanges([...past, ...now(1)], [], ctxWith(), []), 'closed')?.text).toBe('1 closed this week, below your usual 4 a week.')
      const none = of(computeChanges(past, [], ctxWith(), []), 'closed')
      expect(none?.text).toBe('Nothing closed this week yet; you usually close 4 a week.')
      expect(none?.drill).toBeNull()
    })

    it('fewer than four weeks of history: the average of the full weeks there are', () => {
      // History from Mon 19 Oct: the weeks of 25 Oct and 1 Nov are full, 18 Oct's isn't.
      const first = makeTodo({ id: 50, createdAt: new Date(2026, 9, 19), modifiedAt: new Date(2026, 9, 19) })
      const tasks = [first, ...week(1, 3, 100), ...week(2, 2, 200), done(1, day(0, 9))].map((t) => (t.id === 50 ? t : { ...t, createdAt: new Date(2026, 9, 20) }))
      const c = of(computeChanges(tasks, [], ctxWith(), []), 'closed')
      expect(c?.text).toBe('1 closed this week, below your usual 2.5 a week.')
      expect(c?.drill?.description).toContain('the last 2 weeks')
    })

    it('nothing closed and no history: no sentence', () => {
      expect(of(computeChanges([makeTodo({ id: 1, createdAt: day(0, 9) })], [], ctxWith(), []), 'closed')).toBeUndefined()
    })
  })

  it('the sentences in their order, each with tasks opening them', () => {
    const tasks = [
      task({ id: 1, dueDate: day(-1), nextFollowupAt: day(-1), statusId: 10 }),
      task({ id: 2, dueDate: today }),
      task({ id: 3, isCompleted: true, completedAt: day(0, 9) }),
    ]
    const changes = computeChanges(tasks, [], ctxWith({ 1: [ATLAS] }), [1])
    expect(ids(changes)).toEqual(['late', 'followups', 'tag', 'status', 'dueToday', 'closed'])
    expect(changes.every((c) => c.drill != null)).toBe(true)
  })

  it('reads its window: the last STUCK_STATUS_DAYS days of state, due-date and status events', () => {
    const read = eventsWindowRead('changes', today, 0)
    expect(read.start).toEqual(new Date(2026, 9, 21))
    expect([...read.types].sort()).toEqual(['completed', 'created', 'deadline', 'reopened', 'status'])
  })
})
