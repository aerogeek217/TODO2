import { describe, expect, it } from 'vitest'
import type { Status, Tag } from '../../../models'
import type { BreakdownSplit } from '../../../models/chart-widgets'
import type { TabBadgeRanges } from '../../../models/list-definition'
import {
  ageDays,
  computeBreakdown,
  nextBreakdownSort,
  sortBreakdownRows,
  type BreakdownOptions,
} from '../../../services/stats/breakdown'
import type { StatsContext } from '../../../services/stats/stats-context'
import { makePerson, makeTodo } from '../../helpers'

const today = new Date(2026, 9, 10)
const day = (n: number) => new Date(2026, 9, 10 + n, 9)
const zed = makePerson({ id: 1, name: 'Zed' })
const amy = makePerson({ id: 2, name: 'Amy' })
const bob = makePerson({ id: 3, name: 'Bob' })
const q4: Tag & { id: number } = { id: 1, name: 'q4', color: '#111' }
const home: Tag & { id: number } = { id: 2, name: 'home', color: '#222' }
const status = (id: number, name: string): Status & { id: number } => ({ id, name, color: '#888', sortOrder: id, icon: 'circle' })
const STATUSES = [status(10, 'Todo'), status(11, 'Doing'), status(12, 'Waiting')]
const RANGES: TabBadgeRanges = { due: 3, followup: 0 }

function ctx(over: Partial<StatsContext> = {}): StatsContext {
  return { today, weekStartsOn: 1, urgentRange: 3, assignedPeopleMap: new Map(), assignedTagsMap: new Map(), statuses: STATUSES, ...over }
}

function opts(splitBy: BreakdownSplit, over: Partial<BreakdownOptions> = {}): BreakdownOptions {
  return { splitBy, show: 'count', oldestBy: 'lastFollowup', ranges: RANGES, ...over }
}

const NONE = { focus: 0, urgent: 0, important: 0 }

describe('computeBreakdown — people', () => {
  const tasks = [
    makeTodo({ id: 1, focus: true, dueDate: day(-2) }),
    makeTodo({ id: 2, nextFollowupAt: day(-1) }),
    makeTodo({ id: 3 }),
    makeTodo({ id: 4, nextFollowupAt: day(1), dueDate: day(2) }),
    makeTodo({ id: 5 }),
  ]
  const people = new Map([
    [1, [zed, amy]],
    [2, [zed]],
    [3, [bob, bob]], // a duplicate row counts once
    [4, [amy]],
  ])

  it('a task counts under each of its people; most due + follow-up first, then the open count, then the name; Unassigned last', () => {
    const out = computeBreakdown(tasks, ctx({ assignedPeopleMap: people }), opts('people'))
    expect(out.rows.map((r) => [r.label, r.ids, r.dueIds, r.followupIds])).toEqual([
      ['Amy', [1, 4], [1, 4], []],
      ['Zed', [1, 2], [1], [2]],
      ['Bob', [3], [], []],
      ['Unassigned', [5], [], []],
    ])
    expect(out.rows.map((r) => r.key)).toEqual(['person-2', 'person-1', 'person-3', 'none'])
    expect(out.ids).toEqual([1, 4, 2, 3, 5])
  })

  it('counts each priority (a task with two counts in both; urgent by its due date counts) and the overdue part of Due / Follow-up', () => {
    const out = computeBreakdown(tasks, ctx({ assignedPeopleMap: people }), opts('people'))
    const amyRow = out.rows.find((r) => r.label === 'Amy')
    expect(amyRow?.priority).toEqual({ focus: 1, urgent: 2, important: 0 })
    expect([amyRow?.dueOverdue, amyRow?.followupOverdue]).toEqual([1, 0])
    const zedRow = out.rows.find((r) => r.label === 'Zed')
    expect([zedRow?.followupIds.length, zedRow?.followupOverdue]).toEqual([1, 1])
    expect(out.rows.find((r) => r.label === 'Bob')?.priority).toEqual(NONE)
  })

  it('the ranges decide what Due and Follow-up count (as a list tab\'s badge); off counts nothing', () => {
    const out = computeBreakdown(tasks, ctx({ assignedPeopleMap: people }), opts('people', { ranges: { due: 'overdue', followup: 'off' } }))
    expect(out.rows.find((r) => r.label === 'Amy')?.dueIds).toEqual([1])
    expect(out.rows.every((r) => r.followupIds.length === 0)).toBe(true)
  })

  it('a completed task the filter let through counts in its row but in no Due, Follow-up or priority count', () => {
    const done = makeTodo({ id: 9, isCompleted: true, focus: true, dueDate: day(-1) })
    const out = computeBreakdown([done], ctx({ assignedPeopleMap: new Map([[9, [amy]]]) }), opts('people'))
    expect(out.rows.map((r) => [r.label, r.ids, r.dueIds, r.priority])).toEqual([['Amy', [9], [], NONE]])
  })

  it('no tasks, no rows', () => {
    expect(computeBreakdown([], ctx(), opts('people'))).toEqual({ rows: [], ids: [] })
  })
})

describe('computeBreakdown — the @ / # picks narrow people and tags rows, as a list grouped by them', () => {
  const tasks = [makeTodo({ id: 1 }), makeTodo({ id: 2 }), makeTodo({ id: 3 }), makeTodo({ id: 4 })]
  // 1: Amy and Bob · 2: Bob and Zed · 3: Zed alone · 4: nobody.
  const people = new Map([[1, [amy, bob]], [2, [bob, zed]], [3, [zed]]])
  const rows = (restrictions: number[][]) => computeBreakdown(tasks, ctx({ assignedPeopleMap: people }), opts('people', { restrictions }))
    .rows.map((r) => [r.label, r.ids])

  it('one pick: a task counts under the picked people alone; no Unassigned row', () => {
    expect(rows([[2]])).toEqual([['Amy', [1]]])
  })

  it('several picks of one filter (an or): each task under the ones it has', () => {
    expect(rows([[2, 3]])).toEqual([['Bob', [1, 2]], ['Amy', [1]]])
  })

  it('the filter, the chips and the lens all pick: those all pick win, else any one', () => {
    expect(rows([[2, 3], [3]])).toEqual([['Bob', [1, 2]]])
  })

  it('the Unassigned pick (0) keeps the Unassigned row while every pick has it', () => {
    expect(rows([[0, 2]])).toEqual([['Amy', [1]], ['Unassigned', [4]]])
    expect(rows([[0, 2], [2]])).toEqual([['Amy', [1]]])
  })

  it('tags alike, the none row reading No tags', () => {
    const tags = new Map([[1, [q4, home]], [2, [home]]])
    const out = computeBreakdown(tasks, ctx({ assignedTagsMap: tags }), opts('tags'))
    expect(out.rows.map((r) => [r.label, r.ids])).toEqual([['home', [1, 2]], ['q4', [1]], ['No tags', [3, 4]]])
    expect(computeBreakdown(tasks, ctx({ assignedTagsMap: tags }), opts('tags', { restrictions: [[1]] })).rows.map((r) => [r.label, r.ids]))
      .toEqual([['q4', [1]]])
  })
})

describe('computeBreakdown — status, priority, due and age', () => {
  it('status: Settings order, No status (or a deleted status) last', () => {
    const tasks = [
      makeTodo({ id: 1, statusId: 12 }),
      makeTodo({ id: 2, statusId: 10 }),
      makeTodo({ id: 3, statusId: 10 }),
      makeTodo({ id: 4 }),
      makeTodo({ id: 5, statusId: 99 }),
    ]
    const out = computeBreakdown(tasks, ctx(), opts('status'))
    expect(out.rows.map((r) => [r.label, r.ids])).toEqual([['Todo', [2, 3]], ['Waiting', [1]], ['No status', [4, 5]]])
    expect(out.rows[0]?.color).toBe('#888')
  })

  it('priority: the Priority sort\'s exclusive groups (Focus, Urgent + Important, Urgent, Important), No priority last', () => {
    const tasks = [
      makeTodo({ id: 1, focus: true, urgent: true }),
      makeTodo({ id: 2, urgent: true, important: true }),
      makeTodo({ id: 3, dueDate: day(1) }), // urgent by its due date
      makeTodo({ id: 4, important: true }),
      makeTodo({ id: 5 }),
    ]
    const out = computeBreakdown(tasks, ctx(), opts('priority'))
    expect(out.rows.map((r) => [r.label, r.ids])).toEqual([
      ['Focus', [1]], ['Urgent + Important', [2]], ['Urgent', [3]], ['Important', [4]], ['No priority', [5]],
    ])
  })

  it('due: Overdue, Today, Next 7 days, Later, No due date last', () => {
    const tasks = [
      makeTodo({ id: 1, dueDate: day(9) }),
      makeTodo({ id: 2, dueDate: day(7) }),
      makeTodo({ id: 3, dueDate: day(0) }),
      makeTodo({ id: 4, dueDate: day(-3) }),
      makeTodo({ id: 5 }),
    ]
    expect(computeBreakdown(tasks, ctx(), opts('due')).rows.map((r) => [r.label, r.ids])).toEqual([
      ['Overdue', [4]], ['Today', [3]], ['Next 7 days', [2]], ['Later', [1]], ['No due date', [5]],
    ])
  })

  it('age: by days since created, newest first; no none row', () => {
    const tasks = [
      makeTodo({ id: 1, createdAt: day(-120) }),
      makeTodo({ id: 2, createdAt: day(-30) }),
      makeTodo({ id: 3, createdAt: day(-10) }),
      makeTodo({ id: 4, createdAt: day(0) }),
    ]
    expect(computeBreakdown(tasks, ctx(), opts('age')).rows.map((r) => [r.label, r.ids])).toEqual([
      ['Under a week', [4]], ['1–4 weeks', [3]], ['1–3 months', [2]], ['Over 3 months', [1]],
    ])
  })
})

describe('the oldest task of a row (show: oldest)', () => {
  it('by last follow-up (never followed up: since created), its title and age; the median', () => {
    const tasks = [
      makeTodo({ id: 1, title: 'Vendor quote', lastFollowupAt: day(-19), createdAt: day(-40) }),
      makeTodo({ id: 2, title: 'Fresh', createdAt: day(-2) }),
      makeTodo({ id: 3, title: 'Mid', lastFollowupAt: day(-5), createdAt: day(-30) }),
    ]
    const out = computeBreakdown(tasks, ctx({ assignedPeopleMap: new Map([[1, [amy]], [2, [amy]], [3, [amy]]]) }), opts('people', { show: 'oldest' }))
    expect(out.rows[0]?.oldest).toEqual({ id: 1, title: 'Vendor quote', days: 19 })
    expect(out.rows[0]?.medianDays).toBe(5)
  })

  it('people and tags with `oldest`: oldest first by default (Waiting on)', () => {
    const tasks = [makeTodo({ id: 1, lastFollowupAt: day(-3) }), makeTodo({ id: 2, lastFollowupAt: day(-12) })]
    const out = computeBreakdown(tasks, ctx({ assignedPeopleMap: new Map([[1, [amy]], [2, [bob]]]) }), opts('people', { show: 'oldest' }))
    expect(out.rows.map((r) => [r.label, r.oldest?.days])).toEqual([['Bob', 12], ['Amy', 3]])
  })

  it('ageDays reads each date; by due date, how late (none without one)', () => {
    const t = makeTodo({ id: 1, createdAt: day(-8), modifiedAt: day(-4), dueDate: day(-2) })
    expect(ageDays(t, 'lastFollowup', today)).toBe(8)
    expect(ageDays(t, 'created', today)).toBe(8)
    expect(ageDays(t, 'modified', today)).toBe(4)
    expect(ageDays(t, 'due', today)).toBe(2)
    expect(ageDays(makeTodo({ id: 2 }), 'due', today)).toBeNull()
  })
})

describe('sorting the rows by a heading', () => {
  const tasks = [
    makeTodo({ id: 1, dueDate: day(-1) }),
    makeTodo({ id: 2 }),
    makeTodo({ id: 3 }),
    makeTodo({ id: 4, nextFollowupAt: day(0) }),
    makeTodo({ id: 5 }),
  ]
  // Amy: 1 · Bob: 2, 3, 4 · Zed: none · task 5: nobody.
  const out = computeBreakdown(tasks, ctx({ assignedPeopleMap: new Map([[1, [amy]], [2, [bob]], [3, [bob]], [4, [bob]]]) }), opts('people'))
  const labels = (sort: Parameters<typeof sortBreakdownRows>[1]) => sortBreakdownRows(out.rows, sort, 'count').map((r) => r.label)

  it('the default order as computed; a sort keeps the none row last', () => {
    expect(labels(undefined)).toEqual(['Bob', 'Amy', 'Unassigned'])
    expect(labels({ by: 'name' })).toEqual(['Amy', 'Bob', 'Unassigned'])
    expect(labels({ by: 'name', reversed: true })).toEqual(['Bob', 'Amy', 'Unassigned'])
  })

  it('counts largest first, reversed fewest first; ties in the default order', () => {
    expect(labels({ by: 'open' })).toEqual(['Bob', 'Amy', 'Unassigned'])
    expect(labels({ by: 'open', reversed: true })).toEqual(['Amy', 'Bob', 'Unassigned'])
    expect(labels({ by: 'due' })).toEqual(['Amy', 'Bob', 'Unassigned'])
    expect(labels({ by: 'followup' })).toEqual(['Bob', 'Amy', 'Unassigned'])
  })

  it('a heading click: its default direction, then reversed, then back to the default order', () => {
    expect(nextBreakdownSort(undefined, 'open')).toEqual({ by: 'open' })
    expect(nextBreakdownSort({ by: 'open' }, 'open')).toEqual({ by: 'open', reversed: true })
    expect(nextBreakdownSort({ by: 'open', reversed: true }, 'open')).toBeUndefined()
    expect(nextBreakdownSort({ by: 'open', reversed: true }, 'name')).toEqual({ by: 'name' })
  })
})
