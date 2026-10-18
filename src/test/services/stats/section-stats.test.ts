import { describe, expect, it } from 'vitest'
import type { Tag } from '../../../models'
import { computeEisenhowerSummary } from '../../../services/stats/eisenhower-summary'
import { computeRecentlyCompleted } from '../../../services/stats/recently-completed'
import { computeStaleTasks } from '../../../services/stats/stale'
import type { StatsContext } from '../../../services/stats/stats-context'
import { computeTagStats } from '../../../services/stats/tags'
import { DEFAULT_HOT_RULE } from '../../../utils/hot'
import { makeTodo } from '../../helpers'

const today = new Date(2026, 9, 10)
const day = (n: number, hour = 9) => new Date(2026, 9, 10 + n, hour)

function ctx(assignedTagsMap: Map<number, Tag[]> = new Map()): StatsContext {
  return { today, weekStartsOn: 1, urgentRange: 3, hotRule: DEFAULT_HOT_RULE, assignedPeopleMap: new Map(), assignedTagsMap, statuses: [] }
}

describe('computeStaleTasks', () => {
  it('open tasks not changed in N days or more, oldest first, ties by sortOrder', () => {
    const tasks = [
      makeTodo({ id: 1, modifiedAt: day(-14, 23) }), // 14 days ago (late in the day): stale
      makeTodo({ id: 2, modifiedAt: day(-13, 0) }), // 13 days ago: not stale
      makeTodo({ id: 3, modifiedAt: day(-40) }),
      makeTodo({ id: 4, modifiedAt: day(-20), sortOrder: 9 }),
      makeTodo({ id: 5, modifiedAt: day(-20), sortOrder: 2 }),
      makeTodo({ id: 6, modifiedAt: day(-60), isCompleted: true }), // completed: never stale
      makeTodo({ id: 7, modifiedAt: day(0) }),
    ]
    const out = computeStaleTasks(tasks, ctx(), 14)
    expect(out.ids).toEqual([3, 5, 4, 1])
    expect(out.oldestDays).toBe(40)
  })

  it('the window follows the option; nothing stale → no oldest', () => {
    const tasks = [makeTodo({ id: 1, modifiedAt: day(-8) }), makeTodo({ id: 2, modifiedAt: day(-6) })]
    expect(computeStaleTasks(tasks, ctx(), 7).ids).toEqual([1])
    expect(computeStaleTasks(tasks, ctx(), 30)).toEqual({ ids: [], oldestDays: null })
  })

  it('a task with an unreadable modified date is left out', () => {
    const tasks = [makeTodo({ id: 1, modifiedAt: new Date('nope') }), makeTodo({ id: 2, modifiedAt: day(-30) })]
    expect(computeStaleTasks(tasks, ctx(), 14).ids).toEqual([2])
  })
})

describe('computeRecentlyCompleted', () => {
  it('tasks completed today and the N − 1 days before, newest first, ties by sortOrder', () => {
    const tasks = [
      makeTodo({ id: 1, isCompleted: true, completedAt: day(0, 8) }),
      makeTodo({ id: 2, isCompleted: true, completedAt: day(0, 17) }),
      makeTodo({ id: 3, isCompleted: true, completedAt: day(-6, 1) }), // first day of a 7-day window
      makeTodo({ id: 4, isCompleted: true, completedAt: day(-7, 23) }), // just before it
      makeTodo({ id: 5, isCompleted: true, completedAt: day(-2), sortOrder: 8 }),
      makeTodo({ id: 6, isCompleted: true, completedAt: day(-2), sortOrder: 3 }),
      makeTodo({ id: 7, completedAt: day(0) }), // open (reopened): not completed
    ]
    expect(computeRecentlyCompleted(tasks, ctx(), 7).ids).toEqual([2, 1, 6, 5, 3])
    expect(computeRecentlyCompleted(tasks, ctx(), 14).ids).toEqual([2, 1, 6, 5, 3, 4])
  })

  it('a completed task without completedAt falls back to its modified date', () => {
    const tasks = [makeTodo({ id: 1, isCompleted: true, modifiedAt: day(-1) }), makeTodo({ id: 2, isCompleted: true, modifiedAt: day(-9) })]
    expect(computeRecentlyCompleted(tasks, ctx(), 7).ids).toEqual([1])
  })
})

describe('computeTagStats', () => {
  const q4: Tag = { id: 1, name: 'q4', color: '#111' }
  const home: Tag = { id: 2, name: 'home', color: '#222' }
  const art: Tag = { id: 3, name: 'art', color: '#333' }

  it('counts an open task under each of its tags; by open count, ties by name; untagged apart', () => {
    const tasks = [
      makeTodo({ id: 1, focus: true }),
      makeTodo({ id: 2, nextFollowupAt: day(-1) }),
      makeTodo({ id: 3 }),
      makeTodo({ id: 4 }),
      makeTodo({ id: 5, isCompleted: true }), // completed: counts nowhere
      makeTodo({ id: 6, nextFollowupAt: day(0) }),
    ]
    const map = new Map([
      [1, [q4, home]],
      [2, [q4]],
      [3, [art, art]], // a duplicate row counts once
      [4, [home]],
      [5, [q4]],
    ])
    const out = computeTagStats(tasks, ctx(map))
    expect(out.rows.map((r) => [r.tag.name, r.ids, r.hotIds, r.followupDueIds])).toEqual([
      ['home', [1, 4], [1], []],
      ['q4', [1, 2], [1], [2]],
      ['art', [3], [], []],
    ])
    expect(out.untagged).toEqual({ ids: [6], hotIds: [], followupDueIds: [6] })
    expect(out.taggedIds).toEqual([1, 2, 3, 4])
  })

  it('no open tasks → no rows', () => {
    expect(computeTagStats([makeTodo({ id: 1, isCompleted: true })], ctx(new Map([[1, [q4]]])))).toEqual({
      rows: [],
      untagged: { ids: [], hotIds: [], followupDueIds: [] },
      taggedIds: [],
    })
  })
})

describe('computeEisenhowerSummary', () => {
  it('open tasks by effective Urgent × Important, in the Eisenhower widget’s order', () => {
    const tasks = [
      makeTodo({ id: 1, urgent: true, important: true }),
      makeTodo({ id: 2, important: true, dueDate: day(2, 0) }), // urgent by its due date (range 3)
      makeTodo({ id: 3, important: true }),
      makeTodo({ id: 4, urgent: true }),
      makeTodo({ id: 5, dueDate: day(-1, 0) }), // overdue: urgent by date
      makeTodo({ id: 6 }),
      makeTodo({ id: 7, dueDate: day(10, 0) }),
      makeTodo({ id: 8, urgent: true, important: true, isCompleted: true }), // completed: nowhere
    ]
    const out = computeEisenhowerSummary(tasks, ctx())
    expect(out.do).toEqual({ ids: [2, 1], byDate: 1 })
    expect(out.schedule).toEqual({ ids: [3], byDate: 0 })
    expect(out.delegate).toEqual({ ids: [5, 4], byDate: 1 })
    expect(out.drop).toEqual({ ids: [7, 6], byDate: 0 })
  })

  it('with the urgent range off only the flag makes a task urgent', () => {
    const out = computeEisenhowerSummary([makeTodo({ id: 1, important: true, dueDate: day(0, 0) })], { ...ctx(), urgentRange: null })
    expect(out.schedule.ids).toEqual([1])
    expect(out.do.ids).toEqual([])
  })
})
