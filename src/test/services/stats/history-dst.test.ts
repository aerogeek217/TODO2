import { describe, expect, it } from 'vitest'
import type { PersistedTodoItem, TodoEvent, TodoEventType } from '../../../models'
import { filterHistory, historyExactFrom, historyExactness, type FilterHistoryOptions } from '../../../services/stats/filter-history'
import { numberHistoryDays } from '../../../services/stats/number-count'
import { eventsByTask, taskFieldReplay, taskReplay } from '../../../services/stats/task-history'
import type { FilterCriteria } from '../../../utils/filter-criteria'
import { FILTER_HISTORY_EVENT_TYPES, NUMBER_HISTORY_DAYS } from '../../../utils/trend-window'
import { emptyFilterCriteria, lookupsFor, makeTodo } from '../../helpers'
import { DST_ZONE, pinTimeZone } from '../../time-zone'

/**
 * History replay over a 14-day window that holds a daylight-saving change
 * (cr34 T13): a 25-hour day (Sun 1 Nov 2026) and a 23-hour day (Sun 8 Mar
 * 2026) in America/Chicago. A day is a calendar day, never 24 hours: an
 * event just before or just after midnight belongs to its own day, a due
 * date is late from the next calendar day, and the log's first day is the
 * day it began on. Pinned to the zone, so it asserts on the UTC deploy too;
 * every date is built inside a test (in the pinned zone).
 */

const HOUR = 3_600_000

/** The two windows: the day the clocks change is day 7 of each. */
const WINDOWS = [
  { name: 'the 25-hour day (clocks back, Sun 1 Nov)', today: () => new Date(2026, 10, 7), change: () => new Date(2026, 10, 1), hours: 25 },
  { name: 'the 23-hour day (clocks forward, Sun 8 Mar)', today: () => new Date(2026, 2, 14), change: () => new Date(2026, 2, 8), hours: 23 },
] as const
const CHANGE_DAY = 7

let seq = 0
function ev(todoId: number, type: TodoEventType, at: Date, fromValue: string | number | null = null, toValue: string | number | null = null): TodoEvent {
  return { id: ++seq, todoId, type, fromValue, toValue, timestamp: at.toISOString() }
}

function task(overrides: Partial<PersistedTodoItem> & { id: number }): PersistedTodoItem {
  const old = new Date(2026, 0, 1)
  return makeTodo({ createdAt: old, modifiedAt: old, ...overrides })
}

const options = (): FilterHistoryOptions => ({ lookups: lookupsFor(), settings: { urgentRange: null, weekStartsOn: 0, staleAfterDays: 30 } })
const criteria = (patch: Partial<FilterCriteria>): FilterCriteria => ({ ...emptyFilterCriteria, ...patch })

/** The counts as a line with a 1 on each of `days` (window indexes). */
const onDays = (...days: number[]) => Array.from({ length: NUMBER_HISTORY_DAYS }, (_, i) => (days.includes(i) ? 1 : 0))
/** A 1 from day `from` to the window's end. */
const fromDay = (from: number) => Array.from({ length: NUMBER_HISTORY_DAYS }, (_, i) => (i >= from ? 1 : 0))

/** `day` (a local midnight) at `hour:minute` of its own calendar day. */
const at = (day: Date, hour: number, minute = 0) => new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute)
/** The calendar day `n` days after `day`. */
const plus = (day: Date, n: number) => new Date(day.getFullYear(), day.getMonth(), day.getDate() + n)

describe('history replay across a daylight-saving change', () => {
  pinTimeZone(DST_ZONE)

  for (const w of WINDOWS) {
    describe(w.name, () => {
      it('the window is 14 local midnights, a calendar day apart, the changed day among them', () => {
        const days = numberHistoryDays(w.today())
        expect(days).toHaveLength(NUMBER_HISTORY_DAYS)
        for (const [i, d] of days.entries()) {
          expect([d.getHours(), d.getMinutes()], `day ${i} is a local midnight`).toEqual([0, 0])
          if (i > 0) expect(d.getTime(), `day ${i} is the day after day ${i - 1}`).toBe(plus(days[i - 1]!, 1).getTime())
        }
        expect(days[CHANGE_DAY]!.getTime()).toBe(w.change().getTime())
        // The zone is pinned: this day is not 24 hours long.
        expect((days[CHANGE_DAY + 1]!.getTime() - days[CHANGE_DAY]!.getTime()) / HOUR).toBe(w.hours)
        expect(days.at(-1)!.getTime()).toBe(w.today().getTime())
      })

      it('an event belongs to its calendar day, however long the day', () => {
        const days = numberHistoryDays(w.today())
        const change = w.change()
        const events = [
          ev(1, 'status', at(plus(change, -1), 23, 30), 1, 2),
          ev(1, 'status', at(change, 0, 30), 2, 3),
          ev(1, 'status', at(change, 3, 30), 3, 4),
          ev(1, 'status', at(change, 23, 30), 4, 5),
          ev(1, 'status', at(plus(change, 1), 0, 30), 5, 6),
          ev(1, 'status', at(plus(change, 1), 23, 30), 6, 7),
        ]
        const byTask = eventsByTask(events, new Set([1]), FILTER_HISTORY_EVENT_TYPES, days[0]!)
        expect(byTask.get(1)?.all.map((e) => e.day)).toEqual([
          CHANGE_DAY - 1, CHANGE_DAY, CHANGE_DAY, CHANGE_DAY, CHANGE_DAY + 1, CHANGE_DAY + 1,
        ])
        // Each day's end reads the status after that day's last change.
        const replay = taskFieldReplay(task({ id: 1, statusId: 7 }), byTask.get(1), { personIds: [], tagIds: [] }, days[0]!)
        expect([CHANGE_DAY - 2, CHANGE_DAY - 1, CHANGE_DAY, CHANGE_DAY + 1, CHANGE_DAY + 2].map((d) => replay(d)?.statusId)).toEqual([1, 2, 5, 7, 7])
      })

      it('done late on the changed day and reopened just after midnight: done at that day’s end only', () => {
        const days = numberHistoryDays(w.today())
        const change = w.change()
        const events = [ev(1, 'completed', at(change, 23, 30)), ev(1, 'reopened', at(plus(change, 1), 0, 30))]
        const byTask = eventsByTask(events, new Set([1]), FILTER_HISTORY_EVENT_TYPES, days[0]!)
        const replay = taskReplay(task({ id: 1 }), byTask.get(1), days[0]!)
        expect(days.map((_, i) => replay(i).state)).toEqual(days.map((_, i) => (i === CHANGE_DAY ? 'done' : 'open')))
        // Open tasks per day: every day but that one.
        expect(filterHistory(emptyFilterCriteria, [task({ id: 1 })], events, days, options())).toEqual(onDays(...days.map((_, i) => i).filter((i) => i !== CHANGE_DAY)))
      })

      it('a task created just before midnight is there from that day, one just after from the next', () => {
        const days = numberHistoryDays(w.today())
        const change = w.change()
        const before = at(change, 23, 45)
        const after = at(plus(change, 1), 0, 15)
        const tasks = [task({ id: 1, createdAt: before }), task({ id: 2, createdAt: after })]
        const events = [ev(1, 'created', before), ev(2, 'created', after)]
        expect(filterHistory(emptyFilterCriteria, [tasks[0]!], events, days, options())).toEqual(fromDay(CHANGE_DAY))
        expect(filterHistory(emptyFilterCriteria, [tasks[1]!], events, days, options())).toEqual(fromDay(CHANGE_DAY + 1))
      })

      it('a due date is due on its own day and late from the next, across the change', () => {
        const days = numberHistoryDays(w.today())
        const change = w.change()
        const overdue = criteria({ dates: { deadline: { match: 'range', start: null, end: { kind: 'relative', token: 'yesterday' } } } })
        const dueToday = criteria({ dates: { deadline: { match: 'range', start: { kind: 'relative', token: 'today' }, end: { kind: 'relative', token: 'today' } } } })
        for (const offset of [-1, 0, 1]) {
          const due = [task({ id: 1, dueDate: plus(change, offset) })]
          expect(filterHistory(dueToday, due, [], days, options()), `due ${offset} days from the change: due that day`).toEqual(onDays(CHANGE_DAY + offset))
          expect(filterHistory(overdue, due, [], days, options()), `due ${offset} days from the change: late from the next day`).toEqual(fromDay(CHANGE_DAY + offset + 1))
        }
        // A due date moved on the changed day, late in the evening: the old date until that day's end.
        const moved = [task({ id: 2, dueDate: plus(change, 5) })]
        const events = [ev(2, 'deadline', at(change, 23, 30), plus(change, -2).toISOString(), plus(change, 5).toISOString())]
        expect(filterHistory(overdue, moved, events, days, options())).toEqual(onDays(CHANGE_DAY - 1, CHANGE_DAY + 6))
      })

      it('completed today counts a task on the day it was completed, at any hour of it', () => {
        const days = numberHistoryDays(w.today())
        const change = w.change()
        const completedToday = criteria({
          showCompleted: true,
          dates: { completed: { match: 'range', start: { kind: 'relative', token: 'today' }, end: { kind: 'relative', token: 'today' } } },
        })
        for (const [hour, minute, day] of [[0, 30, CHANGE_DAY], [23, 30, CHANGE_DAY], [0, 30, CHANGE_DAY + 1]] as const) {
          const when = at(plus(change, day - CHANGE_DAY), hour, minute)
          const done = [task({ id: 1, isCompleted: true, completedAt: when })]
          expect(filterHistory(completedToday, done, [ev(1, 'completed', when)], days, options()), `completed ${when.toString()}`).toEqual(onDays(day))
        }
      })

      it('the log’s first exact day is the calendar day it began on', () => {
        const days = numberHistoryDays(w.today())
        const change = w.change()
        const people = criteria({ personIds: new Set([1]) })
        expect(historyExactFrom(people, days, at(change, 23, 30))).toEqual({ from: CHANGE_DAY, approximate: ['people'] })
        expect(historyExactFrom(people, days, at(plus(change, 1), 0, 30))).toEqual({ from: CHANGE_DAY + 1, approximate: ['people'] })
        expect(historyExactness(people, change, at(change, 23, 30)).exact).toBe(true)
        expect(historyExactness(people, change, at(plus(change, 1), 0, 30)).exact).toBe(false)
      })
    })
  }

  it('the hour the clocks repeat (01:30 twice on 1 Nov) is one day, whichever of the two', () => {
    const days = numberHistoryDays(new Date(2026, 10, 7))
    // 01:30 CDT, then 01:30 CST an hour later.
    const first = new Date('2026-11-01T06:30:00Z')
    const second = new Date('2026-11-01T07:30:00Z')
    expect([first.getHours(), second.getHours()]).toEqual([1, 1])
    const byTask = eventsByTask([ev(1, 'status', first, 1, 2), ev(1, 'status', second, 2, 3)], new Set([1]), FILTER_HISTORY_EVENT_TYPES, days[0]!)
    expect(byTask.get(1)?.all.map((e) => e.day)).toEqual([CHANGE_DAY, CHANGE_DAY])
  })
})
