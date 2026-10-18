import { describe, it, expect } from 'vitest'
import {
  blockedDropLines,
  buildQuadrants,
  classifyEisenhower,
  compareInQuadrant,
  dropDescription,
  dropPreviewLabel,
  insertionIndex,
  quadrantOf,
  resolveQuadrantDrop,
} from '../../utils/eisenhower'
import type { EisenhowerQuadrant } from '../../models/workspace-layout'
import { makeTodo } from '../helpers'

// Sat 10 Oct 2026, range 3 days (due by Tue 13 counts as urgent).
const TODAY = new Date(2026, 9, 10)
const day = (n: number) => new Date(2026, 9, 10 + n)

describe('quadrantOf', () => {
  it.each<[boolean, boolean, EisenhowerQuadrant]>([
    [true, true, 'do'],
    [false, true, 'schedule'],
    [true, false, 'delegate'],
    [false, false, 'drop'],
  ])('urgent %s, important %s → %s', (u, i, q) => {
    expect(quadrantOf(u, i)).toBe(q)
  })
})

describe('classifyEisenhower', () => {
  it.each<[string, Parameters<typeof makeTodo>[0], number | null, EisenhowerQuadrant, boolean]>([
    ['no flags, no date', {}, 3, 'drop', false],
    ['important only', { important: true }, 3, 'schedule', false],
    ['urgent flag', { urgent: true }, 3, 'delegate', false],
    ['both flags', { urgent: true, important: true }, 3, 'do', false],
    ['due today', { dueDate: day(0) }, 3, 'delegate', true],
    ['due on the range edge', { dueDate: day(3) }, 3, 'delegate', true],
    ['due a day past the range', { dueDate: day(4) }, 3, 'drop', false],
    ['overdue', { dueDate: day(-5) }, 3, 'delegate', true],
    ['overdue + important', { dueDate: day(-1), important: true }, 3, 'do', true],
    ['flagged and due soon', { urgent: true, dueDate: day(1) }, 3, 'delegate', true],
    ['range Off: due today is not urgent', { dueDate: day(0) }, null, 'drop', false],
    ['range Off: the flag still counts', { urgent: true, dueDate: day(0) }, null, 'delegate', false],
    ['range Today: tomorrow is not urgent', { dueDate: day(1) }, 0, 'drop', false],
    ['range Today: overdue is urgent', { dueDate: day(-1) }, 0, 'delegate', true],
    ['completed: the due date never makes it urgent', { isCompleted: true, dueDate: day(-1) }, 3, 'drop', false],
    ['completed: flags still place it', { isCompleted: true, urgent: true, important: true }, 3, 'do', false],
    ['follow-up dates never count', { nextFollowupAt: day(0) }, 3, 'drop', false],
  ])('%s', (_label, fields, range, quadrant, byDate) => {
    expect(classifyEisenhower(makeTodo({ id: 1, ...fields }), TODAY, range)).toEqual({ quadrant, urgentByDate: byDate })
  })
})

describe('order inside a quadrant', () => {
  it('overdue first, then by due date, undated last, ties by sortOrder, completed last', () => {
    const a = makeTodo({ id: 1, sortOrder: 5 })
    const b = makeTodo({ id: 2, dueDate: day(2), sortOrder: 1 })
    const c = makeTodo({ id: 3, dueDate: day(-2), sortOrder: 9 })
    const d = makeTodo({ id: 4, sortOrder: 2 })
    const e = makeTodo({ id: 5, dueDate: day(-9), isCompleted: true, sortOrder: 0 })
    const f = makeTodo({ id: 6, dueDate: day(2), sortOrder: 0 })
    expect([a, b, c, d, e, f].sort(compareInQuadrant).map((t) => t.id)).toEqual([3, 6, 2, 4, 1, 5])
  })

  it('buildQuadrants puts every task in exactly one quadrant, sorted', () => {
    const todos = [
      makeTodo({ id: 1, urgent: true, important: true }),
      makeTodo({ id: 2, important: true, dueDate: day(10) }),
      makeTodo({ id: 3, important: true, dueDate: day(5) }),
      makeTodo({ id: 4, dueDate: day(2) }),
      makeTodo({ id: 5 }),
    ]
    const q = buildQuadrants(todos, TODAY, 3)
    expect(q.do.map((t) => t.id)).toEqual([1])
    expect(q.schedule.map((t) => t.id)).toEqual([3, 2])
    expect(q.delegate.map((t) => t.id)).toEqual([4])
    expect(q.drop.map((t) => t.id)).toEqual([5])
  })

  it('insertionIndex: where a task lands in the sorted quadrant', () => {
    const sorted = [makeTodo({ id: 1, dueDate: day(1) }), makeTodo({ id: 2, dueDate: day(5) }), makeTodo({ id: 3 })]
    expect(insertionIndex(sorted, makeTodo({ id: 9, dueDate: day(3) }))).toBe(1)
    expect(insertionIndex(sorted, makeTodo({ id: 9, dueDate: day(-1) }))).toBe(0)
    expect(insertionIndex(sorted, makeTodo({ id: 9, sortOrder: 99 }))).toBe(3)
    // Its own row doesn't count.
    expect(insertionIndex(sorted, sorted[1]!)).toBe(1)
  })
})

describe('resolveQuadrantDrop', () => {
  const flagged = (fields: Parameters<typeof makeTodo>[0]) => makeTodo({ id: 1, ...fields })

  it.each<[string, Parameters<typeof makeTodo>[0], EisenhowerQuadrant, { urgent?: boolean; important?: boolean } | null]>([
    ['Schedule → Do: sideways sets Urgent', { important: true }, 'do', { urgent: true }],
    ['Delegate → Do: up sets Important', { urgent: true }, 'do', { important: true }],
    ['Schedule → Delegate: diagonal changes both', { important: true }, 'delegate', { urgent: true, important: false }],
    ['Drop → Do: diagonal sets both', {}, 'do', { urgent: true, important: true }],
    ['Do → Drop: diagonal clears both', { urgent: true, important: true }, 'drop', { urgent: false, important: false }],
    ['Do → Schedule: clears Urgent', { urgent: true, important: true }, 'schedule', { urgent: false }],
    ['same quadrant: nothing', { important: true }, 'schedule', null],
    ['flagged, due outside the range → Schedule clears the flag', { urgent: true, important: true, dueDate: day(9) }, 'schedule', { urgent: false }],
  ])('%s', (_label, fields, target, change) => {
    const res = resolveQuadrantDrop([flagged(fields)], target, TODAY, 3)
    if (change == null) expect(res).toEqual({ kind: 'none' })
    else expect(res).toEqual({ kind: 'apply', changes: [{ todoId: 1, ...change }] })
  })

  describe('a task urgent by its due date', () => {
    it('into Do: only Important changes; the urgent flag is not written', () => {
      expect(resolveQuadrantDrop([flagged({ dueDate: day(1) })], 'do', TODAY, 3))
        .toEqual({ kind: 'apply', changes: [{ todoId: 1, important: true }] })
    })

    it('Do → Delegate: only Important clears', () => {
      expect(resolveQuadrantDrop([flagged({ dueDate: day(1), important: true })], 'delegate', TODAY, 3))
        .toEqual({ kind: 'apply', changes: [{ todoId: 1, important: false }] })
    })

    it('flagged and due soon → Do keeps the flag as it is', () => {
      expect(resolveQuadrantDrop([flagged({ urgent: true, dueDate: day(0) })], 'do', TODAY, 3))
        .toEqual({ kind: 'apply', changes: [{ todoId: 1, important: true }] })
    })

    it.each<[string, Parameters<typeof makeTodo>[0], EisenhowerQuadrant]>([
      ['not flagged → Drop', { dueDate: day(3) }, 'drop'],
      ['not flagged → Schedule', { dueDate: day(0) }, 'schedule'],
      ['overdue → Drop', { dueDate: day(-4) }, 'drop'],
      // Clearing the flag wouldn't move it — and the drop never asks the
      // clearing-Urgent question: it's refused before anything changes.
      ['flagged → Schedule', { urgent: true, important: true, dueDate: day(2) }, 'schedule'],
      ['flagged → Drop', { urgent: true, dueDate: day(2) }, 'drop'],
    ])('blocked: %s', (_label, fields, target) => {
      const t = flagged(fields)
      expect(resolveQuadrantDrop([t], target, TODAY, 3)).toEqual({ kind: 'blocked', blocked: [t] })
    })

    it('range Off: nothing is urgent by date, so nothing blocks', () => {
      expect(resolveQuadrantDrop([flagged({ urgent: true, dueDate: day(0) })], 'drop', TODAY, null))
        .toEqual({ kind: 'apply', changes: [{ todoId: 1, urgent: false }] })
    })

    it('completed tasks move by their flags only', () => {
      expect(resolveQuadrantDrop([flagged({ isCompleted: true, dueDate: day(-1), urgent: true })], 'drop', TODAY, 3))
        .toEqual({ kind: 'apply', changes: [{ todoId: 1, urgent: false }] })
    })
  })

  describe('several tasks', () => {
    it('each gets the rule; tasks already there are skipped', () => {
      const tasks = [makeTodo({ id: 1 }), makeTodo({ id: 2, important: true }), makeTodo({ id: 3, dueDate: day(1) })]
      expect(resolveQuadrantDrop(tasks, 'do', TODAY, 3)).toEqual({
        kind: 'apply',
        changes: [{ todoId: 1, urgent: true, important: true }, { todoId: 2, urgent: true }, { todoId: 3, important: true }],
      })
    })

    it('one blocked task refuses the whole drop', () => {
      const tasks = [makeTodo({ id: 1 }), makeTodo({ id: 2, dueDate: day(1) }), makeTodo({ id: 3, dueDate: day(2) })]
      const res = resolveQuadrantDrop(tasks, 'schedule', TODAY, 3)
      expect(res.kind).toBe('blocked')
      if (res.kind === 'blocked') expect(res.blocked.map((t) => t.id)).toEqual([2, 3])
    })
  })
})

describe('drop labels', () => {
  it('preview names what changes', () => {
    expect(dropPreviewLabel([{ todoId: 1, urgent: true }])).toBe('+ Urgent')
    expect(dropPreviewLabel([{ todoId: 1, important: false }])).toBe('− Important')
    expect(dropPreviewLabel([{ todoId: 1, urgent: true, important: false }])).toBe('+ Urgent · − Important')
    expect(dropPreviewLabel([{ todoId: 1, important: true }, { todoId: 2, urgent: false, important: true }])).toBe('− Urgent · + Important')
  })

  it('undo description names the task, or the count', () => {
    const title = (id: number) => (id === 1 ? 'Send board update' : undefined)
    expect(dropDescription([{ todoId: 1, urgent: true }], title)).toBe('Marked urgent · Send board update')
    expect(dropDescription([{ todoId: 1, urgent: true, important: false }], title)).toBe('Marked urgent, not important · Send board update')
    expect(dropDescription([{ todoId: 1, important: true }, { todoId: 2, important: true }], title)).toBe('Marked important · 2 tasks')
  })

  it('refusal lines: one task due soon, overdue, due today, several', () => {
    const t = (fields: Parameters<typeof makeTodo>[0]) => ({ ...makeTodo({ id: 1, ...fields }), title: 'Pick up prescriptions' })
    expect(blockedDropLines('drop', [t({ dueDate: day(3) })], 1, TODAY, 3)).toEqual([
      'Can’t move to Drop',
      'Pick up prescriptions is due Tue 13, within 3 days, so it counts as urgent.',
      'Change its due date or the due-soon range first.',
    ])
    expect(blockedDropLines('schedule', [t({ dueDate: day(-2) })], 1, TODAY, 3)[1])
      .toBe('Pick up prescriptions is overdue (Thu 8), so it counts as urgent.')
    expect(blockedDropLines('schedule', [t({ dueDate: day(0) })], 1, TODAY, 3)[1])
      .toBe('Pick up prescriptions is due today, so it counts as urgent.')
    expect(blockedDropLines('drop', [t({ dueDate: day(1) }), t({ dueDate: day(2) })], 3, TODAY, 3)).toEqual([
      'Can’t move to Drop',
      '2 of 3 tasks are due within 3 days, so they count as urgent.',
      'Change their due dates or the due-soon range first.',
    ])
  })
})
