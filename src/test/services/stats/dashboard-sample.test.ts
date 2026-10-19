import { describe, expect, it } from 'vitest'
import type { FilterCriteria } from '../../../utils/filter-criteria'
import { applyFilter } from '../../../utils/filter-match'
import { computeTiles } from '../../../services/stats/tiles'
import { computeListTileCounts } from '../../../services/stats/list-tiles'
import { computeFollowupGroups } from '../../../services/stats/followup-groups'
import { computeNextSevenDays } from '../../../services/stats/next-seven-days'
import { computeTrend } from '../../../services/stats/trend'
import { computePeopleStats } from '../../../services/stats/people'
import { selectStatusBreakdown } from '../../../services/stats/status-breakdown'
import { statsFilter } from '../../../services/stats/stats-context'
import { computeTagStats } from '../../../services/stats/tags'
import { computeStaleTasks } from '../../../services/stats/stale'
import { computeRecentlyCompleted } from '../../../services/stats/recently-completed'
import { computeEisenhowerSummary } from '../../../services/stats/eisenhower-summary'
import { emptyFilterCriteria, statsPaneContext } from '../../helpers'
import { resolvePanes } from '../../../utils/eisenhower-panes'
import {
  ASSIGNED_PEOPLE, ASSIGNED_TAGS, DESIGN_TREND, DESIGN_TREND_Q4, Q4, SAMPLE_CTX, SAMPLE_EVENTS,
  SAMPLE_LISTS, SAMPLE_TASKS, SAMPLE_TODAY, STATUSES,
} from '../../fixtures/dashboard-sample'

const markerSettings = { urgentRange: SAMPLE_CTX.urgentRange, hotRule: SAMPLE_CTX.hotRule, weekStartsOn: SAMPLE_CTX.weekStartsOn }
const lookups = {
  assignedPeopleMap: ASSIGNED_PEOPLE,
  assignedTagsMap: ASSIGNED_TAGS,
  statusesById: new Map(STATUSES.map((s) => [s.id, s])),
}
const NO_FILTER: FilterCriteria = { ...emptyFilterCriteria, markers: null }
const Q4_FILTER: FilterCriteria = { ...NO_FILTER, tags: new Set([Q4]) }

/** The task set the dashboard computes over: the screen filter, completed tasks kept. */
function screened(screen: FilterCriteria) {
  return applyFilter(statsFilter(screen), SAMPLE_TASKS, ASSIGNED_PEOPLE, STATUSES, SAMPLE_TODAY, ASSIGNED_TAGS, markerSettings)
}

const titles = (ids: readonly number[]) => ids.map((id) => SAMPLE_TASKS.find((t) => t.id === id)?.title)

describe('dashboard sample data — no screen filter', () => {
  const tasks = screened(NO_FILTER)
  const tiles = computeTiles(tasks, SAMPLE_CTX)

  it('Open 19', () => {
    expect(tiles.open.ids).toHaveLength(19)
  })

  it('Hot 4: 3 urgent + important · 1 Focus', () => {
    expect(titles(tiles.hot.ids).sort()).toEqual(
      ['Book venue for offsite', 'Draft homepage copy', 'Fix checkout outage', 'Headcount request'],
    )
    expect(tiles.hot.lines.map((l) => [l.line, l.ids.length])).toEqual([
      [{ urgent: true, important: true }, 3],
      [{ focus: true }, 1],
    ])
  })

  it('Urgent 8 = 3 flagged + 5 by due date', () => {
    expect(tiles.urgent.ids).toHaveLength(8)
    expect(tiles.urgent.flagged).toBe(3)
    expect(tiles.urgent.byDate).toBe(5)
    expect(titles(tiles.urgent.ids)).toEqual(expect.arrayContaining([
      'Fix checkout outage', 'Headcount request', 'Review analytics dashboard',
      'Draft homepage copy', 'Call plumber about water heater', 'Budget review with finance', '1:1 with Ben', 'Pick up prescriptions',
    ]))
  })

  it('Overdue 2, oldest Wed 7 · 3d late', () => {
    expect(tiles.overdue.ids).toHaveLength(2)
    expect(tiles.overdue.oldest).toEqual(new Date(2026, 9, 7))
    expect(tiles.overdue.oldestDaysLate).toBe(3)
  })

  it('Follow-up due 2: 1 late · (1 today) · 3 more in 7 days', () => {
    expect(titles(tiles.followupDue.ids)).toEqual(['Vendor contract', 'Chase venue deposit invoice'])
    expect(tiles.followupDue).toMatchObject({ late: 1, today: 1, upcoming: 3 })
  })

  it('Focus 3, 2 due today', () => {
    expect(tiles.focus.ids).toHaveLength(3)
    expect(tiles.focus.dueToday).toBe(2)
  })

  it('Due today 3 · 7 more in the next 7 days; due in the next 7 days 10; 14 without a follow-up date', () => {
    expect(tiles.dueToday.ids).toHaveLength(3)
    expect(tiles.dueToday.upcoming).toBe(7)
    expect(tiles.dueNext7.ids).toHaveLength(10)
    expect(tiles.noFollowup.ids).toHaveLength(14)
  })

  it('list tiles: Waiting on 2 · Priya 1:1 agenda 4 · #q4 planning 5 · Errands 2 (the prompted list is skipped)', () => {
    const counts = computeListTileCounts(SAMPLE_LISTS, SAMPLE_TASKS, {
      lookups, today: SAMPLE_TODAY, weekStartsOn: 0, markerSettings,
    })
    expect(counts.map((c) => [c.name, c.shown, c.total])).toEqual([
      ['Waiting on', 2, 2], ['Priya 1:1 agenda', 4, 4], ['#q4 planning', 5, 5], ['Errands', 2, 2],
    ])
  })

  it('Needs follow-up 5: Late (Vendor contract) · Today (Chase venue deposit invoice) · Next 7 days (3)', () => {
    const groups = computeFollowupGroups(tasks, SAMPLE_CTX, 7)
    expect(titles(groups.late)).toEqual(['Vendor contract'])
    expect(titles(groups.today)).toEqual(['Chase venue deposit invoice'])
    expect(titles(groups.upcoming)).toEqual(['Vendor contract redlines', 'Sign off on new logo', 'Book venue for offsite'])
  })

  it('Next 7 days: due / follow-up per column, Late then Sat 10 … Fri 16', () => {
    const cols = computeNextSevenDays(tasks, SAMPLE_CTX)
    expect(cols.map((c) => c.date?.getDate() ?? 'late')).toEqual(['late', 10, 11, 12, 13, 14, 15, 16])
    expect(cols.map((c) => [c.dueIds.length, c.followupIds.length])).toEqual([
      [2, 1], [3, 1], [1, 0], [1, 1], [1, 1], [1, 0], [3, 1], [0, 0],
    ])
  })

  it('Created vs completed, 14 days: 17 created, 14 completed, +3 open since Sun 27 Sep, the drawn bars and sparkline', () => {
    const trend = computeTrend(tasks, SAMPLE_EVENTS, SAMPLE_CTX, '14d')
    expect(trend.created).toBe(17)
    expect(trend.completed).toBe(14)
    expect(trend.net).toBe(3)
    expect(trend.window.start).toEqual(new Date(2026, 8, 27))
    expect(trend.buckets.map((b) => b.createdIds.length)).toEqual(DESIGN_TREND.created)
    expect(trend.buckets.map((b) => b.completedIds.length)).toEqual(DESIGN_TREND.completed)
    expect(trend.openSeries).toEqual(DESIGN_TREND.open)
    expect(trend.openAtStart).toBe(16)
  })

  it('Status: To do 11 · In progress 5 · Waiting 2 · Blocked 1', () => {
    expect(selectStatusBreakdown(tasks, STATUSES).map((e) => [e.label, e.count])).toEqual([
      ['To do', 11], ['In progress', 5], ['Waiting', 2], ['Blocked', 1],
    ])
  })

  it('People: open / hot / follow-up due, by open count then name, Unassigned 8 · 1 · 1', () => {
    const people = computePeopleStats(tasks, SAMPLE_CTX)
    expect(people.rows.map((r) => [r.person.name, r.ids.length, r.hotIds.length, r.followupDueIds.length])).toEqual([
      ['Priya Nair', 4, 1, 0],
      ['Alice Chen', 2, 0, 0],
      ['Ben Ortiz', 2, 0, 0],
      ['Dana Kim', 2, 1, 1],
      ['Sam Lee', 1, 1, 0],
    ])
    expect([people.unassigned.ids.length, people.unassigned.hotIds.length, people.unassigned.followupDueIds.length]).toEqual([8, 1, 1])
  })
})

describe('dashboard sample data — top-bar Tags filter q4 (shown of total)', () => {
  const tasks = screened(Q4_FILTER)
  const tiles = computeTiles(tasks, SAMPLE_CTX)

  it('tiles: Open 5 · Hot 1 (in Focus) · Urgent 1 (by date) · Overdue 0 · Follow-up due 0 (1 more) · Focus 1 (none due today)', () => {
    expect(tiles.open.ids).toHaveLength(5)
    expect(tiles.hot.ids).toHaveLength(1)
    expect(tiles.hot.lines.map((l) => l.ids.length)).toEqual([0, 1])
    expect(tiles.urgent).toMatchObject({ flagged: 0, byDate: 1 })
    expect(tiles.overdue.ids).toHaveLength(0)
    expect(tiles.overdue.oldest).toBeNull()
    expect(tiles.followupDue.ids).toHaveLength(0)
    expect(tiles.followupDue.upcoming).toBe(1)
    expect(tiles.focus.ids).toHaveLength(1)
    expect(tiles.focus.dueToday).toBe(0)
  })

  it('list tiles: Waiting on 0 of 2 · Priya 1:1 agenda 2 of 4 · #q4 planning 5 · Errands 0 of 2', () => {
    const counts = computeListTileCounts(SAMPLE_LISTS, SAMPLE_TASKS, {
      screen: Q4_FILTER, lookups, today: SAMPLE_TODAY, weekStartsOn: 0, markerSettings,
    })
    expect(counts.map((c) => [c.name, c.shown, c.total])).toEqual([
      ['Waiting on', 0, 2], ['Priya 1:1 agenda', 2, 4], ['#q4 planning', 5, 5], ['Errands', 0, 2],
    ])
  })

  it('Needs follow-up 1 (Next 7 days); Next 7 days Sun 11 · Wed 14 · Thu 15', () => {
    const groups = computeFollowupGroups(tasks, SAMPLE_CTX, 7)
    expect(groups).toEqual({ late: [], today: [], upcoming: [4] })
    expect(computeNextSevenDays(tasks, SAMPLE_CTX).map((c) => [c.dueIds.length, c.followupIds.length])).toEqual([
      [0, 0], [0, 0], [1, 0], [0, 0], [0, 0], [1, 0], [1, 1], [0, 0],
    ])
  })

  it('trend: 4 created, 3 completed, +1, the drawn bars and sparkline', () => {
    const trend = computeTrend(tasks, SAMPLE_EVENTS, SAMPLE_CTX, '14d')
    expect([trend.created, trend.completed, trend.net]).toEqual([4, 3, 1])
    expect(trend.buckets.map((b) => b.createdIds.length)).toEqual(DESIGN_TREND_Q4.created)
    expect(trend.buckets.map((b) => b.completedIds.length)).toEqual(DESIGN_TREND_Q4.completed)
    expect(trend.openSeries).toEqual(DESIGN_TREND_Q4.open)
  })

  it('status 3 / 2 / 0 / 0 and people Priya 2 · Unassigned 3 (1 hot)', () => {
    expect(selectStatusBreakdown(tasks, STATUSES).map((e) => e.count)).toEqual([3, 2, 0, 0])
    const people = computePeopleStats(tasks, SAMPLE_CTX)
    expect(people.rows.map((r) => [r.person.name, r.ids.length, r.hotIds.length])).toEqual([['Priya Nair', 2, 0]])
    expect([people.unassigned.ids.length, people.unassigned.hotIds.length]).toEqual([3, 1])
  })
})

describe('dashboard sample data — the Tags, Stale tasks, Recently completed and Eisenhower sections', () => {
  const all = screened(NO_FILTER)
  const q4 = screened(Q4_FILTER)

  it('Tags: open tasks per tag, by count then name; untagged apart', () => {
    const tags = computeTagStats(all, SAMPLE_CTX)
    expect(tags.rows.map((r) => [r.tag.name, r.ids.length])).toEqual([['q4', 5], ['errands', 2], ['home', 1], ['planning', 1]])
    expect(tags.untagged.ids).toHaveLength(10)
    // Under the q4 filter only the q4 row is left.
    expect(computeTagStats(q4, SAMPLE_CTX).rows.map((r) => [r.tag.name, r.ids.length])).toEqual([['q4', 5]])
  })

  it('Stale tasks (14 days): the open tasks from before the window, oldest first', () => {
    expect(computeStaleTasks(all, SAMPLE_CTX, 14)).toEqual({ ids: [17, 19], oldestDays: 39 })
    expect(computeStaleTasks(q4, SAMPLE_CTX, 14).ids).toEqual([17])
  })

  it('Recently completed (7 days): completed since Sun 4 Oct, newest first', () => {
    expect(titles(computeRecentlyCompleted(all, SAMPLE_CTX, 7).ids)).toEqual([
      'Ship release notes', 'Order team swag', 'Interview debrief', 'Q4 OKR draft', 'Car service', 'Fix login bug', 'Team lunch booking',
    ])
    expect(titles(computeRecentlyCompleted(q4, SAMPLE_CTX, 7).ids)).toEqual(['Q4 OKR draft'])
  })

  it('Eisenhower: Do 3 · Schedule 1 · Delegate 5 · Drop 10 (Urgent 8 = Do + Delegate)', () => {
    const quadrants = computeEisenhowerSummary(all, resolvePanes({}), statsPaneContext(SAMPLE_CTX))
    expect(titles(quadrants.do.ids)).toEqual(['Fix checkout outage', 'Headcount request', 'Draft homepage copy'])
    expect(quadrants.do.byDate).toBe(1)
    expect(titles(quadrants.schedule.ids)).toEqual(['Book venue for offsite'])
    expect(quadrants.delegate.ids).toEqual([5, 6, 7, 12, 13])
    expect(quadrants.delegate.byDate).toBe(4)
    expect(quadrants.drop.ids).toEqual([14, 8, 15, 16, 9, 10, 11, 17, 18, 19])
    const filtered = computeEisenhowerSummary(q4, resolvePanes({}), statsPaneContext(SAMPLE_CTX))
    expect([filtered.do.ids, filtered.schedule.ids, filtered.delegate.ids, filtered.drop.ids]).toEqual([[], [4], [7], [14, 15, 17]])
  })
})
