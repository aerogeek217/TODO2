import { describe, expect, it } from 'vitest'
import { DST_ZONE, pinTimeZone } from '../time-zone'
import { dayKey } from '../../utils/date'
import {
  inPlanner,
  PLANNER_DELAYED_KEY,
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
  plannerPlannedDay,
  plannerPlannedLater,
  plannerRangeLabel,
  plannerResetCounts,
  plannerResetTasks,
  plannerResetWeekLabel,
  plannerSnooze,
  plannerSnoozeDay,
  plannerLateDates,
  plannerRowTag,
  plannerRowTagHint,
  plannerRowStateWords,
  plannerRowTagLabel,
  plannerShows,
  plannerTagDay,
  plannerTargetKey,
  plannerTileLabel,
  plannerUnplan,
  plannerClearLeaves,
  plannerHasPlan,
  plannerClearDelayed,
  plannerMovePlan,
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
import { DAY_TICKS_MAX, dayTicks } from '../../utils/day-ticks'

// Fri 20 Nov 2026.
const TODAY = new Date(2026, 10, 20)
const day = (n: number, hour = 0) => new Date(2026, 10, 20 + n, hour)
const SPAN = plannerWindow(TODAY)

let seq = 0
function task(over: Partial<PlannerTask> = {}): PlannerTask & { id: number } {
  seq += 1
  return { id: seq, uid: `t${seq}`, isCompleted: false, sortOrder: seq, ...over }
}

/**
 * A stored row still carrying the `unplanned` field the schema no longer has
 * (a hand-made row, or one an upgrade missed): a task cannot be held, so the
 * Planner reads it as the same task without the field.
 */
function leftover(over: Partial<PlannerTask> = {}): PlannerTask & { id: number } {
  return Object.assign(task(over), { unplanned: true })
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

  it('is not moved by a plan: a planned task keeps its own day, a passed plan too', () => {
    expect(natural({ dueDate: day(2), doDate: day(5) })).toEqual(['2026-11-22', '2026-11-22', 'due'])
    expect(natural({ nextFollowupAt: day(3), doDate: day(-2) })).toEqual(['2026-11-23', '2026-11-23', 'followup'])
  })
})

describe('inPlanner', () => {
  it('holds Focus tasks, planned tasks and tasks with a natural day', () => {
    expect(inPlanner(task({ focus: true }), SPAN)).toBe(true)
    expect(inPlanner(task({ doDate: day(30) }), SPAN)).toBe(true)
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
    // A task cannot be held: a stored `unplanned` field brings nothing in.
    expect(inPlanner(leftover(), SPAN)).toBe(false)
    expect(inPlanner(leftover({ dueDate: day(7) }), SPAN)).toBe(false)
  })
})

describe('plannerPlacement: where a task sits', () => {
  const place = (over: Partial<PlannerTask>) => plannerPlacement(task(over), SPAN)
  /** where · the day it sits on · why · placed. */
  const shape = (p: PlannerPlacement | null) => (p ? [p.where, p.day ? dayKey(p.day) : null, p.reason, p.placed] : null)

  it('a stored task cannot be held: the placement ignores anything but doDate', () => {
    // A natural day: it sits there, not placed.
    const dated = plannerPlacement(leftover({ dueDate: day(2), nextFollowupAt: day(1) }), SPAN)
    expect(shape(dated)).toEqual(['day', '2026-11-21', 'followup', false])
    expect(dated?.planned).toBeNull()
    // Late, past the window, or no date: today, nowhere, nowhere.
    expect(shape(plannerPlacement(leftover({ dueDate: day(-3) }), SPAN))).toEqual(['day', '2026-11-20', 'due', false])
    expect(plannerPlacement(leftover({ dueDate: day(40) }), SPAN)).toBeNull()
    expect(plannerPlacement(leftover(), SPAN)).toBeNull()
    // Matching the Unplanned filter: in Unplanned by the filter, not placed.
    expect(shape(plannerPlacement(leftover({ focus: true }), SPAN))).toEqual(['unplanned', null, 'filter', false])
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

  it('a planned day beyond the window’s last day, with no real date inside the window → not shown in this window', () => {
    expect(place({ doDate: day(7) })).toBeNull()
    expect(place({ doDate: day(20), focus: true })).toBeNull()
    // A date past the window doesn't show it either.
    expect(place({ doDate: day(20), dueDate: day(9) })).toBeNull()
    // The window that reaches it shows it.
    expect(shape(plannerPlacement(task({ doDate: day(7) }), plannerWindow(TODAY, 7)))).toEqual(['day', '2026-11-27', 'plan', true])
  })

  it('planned later, with a real date inside the window or overdue → on its natural day, placed, in conflict with that date', () => {
    // Due tomorrow, planned for three weeks on.
    const later = place({ doDate: day(20), dueDate: day(1), focus: true })
    expect(shape(later)).toEqual(['day', '2026-11-21', 'due', true])
    expect(later?.planned).toEqual(day(20))
    expect(later?.conflicts).toEqual([{
      date: 'due', on: day(1), days: 19,
      fixes: [{ kind: 'move-date', date: 'due', to: day(20) }, { kind: 'plan', day: day(1) }],
    }])
    expect(plannerPlannedLater(later)).toBe(true)
    // An overdue row dragged onto a tile of next week, seen from this week: still in Today.
    const overdue = place({ doDate: day(8), nextFollowupAt: day(-3) })
    expect(shape(overdue)).toEqual(['day', '2026-11-20', 'followup', true])
    expect(overdue?.conflicts.map((c) => [c.date, c.days, c.fixes.map((f) => f.kind)])).toEqual([['followup', 11, ['move-date']]])
    // A row on the window's last day by its date, snoozed past it: it stays there.
    expect(shape(place({ doDate: day(7), dueDate: day(6) }))).toEqual(['day', '2026-11-26', 'due', true])
    // Seen from the window that reaches the planned day: on that day, by its plan.
    const there = plannerPlacement(task({ doDate: day(8), nextFollowupAt: day(-3) }), plannerWindow(TODAY, 7))
    expect(shape(there)).toEqual(['day', '2026-11-28', 'plan', true])
    expect(plannerPlannedLater(there)).toBe(false)
    // Not planned later: a plain dated row, a row on its planned day, the trays.
    for (const fields of [{ dueDate: day(1) }, { doDate: day(2) }, { doDate: day(-2) }, { focus: true }]) {
      expect(plannerPlannedLater(place(fields))).toBe(false)
    }
    expect(plannerPlannedLater(null)).toBe(false)
  })

  it('shows a task where its placement puts it — not on a day between tomorrow and a shifted window', () => {
    expect(plannerShows(task({ dueDate: day(1) }), SPAN)).toBe(true)
    expect(plannerShows(task({ doDate: day(7) }), SPAN)).toBe(false)
    expect(plannerShows(task({ doDate: day(7), dueDate: day(6) }), SPAN)).toBe(true)
    expect(plannerShows(task({ doDate: day(-1) }), SPAN)).toBe(true)
    expect(plannerShows(task({ focus: true }), SPAN)).toBe(true)
    expect(plannerShows(task({}), SPAN)).toBe(false)
    // Next week's window: today's rows and the window's show; tomorrow's has no group.
    const next = plannerWindow(TODAY, 7)
    expect(plannerShows(task({ doDate: day(0) }), next)).toBe(true)
    expect(plannerShows(task({ doDate: day(1) }), next)).toBe(false)
    expect(plannerShows(task({ dueDate: day(6) }), next)).toBe(false)
    expect(plannerShows(task({ doDate: day(7) }), next)).toBe(true)
    expect(plannerShows(task({ doDate: day(13) }), next)).toBe(true)
  })

  it('no plan → its natural day, with the reason; not placed', () => {
    expect(shape(place({ dueDate: day(2), nextFollowupAt: day(4) }))).toEqual(['day', '2026-11-22', 'due', false])
    expect(shape(place({ dueDate: day(4), nextFollowupAt: day(2) }))).toEqual(['day', '2026-11-22', 'followup', false])
    expect(shape(place({ dueDate: day(2), nextFollowupAt: day(2) }))).toEqual(['day', '2026-11-22', 'due', false])
    expect(shape(place({ dueDate: day(-3) }))).toEqual(['day', '2026-11-20', 'due', false])
    expect(shape(place({ nextFollowupAt: day(-9), dueDate: day(2) }))).toEqual(['day', '2026-11-20', 'followup', false])
  })

  it('no plan and no natural day: a Focus task → Unplanned, anything else is not in the widget', () => {
    expect(shape(place({ focus: true }))).toEqual(['unplanned', null, 'filter', false])
    expect(shape(place({ focus: true, dueDate: day(7) }))).toEqual(['unplanned', null, 'filter', false])
    expect(shape(place({ focus: true, nextFollowupAt: day(8), dueDate: day(9) }))).toEqual(['unplanned', null, 'filter', false])
    expect(place({})).toBeNull()
    expect(place({ dueDate: day(7) })).toBeNull()
  })

  it('a Focus task with a natural day sits on it, not in Unplanned', () => {
    expect(shape(place({ focus: true, dueDate: day(3) }))).toEqual(['day', '2026-11-23', 'due', false])
  })

  it('completed tasks are not shown, whatever their plan', () => {
    expect(place({ isCompleted: true, doDate: day(1) })).toBeNull()
    expect(place({ isCompleted: true, focus: true })).toBeNull()
    expect(place({ isCompleted: true, dueDate: day(0), focus: true })).toBeNull()
  })

  it('a planned row still carrying a stored `unplanned` field reads by its planned day', () => {
    expect(shape(plannerPlacement(leftover({ doDate: day(2) }), SPAN))).toEqual(['day', '2026-11-22', 'plan', true])
    expect(shape(plannerPlacement(leftover({ doDate: day(-2) }), SPAN))).toEqual(['delayed', null, 'plan', true])
  })
})

describe('a plan on the day of a real date: a plan like any other', () => {
  it('the planned day is the `doDate`’s day, whatever the task’s dates', () => {
    expect(plannerPlannedDay(task({ doDate: day(2, 15) }))).toEqual(day(2))
    expect(plannerPlannedDay(task({ doDate: day(2), dueDate: day(3) }))).toEqual(day(2))
    expect(plannerPlannedDay(task({}))).toBeNull()
    // Due that day (at any time of day), or due for a follow-up that day: still the plan.
    expect(plannerPlannedDay(task({ doDate: day(2), dueDate: day(2, 9) }))).toEqual(day(2))
    expect(plannerPlannedDay(task({ doDate: day(2), nextFollowupAt: day(2), dueDate: day(5) }))).toEqual(day(2))
    expect(plannerPlannedDay(task({ doDate: day(30), dueDate: day(30) }))).toEqual(day(30))
  })

  it('is placed on its day with no conflict, and draws a plan mark on the tile', () => {
    // Add task in the Planner, typed with a due date of today: planned for today and due today.
    const added = task({ doDate: day(0), dueDate: day(0) })
    expect(plannerPlacement(added, SPAN)).toEqual({
      where: 'day', day: day(0), reason: 'plan', placed: true, planned: day(0), natural: { day: day(0), date: day(0), reason: 'due' }, conflicts: [],
    })
    // A planned task whose due date was then edited onto its planned day.
    const edited = task({ doDate: day(3), dueDate: day(3) })
    expect(plannerPlacement(edited, SPAN)).toMatchObject({ where: 'day', day: day(3), reason: 'plan', placed: true, planned: day(3), conflicts: [] })
    const view = plannerView([added, edited], { today: TODAY })
    expect(view.tiles[0]).toMatchObject({ count: 1, dates: ['due'], plans: 1 })
    expect(view.tiles[3]).toMatchObject({ count: 1, dates: ['due'], plans: 1 })
    expect(plannerResetCounts(view)).toEqual({ week: 2, today: 1, delayed: 0 })
  })

  it('lands in Delayed once its day has passed, as any plan does', () => {
    // The same task a day later: due yesterday, planned for yesterday.
    const stale = task({ doDate: day(-1), dueDate: day(-1) })
    expect(plannerPlacement(stale, SPAN)).toMatchObject({ where: 'delayed', placed: true, planned: day(-1) })
    const view = plannerView([stale], { today: TODAY })
    expect(view.today.tasks).toEqual([])
    expect(uids(view.delayed.tasks)).toEqual([stale.uid])
  })

  it('a plan for a date past the window is planned later: out of view until the window reaches it', () => {
    // Snooze from the window's last day onto the day the task is due.
    const snoozed = task({ doDate: day(7), dueDate: day(7) })
    expect(plannerPlacement(snoozed, SPAN)).toBeNull()
    expect(inPlanner(snoozed, SPAN)).toBe(true)
    expect(plannerPlacement(snoozed, plannerWindow(TODAY, 7))).toMatchObject({ where: 'day', day: day(7), reason: 'plan', placed: true })
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
    expect(conflicts({ focus: true, dueDate: day(20) })).toEqual([])
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

  it('orders Delayed by the day planned, oldest first; Unplanned by sort order', () => {
    const recent = task({ doDate: day(-1) })
    const old = task({ doDate: day(-9) })
    const focusB = task({ focus: true, sortOrder: 5 })
    const focusA = task({ focus: true, sortOrder: 2 })
    const focusFar = task({ focus: true, dueDate: day(20), sortOrder: 3 })
    const view = plannerView([recent, old, focusB, focusA, focusFar], { today: TODAY })
    expect(uids(view.delayed.tasks)).toEqual(uids([old, recent]))
    expect(uids(view.unplanned.tasks)).toEqual(uids([focusA, focusFar, focusB]))
  })

  it('the hand order holds in the trays too', () => {
    const a = task({ doDate: day(-1) })
    const b = task({ doDate: day(-2) })
    const c = task({ focus: true })
    const d = task({ focus: true })
    const view = plannerView([a, b, c, d], { today: TODAY, order: [d.uid, a.uid] })
    expect(uids(view.delayed.tasks)).toEqual(uids([a, b]))
    expect(uids(view.unplanned.tasks)).toEqual(uids([d, c]))
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
    const focusFar = task({ focus: true, dueDate: day(9) })
    const focus = task({ focus: true })
    const done = task({ dueDate: day(0), isCompleted: true })
    const far = task({ dueDate: day(7) })
    const plannedFar = task({ doDate: day(8) })
    const plain = task()
    const view = plannerView([late, now, plannedToday, mon, thu, missed, focusFar, focus, done, far, plannedFar, plain], { today: TODAY })
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
    expect(uids(view.unplanned.tasks)).toEqual(uids([focusFar, focus]))
    // Display order: Today, the days, Delayed, Unplanned.
    expect(uids(view.tasks)).toEqual(uids([late, now, plannedToday, mon, thu, missed, focusFar, focus]))
    expect([...view.placements.keys()].sort()).toEqual(uids(view.tasks).sort())
    // Placed: the rows with a planned day — never an Unplanned row.
    expect(view.tasks.filter((t) => view.placements.get(t.uid)?.placed).map((t) => t.uid)).toEqual(uids([plannedToday, mon, missed]))
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
        task({ doDate: day(-1) }), task({ doDate: day(-2), dueDate: day(1) }), task({ focus: true }),
      ]
      const view = plannerView(tasks, { today: TODAY })
      expect(view.tiles.map((t) => t.key)).toEqual(view.window.days.map(dayKey))
      expect(view.tiles.map((t) => t.isToday)).toEqual([true, false, false, false, false, false, false])
      expect(view.tiles[0]).toMatchObject({ count: 3, dates: ['due', 'followup'], plans: 1 })
      expect(view.tiles[2]).toMatchObject({ count: 3, dates: ['due', 'followup'], plans: 1 })
      // The Delayed task's due date still marks its day; nothing sits there.
      expect(view.tiles[1]).toMatchObject({ count: 0, dates: ['due'], plans: 0 })
    })

    it('draw their marks as the shared day ticks: at most eight, then how many more', () => {
      const tasks = Array.from({ length: DAY_TICKS_MAX + 3 }, () => task({ doDate: day(1) }))
      const tile = plannerView(tasks, { today: TODAY }).tiles[1]!
      expect(tile.count).toBe(11)
      expect(dayTicks(tile)).toEqual({ dates: [], plans: 8, more: 3 })
    })

    it('mark the real dates falling on each day wherever the task is planned, and the plans on it', () => {
      const view = plannerView([
        // Due Sun, planned Tue: its due date marks Sun, its plan Tue.
        task({ dueDate: day(2), doDate: day(4) }),
        // Due and follow-up both on Sun, planned for a day that passed (Delayed): two marks on Sun, on no day's count.
        task({ dueDate: day(2), nextFollowupAt: day(2), doDate: day(-1) }),
        // Follow-up Sat, due Mon, no plan: sits on Sat; both dates mark their days.
        task({ nextFollowupAt: day(1), dueDate: day(3) }),
        // Planned for a day that passed (Delayed): its due date still marks Tue; its plan marks no tile.
        task({ dueDate: day(4), doDate: day(-2) }),
        // Planned past the window: it shows on Mon by its follow-up, which marks Mon; its plan marks no tile here.
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
        [['due', 'followup'], 0, 1],
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
    const focusFar = task({ focus: true, dueDate: day(20) })
    const view = plannerView([late, now, between, plannedBetween, inWindow, lastDay, past, focus, missed, focusFar], { today: TODAY, offset: 7 })

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
      expect(uids(view.tasks)).toEqual(uids([late, now, inWindow, lastDay, missed, focus, focusFar]))
      expect(view.placements.has(between.uid)).toBe(false)
      expect(view.placements.has(plannedBetween.uid)).toBe(false)
      expect(uids(view.delayed.tasks)).toEqual(uids([missed]))
      expect(uids(view.unplanned.tasks)).toEqual(uids([focus, focusFar]))
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
      // By its follow-up, by its due date, by a plan, delayed, Focus with no date.
      expect(drop({ nextFollowupAt: day(1) }, on(3))).toEqual({ kind: 'plan', day: day(3) })
      expect(drop({ dueDate: day(1), nextFollowupAt: day(4) }, on(3))).toEqual({ kind: 'plan', day: day(3) })
      expect(drop({ doDate: day(1), nextFollowupAt: day(0) }, on(3))).toEqual({ kind: 'plan', day: day(3) })
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

    it('on its natural day: the plan is cleared', () => {
      expect(drop({ dueDate: day(2), doDate: day(4) }, on(2))).toEqual({ kind: 'own', day: day(2) })
      expect(plannerDropWrite(drop({ dueDate: day(2), doDate: day(4) }, on(2)))).toBeNull()
      expect(drop({ nextFollowupAt: day(1), dueDate: day(3), doDate: day(5) }, on(1))).toEqual({ kind: 'own', day: day(1) })
      expect(drop({ doDate: day(-1), dueDate: day(2) }, on(2))).toEqual({ kind: 'own', day: day(2) })
      // A stored `unplanned` field is no plan to clear: there already.
      expect(plannerDrop(leftover({ nextFollowupAt: day(3) }), SPAN, on(3))).toEqual({ kind: 'none' })
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
    })

    it('planned for its own day and sitting there: a drop there keeps the plan (the order only)', () => {
      // Planned on the very day its date puts it: a plan like any other.
      expect(drop({ dueDate: day(2), doDate: day(2) }, on(2))).toEqual({ kind: 'none' })
      expect(plannerDropWrite(drop({ dueDate: day(2), doDate: day(2) }, on(2)))).toBeUndefined()
      // A late date, planned for today: it sits in Today by its plan, kept.
      expect(drop({ dueDate: day(-3), doDate: day(0) }, on(0))).toEqual({ kind: 'none' })
      // Planned for another day, dropped on its own day: the plan is cleared.
      expect(drop({ dueDate: day(2), doDate: day(4) }, on(2))).toEqual({ kind: 'own', day: day(2) })
      // With no plan state to clear it is simply there.
      expect(drop({ dueDate: day(2) }, on(2))).toEqual({ kind: 'none' })
    })

    it('a day before today is refused', () => {
      expect(drop({ dueDate: day(2) }, on(-1))).toEqual({ kind: 'refuse' })
    })
  })

  describe('on Unplanned', () => {
    it('a planned task loses its plan, wherever its plan or its dates put it', () => {
      // With a natural day, in Focus, delayed, on a day of the window, past it.
      expect(drop({ doDate: day(2), dueDate: day(1) }, UNPLANNED)).toEqual({ kind: 'unplan' })
      expect(drop({ doDate: day(-2), nextFollowupAt: day(3) }, UNPLANNED)).toEqual({ kind: 'unplan' })
      expect(drop({ focus: true, doDate: day(2) }, UNPLANNED)).toEqual({ kind: 'unplan' })
      expect(drop({ focus: true, doDate: day(-2), dueDate: day(20) }, UNPLANNED)).toEqual({ kind: 'unplan' })
      expect(drop({ doDate: day(2) }, UNPLANNED)).toEqual({ kind: 'unplan' })
      expect(drop({ doDate: day(12) }, UNPLANNED)).toEqual({ kind: 'unplan' })
      expect(plannerDropWrite(drop({ doDate: day(2) }, UNPLANNED))).toBeNull()
    })

    it('the cleared task goes back to its natural day, stays in Unplanned by the filter, or leaves the Planner', () => {
      const cleared = (fields: Partial<PlannerTask>) => {
        const planned = task(fields)
        expect(plannerDrop(planned, SPAN, UNPLANNED)).toEqual({ kind: 'unplan' })
        return plannerPlacement({ ...planned, doDate: undefined }, SPAN)
      }
      expect(cleared({ doDate: day(4), dueDate: day(1) })).toMatchObject({ where: 'day', day: day(1), reason: 'due', placed: false })
      expect(cleared({ doDate: day(-2), focus: true })).toMatchObject({ where: 'unplanned', reason: 'filter', placed: false })
      expect(cleared({ doDate: day(2) })).toBeNull()
      expect(cleared({ doDate: day(0), dueDate: day(30) })).toBeNull()
    })

    it('Unplan takes a planned task with no date in the window and not matching the filter out of the Planner: leaves', () => {
      for (const fields of [{ doDate: day(2) }, { doDate: day(-2) }, { doDate: day(0), dueDate: day(30) }] as Array<Partial<PlannerTask>>) {
        const planned = task(fields)
        expect(plannerClearLeaves(planned, SPAN)).toBe(true)
        expect(plannerMovePlan(planned, SPAN, UNPLANNED)).toEqual({ drop: { kind: 'unplan' }, moves: true, leaves: true })
      }
      // With a position too: the order is stored and it still leaves.
      const planned = task({ doDate: day(2) })
      const moved = plannerMovePlan(planned, SPAN, UNPLANNED, { rows: ['x'], index: 0, shown: [planned.uid, 'x'] })
      expect(moved).toMatchObject({ drop: { kind: 'unplan' }, moves: true, leaves: true })
      expect(moved.order).toBeDefined()
      // Kept by a natural day or the filter: no leaves.
      expect(plannerMovePlan(task({ doDate: day(4), dueDate: day(1) }), SPAN, UNPLANNED)).not.toHaveProperty('leaves')
      expect(plannerMovePlan(task({ doDate: day(4), focus: true }), SPAN, UNPLANNED)).not.toHaveProperty('leaves')
      // Only an Unplan leaves: a drop on a day, or on its own day, never does.
      expect(plannerMovePlan(task({ doDate: day(2) }), SPAN, on(4))).not.toHaveProperty('leaves')
      expect(plannerMovePlan(task({ doDate: day(4), dueDate: day(2) }), SPAN, on(2))).not.toHaveProperty('leaves')
    })

    it('where it sits already: nothing', () => {
      expect(drop({ focus: true }, UNPLANNED)).toEqual({ kind: 'none' })
      expect(plannerDrop(leftover({ focus: true }), SPAN, UNPLANNED)).toEqual({ kind: 'none' })
    })

    it('a drop on Unplanned refuses a task with no plan: nothing is put in Unplanned by hand', () => {
      expect(drop({}, UNPLANNED)).toEqual({ kind: 'refuse' })
      expect(drop({ dueDate: day(1) }, UNPLANNED)).toEqual({ kind: 'refuse' })
      expect(drop({ nextFollowupAt: day(-1), focus: true }, UNPLANNED)).toEqual({ kind: 'refuse' })
      expect(drop({ dueDate: day(30) }, UNPLANNED)).toEqual({ kind: 'refuse' })
      expect(drop({ isCompleted: true }, UNPLANNED)).toEqual({ kind: 'refuse' })
      // A stored `unplanned` field is no plan.
      expect(plannerDrop(leftover({ dueDate: day(1) }), SPAN, UNPLANNED)).toEqual({ kind: 'refuse' })
      expect(plannerMovePlan(task({ dueDate: day(1) }), SPAN, UNPLANNED)).toEqual({ drop: { kind: 'refuse' }, moves: false })
    })
  })

  describe('on Delayed', () => {
    it('takes no drop; a row already in it only reorders', () => {
      expect(drop({ dueDate: day(1) }, DELAYED)).toEqual({ kind: 'refuse' })
      expect(drop({ doDate: day(2) }, DELAYED)).toEqual({ kind: 'refuse' })
      expect(drop({ focus: true }, DELAYED)).toEqual({ kind: 'refuse' })
      expect(drop({}, DELAYED)).toEqual({ kind: 'refuse' })
      expect(drop({ doDate: day(-1) }, DELAYED)).toEqual({ kind: 'none' })
    })
  })

  it('a completed task is refused everywhere', () => {
    for (const target of [on(0), on(3), UNPLANNED, DELAYED]) {
      expect(drop({ isCompleted: true, doDate: day(2), dueDate: day(1) }, target)).toEqual({ kind: 'refuse' })
    }
  })

  it('what each drop writes: a planned day, no plan, or nothing', () => {
    expect(plannerDropWrite({ kind: 'plan', day: day(3) })).toEqual({ day: day(3) })
    expect(plannerDropWrite({ kind: 'own', day: day(3) })).toBeNull()
    expect(plannerDropWrite({ kind: 'unplan' })).toBeNull()
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

  it('a row planned later moves on from its planned day, not from the day it shows on', () => {
    // On Thu by its due date, planned for Fri 27: Sat 28.
    expect(snoozeDay({ doDate: day(7), dueDate: day(6) })).toBe('2026-11-28')
    expect(snooze({ doDate: day(7), dueDate: day(6) })).toEqual({ kind: 'plan', day: day(8) })
  })

  it('a Delayed or Unplanned row (or one not shown) goes to tomorrow', () => {
    expect(snoozeDay({ doDate: day(-4) })).toBe('2026-11-21')
    expect(snoozeDay({ focus: true, dueDate: day(9) })).toBe('2026-11-21')
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

  it('landing on its natural day plans it there outright (a pick, not a drag)', () => {
    // Planned Sat, due Sun: snoozed onto Sun, its own date's day.
    expect(snooze({ doDate: day(1), dueDate: day(2) })).toEqual({ kind: 'plan', day: day(2) })
    // Delayed, follow-up tomorrow.
    expect(snooze({ doDate: day(-1), nextFollowupAt: day(1) })).toEqual({ kind: 'plan', day: day(1) })
    // Planned for today, follow-up tomorrow.
    expect(snooze({ doDate: day(0), nextFollowupAt: day(1) })).toEqual({ kind: 'plan', day: day(1) })
    // A drag onto that day still clears the plan.
    expect(plannerDrop(task({ doDate: day(1), dueDate: day(2) }), SPAN, { kind: 'day', day: day(2) })).toEqual({ kind: 'own', day: day(2) })
  })

  it('a completed task is refused', () => {
    expect(snooze({ isCompleted: true, doDate: day(1) })).toEqual({ kind: 'refuse' })
  })
})

describe('a task planned later, in the view', () => {
  it('is a row of its natural day — in Today when overdue — and counts where the view counts: the tile, Reset plan', () => {
    const overdue = task({ doDate: day(8), dueDate: day(-2) })
    const sunday = task({ doDate: day(9), nextFollowupAt: day(2) })
    const gone = task({ doDate: day(9) })
    const view = plannerView([overdue, sunday, gone], { today: TODAY })
    expect(uids(view.today.tasks)).toEqual([overdue.uid])
    expect(uids(view.days[1]?.tasks ?? [])).toEqual([sunday.uid])
    expect(view.delayed.tasks).toEqual([])
    expect(view.unplanned.tasks).toEqual([])
    expect(uids(view.tasks)).toEqual(uids([overdue, sunday]))
    expect(view.placements.has(gone.uid)).toBe(false)
    // The rows sit on those days; their plans mark no tile of this window.
    expect(view.tiles.map((t) => [t.count, t.plans])).toEqual([[1, 0], [0, 0], [1, 0], [0, 0], [0, 0], [0, 0], [0, 0]])
    // Reset plan › This week clears both (they are placed rows it shows); Today only clears plans *for* today.
    expect(plannerResetCounts(view)).toEqual({ week: 2, today: 0, delayed: 0 })
    expect(uids(plannerResetTasks(view, 'week'))).toEqual(uids([overdue, sunday]))
    // The window that reaches the planned days shows them there, by their plans.
    const next = plannerView([overdue, sunday, gone], { today: TODAY, offset: 7 })
    expect(next.today.tasks).toEqual([])
    expect(next.tiles.map((t) => [t.count, t.plans])).toEqual([[0, 0], [1, 1], [2, 2], [0, 0], [0, 0], [0, 0], [0, 0]])
  })
})

describe('a row’s tag and late dates', () => {
  const placed = (over: Partial<PlannerTask>) => plannerPlacement(task(over), SPAN)

  it('a Delayed row: the day it was planned for', () => {
    const tag = plannerRowTag(placed({ doDate: day(-2), dueDate: day(3) }))
    expect(tag).toEqual({ kind: 'planned', day: day(-2) })
    expect(plannerRowTagLabel(tag!, TODAY)).toBe('Wed')
    expect(plannerRowTagHint(tag!)).toBe('Planned for Wed, Nov 18')
  })

  it('an Unplanned row has no tag, whatever its placement holds', () => {
    expect(plannerRowTag(placed({ focus: true }))).toBeNull()
    expect(plannerRowTag(placed({ focus: true, dueDate: day(30) }))).toBeNull()
    expect(plannerRowTag(plannerPlacement(leftover({ focus: true }), SPAN))).toBeNull()
    // Even a placement in Unplanned that carries a natural day (none is made so).
    expect(plannerRowTag({
      where: 'unplanned', day: null, reason: 'filter', placed: false, planned: null,
      natural: { day: day(3), date: day(3), reason: 'followup' }, conflicts: [],
    })).toBeNull()
    // A stored `unplanned` field puts a row on its own day, with no tag.
    expect(plannerRowTag(plannerPlacement(leftover({ nextFollowupAt: day(3) }), SPAN))).toBeNull()
  })

  it('a row planned past a real date: the conflict in words, with its fixes', () => {
    const tag = plannerRowTag(placed({ doDate: day(4), dueDate: day(3) }))
    expect(tag).toMatchObject({ kind: 'conflict', conflict: { date: 'due', days: 1 } })
    expect(plannerRowTagLabel(tag!, TODAY)).toBe('1 day after due')
    expect(plannerRowTagHint(tag!)).toBe('Planned 1 day after its due date')
    expect(tag?.kind === 'conflict' && tag.fixes.map((f) => plannerFixLabel(f, TODAY))).toEqual(['Move due date to Tue, Nov 24', 'Plan for Mon, Nov 23'])
    const followup = plannerRowTag(placed({ doDate: day(4), nextFollowupAt: day(2) }))
    expect(plannerRowTagLabel(followup!, TODAY)).toBe('2 days after follow-up')
    expect(plannerRowTagHint(followup!)).toBe('Planned 2 days after its follow-up')
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

  it('a row planned later: its planned day, with the fixes of the dates that plan passes', () => {
    const tag = plannerRowTag(placed({ doDate: day(7), dueDate: day(6) }))
    expect(tag).toEqual({ kind: 'later', day: day(7), fixes: [{ kind: 'move-date', date: 'due', to: day(7) }, { kind: 'plan', day: day(6) }] })
    expect(plannerRowTagLabel(tag!, TODAY)).toBe('planned Fri, Nov 27')
    expect(plannerRowTagHint(tag!)).toBe('Planned for Fri, Nov 27, after the days shown')
    expect(tag?.kind === 'later' && tag.fixes.map((f) => plannerFixLabel(f, TODAY))).toEqual(['Move due date to Fri, Nov 27', 'Plan for Thu, Nov 26'])
    // Its date is drawn late, as for any plan past a date.
    expect(plannerLateDates(placed({ doDate: day(7), dueDate: day(6) }))).toEqual({ due: true, followup: false })
    // An overdue date offers no Plan for it.
    const overdue = plannerRowTag(placed({ doDate: day(8), nextFollowupAt: day(-3) }))
    expect(overdue?.kind === 'later' && overdue.fixes.map((f) => plannerFixLabel(f, TODAY))).toEqual(['Move follow-up to Sat, Nov 28'])
  })

  it('no tag on a row its own date puts there, on a plan before its dates, or on no placement', () => {
    expect(plannerRowTag(placed({ dueDate: day(2) }))).toBeNull()
    expect(plannerRowTag(placed({ doDate: day(1), dueDate: day(3) }))).toBeNull()
    expect(plannerRowTag(placed({ doDate: day(3), dueDate: day(3) }))).toBeNull()
    expect(plannerRowTag(null)).toBeNull()
    expect(plannerRowTag(undefined)).toBeNull()
  })

  it('a placed row’s plan state in words, for its accessible description: planned, planned for a day', () => {
    expect(plannerRowStateWords(placed({ doDate: day(2) }), TODAY)).toBe('planned')
    expect(plannerRowStateWords(placed({ doDate: day(4), dueDate: day(3) }), TODAY)).toBe('planned')
    expect(plannerRowStateWords(placed({ doDate: day(-2) }), TODAY)).toBe('planned for Wed')
    expect(plannerRowStateWords(placed({ doDate: day(-9) }), TODAY)).toBe('planned for Nov 11')
    expect(plannerRowStateWords(placed({ doDate: day(7), dueDate: day(6) }), TODAY)).toBe('planned for Fri, Nov 27')
    // Not placed: nothing to say — an Unplanned row never is, a stored `unplanned` field changes nothing.
    expect(plannerRowStateWords(placed({ dueDate: day(1) }), TODAY)).toBeNull()
    expect(plannerRowStateWords(placed({ focus: true }), TODAY)).toBeNull()
    expect(plannerRowStateWords(plannerPlacement(leftover({ focus: true }), SPAN), TODAY)).toBeNull()
    expect(plannerRowStateWords(plannerPlacement(leftover({ dueDate: day(1) }), SPAN), TODAY)).toBeNull()
    expect(plannerRowStateWords(placed({ doDate: day(2), dueDate: day(2) }), TODAY)).toBe('planned')
    expect(plannerRowStateWords(null, TODAY)).toBeNull()
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
    // Delayed and Unplanned rows have no conflict: nothing is drawn late that isn't.
    expect(plannerLateDates(placed({ doDate: day(-2), dueDate: day(-3) }))).toBeNull()
    expect(plannerLateDates(placed({ focus: true, dueDate: day(20) }))).toBeNull()
    expect(plannerLateDates(null)).toBeNull()
  })
})

describe('a Move date fix that puts the task on its planned day by its own dates', () => {
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

  it('keeps it for a date moved past the window: a plan on its due date’s day is a plan like any other', () => {
    // Planned for next Friday (past the window), due Sunday: the due date moved to that Friday.
    expect(plannerFixClearsPlan(task({ doDate: day(7), dueDate: day(2) }), move('due', 7), SPAN)).toBe(false)
    expect(plannerFixClearsPlan(task({ doDate: day(7), dueDate: day(2), nextFollowupAt: day(4) }), move('due', 7), SPAN)).toBe(false)
  })

  it('is false for a task with no planned day', () => {
    expect(plannerFixClearsPlan(task({ dueDate: day(1) }), move('due', 3), SPAN)).toBe(false)
    expect(plannerFixClearsPlan(leftover({ dueDate: day(1) }), move('due', 3), SPAN)).toBe(false)
  })
})

describe('Unplan and Clear Delayed plans', () => {
  it('Unplan is the Unplanned drop for one row: a plan cleared, refused without one', () => {
    expect(plannerUnplan(task({ doDate: day(2), dueDate: day(1) }), SPAN)).toEqual({ kind: 'unplan' })
    expect(plannerUnplan(task({ focus: true, doDate: day(2) }), SPAN)).toEqual({ kind: 'unplan' })
    expect(plannerUnplan(task({ doDate: day(2) }), SPAN)).toEqual({ kind: 'unplan' })
    expect(plannerUnplan(task({ focus: true }), SPAN)).toEqual({ kind: 'none' })
    expect(plannerUnplan(task({}), SPAN)).toEqual({ kind: 'refuse' })
    expect(plannerUnplan(task({ dueDate: day(1) }), SPAN)).toEqual({ kind: 'refuse' })
  })

  it('Clear Delayed plans: every Delayed task’s plan cleared, each where its own dates put it; nothing else', () => {
    const dated = task({ doDate: day(-1), dueDate: day(2) })
    const late = task({ doDate: day(-3), nextFollowupAt: day(-5) })
    const focus = task({ doDate: day(-2), focus: true })
    const bare = task({ doDate: day(-2) })
    const farDate = task({ doDate: day(-2), dueDate: day(30) })
    const others = [task({ doDate: day(1) }), task({ dueDate: day(1) }), task({ dueDate: day(0) }), task({ focus: true })]
    const view = plannerView([dated, late, focus, bare, farDate, ...others], { today: TODAY })
    expect(uids(view.delayed.tasks).sort()).toEqual(uids([dated, late, focus, bare, farDate]).sort())
    const plans = plannerClearDelayed(view)
    expect(new Map(plans.map((p) => [p.id, p.plan]))).toEqual(new Map<number, unknown>([
      [dated.id, null], [late.id, null], [focus.id, null], [bare.id, null], [farDate.id, null],
    ]))
    // Afterwards: on its natural day, in Unplanned by the filter, or out of the Planner.
    const after = [dated, late, focus, bare, farDate].map((t): PlannerTask & { id: number } => ({ ...t, doDate: undefined }))
    const next = plannerView([...after, ...others], { today: TODAY })
    expect(next.delayed.tasks).toEqual([])
    const where = (t: PlannerTask) => {
      const p = next.placements.get(t.uid)
      return p ? [p.where, p.day ? dayKey(p.day) : null] : null
    }
    expect(after.map(where)).toEqual([['day', '2026-11-22'], ['day', '2026-11-20'], ['unplanned', null], null, null])
    // The ones that leave are the ones Clear plan says leave.
    expect([dated, late, focus, bare, farDate].map((t) => plannerClearLeaves(t, SPAN))).toEqual([false, false, false, true, true])
  })

  it('with nothing in Delayed: no change', () => {
    expect(plannerClearDelayed(plannerView([task({ doDate: day(1) })], { today: TODAY }))).toEqual([])
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
  // A stored `unplanned` field is no plan: it sits on Sun by its due date, nothing to reset.
  const stale = leftover({ dueDate: day(2) })
  const focus = task({ focus: true })
  const plannedFar = task({ doDate: day(9) })
  const done = task({ doDate: day(0), isCompleted: true })
  const all = [plannedToday, plannedTodayDated, byDateToday, plannedMon, byDateMon, delayedA, delayedB, stale, focus, plannedFar, done]
  const view = plannerView(all, { today: TODAY })
  const reset = (scope: PlannerResetScope) => uids(plannerResetTasks(view, scope)).sort()

  it('this week: every planned task the Planner shows — planned days in the window and Delayed', () => {
    expect(reset('week')).toEqual(uids([plannedToday, plannedTodayDated, plannedMon, delayedA, delayedB]).sort())
  })

  it('today only: the tasks planned for today', () => {
    expect(reset('today')).toEqual(uids([plannedToday, plannedTodayDated]).sort())
  })

  it('Delayed only', () => {
    expect(reset('delayed')).toEqual(uids([delayedA, delayedB]).sort())
  })

  it('counts each scope', () => {
    expect(plannerResetCounts(view)).toEqual({ week: 5, today: 2, delayed: 2 })
    expect(plannerResetCounts(plannerView([byDateToday, focus, stale], { today: TODAY }))).toEqual({ week: 0, today: 0, delayed: 0 })
  })

  it('a shifted window: its own planned days, with today’s and Delayed — not the days between', () => {
    const shifted = plannerView([...all, task({ doDate: day(4) })], { today: TODAY, offset: 7 })
    expect(uids(plannerResetTasks(shifted, 'week')).sort()).toEqual(uids([plannedToday, plannedTodayDated, delayedA, delayedB, plannedFar]).sort())
    expect(plannerResetCounts(shifted)).toEqual({ week: 5, today: 2, delayed: 2 })
  })
})

describe('Reset plan’s week scope is the days shown', () => {
  it('is named This week only while the window starts today; shifted, by its range', () => {
    expect(plannerResetWeekLabel(plannerWindow(TODAY))).toBe('This week')
    expect(plannerResetWeekLabel(plannerWindow(TODAY, 7))).toBe('Nov 27 – Dec 3')
    expect(plannerResetWeekLabel(plannerWindow(TODAY, 42))).toBe('Jan 1 – 7')
  })

  it('shifted, it clears the plans of the window shown (and Today’s and the trays’), not tomorrow’s', () => {
    const tomorrow = task({ doDate: day(1) })
    const next = task({ doDate: day(8) })
    const delayed = task({ doDate: day(-1) })
    expect(uids(plannerResetTasks(plannerView([tomorrow, next, delayed], { today: TODAY }), 'week'))).toEqual(uids([tomorrow, delayed]))
    expect(uids(plannerResetTasks(plannerView([tomorrow, next, delayed], { today: TODAY, offset: 7 }), 'week'))).toEqual(uids([next, delayed]))
  })
})

describe('labels', () => {
  it('names a day and a tile', () => {
    expect(plannerDayLabel(day(3))).toBe('Mon, Nov 23')
    expect(plannerTileLabel({ day: day(3), count: 3, isToday: false })).toBe('Mon, Nov 23: 3 tasks')
    expect(plannerTileLabel({ day: day(3), count: 1, isToday: false })).toBe('Mon, Nov 23: 1 task')
    expect(plannerTileLabel({ day: day(0), count: 0, isToday: true })).toBe('Today, Nov 20: no tasks')
    // With its marks: the real dates on the day, then the plans for it.
    expect(plannerTileLabel({ day: day(3), count: 2, isToday: false, dates: ['due'], plans: 1 })).toBe('Mon, Nov 23: 2 tasks, 1 due, 1 planned')
    expect(plannerTileLabel({ day: day(2), count: 0, isToday: false, dates: ['followup', 'followup'], plans: 0 })).toBe('Sun, Nov 22: no tasks, 2 follow-ups')
    expect(plannerTileLabel({ day: day(0), count: 5, isToday: true, dates: ['due', 'due', 'followup'], plans: 3 })).toBe('Today, Nov 20: 5 tasks, 2 due, 1 follow-up, 3 planned')
    expect(plannerTileLabel({ day: day(1), count: 1, isToday: false, dates: [], plans: 0 })).toBe('Sat, Nov 21: 1 task')
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
    expect(plannerDropLabel({ kind: 'unplan' }, TODAY)).toBe('Unplan')
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

describe('Clear plan', () => {
  it('a task has a plan state only with a planned day (a redundant one too)', () => {
    expect(plannerHasPlan(task({ doDate: day(2) }))).toBe(true)
    expect(plannerHasPlan(task({ dueDate: day(2), doDate: day(2) }))).toBe(true)
    expect(plannerHasPlan(task({ dueDate: day(2), focus: true }))).toBe(false)
    // A stored `unplanned` field is no plan state.
    expect(plannerHasPlan(leftover())).toBe(false)
    expect(plannerHasPlan(leftover({ doDate: day(2) }))).toBe(true)
  })

  it('takes the task out of the Planner only when nothing else keeps it there: no date in the window, not in Focus', () => {
    expect(plannerClearLeaves(task({ doDate: day(3) }), SPAN)).toBe(true)
    expect(plannerClearLeaves(task({ doDate: day(-2) }), SPAN)).toBe(true)
    expect(plannerClearLeaves(task({ doDate: day(2), dueDate: day(30) }), SPAN)).toBe(true)
    expect(plannerClearLeaves(task({ doDate: day(4), dueDate: day(2) }), SPAN)).toBe(false)
    expect(plannerClearLeaves(task({ doDate: day(-1), nextFollowupAt: day(-4) }), SPAN)).toBe(false)
    expect(plannerClearLeaves(task({ doDate: day(3), focus: true }), SPAN)).toBe(false)
    // No plan state: nothing to clear — a stored `unplanned` field included.
    expect(plannerClearLeaves(task({}), SPAN)).toBe(false)
    expect(plannerClearLeaves(leftover(), SPAN)).toBe(false)
    expect(plannerClearLeaves(leftover({ focus: true }), SPAN)).toBe(false)
    // Planned past the window with no date in it: the Planner doesn't show it now, so clearing takes nothing out.
    expect(plannerClearLeaves(task({ doDate: day(12) }), SPAN)).toBe(false)
  })
})

describe('the Unplanned filter (`PlannerJoins`)', () => {
  // A custom filter: errands (the uid stands in for a tag here); an empty one joins nothing.
  const errands = (t: PlannerTask) => t.uid.startsWith('errand')
  const CUSTOM = plannerWindow(TODAY, 0, errands)
  const EMPTY = plannerWindow(TODAY, 0, () => false)
  const errand = (over: Partial<PlannerTask> = {}) => ({ ...task(over), uid: `errand-${seq}` })

  it('absent, it is Focus: the Planner as it always was', () => {
    expect(SPAN.joins).toBeUndefined()
    expect(plannerPlacement(task({ focus: true }), SPAN)?.where).toBe('unplanned')
    expect(plannerPlacement(errand(), SPAN)).toBeNull()
  })

  it('a custom filter decides who joins Unplanned on its own, Focus no longer', () => {
    expect(plannerPlacement(errand(), CUSTOM)).toMatchObject({ where: 'unplanned', reason: 'filter', placed: false })
    expect(plannerPlacement(task({ focus: true }), CUSTOM)).toBeNull()
    expect(inPlanner(errand(), CUSTOM)).toBe(true)
    expect(inPlanner(task({ focus: true }), CUSTOM)).toBe(false)
  })

  it('decides Unplanned only: a task with a day in the window sits on it, matching or not', () => {
    expect(plannerPlacement(errand({ dueDate: day(2) }), CUSTOM)).toMatchObject({ where: 'day', reason: 'due' })
    expect(plannerPlacement(errand({ doDate: day(1) }), CUSTOM)).toMatchObject({ where: 'day', reason: 'plan' })
    expect(plannerPlacement(task({ dueDate: day(2) }), EMPTY)).toMatchObject({ where: 'day', reason: 'due' })
  })

  it('empty, nothing joins on its own: Unplanned stays empty', () => {
    expect(plannerPlacement(task({ focus: true }), EMPTY)).toBeNull()
    expect(plannerPlacement(leftover(), EMPTY)).toBeNull()
    expect(plannerPlacement(leftover({ focus: true }), EMPTY)).toBeNull()
    expect(inPlanner(task({ focus: true }), EMPTY)).toBe(false)
  })

  it('the view takes it: Unplanned holds the matching tasks only', () => {
    const focus = task({ focus: true })
    const match = errand()
    const stale = leftover()
    const tasks = [focus, match, stale]
    expect(uids(plannerView(tasks, { today: TODAY }).unplanned.tasks)).toEqual(uids([focus]))
    expect(uids(plannerView(tasks, { today: TODAY, joins: errands }).unplanned.tasks)).toEqual(uids([match]))
    expect(plannerView(tasks, { today: TODAY, joins: () => false }).unplanned.tasks).toEqual([])
    expect(plannerView(tasks, { today: TODAY, joins: errands }).window.joins).toBe(errands)
  })

  it('Unplan: a planned task loses its plan whatever the filter; one with no plan the filter doesn’t keep is refused', () => {
    expect(plannerUnplan(errand({ doDate: day(2) }), CUSTOM)).toEqual({ kind: 'unplan' })
    expect(plannerUnplan(task({ focus: true, doDate: day(2) }), CUSTOM)).toEqual({ kind: 'unplan' })
    expect(plannerUnplan(task({ focus: true, doDate: day(2) }), EMPTY)).toEqual({ kind: 'unplan' })
    expect(plannerUnplan(errand({ doDate: day(2), dueDate: day(1) }), CUSTOM)).toEqual({ kind: 'unplan' })
    // In Unplanned already by the filter: nothing; not matching it, with no plan: refused.
    expect(plannerUnplan(errand(), CUSTOM)).toEqual({ kind: 'none' })
    expect(plannerUnplan(task({ focus: true }), CUSTOM)).toEqual({ kind: 'refuse' })
    expect(plannerUnplan(task({ focus: true }), EMPTY)).toEqual({ kind: 'refuse' })
    // Whether it leaves is the filter's: kept by it, or out of the Planner.
    expect(plannerMovePlan(errand({ doDate: day(2) }), CUSTOM, { kind: 'unplanned' })).not.toHaveProperty('leaves')
    expect(plannerMovePlan(task({ focus: true, doDate: day(2) }), CUSTOM, { kind: 'unplanned' })).toMatchObject({ leaves: true })
  })

  it('asks the filter of the task as it would be with no plan state', () => {
    const seen: Array<Pick<PlannerTask, 'doDate'>> = []
    const joins = (t: PlannerTask) => {
      seen.push({ doDate: t.doDate })
      return false
    }
    plannerMovePlan(task({ doDate: day(2) }), plannerWindow(TODAY, 0, joins), { kind: 'unplanned' })
    plannerPlacement(task({ doDate: day(-2), focus: true }), plannerWindow(TODAY, 0, joins))
    inPlanner(task({ focus: true }), plannerWindow(TODAY, 0, joins))
    plannerClearLeaves(task({ doDate: day(3) }), plannerWindow(TODAY, 0, joins))
    expect(seen.length).toBeGreaterThan(0)
    expect(seen.every((t) => t.doDate === undefined)).toBe(true)
  })

  it('Clear plan reads Remove from Planner when the filter doesn’t keep the task', () => {
    expect(plannerClearLeaves(errand({ doDate: day(3) }), CUSTOM)).toBe(false)
    expect(plannerClearLeaves(task({ doDate: day(3), focus: true }), CUSTOM)).toBe(true)
    expect(plannerClearLeaves(task({ doDate: day(3), focus: true }), SPAN)).toBe(false)
    expect(plannerClearLeaves(task({ doDate: day(3), focus: true }), EMPTY)).toBe(true)
    // A date in the window keeps it, whatever the filter.
    expect(plannerClearLeaves(task({ doDate: day(4), dueDate: day(2) }), EMPTY)).toBe(false)
  })

  it('Clear Delayed plans clears every Delayed plan; whether each leaves is the filter’s', () => {
    const missedErrand = errand({ doDate: day(-2) })
    const missedFocus = task({ focus: true, doDate: day(-1) })
    const view = plannerView([missedErrand, missedFocus], { today: TODAY, joins: errands })
    expect(plannerClearDelayed(view)).toEqual([{ id: missedErrand.id, plan: null }, { id: missedFocus.id, plan: null }])
    expect(plannerClearLeaves(missedErrand, view.window)).toBe(false)
    expect(plannerClearLeaves(missedFocus, view.window)).toBe(true)
  })
})
