import { describe, expect, it } from 'vitest'
import type { FilterCriteria } from '../../../utils/filter-criteria'
import { applyFilter } from '../../../utils/filter-match'
import { numberConfigOfMetric, type V77NumberMetric } from '../../../data/upgrades/v78/number-metrics'
import type { TodoPredicate } from '../../../models'
import { numberIds } from '../../../services/stats/number-count'
import { predicateToCriteria } from '../../../utils/filter-criteria'
import { computeTrend } from '../../../services/stats/trend'
import { computeBreakdown } from '../../../services/stats/breakdown'
import { openTasks, statsFilter } from '../../../services/stats/stats-context'
import type { BreakdownSplit } from '../../../models/chart-widgets'
import { DEFAULT_TAB_BADGES } from '../../../utils/tab-badges'
import { computeEisenhowerSummary } from '../../../services/stats/eisenhower-summary'
import { emptyFilterCriteria, statsPaneContext, testLookups } from '../../helpers'
import { resolvePanes } from '../../../utils/eisenhower-panes'
import {
  ASSIGNED_PEOPLE, ASSIGNED_TAGS, DESIGN_TREND, DESIGN_TREND_Q4, Q4, SAMPLE_CTX, SAMPLE_EVENTS,
  SAMPLE_TASKS, SAMPLE_TODAY, STATUSES,
} from '../../fixtures/glance-sample'

const markerSettings = { urgentRange: SAMPLE_CTX.urgentRange, weekStartsOn: SAMPLE_CTX.weekStartsOn }
const lookups = testLookups({ assignedPeopleMap: ASSIGNED_PEOPLE, assignedTagsMap: ASSIGNED_TAGS, statuses: STATUSES })
const NO_FILTER: FilterCriteria = { ...emptyFilterCriteria, markers: null }
const Q4_FILTER: FilterCriteria = { ...NO_FILTER, tags: new Set([Q4]) }

/** The task set the glance widgets compute over: the screen filter, completed tasks kept. */
function screened(screen: FilterCriteria) {
  return applyFilter(statsFilter(screen), SAMPLE_TASKS, lookups, SAMPLE_TODAY, markerSettings)
}

/** A Breakdown (D26 P8) of `tasks`' open ones, as People / Tags / Status were: no filter, split by `splitBy`. */
function breakdownOf(splitBy: BreakdownSplit, tasks: typeof SAMPLE_TASKS) {
  return computeBreakdown(openTasks(tasks), SAMPLE_CTX, { splitBy, show: 'count', oldestBy: 'lastFollowup', ranges: DEFAULT_TAB_BADGES })
}

/** Each row's label and task count, the none row as `none`. */
const counts = (splitBy: BreakdownSplit, tasks: typeof SAMPLE_TASKS) =>
  Object.fromEntries(breakdownOf(splitBy, tasks).rows.map((r) => [r.entity.kind === 'none' ? 'none' : r.label, r.ids.length]))

const titles = (ids: readonly number[]) => ids.map((id) => SAMPLE_TASKS.find((t) => t.id === id)?.title)

/** What the Number its v77 metric became counts over `tasks` (ids in dialog order). */
function numberOf(metric: V77NumberMetric, tasks: typeof SAMPLE_TASKS): number[] {
  const filter = predicateToCriteria(numberConfigOfMetric(metric).filter as unknown as TodoPredicate)
  return numberIds(filter, tasks, lookups, SAMPLE_TODAY, markerSettings)
}

describe('glance sample data — no screen filter', () => {
  const tasks = screened(NO_FILTER)
  const n = (metric: V77NumberMetric) => numberOf(metric, tasks)

  it('Open 19', () => {
    expect(n('open')).toHaveLength(19)
  })

  it('Urgent 8 (3 flagged, 5 by due date)', () => {
    expect(titles(n('urgent'))).toEqual(expect.arrayContaining([
      'Fix checkout outage', 'Headcount request', 'Review analytics dashboard',
      'Draft homepage copy', 'Call plumber about water heater', 'Budget review with finance', '1:1 with Ben', 'Pick up prescriptions',
    ]))
    expect(n('urgent')).toHaveLength(8)
  })

  it('Overdue 2, the oldest first', () => {
    const ids = n('overdue')
    expect(ids).toHaveLength(2)
    expect(SAMPLE_TASKS.find((t) => t.id === ids[0])?.dueDate).toEqual(new Date(2026, 9, 7))
  })

  it('Follow-up due 2, by next follow-up', () => {
    expect(titles(n('followupDue'))).toEqual(['Vendor contract', 'Chase venue deposit invoice'])
  })

  it('Focus 3', () => {
    expect(n('focus')).toHaveLength(3)
  })

  it('Due today 3; due in the next 7 days 10; 14 without a follow-up date', () => {
    expect(n('dueToday')).toHaveLength(3)
    expect(n('dueNext7')).toHaveLength(10)
    expect(n('noFollowup')).toHaveLength(14)
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

  it('Status (a Breakdown by status): To do 11 · In progress 5 · Waiting 2 · Blocked 1, in Settings order', () => {
    expect(breakdownOf('status', tasks).rows.map((r) => [r.label, r.ids.length])).toEqual([
      ['To do', 11], ['In progress', 5], ['Waiting', 2], ['Blocked', 1],
    ])
    expect(STATUSES.map((s) => s.name)).toEqual(['To do', 'In progress', 'Waiting', 'Blocked'])
  })

  it('People (a Breakdown by people): open and follow-ups due (overdue and today), Unassigned 8 · 1, last', () => {
    const rows = breakdownOf('people', tasks).rows
    expect(Object.fromEntries(rows.map((r) => [r.label, [r.ids.length, r.followupIds.length]]))).toEqual({
      'Priya Nair': [4, 0],
      'Alice Chen': [2, 0],
      'Ben Ortiz': [2, 0],
      'Dana Kim': [2, 1],
      'Sam Lee': [1, 0],
      Unassigned: [8, 1],
    })
    expect(rows.at(-1)?.entity.kind).toBe('none')
  })
})

describe('glance sample data — top-bar Tags filter q4 (shown of total)', () => {
  const tasks = screened(Q4_FILTER)

  it('Numbers: Open 5 · Urgent 1 (by date) · Overdue 0 · Follow-up due 0 · Focus 1', () => {
    const n = (metric: V77NumberMetric) => numberOf(metric, tasks)
    expect(n('open')).toHaveLength(5)
    expect(n('urgent')).toHaveLength(1)
    expect(n('overdue')).toHaveLength(0)
    expect(n('followupDue')).toHaveLength(0)
    expect(n('focus')).toHaveLength(1)
  })

  it('trend: 4 created, 3 completed, +1, the drawn bars and sparkline', () => {
    const trend = computeTrend(tasks, SAMPLE_EVENTS, SAMPLE_CTX, '14d')
    expect([trend.created, trend.completed, trend.net]).toEqual([4, 3, 1])
    expect(trend.buckets.map((b) => b.createdIds.length)).toEqual(DESIGN_TREND_Q4.created)
    expect(trend.buckets.map((b) => b.completedIds.length)).toEqual(DESIGN_TREND_Q4.completed)
    expect(trend.openSeries).toEqual(DESIGN_TREND_Q4.open)
  })

  it('status 3 / 2 (rows with tasks only) and people Priya 2 · Unassigned 3', () => {
    expect(breakdownOf('status', tasks).rows.map((r) => r.ids.length)).toEqual([3, 2])
    expect(counts('people', tasks)).toEqual({ 'Priya Nair': 2, none: 3 })
  })
})

describe('glance sample data — the Tags section and the Eisenhower’s counts', () => {
  const all = screened(NO_FILTER)
  const q4 = screened(Q4_FILTER)

  it('Tags (a Breakdown by tags): open tasks per tag; No tags 10', () => {
    expect(counts('tags', all)).toEqual({ q4: 5, errands: 2, home: 1, planning: 1, none: 10 })
    // Under the q4 filter only the q4 row is left (with the q4 pick narrowing, `computeBreakdown`'s restrictions, no No tags row either).
    expect(computeBreakdown(openTasks(q4), SAMPLE_CTX, { splitBy: 'tags', show: 'count', oldestBy: 'created', ranges: DEFAULT_TAB_BADGES, restrictions: [[Q4]] })
      .rows.map((r) => [r.label, r.ids.length])).toEqual([['q4', 5]])
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
