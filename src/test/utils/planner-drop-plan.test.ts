import { describe, expect, it } from 'vitest'
import { PLANNER_ORDER_MAX } from '../../models/workspace-layout'
import {
  PLANNER_NO_DAY_KEY,
  plannerDayWords,
  plannerDrop,
  plannerDropLabel,
  plannerDropPlan,
  plannerPlacement,
  plannerReorder,
  plannerTargetKey,
  type PlannerDropPosition,
  type PlannerTarget,
  type PlannerTask,
} from '../../utils/planner'

/**
 * What a Planner drop does beyond the one write (`plannerDrop`, in
 * `planner.test.ts`): the hand order with the row where it was dropped
 * (`plannerReorder`), the whole plan (`plannerDropPlan`: the write, the
 * order, whether the row leaves its group), and what the drag says of it
 * (`plannerDropLabel`).
 */

// Fri 20 Nov 2026.
const TODAY = new Date(2026, 10, 20)
const day = (n: number, hour = 0) => new Date(2026, 10, 20 + n, hour)
const WINDOW = { today: TODAY, last: day(6) }
const on = (n: number): PlannerTarget => ({ kind: 'day', day: day(n, 10) })
const NO_DAY: PlannerTarget = { kind: 'noday' }

let seq = 0
function task(over: Partial<PlannerTask> = {}): PlannerTask {
  seq += 1
  return { uid: `t${seq}`, isCompleted: false, sortOrder: seq, ...over }
}

/** Today: a b c; Monday: d e; Focus, no day: f. */
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

  it('holds only the tasks shown, each once', () => {
    // What it is written over is the displayed sequence: a uid an older order kept is not carried.
    expect(plannerReorder('c', at(['a', 'b', 'c'], 0, ['a', 'b', 'b', 'c', 'a', 'd']))).toEqual(['c', 'a', 'b', 'd'])
    expect(plannerReorder('a', at(['a', 'a', 'b'], 1, ['a', 'b']))).toEqual(['b', 'a'])
  })

  it('ignores a negative or fractional place', () => {
    expect(plannerReorder('c', at(['a', 'b', 'c'], -3))).toEqual(['c', 'a', 'b', 'd', 'e', 'f'])
    expect(plannerReorder('c', at(['a', 'b', 'c'], 1.9))).toEqual(['a', 'c', 'b', 'd', 'e', 'f'])
  })

  it('keeps at most the cap, the group dropped into whole', () => {
    const many = Array.from({ length: 12 }, (_, i) => `u${i}`)
    // Dropped into the last group (u10, u11) of a sequence past a cap of 5: that group stays, the rest is cut from the end.
    expect(plannerReorder('u0', at(['u10', 'u11'], 1, many), 5)).toEqual(['u1', 'u2', 'u10', 'u0', 'u11'])
    // Within the cap nothing is cut.
    expect(plannerReorder('u0', at(['u10', 'u11'], 1, many), 12)).toHaveLength(12)
    // A group larger than the cap is cut to it.
    expect(plannerReorder('u0', at(many, 3, many), 4)).toHaveLength(4)
  })

  it('caps at the layout’s limit by default', () => {
    const many = Array.from({ length: PLANNER_ORDER_MAX + 50 }, (_, i) => `u${i}`)
    const order = plannerReorder('u5', at(['u0', 'u5'], 0, many))
    expect(order).toHaveLength(PLANNER_ORDER_MAX)
    expect(order.slice(0, 3)).toEqual(['u5', 'u0', 'u1'])
    expect(new Set(order).size).toBe(order.length)
  })
})

describe('plannerDropPlan', () => {
  it('moves the follow-up of a row placed by it, to the day’s midnight, and the row leaves its group', () => {
    const t = task({ uid: 'a', nextFollowupAt: day(0, 12) })
    expect(plannerDropPlan(t, WINDOW, on(3))).toEqual({ drop: { kind: 'followup', date: day(3) }, moves: true })
  })

  it('gives any other row the day as its Do day; Focus, no day clears one', () => {
    expect(plannerDropPlan(task({ dueDate: day(1) }), WINDOW, on(3))).toEqual({ drop: { kind: 'do', date: day(3) }, moves: true })
    expect(plannerDropPlan(task({ focus: true }), WINDOW, on(0))).toEqual({ drop: { kind: 'do', date: day(0) }, moves: true })
    expect(plannerDropPlan(task({ doDate: day(2) }), WINDOW, NO_DAY)).toEqual({ drop: { kind: 'do', date: undefined }, moves: true })
  })

  it('writes the order with a row that changes day, where it was dropped', () => {
    const t = task({ uid: 'a', nextFollowupAt: day(0) })
    expect(plannerDropPlan(t, WINDOW, on(3), at(['d', 'e'], 1))).toEqual({
      drop: { kind: 'followup', date: day(3) },
      order: ['b', 'c', 'd', 'a', 'e', 'f'],
      moves: true,
    })
    // A list's row: the Planner did not show it yet.
    const foreign = task({ uid: 'new' })
    expect(plannerDropPlan(foreign, WINDOW, on(3), at(['d', 'e'], 0))).toEqual({
      drop: { kind: 'do', date: day(3) },
      order: ['a', 'b', 'c', 'new', 'd', 'e', 'f'],
      moves: true,
    })
  })

  it('reorders a row inside its own group without a write: it stays there', () => {
    const t = task({ uid: 'c', doDate: day(0) })
    expect(plannerDropPlan(t, WINDOW, on(0), at(['a', 'b', 'c'], 0))).toEqual({
      drop: { kind: 'none' },
      order: ['c', 'a', 'b', 'd', 'e', 'f'],
      moves: false,
    })
    // A late task sits in Today: a drop there is a reorder too.
    const late = task({ uid: 'a', dueDate: day(-4) })
    expect(plannerDropPlan(late, WINDOW, on(0), at(['a', 'b', 'c'], 2)).order).toEqual(['b', 'c', 'a', 'd', 'e', 'f'])
    // Focus, no day among its own.
    const focus = task({ uid: 'f', focus: true })
    expect(plannerDropPlan(focus, WINDOW, NO_DAY, at(['f', 'g'], 1, [...SHOWN, 'g']))).toEqual({
      drop: { kind: 'none' },
      order: ['a', 'b', 'c', 'd', 'e', 'g', 'f'],
      moves: false,
    })
  })

  it('stores nothing for a row dropped where it is', () => {
    const t = task({ uid: 'b', doDate: day(0) })
    expect(plannerDropPlan(t, WINDOW, on(0), at(['a', 'b', 'c'], 1))).toEqual({ drop: { kind: 'none' }, moves: false })
    // On a tile: no place at all.
    expect(plannerDropPlan(t, WINDOW, on(0))).toEqual({ drop: { kind: 'none' }, moves: false })
  })

  it('changes nothing for a refused drop: no write, no order', () => {
    const dated = task({ uid: 'd', dueDate: day(3) })
    expect(plannerDropPlan(dated, WINDOW, NO_DAY, at(['f'], 0))).toEqual({ drop: { kind: 'refuse' }, moves: false })
    const done = task({ uid: 'a', isCompleted: true, nextFollowupAt: day(0) })
    expect(plannerDropPlan(done, WINDOW, on(3), at(['d', 'e'], 0))).toEqual({ drop: { kind: 'refuse' }, moves: false })
  })

  it('doesn’t order a task a drop that writes nothing wouldn’t bring into the group', () => {
    // A list's row with no day, not in Focus, dropped on Focus, no day: nothing to do, and it won't show there.
    expect(plannerDropPlan(task({ uid: 'new' }), WINDOW, NO_DAY, at(['f'], 0))).toEqual({ drop: { kind: 'none' }, moves: false })
  })

  it('reads the placement against the window it is given', () => {
    // A follow-up past this week's window is no placement (a Do day); inside next week's it is the row's day.
    const t = task({ nextFollowupAt: day(9) })
    expect(plannerDropPlan(t, WINDOW, on(2)).drop).toEqual({ kind: 'do', date: day(2) })
    expect(plannerDropPlan(t, { today: TODAY, last: day(13) }, on(8)).drop).toEqual({ kind: 'followup', date: day(8) })
  })
})

describe('plannerDrop — a completed task', () => {
  it('is refused everywhere: the Planner holds open tasks', () => {
    const done = task({ isCompleted: true, doDate: day(1), nextFollowupAt: day(0) })
    const placement = plannerPlacement(done, TODAY, day(6))
    expect(plannerDrop(done, placement, on(3))).toEqual({ kind: 'refuse' })
    expect(plannerDrop(done, placement, on(1))).toEqual({ kind: 'refuse' })
    expect(plannerDrop(done, placement, NO_DAY)).toEqual({ kind: 'refuse' })
  })
})

describe('what the drag says', () => {
  it('labels a drop that writes: which date, which day, in that date’s tone', () => {
    expect(plannerDropLabel({ kind: 'followup', date: day(5) }, TODAY)).toEqual({ text: 'Follow-up · Wed, Nov 25', tone: 'followup' })
    expect(plannerDropLabel({ kind: 'do', date: day(5) }, TODAY)).toEqual({ text: 'Do · Wed, Nov 25', tone: 'do' })
    expect(plannerDropLabel({ kind: 'do', date: day(0) }, TODAY)).toEqual({ text: 'Do · Today', tone: 'do' })
    expect(plannerDropLabel({ kind: 'followup', date: day(0) }, TODAY)).toEqual({ text: 'Follow-up · Today', tone: 'followup' })
    expect(plannerDropLabel({ kind: 'do', date: undefined }, TODAY)).toEqual({ text: 'No day', tone: 'do' })
  })

  it('has no label for a refused drop or one that writes nothing', () => {
    expect(plannerDropLabel({ kind: 'refuse' }, TODAY)).toBeNull()
    expect(plannerDropLabel({ kind: 'none' }, TODAY)).toBeNull()
  })

  it('names a day: Today, else in words', () => {
    expect(plannerDayWords(day(0, 15), TODAY)).toBe('Today')
    expect(plannerDayWords(day(1), TODAY)).toBe('Sat, Nov 21')
  })

  it('keys a target as its group and tile are keyed', () => {
    expect(plannerTargetKey(on(3))).toBe('2026-11-23')
    expect(plannerTargetKey(NO_DAY)).toBe(PLANNER_NO_DAY_KEY)
  })
})
