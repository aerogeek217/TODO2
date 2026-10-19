import { describe, it, expect } from 'vitest'
import {
  blockedDropLines,
  blockedPaneLines,
  buildQuadrants,
  classifyPanes,
  classifyEisenhower,
  compareInQuadrant,
  dropDescription,
  dropPreviewLabel,
  insertionIndex,
  quadrantOf,
  resolvePaneDrop,
  resolveQuadrantDrop,
} from '../../utils/eisenhower'
import { defaultPaneFilter, resolvePanes } from '../../utils/eisenhower-panes'
import { emptyPredicate } from '../../models'
import type { EisenhowerQuadrant } from '../../models/workspace-layout'
import { makePaneContext, makeTodo } from '../helpers'

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

// ── Panes ───────────────────────────────────────────────────────────────────

const statusRow = (id: number, name: string) => ({ id, name, color: '#000', icon: 'circle' as const, sortOrder: id })
const personRow = (id: number, name: string) => ({ id, name, initials: name.slice(0, 2) })
const tagRow = (id: number, name: string) => ({ id, name, color: '#000' })

describe('classifyPanes on the default panes', () => {
  // A small deterministic generator (mulberry32): the same tasks every run.
  function rng(seed: number): () => number {
    let a = seed
    return () => {
      a = (a + 0x6d2b79f5) | 0
      let t = Math.imul(a ^ (a >>> 15), 1 | a)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }

  it('places every task exactly as classifyEisenhower does (generated tasks, every urgent range)', () => {
    const next = rng(20261019)
    const todos = Array.from({ length: 2000 }, (_, i) => makeTodo({
      id: i + 1,
      sortOrder: i,
      ...(next() < 0.4 ? { urgent: true } : {}),
      ...(next() < 0.4 ? { important: true } : {}),
      ...(next() < 0.2 ? { focus: true } : {}),
      ...(next() < 0.2 ? { isCompleted: true } : {}),
      ...(next() < 0.6 ? { dueDate: day(Math.floor(next() * 21) - 10) } : {}),
      ...(next() < 0.2 ? { nextFollowupAt: day(Math.floor(next() * 7) - 3) } : {}),
    }))
    for (const range of [null, 0, 1, 3, 7, 14] as const) {
      const { byPane, none } = classifyPanes(todos, resolvePanes(undefined), makePaneContext(TODAY, range))
      expect(none).toEqual([])
      const expected = buildQuadrants(todos, TODAY, range)
      for (const q of ['do', 'schedule', 'delegate', 'drop'] as const) {
        expect(byPane[q].map((t) => t.id)).toEqual(expected[q].map((t) => t.id))
      }
    }
    // The generator covers every quadrant, urgent-by-date and completed tasks included.
    const covered = buildQuadrants(todos, TODAY, 3)
    for (const q of ['do', 'schedule', 'delegate', 'drop'] as const) expect(covered[q].length).toBeGreaterThan(50)
    expect(todos.some((t) => t.urgent !== true && classifyEisenhower(t, TODAY, 3).urgentByDate)).toBe(true)
    expect(todos.some((t) => t.isCompleted && t.dueDate != null && t.urgent !== true)).toBe(true)
  })
})

describe('classifyPanes on custom panes', () => {
  const ctx = makePaneContext(TODAY, 3, {
    statuses: [statusRow(3, 'Delegated')],
    people: [personRow(1, 'Ann')],
    assignedPeopleMap: new Map([[2, [personRow(1, 'Ann')]]]),
  })

  it('first match wins; a task no pane matches is in none', () => {
    const panes = resolvePanes({
      delegate: { filter: { ...defaultPaneFilter('delegate'), statusIds: [3], negate: { statusIds: true } } },
    })
    const todos = [
      makeTodo({ id: 1, urgent: true, statusId: 3 }),
      makeTodo({ id: 2, urgent: true }),
      makeTodo({ id: 3, important: true }),
    ]
    const { byPane, none } = classifyPanes(todos, panes, ctx)
    expect(byPane.delegate.map((t) => t.id)).toEqual([2])
    expect(byPane.schedule.map((t) => t.id)).toEqual([3])
    expect(none.map((t) => t.id)).toEqual([1])
  })

  it('an earlier pane that overlaps a later one takes the task', () => {
    const panes = resolvePanes({ do: { name: 'Focus', filter: { ...emptyPredicate(), markers: { focus: true } } } })
    const { byPane } = classifyPanes([makeTodo({ id: 1, focus: true, important: true })], panes, ctx)
    expect(byPane.do.map((t) => t.id)).toEqual([1])
    expect(byPane.schedule).toEqual([])
  })

  it('a pane filter ignores Show completed (the source decides) and reads people and text by name', () => {
    const panes = resolvePanes({ do: { filter: { ...emptyPredicate(), personIds: [1], searchText: 'ann' } } })
    const { byPane } = classifyPanes([makeTodo({ id: 2, isCompleted: true, title: 'Call' })], panes, ctx)
    expect(byPane.do.map((t) => t.id)).toEqual([2])
  })
})

describe('resolvePaneDrop on custom panes', () => {
  const ctx = makePaneContext(TODAY, 3, {
    statuses: [statusRow(3, 'Delegated'), statusRow(4, 'Waiting')],
    people: [personRow(1, 'Ann')],
    tags: [tagRow(5, 'home')],
  })
  const t = (fields: Parameters<typeof makeTodo>[0]) => makeTodo({ id: 1, title: 'Chase vendor', ...fields })

  it('writes a single "is" status, person and tag, with the flags', () => {
    const panes = resolvePanes({ drop: { filter: { ...defaultPaneFilter('drop'), statusIds: [4], personIds: [1], tags: [5] } } })
    expect(resolvePaneDrop([t({ urgent: true })], 'drop', panes, ctx))
      .toEqual({ kind: 'apply', changes: [{ todoId: 1, urgent: false, statusId: 4, personId: 1, tagId: 5 }] })
  })

  it('writes Focus Yes / No', () => {
    const panes = resolvePanes({
      do: { filter: { ...emptyPredicate(), markers: { focus: true } } },
      schedule: { filter: { ...emptyPredicate(), markers: { focus: false } } },
    })
    expect(resolvePaneDrop([t({})], 'do', panes, ctx)).toEqual({ kind: 'apply', changes: [{ todoId: 1, focus: true }] })
    expect(resolvePaneDrop([t({ focus: true })], 'schedule', panes, ctx)).toEqual({ kind: 'apply', changes: [{ todoId: 1, focus: false }] })
  })

  it('refuses when a clause the drop can’t change fails, naming it', () => {
    const panes = resolvePanes({ delegate: { filter: { ...defaultPaneFilter('delegate'), statusIds: [3], negate: { statusIds: true } } } })
    const task = t({ urgent: true, statusId: 3 })
    const res = resolvePaneDrop([task], 'delegate', panes, ctx)
    expect(res).toEqual({ kind: 'blocked', blocked: [{ task, miss: { kind: 'clause', field: 'status' } }] })
    if (res.kind !== 'blocked') return
    expect(blockedPaneLines(panes[2]!, res.blocked, 1, panes, ctx, ctx)).toEqual([
      'Can’t move to Delegate',
      'Chase vendor is still Delegated.',
      'Change its status first, or edit the pane.',
    ])
  })

  it('refuses when an earlier pane would take the task first', () => {
    const panes = resolvePanes({ do: { name: 'Now', filter: { ...emptyPredicate(), markers: { focus: true } } } })
    const task = t({ focus: true })
    const res = resolvePaneDrop([task], 'drop', panes, ctx)
    expect(res).toEqual({ kind: 'blocked', blocked: [{ task, miss: { kind: 'earlier', pane: 'do' } }] })
    if (res.kind !== 'blocked') return
    expect(blockedPaneLines(panes[3]!, res.blocked, 1, panes, ctx, ctx)[1]).toBe('Chase vendor matches “Now” first.')
  })

  it('a date clause implies nothing: a task outside it is refused', () => {
    const panes = resolvePanes({ schedule: { filter: { ...defaultPaneFilter('schedule'), dates: { deadline: { match: 'set' } } } } })
    const task = t({})
    const res = resolvePaneDrop([task], 'schedule', panes, ctx)
    expect(res).toEqual({ kind: 'blocked', blocked: [{ task, miss: { kind: 'clause', field: 'deadline' } }] })
    if (res.kind !== 'blocked') return
    expect(blockedPaneLines(panes[1]!, res.blocked, 1, panes, ctx, ctx)[1]).toBe('Chase vendor doesn’t match its Due filter (has a date).')
  })

  it('a renamed pane wanting Urgent No keeps the due-date refusal, under its own name', () => {
    const panes = resolvePanes({ drop: { name: 'Later' } })
    const task = t({ dueDate: day(1) })
    const res = resolvePaneDrop([task], 'drop', panes, ctx)
    expect(res).toEqual({ kind: 'blocked', blocked: [{ task, miss: { kind: 'urgent-date' } }] })
    if (res.kind !== 'blocked') return
    expect(blockedPaneLines(panes[3]!, res.blocked, 1, panes, ctx, ctx)).toEqual([
      'Can’t move to Later',
      'Chase vendor is due Sun 11, within 3 days, so it counts as urgent.',
      'Change its due date or the due-soon range first.',
    ])
  })

  it('several refused: how many, then the first one’s reason', () => {
    const panes = resolvePanes({ delegate: { filter: { ...defaultPaneFilter('delegate'), statusIds: [3], negate: { statusIds: true } } } })
    const a = makeTodo({ id: 1, title: 'A', urgent: true, statusId: 3 })
    const b = makeTodo({ id: 2, title: 'B' })
    const res = resolvePaneDrop([a, b], 'delegate', panes, ctx)
    if (res.kind !== 'blocked') throw new Error('expected a refusal')
    expect(blockedPaneLines(panes[2]!, res.blocked, 2, panes, ctx, ctx)).toEqual([
      'Can’t move to Delegate',
      '1 of 2 tasks wouldn’t land in “Delegate”: A is still Delegated.',
      'Change its status first, or edit the pane.',
    ])
  })

  it('preview and undo text name the status, person and tag', () => {
    const change = { todoId: 1, urgent: true, statusId: 4, personId: 1, tagId: 5 }
    expect(dropPreviewLabel([change], ctx)).toBe('+ Urgent · → Waiting · + Ann · + #home')
    expect(dropDescription([change], () => 'Chase vendor', ctx)).toBe('Marked urgent, status Waiting, assigned to Ann, tagged #home · Chase vendor')
    expect(dropDescription([{ todoId: 1, statusId: 4 }, { todoId: 2, statusId: 4 }], () => undefined, ctx)).toBe('Status Waiting · 2 tasks')
  })
})
