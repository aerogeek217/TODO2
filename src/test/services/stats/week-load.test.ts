import { describe, expect, it } from 'vitest'
import type { PersistedTodoItem, StatusUpdate, TodoEvent, TodoEventType } from '../../../models'
import { computeWeekLoad, type WeekLoad, type WeekLoadCounts, type WeekLoadKind } from '../../../services/stats/week-load'
import { eventsByTask, taskFieldReplayAt } from '../../../services/stats/task-history'
import { FILTER_HISTORY_EVENT_TYPES } from '../../../utils/trend-window'
import { makeTodo } from '../../helpers'

/**
 * The week load (`services/stats/week-load`): one test per rule of the
 * plan — where a date lands, what became of it, today, the usual week, the
 * log limits and a deleted task. Weeks start on Monday; now is Wednesday
 * Nov 25, 2026, 14:00 — this week is Nov 23 – 29, last week Nov 16 – 22.
 */

const NOW = new Date(2026, 10, 25, 14, 0)
const OLD = new Date(2026, 8, 1, 9, 0)
/** Nov `d`, 2026 at `h`:00 (local). */
const nov = (d: number, h = 0) => new Date(2026, 10, d, h)
const iso = (d: Date) => d.toISOString()

let seq = 0
function ev(todoId: number, type: TodoEventType, at: Date, fromValue: string | null = null, toValue: string | null = null): TodoEvent {
  return { id: ++seq, todoId, type, fromValue, toValue, timestamp: iso(at) }
}

function task(overrides: Partial<PersistedTodoItem> & { id: number }): PersistedTodoItem {
  return makeTodo({ createdAt: OLD, modifiedAt: OLD, ...overrides })
}

interface Run {
  events?: TodoEvent[]
  statusUpdates?: Map<number, Pick<StatusUpdate, 'date'>[]>
  planLogSince?: Date | null
  historyLogSince?: Date | null
}

function run(tasks: PersistedTodoItem[], { events = [], statusUpdates = new Map(), planLogSince = OLD, historyLogSince = OLD }: Run = {}): WeekLoad {
  return computeWeekLoad({ tasks, events, statusUpdates, weekStartsOn: 1, planLogSince, historyLogSince, now: NOW })
}

/** The counts of `kind` on `date`'s day. */
function on(load: WeekLoad, date: Date, kind: WeekLoadKind): WeekLoadCounts {
  for (const week of load.weeks) {
    for (const day of week.days) {
      if (day.date.getTime() === new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()) return day.kinds[kind]
    }
  }
  throw new Error(`no day ${date.toDateString()}`)
}

const counts = (c: Partial<WeekLoadCounts>): WeekLoadCounts => ({ done: 0, late: 0, moved: 0, removed: 0, ahead: 0, ...c })
const NONE = counts({})

/** Every count of every day and kind, added up. */
function everything(load: WeekLoad): number {
  return load.weeks.reduce((n, w) => n + w.totals.load, 0)
}

describe('the weeks', () => {
  it('runs from 8 weeks back to 6 ahead, Monday to Sunday, this week at offset 0', () => {
    const load = run([])
    expect(load.weeks).toHaveLength(15)
    expect(load.weeks.map((w) => w.offset)).toEqual([-8, -7, -6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6])
    const thisWeek = load.weeks[8]!
    expect(thisWeek.start).toEqual(nov(23))
    expect(thisWeek.days.map((d) => d.when)).toEqual(['past', 'past', 'today', 'future', 'future', 'future', 'future'])
    expect(load.weeks[0]!.start).toEqual(new Date(2026, 8, 28))
  })
})

describe('where a date lands', () => {
  it('at the day’s start: open, its due date on the day', () => {
    const load = run([task({ id: 1, dueDate: nov(16) })])
    expect(on(load, nov(16), 'due')).toEqual(counts({ late: 1 }))
    expect(everything(load)).toBe(1)
  })

  it('during the day: a due date set to that very day', () => {
    const t = task({ id: 1, dueDate: nov(17) })
    const load = run([t], { events: [ev(1, 'deadline', nov(17, 10), null, iso(nov(17)))] })
    expect(on(load, nov(17), 'due')).toEqual(counts({ late: 1 }))
  })

  it('moved before the day began never lands there: planning ahead, not slipping', () => {
    const t = task({ id: 1, dueDate: nov(20), isCompleted: true, completedAt: nov(20, 15) })
    const load = run([t], { events: [ev(1, 'deadline', nov(16, 9), iso(nov(18)), iso(nov(20))), ev(1, 'completed', nov(20, 15))] })
    expect(on(load, nov(18), 'due')).toEqual(NONE)
    expect(on(load, nov(20), 'due')).toEqual(counts({ done: 1 }))
    expect(everything(load)).toBe(1)
  })

  it('the kind is the date that put it there: planned over due, due over a follow-up on a tie, the earlier of the two', () => {
    const load = run([
      task({ id: 1, dueDate: nov(19), doDate: nov(17) }),
      task({ id: 2, dueDate: nov(18), nextFollowupAt: nov(18, 9) }),
      task({ id: 3, dueDate: nov(20), nextFollowupAt: nov(18) }),
    ])
    expect(on(load, nov(17), 'planned')).toEqual(counts({ late: 1 }))
    expect(on(load, nov(19), 'due')).toEqual(NONE)
    expect(on(load, nov(18), 'due')).toEqual(counts({ late: 1 }))
    expect(on(load, nov(18), 'followup')).toEqual(counts({ late: 1 }))
  })

  it('a deleted task counts nowhere: its events are deleted with it', () => {
    const load = run([], { events: [ev(9, 'deadline', nov(16, 9), null, iso(nov(17))), ev(9, 'completed', nov(17, 9))] })
    expect(everything(load)).toBe(0)
    expect(load.usual.perWeek).toBe(0)
  })
})

describe('what became of it', () => {
  it('done: completed by the end of the due day', () => {
    const t = task({ id: 1, dueDate: nov(16), isCompleted: true, completedAt: nov(16, 17) })
    const load = run([t], { events: [ev(1, 'completed', nov(16, 17))] })
    expect(on(load, nov(16), 'due')).toEqual(counts({ done: 1 }))
  })

  it('late: still on the day at its end — completed later, or still open', () => {
    const later = task({ id: 1, dueDate: nov(16), isCompleted: true, completedAt: nov(18, 9) })
    const open = task({ id: 2, dueDate: nov(16) })
    const load = run([later, open], { events: [ev(1, 'completed', nov(18, 9))] })
    expect(on(load, nov(16), 'due')).toEqual(counts({ late: 2 }))
  })

  it('moved: during the day — slips there and lands again on the new day', () => {
    const t = task({ id: 1, dueDate: nov(19), isCompleted: true, completedAt: nov(19, 12) })
    const load = run([t], { events: [ev(1, 'deadline', nov(16, 15), iso(nov(16)), iso(nov(19))), ev(1, 'completed', nov(19, 12))] })
    expect(on(load, nov(16), 'due')).toEqual(counts({ moved: 1 }))
    expect(on(load, nov(19), 'due')).toEqual(counts({ done: 1 }))
  })

  it('moved: after the day, while still open', () => {
    const t = task({ id: 1, dueDate: nov(27) })
    const load = run([t], { events: [ev(1, 'deadline', nov(18, 10), iso(nov(16)), iso(nov(27)))] })
    expect(on(load, nov(16), 'due')).toEqual(counts({ moved: 1 }))
    expect(on(load, nov(17), 'due')).toEqual(NONE)
    expect(on(load, nov(27), 'due')).toEqual(counts({ ahead: 1 }))
  })

  it('removed: the date cleared and nothing else on the day — even when another date then places it elsewhere', () => {
    const cleared = task({ id: 1 })
    const unplanned = task({ id: 2, dueDate: nov(20) })
    const load = run([cleared, unplanned], {
      events: [
        ev(1, 'planned', nov(17, 11), iso(nov(17)), null),
        ev(2, 'planned', nov(17, 11), iso(nov(17)), null),
      ],
    })
    expect(on(load, nov(17), 'planned')).toEqual(counts({ removed: 2 }))
    expect(on(load, nov(20), 'due')).toEqual(counts({ late: 1 }))
  })

  it('not removed while another date still holds the task on the day: it stays under the kind that landed', () => {
    const t = task({ id: 1, dueDate: nov(17) })
    const load = run([t], { events: [ev(1, 'planned', nov(17, 11), iso(nov(17)), null)] })
    expect(on(load, nov(17), 'planned')).toEqual(counts({ late: 1 }))
    expect(on(load, nov(17), 'due')).toEqual(NONE)
  })

  it('a follow-up moved by its own follow-up (Mark followed up, one write) counts as followed up', () => {
    const t = task({ id: 1, nextFollowupAt: nov(30), lastFollowupAt: nov(16, 11) })
    const at = nov(16, 11)
    const load = run([t], {
      events: [ev(1, 'followedUp', at, null, iso(at)), ev(1, 'followup', at, iso(nov(16)), iso(nov(30)))],
    })
    expect(on(load, nov(16), 'followup')).toEqual(counts({ done: 1 }))
    expect(on(load, nov(30), 'followup')).toEqual(counts({ ahead: 1 }))
  })

  it('a follow-up followed up later is late, not moved', () => {
    const t = task({ id: 1, nextFollowupAt: nov(30), lastFollowupAt: nov(18, 11) })
    const at = nov(18, 11)
    const load = run([t], {
      events: [ev(1, 'followedUp', at, null, iso(at)), ev(1, 'followup', at, iso(nov(16)), iso(nov(30)))],
    })
    expect(on(load, nov(16), 'followup')).toEqual(counts({ late: 1 }))
  })

  it('a repeating task’s completion (its due date advanced, its plan cleared) counts as done; a hand move is moved', () => {
    const weekly = { every: { count: 1, unit: 'w' as const } }
    const done = task({ id: 1, dueDate: nov(30), recurrenceRule: weekly })
    const pushed = task({ id: 2, dueDate: nov(26), recurrenceRule: weekly })
    const load = run([done, pushed], {
      events: [
        ev(1, 'deadline', nov(16, 10), iso(nov(16)), iso(nov(23))),
        ev(1, 'planned', nov(16, 10), iso(nov(16)), null),
        ev(1, 'deadline', nov(23, 10), iso(nov(23)), iso(nov(30))),
        ev(2, 'deadline', nov(19, 10), iso(nov(19)), iso(nov(26))),
        ev(2, 'deadline', nov(16, 10), iso(nov(16)), iso(nov(19))),
      ],
    })
    expect(on(load, nov(16), 'planned')).toEqual(counts({ done: 1 }))
    expect(on(load, nov(23), 'due')).toEqual(counts({ done: 1 }))
    // Nov 16 → 19 is three days, not the weekly advance: moved. Nov 19 → 26 is.
    expect(on(load, nov(16), 'due')).toEqual(counts({ moved: 1 }))
    expect(on(load, nov(19), 'due')).toEqual(counts({ done: 1 }))
  })

  it('planned: done by a status update on or before the planned day, from when it was planned', () => {
    const worked = task({ id: 1, doDate: nov(18) })
    const stale = task({ id: 2, doDate: nov(18) })
    const load = run([worked, stale], {
      events: [ev(1, 'planned', nov(16, 9), null, iso(nov(18))), ev(2, 'planned', nov(16, 9), null, iso(nov(18)))],
      statusUpdates: new Map([[1, [{ date: nov(17) }]], [2, [{ date: nov(12) }]]]),
    })
    expect(on(load, nov(18), 'planned')).toEqual(counts({ done: 1, late: 1 }))
  })

  it('planned: done by a follow-up on the day', () => {
    const t = task({ id: 1, doDate: nov(18), lastFollowupAt: nov(18, 10) })
    const load = run([t], { events: [ev(1, 'followedUp', nov(18, 10), null, iso(nov(18, 10)))] })
    expect(on(load, nov(18), 'planned')).toEqual(counts({ done: 1 }))
  })
})

describe('today and the days to come', () => {
  it('today: done so far filled, a move already off today slipped, the rest ahead; days to come by the current dates', () => {
    const load = run([
      task({ id: 1, dueDate: nov(25), isCompleted: true, completedAt: nov(25, 10) }),
      task({ id: 2, dueDate: nov(25) }),
      task({ id: 3, dueDate: nov(27) }),
      task({ id: 4, doDate: nov(26), dueDate: nov(28) }),
      task({ id: 5, dueDate: nov(26), isCompleted: true, completedAt: nov(24, 9) }),
    ], {
      events: [ev(1, 'completed', nov(25, 10)), ev(3, 'deadline', nov(25, 11), iso(nov(25)), iso(nov(27))), ev(5, 'completed', nov(24, 9))],
    })
    expect(on(load, nov(25), 'due')).toEqual(counts({ done: 1, moved: 1, ahead: 1 }))
    expect(on(load, nov(27), 'due')).toEqual(counts({ ahead: 1 }))
    expect(on(load, nov(26), 'planned')).toEqual(counts({ ahead: 1 }))
    expect(on(load, nov(28), 'due')).toEqual(NONE)
    expect(on(load, nov(26), 'due')).toEqual(NONE)
    const thisWeek = load.weeks[8]!
    expect(thisWeek.totals).toEqual({ load: 5, done: 1, slipped: 1, ahead: 3, late: 0, moved: 1, removed: 0 })
    expect(thisWeek.slipPct).toBe(50)
  })

  it('a week ahead: all ahead, nothing closed, no slipped share and no notes', () => {
    const load = run([task({ id: 1, dueDate: nov(30) }), task({ id: 2, nextFollowupAt: new Date(2026, 11, 2) })], { planLogSince: NOW, historyLogSince: NOW })
    const next = load.weeks[9]!
    expect(next.totals).toMatchObject({ load: 2, ahead: 2, done: 0, slipped: 0 })
    expect(next.slipPct).toBeNull()
    expect(next.notes).toEqual([])
  })

  it('a past week’s totals and slipped share', () => {
    const load = run([
      task({ id: 1, dueDate: nov(16), isCompleted: true, completedAt: nov(16, 9) }),
      task({ id: 2, dueDate: nov(17), isCompleted: true, completedAt: nov(17, 9) }),
      task({ id: 3, dueDate: nov(18), isCompleted: true, completedAt: nov(18, 9) }),
      task({ id: 4, dueDate: nov(19) }),
    ], { events: [ev(1, 'completed', nov(16, 9)), ev(2, 'completed', nov(17, 9)), ev(3, 'completed', nov(18, 9))] })
    const last = load.weeks[7]!
    expect(last.totals).toEqual({ load: 4, done: 3, slipped: 1, ahead: 0, late: 1, moved: 0, removed: 0 })
    expect(last.slipPct).toBe(25)
  })
})

describe('the usual week', () => {
  it('is the median completions per week over the 8 full weeks before this one, with each weekday’s share; this week is never part of it', () => {
    // Completions per week, oldest first: 0 0 2 2 4 4 4 6 → median 3.
    const perWeek = [0, 0, 2, 2, 4, 4, 4, 6]
    const tasks: PersistedTodoItem[] = []
    const events: TodoEvent[] = []
    let id = 100
    perWeek.forEach((n, w) => {
      for (let i = 0; i < n; i++) {
        // Mondays, but every second one on that week's Wednesday.
        const at = new Date(2026, 8, 28 + w * 7 + (i % 2 === 1 ? 2 : 0), 10)
        tasks.push(task({ id: ++id, isCompleted: true, completedAt: at }))
        events.push(ev(id, 'completed', at))
      }
    })
    // This week's completions don't count.
    tasks.push(task({ id: 999, isCompleted: true, completedAt: nov(24, 9) }))
    events.push(ev(999, 'completed', nov(24, 9)))
    const { usual } = run(tasks, { events })
    expect(usual.perWeek).toBe(3)
    expect(usual.weekdayShares).toHaveLength(7)
    expect(usual.weekdayShares[0]).toBeCloseTo(11 / 22)
    expect(usual.weekdayShares[2]).toBeCloseTo(11 / 22)
    expect(usual.weekdayShares[1]).toBe(0)
  })

  it('with no completions: zero a week, even shares', () => {
    const { usual } = run([])
    expect(usual.perWeek).toBe(0)
    expect(usual.weekdayShares).toEqual(Array.from({ length: 7 }, () => 1 / 7))
  })

  it('a repeating task’s completion counts', () => {
    const weekly = { every: { count: 1, unit: 'w' as const } }
    const t = task({ id: 1, dueDate: nov(23), recurrenceRule: weekly })
    const events = [2, 9, 16].flatMap((d) => [ev(1, 'deadline', new Date(2026, 10, d, 10), iso(new Date(2026, 10, d)), iso(new Date(2026, 10, d + 7)))])
    const { usual } = run([t], { events })
    // 3 of the 8 weeks had one: the median is 0, Monday holds every share.
    expect(usual.perWeek).toBe(0)
    expect(usual.weekdayShares[0]).toBe(1)
  })
})

describe('before the logs reach back', () => {
  it('before planLogSince planned days are unknown: tasks land by due date and follow-up only, and the week says so', () => {
    const since = nov(18, 10)
    const t = task({ id: 1, dueDate: nov(17) })
    const load = run([t], { planLogSince: since, events: [ev(1, 'planned', nov(19, 9), iso(nov(16)), null)] })
    expect(on(load, nov(16), 'planned')).toEqual(NONE)
    expect(on(load, nov(17), 'due')).toEqual(counts({ late: 1 }))
    expect(load.weeks[7]!.notes).toEqual([{ log: 'planned', since }])
    expect(load.weeks[8]!.notes).toEqual([])
    expect(load.weeks[6]!.notes).toEqual([{ log: 'planned', since }])
  })

  it('before historyLogSince follow-ups are unknown too, and the week names that date', () => {
    const history = nov(4, 9)
    const plans = nov(18, 9)
    const t = task({ id: 1, nextFollowupAt: nov(2) })
    const load = run([t], { historyLogSince: history, planLogSince: plans })
    expect(on(load, nov(2), 'followup')).toEqual(NONE)
    // Nov 2 – 8: before both logs.
    expect(load.weeks[5]!.notes).toEqual([{ log: 'planned', since: plans }, { log: 'followup', since: history }])
    expect(load.weeks[6]!.notes).toEqual([{ log: 'planned', since: plans }])
  })

  it('a log not stamped yet reads as beginning now', () => {
    const load = run([], { planLogSince: null })
    expect(load.weeks[8]!.notes).toEqual([{ log: 'planned', since: NOW }])
  })
})

describe('taskFieldReplayAt', () => {
  it('reads the replay at a moment: every event at or before it applied, none after', () => {
    const t = task({ id: 1, dueDate: nov(20), doDate: nov(19) })
    const events = eventsByTask([
      ev(1, 'deadline', nov(16, 10), iso(nov(17)), iso(nov(20))),
      ev(1, 'planned', nov(16, 12), null, iso(nov(19))),
    ], new Set([1]), FILTER_HISTORY_EVENT_TYPES, nov(16))
    const at = taskFieldReplayAt(t, events.get(1), { personIds: [], tagIds: [] })
    expect(at(nov(16, 9).getTime())).toMatchObject({ dueDate: nov(17), doDate: null })
    expect(at(nov(16, 10).getTime())).toMatchObject({ dueDate: nov(20), doDate: null })
    expect(at(nov(16, 12).getTime())).toMatchObject({ dueDate: nov(20), doDate: nov(19) })
    expect(at(OLD.getTime() - 1)).toBeNull()
  })
})
