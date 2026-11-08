import { describe, expect, it } from 'vitest'
import type { PersistedTodoItem, Tag } from '../../../models'
import {
  computePulse, cumulative, lateShareText, momentumText, pulseMomentum, worstPulseCard,
} from '../../../services/stats/pulse'
import { makeTodo } from '../../helpers'
import { DST_ZONE, pinTimeZone } from '../../time-zone'

const today = new Date(2026, 10, 11) // Wed 11 Nov; weeks (Sunday first) from 18 Oct, 25 Oct, 1 Nov, 8 Nov
const OLD = new Date(2026, 0, 1)

const ATLAS: Tag = { id: 1, name: 'Project: Atlas', color: '#4f8cff' }
const BETA: Tag = { id: 2, name: 'Project: Beta', color: '#e05050' }
const EMPTY: Tag = { id: 3, name: 'Project: Empty', color: '#34c759' }
const TAGS = [ATLAS, BETA, EMPTY]

function task(overrides: Partial<PersistedTodoItem> & { id: number }): PersistedTodoItem {
  return makeTodo({ createdAt: OLD, modifiedAt: today, ...overrides })
}

function ctxWith(tags: Record<number, Tag[]>) {
  return { today, weekStartsOn: 0 as const, assignedTagsMap: new Map(Object.entries(tags).map(([id, t]) => [Number(id), t])) }
}

describe('computePulse', () => {
  it('no tasks: an empty, steady card per picked tag; a tag deleted since is skipped', () => {
    const cards = computePulse([], TAGS, ctxWith({}), [3, 99, 1], 30)
    expect(cards.map((c) => c.tag.id)).toEqual([3, 1])
    expect(cards[0]).toMatchObject({ openIds: [], lateIds: [], staleCount: 0, lateShare: 0, added: [0, 0, 0, 0], closed: [0, 0, 0, 0], net: 0, momentum: 'steady' })
    expect(momentumText(cards[0]!)).toBe('Steady: +0 net in 4 weeks')
  })

  it('open, late and stale counts, and the late share of the open tasks', () => {
    const tasks = [
      task({ id: 1, dueDate: new Date(2026, 10, 9) }),
      task({ id: 2, dueDate: new Date(2026, 10, 20), modifiedAt: new Date(2026, 8, 1) }),
      task({ id: 3 }),
      task({ id: 4, dueDate: new Date(2026, 10, 1), isCompleted: true, completedAt: OLD }),
    ]
    const [card] = computePulse(tasks, TAGS, ctxWith({ 1: [ATLAS], 2: [ATLAS], 3: [ATLAS, BETA], 4: [ATLAS] }), [1], 30)
    expect(card).toMatchObject({ openIds: [1, 2, 3], lateIds: [1], staleCount: 1 })
    expect(card!.lateShare).toBeCloseTo(1 / 3)
    expect(lateShareText(card!.lateShare)).toBe('33%')
    // Stale off (0): none.
    expect(computePulse(tasks, TAGS, ctxWith({ 2: [ATLAS] }), [1], 0)[0]!.staleCount).toBe(0)
  })

  it('added and closed per week: this week so far and the three before, split at the week start', () => {
    const tasks = [
      task({ id: 1, createdAt: new Date(2026, 9, 17, 23) }), // the day before the first week: not counted
      task({ id: 2, createdAt: new Date(2026, 9, 18, 0, 5) }), // the first week's first minutes
      task({ id: 3, createdAt: new Date(2026, 10, 7, 23, 59) }), // the third week's last day
      task({ id: 4, createdAt: new Date(2026, 10, 8), isCompleted: true, completedAt: new Date(2026, 10, 10) }),
      task({ id: 5, isCompleted: true, completedAt: new Date(2026, 9, 26) }),
      task({ id: 6, isCompleted: true, completedAt: new Date(2026, 10, 12) }), // tomorrow (a bad clock): not counted
    ]
    const map = Object.fromEntries(tasks.map((t) => [t.id, [ATLAS]]))
    const [card] = computePulse(tasks, TAGS, ctxWith(map), [1], 30)
    expect(card!.added).toEqual([1, 0, 1, 1])
    expect(card!.closed).toEqual([0, 1, 0, 1])
    expect(card!.net).toBe(1)
    expect(card!.momentum).toBe('steady')
    expect(cumulative(card!.added)).toEqual([0, 1, 1, 2, 3])
  })

  it('momentum: growing above +2 net, shrinking below 0, steady between', () => {
    expect([-1, 0, 2, 3].map(pulseMomentum)).toEqual(['shrinking', 'steady', 'steady', 'growing'])
    expect(momentumText({ net: 5, momentum: 'growing' })).toBe('Growing: +5 net in 4 weeks')
    expect(momentumText({ net: -2, momentum: 'shrinking' })).toBe('Shrinking: −2 net in 4 weeks')
  })

  it('a task with several picked tags counts under each', () => {
    const cards = computePulse([task({ id: 1, dueDate: new Date(2026, 10, 1) })], TAGS, ctxWith({ 1: [ATLAS, BETA] }), [1, 2], 30)
    expect(cards.map((c) => c.lateIds)).toEqual([[1], [1]])
  })

  it('the worst card: the largest late share, then the most late; none late = none', () => {
    const tasks = [
      task({ id: 1, dueDate: new Date(2026, 10, 1) }), task({ id: 2 }), // Atlas 1 of 2
      task({ id: 3, dueDate: new Date(2026, 10, 1) }), task({ id: 4, dueDate: new Date(2026, 10, 2) }), task({ id: 5 }), task({ id: 6 }), // Beta 2 of 4
    ]
    const cards = computePulse(tasks, TAGS, ctxWith({ 1: [ATLAS], 2: [ATLAS], 3: [BETA], 4: [BETA], 5: [BETA], 6: [BETA] }), [1, 2, 3], 30)
    expect(worstPulseCard(cards)?.tag.id).toBe(2)
    expect(worstPulseCard(cards.filter((c) => c.tag.id === 3))).toBeNull()
    expect(worstPulseCard([])).toBeNull()
  })
})

describe('computePulse in a daylight-saving zone', () => {
  pinTimeZone(DST_ZONE)

  it('its 4 weeks across the fall-back change: added and closed counted by local day', () => {
    const today = new Date(2026, 10, 4) // Wed 4 Nov; weeks from 11 Oct, 18 Oct, 25 Oct and Sun 1 Nov (25 hours)
    const old = new Date(2026, 0, 1)
    const t = (o: Partial<PersistedTodoItem> & { id: number }) => makeTodo({ createdAt: old, modifiedAt: today, ...o })
    const tasks = [
      t({ id: 1, createdAt: new Date(2026, 9, 31, 23, 30) }), // Sat 31 Oct: week 3
      t({ id: 2, createdAt: new Date(2026, 10, 1, 0, 30) }), // Sun 1 Nov: week 4
      t({ id: 3, isCompleted: true, completedAt: new Date(2026, 10, 1, 23, 30) }), // the change's last hour: week 4
      t({ id: 4, isCompleted: true, completedAt: new Date(2026, 9, 11, 0, 30) }), // the first week's first hour
      t({ id: 5, dueDate: new Date(2026, 10, 3) }), // due yesterday: late
      t({ id: 6, dueDate: new Date(2026, 10, 4) }), // due today: not late
    ]
    const assignedTagsMap = new Map(tasks.map((x) => [x.id, [ATLAS]]))
    const [card] = computePulse(tasks, TAGS, { today, weekStartsOn: 0, assignedTagsMap }, [1], 30)
    expect(card?.added).toEqual([0, 0, 1, 1])
    expect(card?.closed).toEqual([1, 0, 0, 1])
    expect(card?.lateIds).toEqual([5])
  })
})
