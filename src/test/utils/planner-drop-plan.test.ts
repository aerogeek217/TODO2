import { describe, expect, it } from 'vitest'
import { PLANNER_ORDER_MAX } from '../../models/workspace-layout'
import {
  plannerDayWords,
  plannerMovePlan,
  plannerReorder,
  type PlannerDropPosition,
  type PlannerTarget,
  type PlannerTask,
} from '../../utils/planner'

/**
 * What a Planner drop does beyond the plan write (`plannerDrop`, in
 * `planner.test.ts`): the hand order with the row where it was dropped,
 * merged into the stored one so the tasks not shown keep their places
 * (`plannerReorder` — the trays' rows in the same sequence), and the whole
 * move (`plannerMovePlan`: the plan write, the order, whether the row
 * leaves its group).
 */

// Fri 20 Nov 2026.
const TODAY = new Date(2026, 10, 20)
const day = (n: number, hour = 0) => new Date(2026, 10, 20 + n, hour)
const WINDOW = { today: TODAY, last: day(6) }
const on = (n: number): PlannerTarget => ({ kind: 'day', day: day(n, 10) })
const UNPLANNED: PlannerTarget = { kind: 'unplanned' }
const DELAYED: PlannerTarget = { kind: 'delayed' }

let seq = 0
function task(over: Partial<PlannerTask> = {}): PlannerTask {
  seq += 1
  return { uid: `t${seq}`, isCompleted: false, sortOrder: seq, ...over }
}

/** Today: a b c; Monday: d e; Unplanned: f. */
const SHOWN = ['a', 'b', 'c', 'd', 'e', 'f']
const at = (rows: string[], index: number, shown: readonly string[] = SHOWN): PlannerDropPosition => ({ rows, index, shown })

describe('plannerReorder', () => {
  it('moves a row inside its group: before the row it was dropped before', () => {
    // `index` counts the group's rows without the moved one.
    expect(plannerReorder('c', at(['a', 'b', 'c'], 0))).toEqual(['c', 'a', 'b', 'd', 'e', 'f'])
    expect(plannerReorder('c', at(['a', 'b', 'c'], 1))).toEqual(['a', 'c', 'b', 'd', 'e', 'f'])
    expect(plannerReorder('a', at(['a', 'b', 'c'], 1))).toEqual(['b', 'a', 'c', 'd', 'e', 'f'])
  })

  it('puts a row dropped at a group’s end after its last row, not at the sequence’s end', () => {
    expect(plannerReorder('a', at(['a', 'b', 'c'], 2))).toEqual(['b', 'c', 'a', 'd', 'e', 'f'])
    expect(plannerReorder('a', at(['a', 'b', 'c'], 99))).toEqual(['b', 'c', 'a', 'd', 'e', 'f'])
  })

  it('leaves the sequence as it is for a row dropped where it was', () => {
    expect(plannerReorder('b', at(['a', 'b', 'c'], 1))).toEqual(SHOWN)
    expect(plannerReorder('c', at(['a', 'b', 'c'], 2))).toEqual(SHOWN)
  })

  it('moves a row into another group, where it was dropped', () => {
    expect(plannerReorder('a', at(['d', 'e'], 0))).toEqual(['b', 'c', 'a', 'd', 'e', 'f'])
    expect(plannerReorder('a', at(['d', 'e'], 1))).toEqual(['b', 'c', 'd', 'a', 'e', 'f'])
    expect(plannerReorder('a', at(['d', 'e'], 2))).toEqual(['b', 'c', 'd', 'e', 'a', 'f'])
    expect(plannerReorder('f', at(['a', 'b', 'c'], 1))).toEqual(['a', 'f', 'b', 'c', 'd', 'e'])
  })

  it('takes a row the Planner did not show (a list’s row), and one dropped into a group with no row', () => {
    expect(plannerReorder('new', at(['d', 'e'], 1))).toEqual(['a', 'b', 'c', 'd', 'new', 'e', 'f'])
    expect(plannerReorder('a', at([], 0))).toEqual(['b', 'c', 'd', 'e', 'f', 'a'])
    expect(plannerReorder('new', at([], 0, []))).toEqual(['new'])
  })

  it('holds each task once', () => {
    expect(plannerReorder('c', at(['a', 'b', 'c'], 0, ['a', 'b', 'b', 'c', 'a', 'd']))).toEqual(['c', 'a', 'b', 'd'])
    expect(plannerReorder('a', at(['a', 'a', 'b'], 1, ['a', 'b']))).toEqual(['b', 'a'])
    expect(plannerReorder('a', at(['a', 'b'], 1, ['a', 'b']), { order: ['b', 'a', 'b', 'x', 'a', 'x'] })).toEqual(['b', 'a', 'x'])
  })

  it('ignores a negative or fractional place', () => {
    expect(plannerReorder('c', at(['a', 'b', 'c'], -3))).toEqual(['c', 'a', 'b', 'd', 'e', 'f'])
    expect(plannerReorder('c', at(['a', 'b', 'c'], 1.9))).toEqual(['a', 'c', 'b', 'd', 'e', 'f'])
  })

  it('keeps at most the cap, the group dropped into whole', () => {
    const many = Array.from({ length: 12 }, (_, i) => `u${i}`)
    // Dropped into the last group (u10, u11) of a sequence past a cap of 5: that group stays, the rest is cut from the end.
    expect(plannerReorder('u0', at(['u10', 'u11'], 1, many), { max: 5 })).toEqual(['u1', 'u2', 'u10', 'u0', 'u11'])
    // Within the cap nothing is cut.
    expect(plannerReorder('u0', at(['u10', 'u11'], 1, many), { max: 12 })).toHaveLength(12)
    // A group larger than the cap is cut to it.
    expect(plannerReorder('u0', at(many, 3, many), { max: 4 })).toHaveLength(4)
  })

  it('over the cap, drops the tasks not shown first — the earliest in the sequence first', () => {
    // Shown: a b c; the order also holds four tasks not shown now.
    const order = ['h1', 'a', 'h2', 'b', 'h3', 'c', 'h4']
    const position = at(['a', 'b', 'c'], 0, ['a', 'b', 'c'])
    expect(plannerReorder('c', position, { order })).toEqual(['h1', 'c', 'a', 'h2', 'b', 'h3', 'h4'])
    expect(plannerReorder('c', position, { order, max: 6 })).toEqual(['c', 'a', 'h2', 'b', 'h3', 'h4'])
    expect(plannerReorder('c', position, { order, max: 4 })).toEqual(['c', 'a', 'b', 'h4'])
    // Every task shown stays while a hidden one can go.
    expect(plannerReorder('c', position, { order, max: 3 })).toEqual(['c', 'a', 'b'])
  })

  it('caps at the layout’s limit by default', () => {
    const many = Array.from({ length: PLANNER_ORDER_MAX + 50 }, (_, i) => `u${i}`)
    const order = plannerReorder('u5', at(['u0', 'u5'], 0, many))
    expect(order).toHaveLength(PLANNER_ORDER_MAX)
    expect(order.slice(0, 3)).toEqual(['u5', 'u0', 'u1'])
    expect(new Set(order).size).toBe(order.length)
  })
})

describe('plannerReorder — merged into the stored order', () => {
  it('keeps the place of a task the screen filter hides', () => {
    // Today was hand-ordered c, a, b; a filter hides c; a is dragged below b.
    const order = ['c', 'a', 'b', 'd', 'e', 'f']
    const filtered = at(['a', 'b'], 1, ['a', 'b', 'd', 'e', 'f'])
    const next = plannerReorder('a', filtered, { order })
    // With the filter cleared c is still first, then b, a as dropped.
    expect(next).toEqual(['c', 'b', 'a', 'd', 'e', 'f'])
    // A hidden task between the two rows stays between the rows that keep their places.
    expect(plannerReorder('b', at(['a', 'b'], 0, ['a', 'b']), { order: ['a', 'c', 'b'] })).toEqual(['b', 'a', 'c'])
    expect(plannerReorder('a', at(['a', 'b'], 1, ['a', 'b']), { order: ['a', 'c', 'b'] })).toEqual(['c', 'b', 'a'])
  })

  it('keeps the order of a day outside a shifted window', () => {
    // Wednesday was hand-ordered w2, w1, w3. The window is shifted: Today (t1 t2) and next week (n1 n2) show, Wednesday doesn't.
    const order = ['t1', 't2', 'w2', 'w1', 'w3']
    const shifted = ['t1', 't2', 'n1', 'n2']
    const next = plannerReorder('n2', at(['n1', 'n2'], 0, shifted), { order })
    expect(next.filter((u) => u.startsWith('w'))).toEqual(['w2', 'w1', 'w3'])
    expect(next).toEqual(['t1', 't2', 'n2', 'n1', 'w2', 'w1', 'w3'])
    // A reorder in Today there leaves it alone too.
    expect(plannerReorder('t2', at(['t1', 't2'], 0, shifted), { order })).toEqual(['t2', 't1', 'n1', 'n2', 'w2', 'w1', 'w3'])
  })

  it('moves only the dropped row: every other stored task keeps its position relative to every other', () => {
    const order = ['h1', 'a', 'h2', 'b', 'h3', 'c', 'h4', 'd', 'h5']
    const without = (list: string[], uid: string) => list.filter((u) => u !== uid)
    for (const [uid, index] of [['a', 2], ['c', 0], ['b', 1], ['b', 0], ['a', 1]] as const) {
      const next = plannerReorder(uid, at(['a', 'b', 'c'], index, ['a', 'b', 'c', 'd']), { order })
      expect(without(next, uid)).toEqual(without(order, uid))
      expect(next.filter((u) => ['a', 'b', 'c'].includes(u))).toEqual((() => {
        const rows = without(['a', 'b', 'c'], uid)
        rows.splice(index, 0, uid)
        return rows
      })())
    }
  })

  it('gives every task shown a place, so each group reads as it does now', () => {
    // The order holds a and b; Today shows a, b, then x and y the order never held (after them, by the default order).
    const order = ['a', 'h', 'b']
    const shown = ['a', 'b', 'x', 'y', 'm1', 'm2']
    // y dragged above x: x must be listed for y to stand before it.
    expect(plannerReorder('y', at(['a', 'b', 'x', 'y'], 2, shown), { order })).toEqual(['a', 'h', 'b', 'y', 'x', 'm1', 'm2'])
    // A row of another group joining Today between a and b.
    expect(plannerReorder('m2', at(['a', 'b', 'x', 'y'], 1, shown), { order })).toEqual(['a', 'm2', 'h', 'b', 'x', 'y', 'm1'])
    // Nothing stored yet: the displayed sequence.
    expect(plannerReorder('b', at(['a', 'b', 'x', 'y'], 0, shown))).toEqual(['b', 'a', 'x', 'y', 'm1', 'm2'])
  })

  it('drops only the tasks that no longer exist', () => {
    const order = ['gone', 'c', 'a', 'purged', 'b', 'done']
    const exists = (uid: string) => !['gone', 'purged'].includes(uid)
    // c is hidden by a filter, done is completed (not shown, still a task): both stay.
    expect(plannerReorder('a', at(['a', 'b'], 1, ['a', 'b']), { order, exists })).toEqual(['c', 'b', 'a', 'done'])
    // Without a way to tell, nothing stored is dropped.
    expect(plannerReorder('a', at(['a', 'b'], 1, ['a', 'b']), { order })).toEqual(['gone', 'c', 'purged', 'b', 'a', 'done'])
    // A task shown exists, whatever the check says.
    expect(plannerReorder('a', at(['a', 'b'], 1, ['a', 'b']), { order: ['a', 'b'], exists: () => false })).toEqual(['b', 'a'])
  })

  it('puts a row dropped into a group with no other row at the end, the rest as stored', () => {
    expect(plannerReorder('a', at([], 0, ['a', 'b']), { order: ['a', 'h', 'b'] })).toEqual(['h', 'b', 'a'])
  })
})

describe('the order merge with the two trays', () => {
  /** Today: a b; Monday: d; Delayed: x y; Unplanned: f g. */
  const WITH_TRAYS = ['a', 'b', 'd', 'x', 'y', 'f', 'g']

  it('reorders inside Delayed and inside Unplanned, the rest as it was', () => {
    expect(plannerReorder('y', at(['x', 'y'], 0, WITH_TRAYS))).toEqual(['a', 'b', 'd', 'y', 'x', 'f', 'g'])
    expect(plannerReorder('f', at(['f', 'g'], 1, WITH_TRAYS))).toEqual(['a', 'b', 'd', 'x', 'y', 'g', 'f'])
  })

  it('moves a row between a day and a tray, where it was dropped', () => {
    // Monday's row unplanned between f and g.
    expect(plannerReorder('d', at(['f', 'g'], 1, WITH_TRAYS))).toEqual(['a', 'b', 'x', 'y', 'f', 'd', 'g'])
    // A Delayed row planned for today, first.
    expect(plannerReorder('x', at(['a', 'b'], 0, WITH_TRAYS))).toEqual(['x', 'a', 'b', 'd', 'y', 'f', 'g'])
    // An Unplanned row onto Monday, last.
    expect(plannerReorder('g', at(['d'], 1, WITH_TRAYS))).toEqual(['a', 'b', 'd', 'g', 'x', 'y', 'f'])
  })

  it('keeps the stored places of the trays’ rows while a filter hides them', () => {
    const order = ['y', 'a', 'x', 'g', 'b', 'f']
    // Only Today shows; b is dragged above a.
    const next = plannerReorder('b', at(['a', 'b'], 0, ['a', 'b']), { order })
    expect(next).toEqual(['y', 'b', 'a', 'x', 'g', 'f'])
    expect(next.filter((u) => ['x', 'y'].includes(u))).toEqual(['y', 'x'])
    expect(next.filter((u) => ['f', 'g'].includes(u))).toEqual(['g', 'f'])
  })
})

describe('plannerMovePlan', () => {
  it('plans a row for the day it is dropped on — by its follow-up, its due date or no date — and the row leaves its group', () => {
    expect(plannerMovePlan(task({ nextFollowupAt: day(0, 12) }), WINDOW, on(3))).toEqual({ drop: { kind: 'plan', day: day(3) }, moves: true })
    expect(plannerMovePlan(task({ dueDate: day(1) }), WINDOW, on(3))).toEqual({ drop: { kind: 'plan', day: day(3) }, moves: true })
    expect(plannerMovePlan(task({ focus: true }), WINDOW, on(0))).toEqual({ drop: { kind: 'plan', day: day(0) }, moves: true })
  })

  it('clears the plan on the task’s own date’s day, and unplans on Unplanned', () => {
    expect(plannerMovePlan(task({ doDate: day(4), dueDate: day(2) }), WINDOW, on(2))).toEqual({ drop: { kind: 'own', day: day(2) }, moves: true })
    expect(plannerMovePlan(task({ doDate: day(2), dueDate: day(1) }), WINDOW, UNPLANNED)).toEqual({ drop: { kind: 'unplan', hold: true }, moves: true })
    expect(plannerMovePlan(task({ doDate: day(2), focus: true }), WINDOW, UNPLANNED)).toEqual({ drop: { kind: 'unplan', hold: false }, moves: true })
  })

  it('writes the order with a row that changes group, where it was dropped', () => {
    const t = task({ uid: 'a', nextFollowupAt: day(0) })
    expect(plannerMovePlan(t, WINDOW, on(3), at(['d', 'e'], 1))).toEqual({
      drop: { kind: 'plan', day: day(3) },
      order: ['b', 'c', 'd', 'a', 'e', 'f'],
      moves: true,
    })
    // A list's row: the Planner did not show it yet.
    const foreign = task({ uid: 'new' })
    expect(plannerMovePlan(foreign, WINDOW, on(3), at(['d', 'e'], 0))).toEqual({
      drop: { kind: 'plan', day: day(3) },
      order: ['a', 'b', 'c', 'new', 'd', 'e', 'f'],
      moves: true,
    })
    // A dated row held in Unplanned, above f.
    const dated = task({ uid: 'd', dueDate: day(3) })
    expect(plannerMovePlan(dated, WINDOW, UNPLANNED, at(['f'], 0))).toEqual({
      drop: { kind: 'unplan', hold: true },
      order: ['a', 'b', 'c', 'e', 'd', 'f'],
      moves: true,
    })
  })

  it('reorders a row inside its own group without a write: it stays there', () => {
    const t = task({ uid: 'c', doDate: day(0) })
    expect(plannerMovePlan(t, WINDOW, on(0), at(['a', 'b', 'c'], 0))).toEqual({
      drop: { kind: 'none' },
      order: ['c', 'a', 'b', 'd', 'e', 'f'],
      moves: false,
    })
    // A late task sits in Today: a drop there is a reorder too.
    const late = task({ uid: 'a', dueDate: day(-4) })
    expect(plannerMovePlan(late, WINDOW, on(0), at(['a', 'b', 'c'], 2)).order).toEqual(['b', 'c', 'a', 'd', 'e', 'f'])
    // Unplanned among its own: a Focus row and a held one.
    const focus = task({ uid: 'f', focus: true })
    expect(plannerMovePlan(focus, WINDOW, UNPLANNED, at(['f', 'g'], 1, [...SHOWN, 'g']))).toEqual({
      drop: { kind: 'none' },
      order: ['a', 'b', 'c', 'd', 'e', 'g', 'f'],
      moves: false,
    })
    const held = task({ uid: 'g', unplanned: true, dueDate: day(1) })
    expect(plannerMovePlan(held, WINDOW, UNPLANNED, at(['f', 'g'], 0, [...SHOWN, 'g'])).order).toEqual(['a', 'b', 'c', 'd', 'e', 'g', 'f'])
    // Delayed among its own: the one drop Delayed takes.
    const missed = task({ uid: 'y', doDate: day(-2) })
    expect(plannerMovePlan(missed, WINDOW, DELAYED, at(['x', 'y'], 0, ['a', 'x', 'y']))).toEqual({
      drop: { kind: 'none' },
      order: ['a', 'y', 'x'],
      moves: false,
    })
  })

  it('stores nothing for a row dropped where it is', () => {
    const t = task({ uid: 'b', doDate: day(0) })
    expect(plannerMovePlan(t, WINDOW, on(0), at(['a', 'b', 'c'], 1))).toEqual({ drop: { kind: 'none' }, moves: false })
    // On a tile: no place at all.
    expect(plannerMovePlan(t, WINDOW, on(0))).toEqual({ drop: { kind: 'none' }, moves: false })
  })

  it('changes nothing for a refused drop: no write, no order', () => {
    // Delayed takes no drop.
    const dated = task({ uid: 'd', dueDate: day(3) })
    expect(plannerMovePlan(dated, WINDOW, DELAYED, at(['x'], 0))).toEqual({ drop: { kind: 'refuse' }, moves: false })
    const done = task({ uid: 'a', isCompleted: true, nextFollowupAt: day(0) })
    expect(plannerMovePlan(done, WINDOW, on(3), at(['d', 'e'], 0))).toEqual({ drop: { kind: 'refuse' }, moves: false })
    // A list's row with no plan and no date, not in Focus, dropped on Unplanned: it wouldn't show there.
    expect(plannerMovePlan(task({ uid: 'new' }), WINDOW, UNPLANNED, at(['f'], 0))).toEqual({ drop: { kind: 'refuse' }, moves: false })
  })

  it('merges the place into the stored order it is given', () => {
    const t = task({ uid: 'a', doDate: day(0) })
    const exists = (uid: string) => uid !== 'gone'
    expect(plannerMovePlan(t, WINDOW, on(0), at(['a', 'b'], 1, ['a', 'b']), { order: ['c', 'a', 'gone', 'b'], exists }).order).toEqual(['c', 'b', 'a'])
    // Dropped where it is: nothing to store, whatever the stored order holds.
    expect(plannerMovePlan(t, WINDOW, on(0), at(['a', 'b'], 0, ['a', 'b']), { order: ['c', 'a', 'gone', 'b'], exists }).order).toBeUndefined()
  })

  it('reads the task’s natural day against the window it is given', () => {
    // A follow-up past this week's window is no natural day: the task is planned and stays planned there.
    const t = task({ nextFollowupAt: day(9), doDate: day(3) })
    expect(plannerMovePlan(t, WINDOW, on(2)).drop).toEqual({ kind: 'plan', day: day(2) })
    // Next week's window reaches the follow-up: a drop on its day clears the plan.
    expect(plannerMovePlan(t, { today: TODAY, last: day(13) }, on(9)).drop).toEqual({ kind: 'own', day: day(9) })
    expect(plannerMovePlan(t, { today: TODAY, last: day(13) }, on(8)).drop).toEqual({ kind: 'plan', day: day(8) })
  })
})

describe('what the drag says', () => {
  it('names a day: Today, else in words', () => {
    expect(plannerDayWords(day(0, 15), TODAY)).toBe('Today')
    expect(plannerDayWords(day(1), TODAY)).toBe('Sat, Nov 21')
  })
})
