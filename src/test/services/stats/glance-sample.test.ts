import { describe, expect, it } from 'vitest'
import type { FilterCriteria } from '../../../utils/filter-criteria'
import { applyFilter } from '../../../utils/filter-match'
import { numberConfigOfMetric, type V77NumberMetric } from '../../../data/upgrades/v78/number-metrics'
import type { TodoPredicate } from '../../../models'
import { numberIds } from '../../../services/stats/number-count'
import { predicateToCriteria } from '../../../utils/filter-criteria'
import { computeTrend } from '../../../services/stats/trend'
import { computePeopleStats } from '../../../services/stats/people'
import { selectStatusBreakdown } from '../../../services/stats/status-breakdown'
import { statsFilter } from '../../../services/stats/stats-context'
import { computeTagStats } from '../../../services/stats/tags'
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

  it('Status: To do 11 · In progress 5 · Waiting 2 · Blocked 1', () => {
    expect(selectStatusBreakdown(tasks, STATUSES).map((e) => [e.label, e.count])).toEqual([
      ['To do', 11], ['In progress', 5], ['Waiting', 2], ['Blocked', 1],
    ])
  })

  it('People: open / by priority / follow-up due, by open count then name, Unassigned 8 · 1', () => {
    const people = computePeopleStats(tasks, SAMPLE_CTX)
    expect(people.rows.map((r) => [r.person.name, r.ids.length, r.followupDueIds.length])).toEqual([
      ['Priya Nair', 4, 0],
      ['Alice Chen', 2, 0],
      ['Ben Ortiz', 2, 0],
      ['Dana Kim', 2, 1],
      ['Sam Lee', 1, 0],
    ])
    expect([people.unassigned.ids.length, people.unassigned.followupDueIds.length]).toEqual([8, 1])
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

  it('status 3 / 2 / 0 / 0 and people Priya 2 · Unassigned 3', () => {
    expect(selectStatusBreakdown(tasks, STATUSES).map((e) => e.count)).toEqual([3, 2, 0, 0])
    const people = computePeopleStats(tasks, SAMPLE_CTX)
    expect(people.rows.map((r) => [r.person.name, r.ids.length])).toEqual([['Priya Nair', 2]])
    expect(people.unassigned.ids).toHaveLength(3)
  })
})

describe('glance sample data — the Tags section and the Eisenhower’s counts', () => {
  const all = screened(NO_FILTER)
  const q4 = screened(Q4_FILTER)

  it('Tags: open tasks per tag, by count then name; untagged apart', () => {
    const tags = computeTagStats(all, SAMPLE_CTX)
    expect(tags.rows.map((r) => [r.tag.name, r.ids.length])).toEqual([['q4', 5], ['errands', 2], ['home', 1], ['planning', 1]])
    expect(tags.untagged.ids).toHaveLength(10)
    // Under the q4 filter only the q4 row is left.
    expect(computeTagStats(q4, SAMPLE_CTX).rows.map((r) => [r.tag.name, r.ids.length])).toEqual([['q4', 5]])
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
