import { describe, expect, it } from 'vitest'
import { DST_ZONE, pinTimeZone } from '../time-zone'
import { dayKey } from '../../utils/date'
import {
  inPlanner,
  PLANNER_DELAYED_KEY,
  PLANNER_TILE_TICKS_MAX,
  PLANNER_UNPLANNED_KEY,
  plannerConflictLabel,
  plannerConflicts,
  plannerDayLabel,
  plannerDrop,
  plannerDropLabel,
  plannerDropWrite,
  plannerFixClearsPlan,
  plannerFixLabel,
  plannerNaturalDay,
  plannerOffset,
  plannerOrder,
  plannerPlacement,
  plannerRangeLabel,
  plannerResetCounts,
  plannerResetTasks,
  plannerSnooze,
  plannerSnoozeDay,
  plannerLateDates,
  plannerRowTag,
  plannerRowTagHint,
  plannerRowTagLabel,
  plannerTagDay,
  plannerTargetKey,
  plannerTileLabel,
  plannerTileMarks,
  plannerUnplan,
  plannerUnplanDelayed,
  plannerView,
  plannerWindow,
  type PlannerConflict,
  type PlannerDrop,
  type PlannerNaturalDay,
  type PlannerPlacement,
  type PlannerResetScope,
  type PlannerTarget,
  type PlannerTask,
} from '../../utils/planner'

// Fri 20 Nov 2026.
const TODAY = new Date(2026, 10, 20)
const day = (n: number, hour = 0) => new Date(2026, 10, 20 + n, hour)
const SPAN = plannerWindow(TODAY)

let seq = 0
function task(over: Partial<PlannerTask> = {}): PlannerTask & { id: number } {
  seq += 1
  return { id: seq, uid: `t${seq}`, isCompleted: false, sortOrder: seq, ...over }
}

const uids = (tasks: readonly PlannerTask[]) => tasks.map((t) => t.uid)

describe('plannerOffset / plannerWindow', () => {
  it('keeps whole weeks, never before this week', () => {
    expect(plannerOffset(0)).toBe(0)
    expect(plannerOffset(7)).toBe(7)
    expect(plannerOffset(13)).toBe(7)
    expect(plannerOffset(-7)).toBe(0)
    expect(plannerOffset(Number.NaN)).toBe(0)
  })

  it('is seven days from today, at midnight', () => {
    const w = plannerWindow(new Date(2026, 10, 20, 15, 30))
    expect(w.days.map(dayKey)).toEqual(['2026-11-20', '2026-11-21', '2026-11-22', '2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26'])
    expect(w.today.getTime()).toBe(TODAY.getTime())
    expect(dayKey(w.first)).toBe('2026-11-20')
    expect(dayKey(w.last)).toBe('2026-11-26')
  })

  it('shifts by its offset and keeps today', () => {
    const w = plannerWindow(TODAY, 14)
    expect(dayKey(w.first)).toBe('2026-12-04')
    expect(dayKey(w.last)).toBe('2026-12-10')
    expect(dayKey(w.today)).toBe('2026-11-20')
  })
})

describe('plannerNaturalDay', () => {
  const natural = (over: Partial<PlannerTask>) => {
    const n: PlannerNaturalDay | null = plannerNaturalDay(task(over), SPAN)
    return n ? [dayKey(n.day), dayKey(n.date), n.reason] : null
  }

  it('is the earlier of the follow-up and the due date', () => {
    expect(natural({ dueDate: day(2), nextFollowupAt: day(4) })).toEqual(['2026-11-22', '2026-11-22', 'due'])
    expect(natural({ dueDate: day(4), nextFollowupAt: day(2) })).toEqual(['2026-11-22', '2026-11-22', 'followup'])
  })

  it('a tie is the due date’s, whatever their times', () => {
    expect(natural({ dueDate: day(2), nextFollowupAt: day(2, 12) })).toEqual(['2026-11-22', '2026-11-22', 'due'])
    expect(natural({ dueDate: day(2, 18), nextFollowupAt: day(2) })).toEqual(['2026-11-22', '2026-11-22', 'due'])
  })

  it('is by the one date it has', () => {
    expect(natural({ nextFollowupAt: day(1) })).toEqual(['2026-11-21', '2026-11-21', 'followup'])
    expect(natural({ dueDate: day(1) })).toEqual(['2026-11-21', '2026-11-21', 'due'])
  })

  it('a date before today counts as today, keeping the date', () => {
    expect(natural({ dueDate: day(-3) })).toEqual(['2026-11-20', '2026-11-17', 'due'])
    expect(natural({ nextFollowupAt: day(-9), dueDate: day(2) })).toEqual(['2026-11-20', '2026-11-11', 'followup'])
    expect(natural({ nextFollowupAt: day(-2), dueDate: day(-2) })).toEqual(['2026-11-20', '2026-11-18', 'due'])
  })

  it('none when the earlier date is past the window, even with a later one, or with no date', () => {
    expect(natural({})).toBeNull()
    expect(natural({ dueDate: day(7) })).toBeNull()
    expect(natural({ nextFollowupAt: day(8), dueDate: day(9) })).toBeNull()
  })

  it('reads the last day inclusively', () => {
    expect(natural({ dueDate: day(6) })?.[2]).toBe('due')
    expect(natural({ nextFollowupAt: day(6, 23) })?.[2]).toBe('followup')
  })

  it('is not moved by a plan: a planned or held task keeps its own day', () => {
    expect(natural({ dueDate: day(2), doDate: day(5) })).toEqual(['2026-11-22', '2026-11-22', 'due'])
    expect(natural({ nextFollowupAt: day(3), unplanned: true })).toEqual(['2026-11-23', '2026-11-23', 'followup'])
  })
})

describe('inPlanner', () => {
  it('holds Focus tasks, planned tasks, held tasks and tasks with a natural day', () => {
    expect(inPlanner(task({ focus: true }), SPAN)).toBe(true)
    expect(inPlanner(task({ doDate: day(30) }), SPAN)).toBe(true)
    expect(inPlanner(task({ unplanned: true }), SPAN)).toBe(true)
    expect(inPlanner(task({ dueDate: day(6) }), SPAN)).toBe(true)
    expect(inPlanner(task({ nextFollowupAt: day(6, 12) }), SPAN)).toBe(true)
    expect(inPlanner(task({ dueDate: day(-40) }), SPAN)).toBe(true)
  })

  it('leaves out the rest', () => {
    expect(inPlanner(task(), SPAN)).toBe(false)
    expect(inPlanner(task({ dueDate: day(7) }), SPAN)).toBe(false)
    expect(inPlanner(task({ nextFollowupAt: day(7) }), SPAN)).toBe(false)
    expect(inPlanner(task({ focus: true, isCompleted: true }), SPAN)).toBe(false)
    expect(inPlanner(task({ doDate: day(0), isCompleted: true }), SPAN)).toBe(false)
    expect(inPlanner(task({ unplanned: true, isCompleted: true }), SPAN)).toBe(false)
  })
})

describe('plannerPlacement: where a task sits', () => {
  const place = (over: Partial<PlannerTask>) => plannerPlacement(task(over), SPAN)
  /** where · the day it sits on · why · placed. */
  const shape = (p: PlannerPlacement | null) => (p ? [p.where, p.day ? dayKey(p.day) : null, p.reason, p.placed] : null)

  it('held → the Unplanned tray, whatever its dates — and it keeps the day it came off', () => {
    const held = place({ unplanned: true, dueDate: day(2), nextFollowupAt: day(1) })
    expect(shape(held)).toEqual(['unplanned', null, 'held', true])
    expect(held?.natural && dayKey(held.natural.day)).toBe('2026-11-21')
    expect(held?.planned).toBeNull()
  })

  it('a held task whose dates move stays held: later, earlier, past the window, or gone', () => {
    for (const dates of [{ dueDate: day(5) }, { dueDate: day(-3) }, { dueDate: day(40) }, {}] as Partial<PlannerTask>[]) {
      expect(shape(place({ unplanned: true, ...dates }))).toEqual(['unplanned', null, 'held', true])
    }
    expect(place({ unplanned: true, dueDate: day(40) })?.natural).toBeNull()
    expect(place({ unplanned: true })?.natural).toBeNull()
  })

  it('a planned day before today → the Delayed tray, never Today', () => {
    const delayed = place({ doDate: day(-1), dueDate: day(0) })
    expect(shape(delayed)).toEqual(['delayed', null, 'plan', true])
    expect(delayed?.planned && dayKey(delayed.planned)).toBe('2026-11-19')
    expect(delayed?.natural && dayKey(delayed.natural.day)).toBe('2026-11-20')
    expect(delayed?.conflicts).toEqual([])
    expect(shape(place({ doDate: day(-30) }))).toEqual(['delayed', null, 'plan', true])
  })

  it('a planned day inside the window → that day, today included, whatever its other dates', () => {
    expect(shape(place({ doDate: day(0, 9) }))).toEqual(['day', '2026-11-20', 'plan', true])
    expect(shape(place({ doDate: day(3), dueDate: day(1), nextFollowupAt: day(0) }))).toEqual(['day', '2026-11-23', 'plan', true])
    expect(shape(place({ doDate: day(6) }))).toEqual(['day', '2026-11-26', 'plan', true])
  })

  it('a planned day beyond the window’s last day → not shown in this window', () => {
    expect(place({ doDate: day(7) })).toBeNull()
    expect(place({ doDate: day(20), dueDate: day(1), focus: true })).toBeNull()
    // The window that reaches it shows it.
    expect(shape(plannerPlacement(task({ doDate: day(7) }), plannerWindow(TODAY, 7)))).toEqual(['day', '2026-11-27', 'plan', true])
  })

  it('no plan → its natural day, with the reason; not placed', () => {
    expect(shape(place({ dueDate: day(2), nextFollowupAt: day(4) }))).toEqual(['day', '2026-11-22', 'due', false])
    expect(shape(place({ dueDate: day(4), nextFollowupAt: day(2) }))).toEqual(['day', '2026-11-22', 'followup', false])
    expect(shape(place({ dueDate: day(2), nextFollowupAt: day(2) }))).toEqual(['day', '2026-11-22', 'due', false])
    expect(shape(place({ dueDate: day(-3) }))).toEqual(['day', '2026-11-20', 'due', false])
    expect(shape(place({ nextFollowupAt: day(-9), dueDate: day(2) }))).toEqual(['day', '2026-11-20', 'followup', false])
  })

  it('no plan and no natural day: a Focus task → Unplanned, anything else is not in the widget', () => {
    expect(shape(place({ focus: true }))).toEqual(['unplanned', null, 'focus', false])
    expect(shape(place({ focus: true, dueDate: day(7) }))).toEqual(['unplanned', null, 'focus', false])
    expect(shape(place({ focus: true, nextFollowupAt: day(8), dueDate: day(9) }))).toEqual(['unplanned', null, 'focus', false])
    expect(place({})).toBeNull()
    expect(place({ dueDate: day(7) })).toBeNull()
  })

  it('a Focus task with a natural day sits on it, not in Unplanned', () => {
    expect(shape(place({ focus: true, dueDate: day(3) }))).toEqual(['day', '2026-11-23', 'due', false])
  })

  it('completed tasks are not shown, whatever their plan', () => {
    expect(place({ isCompleted: true, doDate: day(1) })).toBeNull()
    expect(place({ isCompleted: true, unplanned: true })).toBeNull()
    expect(place({ isCompleted: true, dueDate: day(0), focus: true })).toBeNull()
  })

  it('a row both planned and held (a hand-made row) reads as planned', () => {
    expect(shape(place({ doDate: day(2), unplanned: true }))).toEqual(['day', '2026-11-22', 'plan', true])
  })
})

describe('conflicts: a plan that falls after a real date', () => {
  const conflicts = (over: Partial<PlannerTask>): PlannerConflict[] => plannerPlacement(task(over), SPAN)?.conflicts ?? []

  it('none when the plan is on or before its dates, or the task has none', () => {
    expect(conflicts({ doDate: day(2) })).toEqual([])
    expect(conflicts({ doDate: day(2), dueDate: day(2) })).toEqual([])
    expect(conflicts({ doDate: day(2), dueDate: day(3), nextFollowupAt: day(2, 15) })).toEqual([])
  })

  it('days after due, with both fixes while that day is today or later', () => {
    expect(conflicts({ doDate: day(3), dueDate: day(1) })).toEqual([{
      date: 'due', on: day(1), days: 2,
      fixes: [{ kind: 'move-date', date: 'due', to: day(3) }, { kind: 'plan', day: day(1) }],
    }])
    // Due today: planning for today is still on offer.
    expect(conflicts({ doDate: day(1), dueDate: day(0, 17) })).toEqual([{
      date: 'due', on: day(0), days: 1,
      fixes: [{ kind: 'move-date', date: 'due', to: day(1) }, { kind: 'plan', day: day(0) }],
    }])
  })

  it('days after follow-up likewise', () => {
    expect(conflicts({ doDate: day(4), nextFollowupAt: day(3) })).toEqual([{
      date: 'followup', on: day(3), days: 1,
      fixes: [{ kind: 'move-date', date: 'followup', to: day(4) }, { kind: 'plan', day: day(3) }],
    }])
  })

  it('a date already past offers only moving it', () => {
    expect(conflicts({ doDate: day(2), dueDate: day(-3) })).toEqual([{
      date: 'due', on: day(-3), days: 5, fixes: [{ kind: 'move-date', date: 'due', to: day(2) }],
    }])
  })

  it('both dates, the due date first; a plan for today after late dates', () => {
    expect(conflicts({ doDate: day(0), dueDate: day(-1), nextFollowupAt: day(-2) }).map((c) => [c.date, c.days, c.fixes.length])).toEqual([
      ['due', 1, 1], ['followup', 2, 1],
    ])
    expect(conflicts({ doDate: day(5), dueDate: day(4), nextFollowupAt: day(1) }).map((c) => [c.date, c.days])).toEqual([['due', 1], ['followup', 4]])
  })

  it('only for a row on its planned day: none in Delayed, in Unplanned or without a plan', () => {
    expect(conflicts({ doDate: day(-1), dueDate: day(-5) })).toEqual([])
    expect(conflicts({ unplanned: true, dueDate: day(-5) })).toEqual([])
    expect(conflicts({ dueDate: day(-5) })).toEqual([])
    // The pure check says what a plan for a day would fall after, whatever the task holds.
    expect(plannerConflicts({ dueDate: day(-5) }, day(-1), TODAY).map((c) => c.days)).toEqual([4])
  })

  it('in words', () => {
    expect(plannerConflictLabel({ date: 'due', days: 1 })).toBe('1 day after due')
    expect(plannerConflictLabel({ date: 'due', days: 3 })).toBe('3 days after due')
    expect(plannerConflictLabel({ date: 'followup', days: 2 })).toBe('2 days after follow-up')
    expect(plannerFixLabel({ kind: 'move-date', date: 'due', to: day(5) }, TODAY)).toBe('Move due date to Wed, Nov 25')
    expect(plannerFixLabel({ kind: 'move-date', date: 'followup', to: day(0) }, TODAY)).toBe('Move follow-up to Today')
    expect(plannerFixLabel({ kind: 'plan', day: day(3) }, TODAY)).toBe('Plan for Mon, Nov 23')
  })
})

describe('plannerOrder', () => {
  it('lists the ordered tasks first, then the rest by reason, date and sort order', () => {
    const due = task({ dueDate: day(0) })
    const lateDue = task({ dueDate: day(-2) })
    const followup = task({ nextFollowupAt: day(0) })
    const planned = task({ doDate: day(0), sortOrder: 9 })
    const plannedFirst = task({ doDate: day(0), sortOrder: 1 })
    const view = plannerView([planned, followup, due, plannedFirst, lateDue], { today: TODAY })
    expect(uids(view.today.tasks)).toEqual(uids([lateDue, due, followup, plannedFirst, planned]))
    const ordered = plannerOrder(view.today.tasks, view.placements, [planned.uid, 'gone', followup.uid, planned.uid])
    expect(uids(ordered)).toEqual(uids([planned, followup, lateDue, due, plannedFirst]))
  })

  it('orders Delayed by the day planned, oldest first; Unplanned held rows before Focus ones', () => {
    const recent = task({ doDate: day(-1) })
    const old = task({ doDate: day(-9) })
    const focusB = task({ focus: true, sortOrder: 5 })
    const focusA = task({ focus: true, sortOrder: 2 })
    const heldLate = task({ unplanned: true, dueDate: day(4) })
    const heldSoon = task({ unplanned: true, nextFollowupAt: day(1) })
    const view = plannerView([recent, old, focusB, focusA, heldLate, heldSoon], { today: TODAY })
    expect(uids(view.delayed.tasks)).toEqual(uids([old, recent]))
    expect(uids(view.unplanned.tasks)).toEqual(uids([heldSoon, heldLate, focusA, focusB]))
  })

  it('the hand order holds in the trays too', () => {
    const a = task({ doDate: day(-1) })
    const b = task({ doDate: day(-2) })
    const c = task({ focus: true })
    const d = task({ unplanned: true, dueDate: day(1) })
    const view = plannerView([a, b, c, d], { today: TODAY, order: [c.uid, a.uid] })
    expect(uids(view.delayed.tasks)).toEqual(uids([a, b]))
    expect(uids(view.unplanned.tasks)).toEqual(uids([c, d]))
  })
})

describe('plannerView', () => {
  it('groups Today, every day ahead, Delayed and Unplanned', () => {
    const late = task({ dueDate: day(-5) })
    const now = task({ nextFollowupAt: day(0) })
    const plannedToday = task({ doDate: day(0), dueDate: day(4) })
    const mon = task({ doDate: day(3) })
    const thu = task({ dueDate: day(6) })
    const missed = task({ doDate: day(-1), dueDate: day(0) })
    const held = task({ unplanned: true, dueDate: day(2) })
    const focus = task({ focus: true })
    const done = task({ dueDate: day(0), isCompleted: true })
    const far = task({ dueDate: day(7) })
    const plannedFar = task({ doDate: day(8) })
    const plain = task()
    const view = plannerView([late, now, plannedToday, mon, thu, missed, held, focus, done, far, plannedFar, plain], { today: TODAY })
    expect(view.today.kind).toBe('today')
    expect(view.today.key).toBe('2026-11-20')
    // A plan whose day has passed is in Delayed, not Today.
    expect(uids(view.today.tasks)).toEqual(uids([late, now, plannedToday]))
    expect(view.days.map((g) => [g.key, g.tasks.length])).toEqual([
      ['2026-11-21', 0], ['2026-11-22', 0], ['2026-11-23', 1], ['2026-11-24', 0], ['2026-11-25', 0], ['2026-11-26', 1],
    ])
    expect(view.delayed).toMatchObject({ key: PLANNER_DELAYED_KEY, kind: 'delayed', day: null })
    expect(uids(view.delayed.tasks)).toEqual(uids([missed]))
    expect(view.unplanned).toMatchObject({ key: PLANNER_UNPLANNED_KEY, kind: 'unplanned', day: null })
    expect(uids(view.unplanned.tasks)).toEqual(uids([held, focus]))
    // Display order: Today, the days, Delayed, Unplanned.
    expect(uids(view.tasks)).toEqual(uids([late, now, plannedToday, mon, thu, missed, held, focus]))
    expect([...view.placements.keys()].sort()).toEqual(uids(view.tasks).sort())
    expect(view.tasks.filter((t) => view.placements.get(t.uid)?.placed).map((t) => t.uid)).toEqual(uids([plannedToday, mon, missed, held]))
  })

  it('lists every later day of the window after Today, the empty ones too', () => {
    const sat = task({ doDate: day(1) })
    const tue = task({ doDate: day(4) })
    const view = plannerView([sat, tue], { today: TODAY })
    expect(view.days.map((g) => g.key)).toEqual(['2026-11-21', '2026-11-22', '2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26'])
    expect(view.days.map((g) => g.tasks.length)).toEqual([1, 0, 0, 1, 0, 0])
    expect(view.tiles.map((t) => t.count)).toEqual([0, 1, 0, 0, 1, 0, 0])
    expect(uids(view.tasks)).toEqual(uids([sat, tue]))
  })

  it('applies the hand order inside each group', () => {
    const a = task({ doDate: day(0) })
    const b = task({ doDate: day(0) })
    const c = task({ doDate: day(1) })
    const d = task({ doDate: day(1) })
    const view = plannerView([a, b, c, d], { today: TODAY, order: [d.uid, b.uid] })
    expect(uids(view.today.tasks)).toEqual(uids([b, a]))
    expect(uids(view.days[0]?.tasks ?? [])).toEqual(uids([d, c]))
  })

  describe('tiles', () => {
    it('count the rows sitting on each day', () => {
      const tasks = [
        task({ dueDate: day(-1) }), task({ nextFollowupAt: day(0) }), task({ doDate: day(0) }),
        task({ doDate: day(2) }), task({ dueDate: day(2) }), task({ nextFollowupAt: day(2) }),
        // In the trays: on no tile's count.
        task({ doDate: day(-1) }), task({ unplanned: true, dueDate: day(1) }), task({ focus: true }),
      ]
      const view = plannerView(tasks, { today: TODAY })
      expect(view.tiles.map((t) => t.key)).toEqual(view.window.days.map(dayKey))
      expect(view.tiles.map((t) => t.isToday)).toEqual([true, false, false, false, false, false, false])
      expect(view.tiles[0]).toMatchObject({ count: 3, dates: ['due', 'followup'], plans: 1 })
      expect(view.tiles[2]).toMatchObject({ count: 3, dates: ['due', 'followup'], plans: 1 })
      // The held task's due date still marks its day; nothing sits there.
      expect(view.tiles[1]).toMatchObject({ count: 0, dates: ['due'], plans: 0 })
    })

    it('draw the real dates as solid ticks, then the plans as hollow ones: at most eight marks, then how many more', () => {
      expect(plannerTileMarks({ dates: ['due', 'followup'], plans: 2 })).toEqual({ dates: ['due', 'followup'], plans: 2, more: 0 })
      expect(plannerTileMarks({ dates: [], plans: 0 })).toEqual({ dates: [], plans: 0, more: 0 })
      const tasks = Array.from({ length: PLANNER_TILE_TICKS_MAX + 3 }, () => task({ doDate: day(1) }))
      const tile = plannerView(tasks, { today: TODAY }).tiles[1]!
      expect(tile.count).toBe(11)
      expect(plannerTileMarks(tile)).toEqual({ dates: [], plans: 8, more: 3 })
      // The real dates first: the plans take what room is left.
      expect(plannerTileMarks({ dates: ['due', 'due', 'due', 'followup', 'followup', 'followup'], plans: 5 }))
        .toEqual({ dates: ['due', 'due', 'due', 'followup', 'followup', 'followup'], plans: 2, more: 3 })
      const many = Array.from({ length: 10 }, () => 'due' as const)
      expect(plannerTileMarks({ dates: many, plans: 1 })).toEqual({ dates: many.slice(0, 8), plans: 0, more: 3 })
    })

    it('mark the real dates falling on each day wherever the task is planned, and the plans on it', () => {
      const view = plannerView([
        // Due Sun, planned Tue: its due date marks Sun, its plan Tue.
        task({ dueDate: day(2), doDate: day(4) }),
        // Due and follow-up both on Sun, held in Unplanned: two marks on Sun, on no day's count.
        task({ dueDate: day(2), nextFollowupAt: day(2), unplanned: true }),
        // Follow-up Sat, due Mon, no plan: sits on Sat; both dates mark their days.
        task({ nextFollowupAt: day(1), dueDate: day(3) }),
        // Planned for a day that passed (Delayed): its due date still marks Tue; its plan marks no tile.
        task({ dueDate: day(4), doDate: day(-2) }),
        // Planned past the window (not shown): its follow-up still marks Mon.
        task({ nextFollowupAt: day(3), doDate: day(9) }),
        // A Focus task with a plan and no dates: a plan mark only.
        task({ focus: true, doDate: day(1) }),
        // Completed: nothing.
        task({ dueDate: day(2), doDate: day(2), isCompleted: true }),
      ], { today: TODAY })
      expect(view.tiles.map((t) => [t.dates, t.plans, t.count])).toEqual([
        [[], 0, 0],
        [['followup'], 1, 2],
        [['due', 'due', 'followup'], 0, 0],
        [['due', 'followup'], 0, 0],
        [['due'], 1, 1],
        [[], 0, 0],
        [[], 0, 0],
      ])
    })

    it('count late real dates on today, one mark each', () => {
      const view = plannerView([
        task({ dueDate: day(-3) }),
        task({ nextFollowupAt: day(-1), dueDate: day(-8) }),
        // Late, but planned for Monday: the date still counts on today.
        task({ nextFollowupAt: day(-2), doDate: day(3) }),
        task({ dueDate: day(0, 16) }),
      ], { today: TODAY })
      expect(view.tiles[0]).toMatchObject({ dates: ['due', 'due', 'due', 'followup', 'followup'], plans: 0, count: 3 })
      expect(view.tiles[3]).toMatchObject({ dates: [], plans: 1, count: 1 })
    })

    it('a date past the window marks no tile', () => {
      const view = plannerView([task({ focus: true, dueDate: day(7) }), task({ nextFollowupAt: day(2), dueDate: day(30) })], { today: TODAY })
      expect(view.tiles.map((t) => t.dates.length)).toEqual([0, 0, 1, 0, 0, 0, 0])
    })
  })

  describe('with the window shifted', () => {
    const late = task({ dueDate: day(-1) })
    const now = task({ doDate: day(0) })
    const between = task({ dueDate: day(3) })
    const plannedBetween = task({ doDate: day(4) })
    const inWindow = task({ nextFollowupAt: day(9) })
    const lastDay = task({ dueDate: day(13) })
    const past = task({ dueDate: day(14) })
    const focus = task({ focus: true })
    const missed = task({ doDate: day(-3) })
    const held = task({ unplanned: true, dueDate: day(2) })
    const view = plannerView([late, now, between, plannedBetween, inWindow, lastDay, past, focus, missed, held], { today: TODAY, offset: 7 })

    it('keeps Today as today', () => {
      expect(view.today.key).toBe('2026-11-20')
      expect(uids(view.today.tasks)).toEqual(uids([late, now]))
    })

    it('lists the window from its first day', () => {
      expect(view.days.map((g) => [g.key, g.tasks.length])).toEqual([
        ['2026-11-27', 0], ['2026-11-28', 0], ['2026-11-29', 1], ['2026-11-30', 0], ['2026-12-01', 0], ['2026-12-02', 0], ['2026-12-03', 1],
      ])
    })

    it('shows the window on its tiles, none of them today — late dates mark none', () => {
      expect(view.tiles.map((t) => [t.key, t.count, t.dates])).toEqual([
        ['2026-11-27', 0, []], ['2026-11-28', 0, []], ['2026-11-29', 1, ['followup']], ['2026-11-30', 0, []],
        ['2026-12-01', 0, []], ['2026-12-02', 0, []], ['2026-12-03', 1, ['due']],
      ])
      expect(view.tiles.some((t) => t.isToday)).toBe(false)
    })

    it('leaves a task dated or planned between tomorrow and the window in no group; the trays stay', () => {
      expect(uids(view.tasks)).toEqual(uids([late, now, inWindow, lastDay, missed, held, focus]))
      expect(view.placements.has(between.uid)).toBe(false)
      expect(view.placements.has(plannedBetween.uid)).toBe(false)
      expect(uids(view.delayed.tasks)).toEqual(uids([missed]))
      expect(uids(view.unplanned.tasks)).toEqual(uids([held, focus]))
    })

    it('gives a task dated past this week a day once the window reaches it', () => {
      // Focus with a due date in the shifted window: Unplanned this week, a day there.
      const t = task({ focus: true, dueDate: day(9) })
      expect(uids(plannerView([t], { today: TODAY }).unplanned.tasks)).toEqual([t.uid])
      const shifted = plannerView([t], { today: TODAY, offset: 7 })
      expect(shifted.unplanned.tasks).toEqual([])
      expect(shifted.days.find((g) => g.key === '2026-11-29')?.tasks).toEqual([t])
    })

    it('lists all seven days of a shifted window', () => {
      const shifted = plannerView([], { today: TODAY, offset: 7 })
      expect(shifted.days.map((g) => g.key)).toEqual(['2026-11-27', '2026-11-28', '2026-11-29', '2026-11-30', '2026-12-01', '2026-12-02', '2026-12-03'])
    })
  })
})

describe('plannerDrop: the drop rule', () => {
  const drop = (over: Partial<PlannerTask>, target: PlannerTarget): PlannerDrop => plannerDrop(task(over), SPAN, target)
  const on = (n: number): PlannerTarget => ({ kind: 'day', day: day(n, 10) })
  const UNPLANNED: PlannerTarget = { kind: 'unplanned' }
  const DELAYED: PlannerTarget = { kind: 'delayed' }

  describe('on a day', () => {
    it('plans the task for the day, whatever put it where it is — never a real date', () => {
      // By its follow-up, by its due date, by a plan, held, delayed, Focus with no date.
      expect(drop({ nextFollowupAt: day(1) }, on(3))).toEqual({ kind: 'plan', day: day(3) })
      expect(drop({ dueDate: day(1), nextFollowupAt: day(4) }, on(3))).toEqual({ kind: 'plan', day: day(3) })
      expect(drop({ doDate: day(1), nextFollowupAt: day(0) }, on(3))).toEqual({ kind: 'plan', day: day(3) })
      expect(drop({ unplanned: true, dueDate: day(1) }, on(3))).toEqual({ kind: 'plan', day: day(3) })
      expect(drop({ doDate: day(-2), dueDate: day(1) }, on(3))).toEqual({ kind: 'plan', day: day(3) })
      expect(drop({ focus: true }, on(0))).toEqual({ kind: 'plan', day: day(0) })
      // An earlier day than its date too.
      expect(drop({ dueDate: day(4) }, on(1))).toEqual({ kind: 'plan', day: day(1) })
    })

    it('a task the Planner doesn’t show (a list’s row) is planned too', () => {
      expect(drop({}, on(2))).toEqual({ kind: 'plan', day: day(2) })
      expect(drop({ nextFollowupAt: day(30) }, on(2))).toEqual({ kind: 'plan', day: day(2) })
      expect(drop({ doDate: day(12) }, on(2))).toEqual({ kind: 'plan', day: day(2) })
    })

    it('on its natural day: the plan is cleared (no planned day, not held)', () => {
      expect(drop({ dueDate: day(2), doDate: day(4) }, on(2))).toEqual({ kind: 'own', day: day(2) })
      expect(drop({ nextFollowupAt: day(1), dueDate: day(3), doDate: day(5) }, on(1))).toEqual({ kind: 'own', day: day(1) })
      expect(drop({ unplanned: true, nextFollowupAt: day(3) }, on(3))).toEqual({ kind: 'own', day: day(3) })
      expect(drop({ doDate: day(-1), dueDate: day(2) }, on(2))).toEqual({ kind: 'own', day: day(2) })
      // A late date's natural day is today.
      expect(drop({ dueDate: day(-4), doDate: day(3) }, on(0))).toEqual({ kind: 'own', day: day(0) })
      // A plan past the window, dropped from a list on its date's day.
      expect(drop({ dueDate: day(2), doDate: day(12) }, on(2))).toEqual({ kind: 'own', day: day(2) })
      // Its later date's day is not its natural day: a plan.
      expect(drop({ nextFollowupAt: day(1), dueDate: day(3), doDate: day(5) }, on(3))).toEqual({ kind: 'plan', day: day(3) })
    })

    it('where it sits already: nothing (the order only)', () => {
      expect(drop({ doDate: day(2) }, on(2))).toEqual({ kind: 'none' })
      expect(drop({ nextFollowupAt: day(2) }, on(2))).toEqual({ kind: 'none' })
      // A late task sits on today.
      expect(drop({ dueDate: day(-4) }, on(0))).toEqual({ kind: 'none' })
      // Planned on the very day its date would put it: it is there.
      expect(drop({ dueDate: day(2), doDate: day(2) }, on(2))).toEqual({ kind: 'none' })
    })

    it('a day before today is refused', () => {
      expect(drop({ dueDate: day(2) }, on(-1))).toEqual({ kind: 'refuse' })
    })
  })

  describe('on Unplanned', () => {
    it('holds a task with a natural day, planned or not', () => {
      expect(drop({ dueDate: day(1) }, UNPLANNED)).toEqual({ kind: 'unplan', hold: true })
      expect(drop({ nextFollowupAt: day(-1), focus: true }, UNPLANNED)).toEqual({ kind: 'unplan', hold: true })
      expect(drop({ doDate: day(2), dueDate: day(1) }, UNPLANNED)).toEqual({ kind: 'unplan', hold: true })
      expect(drop({ doDate: day(-2), nextFollowupAt: day(3) }, UNPLANNED)).toEqual({ kind: 'unplan', hold: true })
    })

    it('a Focus task without one just loses its plan: Focus keeps it in Unplanned', () => {
      expect(drop({ focus: true, doDate: day(2) }, UNPLANNED)).toEqual({ kind: 'unplan', hold: false })
      expect(drop({ focus: true, doDate: day(-2), dueDate: day(20) }, UNPLANNED)).toEqual({ kind: 'unplan', hold: false })
    })

    it('Unplan never takes a task out of the Planner: a planned task with no date in the window, not in Focus, is held', () => {
      const cases: Array<Partial<PlannerTask>> = [{ doDate: day(2) }, { doDate: day(-2) }, { doDate: day(0), dueDate: day(30) }]
      for (const fields of cases) {
        const planned = task(fields)
        const decided = plannerDrop(planned, SPAN, UNPLANNED)
        expect(decided).toEqual({ kind: 'unplan', hold: true })
        // What it writes leaves the task in the Unplanned tray.
        const write = plannerDropWrite(decided)
        expect(write).toBe('unplanned')
        const after: PlannerTask = { ...planned, doDate: undefined, unplanned: true }
        expect(plannerPlacement(after, SPAN)).toMatchObject({ where: 'unplanned', reason: 'held', placed: true })
      }
    })

    it('where it sits already: nothing', () => {
      expect(drop({ focus: true }, UNPLANNED)).toEqual({ kind: 'none' })
      expect(drop({ unplanned: true, dueDate: day(1) }, UNPLANNED)).toEqual({ kind: 'none' })
      expect(drop({ unplanned: true }, UNPLANNED)).toEqual({ kind: 'none' })
    })

    it('a task with no plan to lose that wouldn’t show there is refused', () => {
      expect(drop({}, UNPLANNED)).toEqual({ kind: 'refuse' })
      expect(drop({ dueDate: day(30) }, UNPLANNED)).toEqual({ kind: 'refuse' })
    })
  })

  describe('on Delayed', () => {
    it('takes no drop; a row already in it only reorders', () => {
      expect(drop({ dueDate: day(1) }, DELAYED)).toEqual({ kind: 'refuse' })
      expect(drop({ doDate: day(2) }, DELAYED)).toEqual({ kind: 'refuse' })
      expect(drop({ focus: true }, DELAYED)).toEqual({ kind: 'refuse' })
      expect(drop({ unplanned: true }, DELAYED)).toEqual({ kind: 'refuse' })
      expect(drop({ doDate: day(-1) }, DELAYED)).toEqual({ kind: 'none' })
    })
  })

  it('a completed task is refused everywhere', () => {
    for (const target of [on(0), on(3), UNPLANNED, DELAYED]) {
      expect(drop({ isCompleted: true, doDate: day(2), dueDate: day(1) }, target)).toEqual({ kind: 'refuse' })
    }
  })

  it('what each drop writes: both plan fields’ state, or nothing', () => {
    expect(plannerDropWrite({ kind: 'plan', day: day(3) })).toEqual({ day: day(3) })
    expect(plannerDropWrite({ kind: 'own', day: day(3) })).toBeNull()
    expect(plannerDropWrite({ kind: 'unplan', hold: true })).toBe('unplanned')
    expect(plannerDropWrite({ kind: 'unplan', hold: false })).toBeNull()
    expect(plannerDropWrite({ kind: 'refuse' })).toBeUndefined()
    expect(plannerDropWrite({ kind: 'none' })).toBeUndefined()
  })

  it('names its targets', () => {
    expect(plannerTargetKey(on(3))).toBe('2026-11-23')
    expect(plannerTargetKey(UNPLANNED)).toBe(PLANNER_UNPLANNED_KEY)
    expect(plannerTargetKey(DELAYED)).toBe(PLANNER_DELAYED_KEY)
  })
})

describe('Snooze', () => {
  const snoozeDay = (over: Partial<PlannerTask>) => dayKey(plannerSnoozeDay(plannerPlacement(task(over), SPAN), TODAY))
  const snooze = (over: Partial<PlannerTask>) => plannerSnooze(task(over), SPAN)

  it('is the day after the day the row sits on', () => {
    expect(snoozeDay({ doDate: day(2) })).toBe('2026-11-23')
    expect(snoozeDay({ dueDate: day(3) })).toBe('2026-11-24')
    expect(snoozeDay({ nextFollowupAt: day(0) })).toBe('2026-11-21')
    // A late row sits on today.
    expect(snoozeDay({ dueDate: day(-6) })).toBe('2026-11-21')
    // The window's last day: the day after it.
    expect(snoozeDay({ doDate: day(6) })).toBe('2026-11-27')
  })

  it('a Delayed or Unplanned row (or one not shown) goes to tomorrow', () => {
    expect(snoozeDay({ doDate: day(-4) })).toBe('2026-11-21')
    expect(snoozeDay({ unplanned: true, dueDate: day(5) })).toBe('2026-11-21')
    expect(snoozeDay({ focus: true })).toBe('2026-11-21')
    expect(snoozeDay({})).toBe('2026-11-21')
    expect(dayKey(plannerSnoozeDay(null, new Date(2026, 10, 20, 23, 59)))).toBe('2026-11-21')
  })

  it('plans the task for that day through the drop rule', () => {
    expect(snooze({ dueDate: day(0) })).toEqual({ kind: 'plan', day: day(1) })
    expect(snooze({ doDate: day(2), dueDate: day(1) })).toEqual({ kind: 'plan', day: day(3) })
    expect(snooze({ doDate: day(-4) })).toEqual({ kind: 'plan', day: day(1) })
    expect(snooze({ focus: true })).toEqual({ kind: 'plan', day: day(1) })
  })

  it('landing on its natural day clears the plan', () => {
    // Planned Sat, due Sun: snoozed onto Sun, its own date's day.
    expect(snooze({ doDate: day(1), dueDate: day(2) })).toEqual({ kind: 'own', day: day(2) })
    // Delayed, follow-up tomorrow.
    expect(snooze({ doDate: day(-1), nextFollowupAt: day(1) })).toEqual({ kind: 'own', day: day(1) })
    // Held, due tomorrow.
    expect(snooze({ unplanned: true, dueDate: day(1) })).toEqual({ kind: 'own', day: day(1) })
  })

  it('a completed task is refused', () => {
    expect(snooze({ isCompleted: true, doDate: day(1) })).toEqual({ kind: 'refuse' })
  })
})

describe('a row’s tag and late dates', () => {
  const placed = (over: Partial<PlannerTask>) => plannerPlacement(task(over), SPAN)

  it('a Delayed row: the day it was planned for', () => {
    const tag = plannerRowTag(placed({ doDate: day(-2), dueDate: day(3) }))
    expect(tag).toEqual({ kind: 'planned', day: day(-2) })
    expect(plannerRowTagLabel(tag!, TODAY)).toBe('Wed')
    expect(plannerRowTagHint(tag!, TODAY)).toBe('Planned for Wed, Nov 18')
  })

  it('a row held in Unplanned with a natural day: that day; without one, no tag', () => {
    const tag = plannerRowTag(placed({ unplanned: true, nextFollowupAt: day(3) }))
    expect(tag).toEqual({ kind: 'natural', day: day(3) })
    expect(plannerRowTagLabel(tag!, TODAY)).toBe('Mon')
    expect(plannerRowTagHint(tag!, TODAY)).toBe('Its own date puts it on Mon, Nov 23')
    // A late date puts it on today.
    const late = plannerRowTag(placed({ unplanned: true, dueDate: day(-4) }))
    expect(plannerRowTagLabel(late!, TODAY)).toBe('Today')
    expect(plannerRowTagHint(late!, TODAY)).toBe('Its own date puts it on Today')
    expect(plannerRowTag(placed({ unplanned: true }))).toBeNull()
    expect(plannerRowTag(placed({ unplanned: true, dueDate: day(30) }))).toBeNull()
    expect(plannerRowTag(placed({ focus: true }))).toBeNull()
  })

  it('a row planned past a real date: the conflict in words, with its fixes', () => {
    const tag = plannerRowTag(placed({ doDate: day(4), dueDate: day(3) }))
    expect(tag).toMatchObject({ kind: 'conflict', conflict: { date: 'due', days: 1 } })
    expect(plannerRowTagLabel(tag!, TODAY)).toBe('1 day after due')
    expect(plannerRowTagHint(tag!, TODAY)).toBe('Planned 1 day after its due date')
    expect(tag?.kind === 'conflict' && tag.fixes.map((f) => plannerFixLabel(f, TODAY))).toEqual(['Move due date to Tue, Nov 24', 'Plan for Mon, Nov 23'])
    const followup = plannerRowTag(placed({ doDate: day(4), nextFollowupAt: day(2) }))
    expect(plannerRowTagLabel(followup!, TODAY)).toBe('2 days after follow-up')
    expect(plannerRowTagHint(followup!, TODAY)).toBe('Planned 2 days after its follow-up')
  })

  it('with both dates passed the tag is the due date’s, and the menu holds every fix once', () => {
    const tag = plannerRowTag(placed({ doDate: day(5), dueDate: day(2), nextFollowupAt: day(1) }))
    expect(plannerRowTagLabel(tag!, TODAY)).toBe('3 days after due')
    expect(tag?.kind === 'conflict' && tag.fixes.map((f) => plannerFixLabel(f, TODAY))).toEqual([
      'Move due date to Wed, Nov 25', 'Plan for Sun, Nov 22', 'Move follow-up to Wed, Nov 25', 'Plan for Sat, Nov 21',
    ])
    // Both dates on one day: one Plan for it.
    const same = plannerRowTag(placed({ doDate: day(5), dueDate: day(2), nextFollowupAt: day(2) }))
    expect(same?.kind === 'conflict' && same.fixes.map((f) => plannerFixLabel(f, TODAY))).toEqual([
      'Move due date to Wed, Nov 25', 'Plan for Sun, Nov 22', 'Move follow-up to Wed, Nov 25',
    ])
    // A date already past offers no Plan for it.
    const past = plannerRowTag(placed({ doDate: day(1), dueDate: day(-2) }))
    expect(past?.kind === 'conflict' && past.fixes.map((f) => plannerFixLabel(f, TODAY))).toEqual(['Move due date to Sat, Nov 21'])
  })

  it('no tag on a row its own date puts there, on a plan before its dates, or on no placement', () => {
    expect(plannerRowTag(placed({ dueDate: day(2) }))).toBeNull()
    expect(plannerRowTag(placed({ doDate: day(1), dueDate: day(3) }))).toBeNull()
    expect(plannerRowTag(placed({ doDate: day(3), dueDate: day(3) }))).toBeNull()
    expect(plannerRowTag(null)).toBeNull()
    expect(plannerRowTag(undefined)).toBeNull()
  })

  it('a tag’s day in words: Today, a weekday within six days, else the date', () => {
    expect(plannerTagDay(day(0, 15), TODAY)).toBe('Today')
    expect(plannerTagDay(day(-1), TODAY)).toBe('Thu')
    expect(plannerTagDay(day(-6), TODAY)).toBe('Sat')
    expect(plannerTagDay(day(6), TODAY)).toBe('Thu')
    expect(plannerTagDay(day(-7), TODAY)).toBe('Nov 13')
    expect(plannerTagDay(day(-30), TODAY)).toBe('Oct 21')
  })

  it('the dates a plan falls after are the ones drawn late', () => {
    expect(plannerLateDates(placed({ doDate: day(4), dueDate: day(3) }))).toEqual({ due: true, followup: false })
    expect(plannerLateDates(placed({ doDate: day(4), dueDate: day(6), nextFollowupAt: day(1) }))).toEqual({ due: false, followup: true })
    expect(plannerLateDates(placed({ doDate: day(5), dueDate: day(2), nextFollowupAt: day(1) }))).toEqual({ due: true, followup: true })
    expect(plannerLateDates(placed({ doDate: day(1), dueDate: day(3) }))).toBeNull()
    // Delayed and held rows have no conflict: nothing is drawn late that isn't.
    expect(plannerLateDates(placed({ doDate: day(-2), dueDate: day(-3) }))).toBeNull()
    expect(plannerLateDates(placed({ unplanned: true, dueDate: day(1) }))).toBeNull()
    expect(plannerLateDates(null)).toBeNull()
  })
})

describe('a Move date fix that makes the plan redundant', () => {
  const move = (date: 'due' | 'followup', n: number) => ({ kind: 'move-date' as const, date, to: day(n) })

  it('clears the plan when the task’s own dates then put it on its planned day', () => {
    // Due Sat, planned Mon: the due date moved to Mon is the task's natural day.
    expect(plannerFixClearsPlan(task({ doDate: day(3), dueDate: day(1) }), move('due', 3), SPAN)).toBe(true)
    expect(plannerFixClearsPlan(task({ doDate: day(4), nextFollowupAt: day(2) }), move('followup', 4), SPAN)).toBe(true)
    // The other date is later, or on the same day: the moved one still decides.
    expect(plannerFixClearsPlan(task({ doDate: day(3), dueDate: day(1), nextFollowupAt: day(5) }), move('due', 3), SPAN)).toBe(true)
    expect(plannerFixClearsPlan(task({ doDate: day(3), dueDate: day(1), nextFollowupAt: day(3) }), move('due', 3), SPAN)).toBe(true)
    // Planned for today with the other date already late: its dates put it on today too.
    expect(plannerFixClearsPlan(task({ doDate: day(0), dueDate: day(-2), nextFollowupAt: day(-4) }), move('due', 0), SPAN)).toBe(true)
  })

  it('keeps the plan while another, earlier date still puts it elsewhere', () => {
    // Due Sat, follow-up Sun, planned Wed: with the due date on Wed the follow-up still puts it on Sun.
    const both = task({ doDate: day(5), dueDate: day(1), nextFollowupAt: day(2) })
    expect(plannerFixClearsPlan(both, move('due', 5), SPAN)).toBe(false)
    // The second fix, once the first was made, does clear it.
    expect(plannerFixClearsPlan({ ...both, dueDate: day(5) }, move('followup', 5), SPAN)).toBe(true)
  })

  it('is false for a task with no planned day', () => {
    expect(plannerFixClearsPlan(task({ dueDate: day(1) }), move('due', 3), SPAN)).toBe(false)
    expect(plannerFixClearsPlan(task({ unplanned: true, dueDate: day(1) }), move('due', 3), SPAN)).toBe(false)
  })
})

describe('Unplan and Unplan all Delayed', () => {
  it('Unplan is the Unplanned drop for one row', () => {
    expect(plannerUnplan(task({ doDate: day(2), dueDate: day(1) }), SPAN)).toEqual({ kind: 'unplan', hold: true })
    expect(plannerUnplan(task({ focus: true, doDate: day(2) }), SPAN)).toEqual({ kind: 'unplan', hold: false })
    expect(plannerUnplan(task({ doDate: day(2) }), SPAN)).toEqual({ kind: 'unplan', hold: true })
    expect(plannerUnplan(task({ focus: true }), SPAN)).toEqual({ kind: 'none' })
    expect(plannerUnplan(task({}), SPAN)).toEqual({ kind: 'refuse' })
  })

  it('Unplan all Delayed: every Delayed task held, a Focus one with no date its plan cleared — each stays in the Planner; nothing else', () => {
    const dated = task({ doDate: day(-1), dueDate: day(2) })
    const late = task({ doDate: day(-3), nextFollowupAt: day(-5) })
    const focus = task({ doDate: day(-2), focus: true })
    const bare = task({ doDate: day(-2) })
    const farDate = task({ doDate: day(-2), dueDate: day(30) })
    const others = [task({ doDate: day(1) }), task({ unplanned: true, dueDate: day(1) }), task({ dueDate: day(0) }), task({ focus: true })]
    const view = plannerView([dated, late, focus, bare, farDate, ...others], { today: TODAY })
    expect(uids(view.delayed.tasks).sort()).toEqual(uids([dated, late, focus, bare, farDate]).sort())
    const plans = plannerUnplanDelayed(view)
    expect(new Map(plans.map((p) => [p.id, p.plan]))).toEqual(new Map<number, unknown>([
      [dated.id, 'unplanned'], [late.id, 'unplanned'], [focus.id, null], [bare.id, 'unplanned'], [farDate.id, 'unplanned'],
    ]))
    // Every one of them is in Unplanned afterwards.
    const written = new Map(plans.map((p) => [p.id, p.plan]))
    const after = [dated, late, focus, bare, farDate].map((t): PlannerTask => ({ ...t, doDate: undefined, unplanned: written.get(t.id) === 'unplanned' ? true : undefined }))
    const next = plannerView([...after, ...others], { today: TODAY })
    expect(next.delayed.tasks).toEqual([])
    for (const t of after) expect(next.placements.get(t.uid)?.where).toBe('unplanned')
  })

  it('with nothing in Delayed: no change', () => {
    expect(plannerUnplanDelayed(plannerView([task({ doDate: day(1) })], { today: TODAY }))).toEqual([])
  })
})

describe('Reset plan', () => {
  const plannedToday = task({ doDate: day(0) })
  const plannedTodayDated = task({ doDate: day(0), dueDate: day(3) })
  const byDateToday = task({ dueDate: day(0) })
  const plannedMon = task({ doDate: day(3), nextFollowupAt: day(1) })
  const byDateMon = task({ dueDate: day(3) })
  const delayedA = task({ doDate: day(-1) })
  const delayedB = task({ doDate: day(-5), dueDate: day(2) })
  const held = task({ unplanned: true, dueDate: day(2) })
  const focus = task({ focus: true })
  const plannedFar = task({ doDate: day(9) })
  const done = task({ doDate: day(0), isCompleted: true })
  const all = [plannedToday, plannedTodayDated, byDateToday, plannedMon, byDateMon, delayedA, delayedB, held, focus, plannedFar, done]
  const view = plannerView(all, { today: TODAY })
  const reset = (scope: PlannerResetScope) => uids(plannerResetTasks(view, scope)).sort()

  it('this week: every task with a plan state the Planner shows or holds — planned days in the window, Delayed, held', () => {
    expect(reset('week')).toEqual(uids([plannedToday, plannedTodayDated, plannedMon, delayedA, delayedB, held]).sort())
  })

  it('today only: the tasks planned for today', () => {
    expect(reset('today')).toEqual(uids([plannedToday, plannedTodayDated]).sort())
  })

  it('Delayed only', () => {
    expect(reset('delayed')).toEqual(uids([delayedA, delayedB]).sort())
  })

  it('counts each scope', () => {
    expect(plannerResetCounts(view)).toEqual({ week: 6, today: 2, delayed: 2 })
    expect(plannerResetCounts(plannerView([byDateToday, focus], { today: TODAY }))).toEqual({ week: 0, today: 0, delayed: 0 })
  })

  it('a shifted window: its own planned days, with today’s, Delayed and held — not the days between', () => {
    const shifted = plannerView([...all, task({ doDate: day(4) })], { today: TODAY, offset: 7 })
    expect(uids(plannerResetTasks(shifted, 'week')).sort()).toEqual(uids([plannedToday, plannedTodayDated, delayedA, delayedB, held, plannedFar]).sort())
    expect(plannerResetCounts(shifted)).toEqual({ week: 6, today: 2, delayed: 2 })
  })
})

describe('labels', () => {
  it('names a day and a tile', () => {
    expect(plannerDayLabel(day(3))).toBe('Mon, Nov 23')
    expect(plannerTileLabel({ day: day(3), count: 3, isToday: false })).toBe('Mon, Nov 23: 3 tasks')
    expect(plannerTileLabel({ day: day(3), count: 1, isToday: false })).toBe('Mon, Nov 23: 1 task')
    expect(plannerTileLabel({ day: day(0), count: 0, isToday: true })).toBe('Today, Nov 20: no tasks')
  })

  it('names the window', () => {
    expect(plannerRangeLabel(plannerWindow(TODAY))).toBe('Nov 20 – 26')
    expect(plannerRangeLabel(plannerWindow(TODAY, 7))).toBe('Nov 27 – Dec 3')
    expect(plannerRangeLabel(plannerWindow(new Date(2026, 11, 28)))).toBe('Dec 28, 2026 – Jan 3, 2027')
  })

  it('says what a drop does on the lifted row: only the plan', () => {
    expect(plannerDropLabel({ kind: 'plan', day: day(5) }, TODAY)).toBe('Plan · Wed, Nov 25')
    expect(plannerDropLabel({ kind: 'plan', day: day(0) }, TODAY)).toBe('Plan · Today')
    expect(plannerDropLabel({ kind: 'own', day: day(5) }, TODAY)).toBe('Its date · Wed, Nov 25')
    expect(plannerDropLabel({ kind: 'unplan', hold: true }, TODAY)).toBe('Unplan')
    expect(plannerDropLabel({ kind: 'unplan', hold: false }, TODAY)).toBe('Unplan')
    expect(plannerDropLabel({ kind: 'refuse' }, TODAY)).toBeNull()
    expect(plannerDropLabel({ kind: 'none' }, TODAY)).toBeNull()
  })
})

describe('across a daylight-saving change', () => {
  pinTimeZone(DST_ZONE)

  it('steps the window by calendar days over the 25-hour day', () => {
    // Fri 30 Oct 2026; clocks go back on Sun 1 Nov.
    const w = plannerWindow(new Date(2026, 9, 30, 8))
    expect(w.days.map(dayKey)).toEqual(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05'])
    expect(w.days.every((d) => d.getHours() === 0)).toBe(true)
  })

  it('steps it over the 23-hour day', () => {
    // Fri 6 Mar 2026; clocks go forward on Sun 8 Mar.
    const w = plannerWindow(new Date(2026, 2, 6), 7)
    expect(w.days.map(dayKey)).toEqual(['2026-03-13', '2026-03-14', '2026-03-15', '2026-03-16', '2026-03-17', '2026-03-18', '2026-03-19'])
    expect(w.days.every((d) => d.getHours() === 0)).toBe(true)
  })

  it('puts a task on the day after the change on that day, planned or by its date', () => {
    const today = new Date(2026, 9, 30)
    const mon = { uid: 'mon', isCompleted: false, sortOrder: 1, dueDate: new Date(2026, 10, 2) }
    const sun = { uid: 'sun', isCompleted: false, sortOrder: 2, nextFollowupAt: new Date(2026, 10, 1, 23, 30) }
    const planned = { uid: 'planned', isCompleted: false, sortOrder: 3, doDate: new Date(2026, 10, 2), dueDate: new Date(2026, 9, 31) }
    const view = plannerView([mon, sun, planned], { today })
    expect(view.days.find((g) => g.key === '2026-11-01')?.tasks).toEqual([sun])
    expect(view.days.find((g) => g.key === '2026-11-02')?.tasks).toEqual([mon, planned])
    expect(view.tiles.map((t) => t.count)).toEqual([0, 0, 1, 2, 0, 0, 0])
    expect(view.tiles.map((t) => t.dates)).toEqual([[], ['due'], ['followup'], ['due'], [], [], []])
    // Sat → Mon across the 25-hour Sunday: two days after due.
    expect(view.placements.get('planned')?.conflicts.map((c) => [c.date, c.days])).toEqual([['due', 2]])
  })

  it('counts conflict days across the 23-hour day', () => {
    // Fri 6 Mar 2026; clocks go forward on Sun 8 Mar.
    const today = new Date(2026, 2, 6)
    const t: PlannerTask = { uid: 'a', isCompleted: false, sortOrder: 1, dueDate: new Date(2026, 2, 7), doDate: new Date(2026, 2, 9) }
    expect(plannerPlacement(t, plannerWindow(today))?.conflicts.map((c) => c.days)).toEqual([2])
  })

  it('reads the last day of a window that spans the change inclusively, and snoozes by calendar days', () => {
    const today = new Date(2026, 9, 30)
    const span = plannerWindow(today)
    const onLast: PlannerTask = { uid: 'a', isCompleted: false, sortOrder: 1, dueDate: new Date(2026, 10, 5, 23) }
    const after: PlannerTask = { uid: 'b', isCompleted: false, sortOrder: 2, dueDate: new Date(2026, 10, 6) }
    expect(inPlanner(onLast, span)).toBe(true)
    expect(inPlanner(after, span)).toBe(false)
    expect(plannerDrop(onLast, span, { kind: 'day', day: new Date(2026, 10, 1, 12) })).toEqual({ kind: 'plan', day: new Date(2026, 10, 1) })
    expect(plannerDrop({ ...onLast, doDate: new Date(2026, 10, 1) }, span, { kind: 'day', day: new Date(2026, 10, 5, 1) }))
      .toEqual({ kind: 'own', day: new Date(2026, 10, 5) })
    // Sat 31 Oct → Sun 1 Nov (25 hours) → Mon 2 Nov.
    const sat: PlannerTask = { uid: 'c', isCompleted: false, sortOrder: 3, doDate: new Date(2026, 9, 31) }
    expect(plannerSnooze(sat, span)).toEqual({ kind: 'plan', day: new Date(2026, 10, 1) })
    expect(plannerSnooze({ ...sat, doDate: new Date(2026, 10, 1) }, span)).toEqual({ kind: 'plan', day: new Date(2026, 10, 2) })
  })
})
