import { describe, expect, it } from 'vitest'
import { DST_ZONE, pinTimeZone } from '../time-zone'
import { dayKey } from '../../utils/date'
import {
  inPlanner,
  PLANNER_NO_DAY_KEY,
  PLANNER_TILE_TICKS_MAX,
  plannerDayLabel,
  plannerDrop,
  plannerOffset,
  plannerOrder,
  plannerPlacement,
  plannerRangeLabel,
  plannerTileLabel,
  plannerView,
  plannerWindow,
  type PlannerDrop,
  type PlannerPlacement,
  type PlannerTarget,
  type PlannerTask,
} from '../../utils/planner'

// Fri 20 Nov 2026.
const TODAY = new Date(2026, 10, 20)
const day = (n: number, hour = 0) => new Date(2026, 10, 20 + n, hour)

let seq = 0
function task(over: Partial<PlannerTask> = {}): PlannerTask {
  seq += 1
  return { uid: `t${seq}`, isCompleted: false, sortOrder: seq, ...over }
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

describe('inPlanner', () => {
  const last = day(6)
  it('holds Focus tasks, planned tasks and tasks dated on or before the last day', () => {
    expect(inPlanner(task({ focus: true }), last)).toBe(true)
    expect(inPlanner(task({ doDate: day(30) }), last)).toBe(true)
    expect(inPlanner(task({ dueDate: day(6) }), last)).toBe(true)
    expect(inPlanner(task({ nextFollowupAt: day(6, 12) }), last)).toBe(true)
    expect(inPlanner(task({ dueDate: day(-40) }), last)).toBe(true)
  })

  it('leaves out the rest', () => {
    expect(inPlanner(task(), last)).toBe(false)
    expect(inPlanner(task({ dueDate: day(7) }), last)).toBe(false)
    expect(inPlanner(task({ nextFollowupAt: day(7) }), last)).toBe(false)
    expect(inPlanner(task({ focus: true, isCompleted: true }), last)).toBe(false)
    expect(inPlanner(task({ doDate: day(0), isCompleted: true }), last)).toBe(false)
  })
})

describe('plannerPlacement', () => {
  const last = day(6)
  const place = (over: Partial<PlannerTask>) => plannerPlacement(task(over), TODAY, last)
  const shape = (p: PlannerPlacement | null) => (p ? [dayKey(p.day), dayKey(p.date), p.reason] : null)

  it('sits on its Do day, whatever its other dates', () => {
    expect(shape(place({ doDate: day(3), dueDate: day(1), nextFollowupAt: day(0) }))).toEqual(['2026-11-23', '2026-11-23', 'do'])
  })

  it('sits on a Do day past the window too', () => {
    expect(shape(place({ doDate: day(20) }))).toEqual(['2026-12-10', '2026-12-10', 'do'])
  })

  it('takes the earlier of the follow-up and the due date', () => {
    expect(shape(place({ dueDate: day(2), nextFollowupAt: day(4) }))).toEqual(['2026-11-22', '2026-11-22', 'due'])
    expect(shape(place({ dueDate: day(4), nextFollowupAt: day(2) }))).toEqual(['2026-11-22', '2026-11-22', 'followup'])
  })

  it('is by its follow-up when both are the same day, whatever their times', () => {
    expect(place({ dueDate: day(2), nextFollowupAt: day(2, 12) })?.reason).toBe('followup')
  })

  it('is by the one date it has', () => {
    expect(place({ nextFollowupAt: day(1) })?.reason).toBe('followup')
    expect(place({ dueDate: day(1) })?.reason).toBe('due')
  })

  it('shows a date before today on today, keeping the date', () => {
    expect(shape(place({ dueDate: day(-3) }))).toEqual(['2026-11-20', '2026-11-17', 'due'])
    expect(shape(place({ doDate: day(-1) }))).toEqual(['2026-11-20', '2026-11-19', 'do'])
    expect(shape(place({ nextFollowupAt: day(-9), dueDate: day(2) }))).toEqual(['2026-11-20', '2026-11-11', 'followup'])
  })

  it('has no day when the earlier date is past the window, even with a later one', () => {
    expect(place({ focus: true })).toBeNull()
    expect(place({ focus: true, dueDate: day(7) })).toBeNull()
    expect(place({ focus: true, nextFollowupAt: day(8), dueDate: day(9) })).toBeNull()
  })

  it('reads the last day inclusively', () => {
    expect(place({ dueDate: day(6) })?.reason).toBe('due')
    expect(place({ nextFollowupAt: day(6, 23) })?.reason).toBe('followup')
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

  it('orders Focus tasks with no day by sort order', () => {
    const a = task({ focus: true, sortOrder: 5 })
    const b = task({ focus: true, sortOrder: 2 })
    expect(uids(plannerView([a, b], { today: TODAY }).noDay.tasks)).toEqual(uids([b, a]))
  })
})

describe('plannerView', () => {
  it('groups Today, every day ahead and Focus, no day', () => {
    const late = task({ dueDate: day(-5) })
    const now = task({ nextFollowupAt: day(0) })
    const mon = task({ doDate: day(3) })
    const thu = task({ dueDate: day(6) })
    const focus = task({ focus: true })
    const done = task({ dueDate: day(0), isCompleted: true })
    const far = task({ dueDate: day(7) })
    const plain = task()
    const view = plannerView([late, now, mon, thu, focus, done, far, plain], { today: TODAY })
    expect(view.today.kind).toBe('today')
    expect(view.today.key).toBe('2026-11-20')
    expect(uids(view.today.tasks)).toEqual(uids([late, now]))
    expect(view.days.map((g) => [g.key, g.tasks.length])).toEqual([
      ['2026-11-21', 0], ['2026-11-22', 0], ['2026-11-23', 1], ['2026-11-24', 0], ['2026-11-25', 0], ['2026-11-26', 1],
    ])
    expect(view.noDay.key).toBe(PLANNER_NO_DAY_KEY)
    expect(uids(view.noDay.tasks)).toEqual(uids([focus]))
    expect(uids(view.tasks)).toEqual(uids([late, now, mon, thu, focus]))
    expect([...view.placements.keys()].sort()).toEqual(uids([late, now, mon, thu]).sort())
  })

  it('starts the days ahead at the picked day', () => {
    const sat = task({ doDate: day(1) })
    const tue = task({ doDate: day(4) })
    const view = plannerView([sat, tue], { today: TODAY, picked: day(3, 9) })
    expect(view.days.map((g) => g.key)).toEqual(['2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26'])
    // The tiles and the count of what it holds don't follow the pick.
    expect(view.tiles.map((t) => t.count)).toEqual([0, 1, 0, 0, 1, 0, 0])
    expect(uids(view.tasks)).toEqual(uids([sat, tue]))
  })

  it('reads a pick of today, or one outside the window, as none', () => {
    const tomorrowOn = ['2026-11-21', '2026-11-22', '2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26']
    expect(plannerView([], { today: TODAY, picked: day(0) }).days.map((g) => g.key)).toEqual(tomorrowOn)
    expect(plannerView([], { today: TODAY, picked: day(-2) }).days.map((g) => g.key)).toEqual(tomorrowOn)
    expect(plannerView([], { today: TODAY, picked: day(9) }).days.map((g) => g.key)).toEqual(tomorrowOn)
  })

  it('counts each day on its tile, today as the Today group', () => {
    const tasks = [
      task({ dueDate: day(-1) }), task({ nextFollowupAt: day(0) }), task({ doDate: day(0) }),
      task({ doDate: day(2) }), task({ dueDate: day(2) }), task({ nextFollowupAt: day(2) }),
    ]
    const view = plannerView(tasks, { today: TODAY })
    expect(view.tiles.map((t) => t.key)).toEqual(view.window.days.map(dayKey))
    expect(view.tiles.map((t) => t.isToday)).toEqual([true, false, false, false, false, false, false])
    expect(view.tiles[0]).toMatchObject({ count: 3, ticks: ['due', 'followup', 'do'], more: 0 })
    expect(view.tiles[2]).toMatchObject({ count: 3, ticks: ['due', 'followup', 'do'], more: 0 })
    expect(view.tiles[1]).toMatchObject({ count: 0, ticks: [], more: 0 })
  })

  it('draws at most eight ticks, then says how many more', () => {
    const tasks = Array.from({ length: PLANNER_TILE_TICKS_MAX + 3 }, () => task({ doDate: day(1) }))
    const tile = plannerView(tasks, { today: TODAY }).tiles[1]
    expect(tile?.count).toBe(11)
    expect(tile?.ticks).toHaveLength(8)
    expect(tile?.more).toBe(3)
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

  describe('with the window shifted', () => {
    const late = task({ dueDate: day(-1) })
    const now = task({ doDate: day(0) })
    const between = task({ dueDate: day(3) })
    const inWindow = task({ nextFollowupAt: day(9) })
    const lastDay = task({ dueDate: day(13) })
    const past = task({ dueDate: day(14) })
    const focus = task({ focus: true })
    const view = plannerView([late, now, between, inWindow, lastDay, past, focus], { today: TODAY, offset: 7 })

    it('keeps Today as today', () => {
      expect(view.today.key).toBe('2026-11-20')
      expect(uids(view.today.tasks)).toEqual(uids([late, now]))
    })

    it('lists the window from its first day', () => {
      expect(view.days.map((g) => [g.key, g.tasks.length])).toEqual([
        ['2026-11-27', 0], ['2026-11-28', 0], ['2026-11-29', 1], ['2026-11-30', 0], ['2026-12-01', 0], ['2026-12-02', 0], ['2026-12-03', 1],
      ])
    })

    it('shows the window on its tiles, none of them today', () => {
      expect(view.tiles.map((t) => [t.key, t.count])).toEqual([
        ['2026-11-27', 0], ['2026-11-28', 0], ['2026-11-29', 1], ['2026-11-30', 0], ['2026-12-01', 0], ['2026-12-02', 0], ['2026-12-03', 1],
      ])
      expect(view.tiles.some((t) => t.isToday)).toBe(false)
    })

    it('leaves a task dated between tomorrow and the window in no group', () => {
      expect(uids(view.tasks)).toEqual(uids([late, now, inWindow, lastDay, focus]))
      expect(view.placements.has(between.uid)).toBe(false)
    })

    it('gives a task dated past this week a day once the window reaches it', () => {
      // Focus with a due date in the shifted window: no day this week, a day there.
      const t = task({ focus: true, dueDate: day(9) })
      expect(uids(plannerView([t], { today: TODAY }).noDay.tasks)).toEqual([t.uid])
      const shifted = plannerView([t], { today: TODAY, offset: 7 })
      expect(shifted.noDay.tasks).toEqual([])
      expect(shifted.days.find((g) => g.key === '2026-11-29')?.tasks).toEqual([t])
    })

    it('honors a pick inside the shifted window', () => {
      const picked = plannerView([], { today: TODAY, offset: 7, picked: day(11) })
      expect(picked.days.map((g) => g.key)).toEqual(['2026-12-01', '2026-12-02', '2026-12-03'])
    })
  })
})

describe('plannerDrop', () => {
  const last = day(6)
  const drop = (over: Partial<PlannerTask>, target: PlannerTarget): PlannerDrop => {
    const t = task(over)
    return plannerDrop(t, plannerPlacement(t, TODAY, last), target)
  }
  const on = (n: number): PlannerTarget => ({ kind: 'day', day: day(n, 10) })

  it('does nothing on the day the task is on', () => {
    expect(drop({ doDate: day(2) }, on(2))).toEqual({ kind: 'none' })
    expect(drop({ nextFollowupAt: day(2) }, on(2))).toEqual({ kind: 'none' })
    // A late task sits on today.
    expect(drop({ dueDate: day(-4) }, on(0))).toEqual({ kind: 'none' })
  })

  it('moves the follow-up of a task placed by it', () => {
    expect(drop({ nextFollowupAt: day(1) }, on(3))).toEqual({ kind: 'followup', date: day(3) })
    expect(drop({ nextFollowupAt: day(1), dueDate: day(1) }, on(0))).toEqual({ kind: 'followup', date: day(0) })
    expect(drop({ nextFollowupAt: day(-3), dueDate: day(5) }, on(2))).toEqual({ kind: 'followup', date: day(2) })
  })

  it('gives every other task a Do day, never moving the due date', () => {
    expect(drop({ dueDate: day(1), nextFollowupAt: day(4) }, on(3))).toEqual({ kind: 'do', date: day(3) })
    expect(drop({ doDate: day(1), nextFollowupAt: day(0) }, on(3))).toEqual({ kind: 'do', date: day(3) })
    expect(drop({ focus: true }, on(0))).toEqual({ kind: 'do', date: day(0) })
    // A task the Planner doesn't hold (a row from a list).
    expect(drop({ nextFollowupAt: day(30) }, on(2))).toEqual({ kind: 'do', date: day(2) })
  })

  it('clears a Do day on Focus, no day', () => {
    expect(drop({ doDate: day(2), dueDate: day(1) }, { kind: 'noday' })).toEqual({ kind: 'do', date: undefined })
  })

  it('refuses a task placed by a date there', () => {
    expect(drop({ dueDate: day(1) }, { kind: 'noday' })).toEqual({ kind: 'refuse' })
    expect(drop({ nextFollowupAt: day(-1), focus: true }, { kind: 'noday' })).toEqual({ kind: 'refuse' })
  })

  it('does nothing for a task with no day already', () => {
    expect(drop({ focus: true }, { kind: 'noday' })).toEqual({ kind: 'none' })
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

  it('puts a task on the day after the change on that day', () => {
    const today = new Date(2026, 9, 30)
    const mon = { uid: 'mon', isCompleted: false, sortOrder: 1, dueDate: new Date(2026, 10, 2) }
    const sun = { uid: 'sun', isCompleted: false, sortOrder: 2, nextFollowupAt: new Date(2026, 10, 1, 23, 30) }
    const view = plannerView([mon, sun], { today })
    expect(view.days.find((g) => g.key === '2026-11-01')?.tasks).toEqual([sun])
    expect(view.days.find((g) => g.key === '2026-11-02')?.tasks).toEqual([mon])
    expect(view.tiles.map((t) => t.count)).toEqual([0, 0, 1, 1, 0, 0, 0])
  })

  it('reads the last day of a window that spans the change inclusively', () => {
    const today = new Date(2026, 9, 30)
    const last = plannerWindow(today).last
    const onLast: PlannerTask = { uid: 'a', isCompleted: false, sortOrder: 1, dueDate: new Date(2026, 10, 5, 23) }
    const after: PlannerTask = { uid: 'b', isCompleted: false, sortOrder: 2, dueDate: new Date(2026, 10, 6) }
    expect(inPlanner(onLast, last)).toBe(true)
    expect(inPlanner(after, last)).toBe(false)
    expect(plannerDrop(onLast, plannerPlacement(onLast, today, last), { kind: 'day', day: new Date(2026, 10, 1, 12) }))
      .toEqual({ kind: 'do', date: new Date(2026, 10, 1) })
  })
})
