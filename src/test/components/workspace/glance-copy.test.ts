import { describe, it, expect } from 'vitest'
import {
  countOf, signed, metricSubLine, trendBucketLabel,
} from '../../../components/workspace/glance/glance-copy'
import { computeMetrics } from '../../../services/stats/metrics'
import { SAMPLE_CTX } from '../../fixtures/glance-sample'
import { makeTodo } from '../../helpers'
import { filterChips, listFilterHint, predicateLineItems } from '../../../utils/filter-chips'
import { emptyPredicate } from '../../../models'

describe('glance copy', () => {
  it('countOf / signed', () => {
    expect(countOf(5, 5)).toBe('5')
    expect(countOf(5, 19)).toBe('5 of 19')
    expect([signed(3), signed(-2), signed(0)]).toEqual(['+3', '−2', '0'])
  })

  it('Number sub-lines when nothing matches', () => {
    const tiles = computeMetrics([makeTodo({ id: 1 })], SAMPLE_CTX)
    const ctx = { today: SAMPLE_CTX.today, trendNet: 0, trendRange: '4w' as const }
    expect(metricSubLine('open', tiles, ctx)).toBe('No change in the last 4 weeks')
    expect(metricSubLine('open', tiles, { ...ctx, trendNet: null })).toBe('')
    expect(metricSubLine('urgent', tiles, ctx)).toBe('Nothing urgent')
    expect(metricSubLine('overdue', tiles, ctx)).toBe('Nothing overdue')
    expect(metricSubLine('followupDue', tiles, ctx)).toBe('Nothing due')
    expect(metricSubLine('focus', tiles, ctx)).toBe('None due today')
    expect(metricSubLine('dueToday', tiles, ctx)).toBe('None in the next 7 days')
    expect(metricSubLine('dueNext7', tiles, ctx)).toBe('')
  })

  it('Follow-up due at 0 names the next one, however far', () => {
    const today = SAMPLE_CTX.today
    const at = (n: number) => new Date(today.getFullYear(), today.getMonth(), today.getDate() + n)
    const ctx = { today, trendNet: 0, trendRange: '4w' as const }
    const tiles = computeMetrics([makeTodo({ id: 1, nextFollowupAt: at(12) }), makeTodo({ id: 2, nextFollowupAt: at(2) })], SAMPLE_CTX)
    const d = at(2)
    const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()]
    const mmdd = `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`
    expect(metricSubLine('followupDue', tiles, ctx)).toBe(`Next one ${weekday} ${mmdd}`)
    // Due today with more this week still says so.
    const busy = computeMetrics([makeTodo({ id: 1, nextFollowupAt: at(0) }), makeTodo({ id: 2, nextFollowupAt: at(2) })], SAMPLE_CTX)
    expect(metricSubLine('followupDue', busy, ctx)).toBe('1 more in the next 7 days')
  })

  it('bar labels', () => {
    expect(trendBucketLabel(new Date(2026, 8, 27), 'day')).toBe('27')
    expect(trendBucketLabel(new Date(2026, 8, 27), 'week')).toBe('Sep 27')
  })

  it('a list’s filter hint: people as @, tags as #, the rest as Label: value', () => {
    expect(listFilterHint([])).toBe('All tasks')
    expect(listFilterHint([
      { field: 'people', label: 'People', value: 'Priya +1' },
      { field: 'tags', label: 'Tags', value: '#q4' },
      { field: 'status', label: 'Status', value: 'Waiting' },
    ])).toBe('@Priya +1 · #q4 · Status: Waiting')
  })

  it('a list’s filter hint names each date type that filters', () => {
    const chips = filterChips({
      ...emptyPredicate(),
      dates: { deadline: { match: 'set' }, created: { match: 'range', start: { kind: 'relative', token: 'start-of-month' }, end: null } },
    }, { people: [], tags: [], statuses: [] })
    expect(listFilterHint(chips)).toBe('Due: any date · Created: on or after start of month')
  })

  it('a list’s filter hint spells an expression as its text', () => {
    const names = { people: [{ id: 1, name: 'Aisha', initials: 'AI' }], tags: [], statuses: [] }
    const items = predicateLineItems({
      ...emptyPredicate(),
      expression: { kind: 'and', items: [{ kind: 'status', id: 0 }, { kind: 'or', items: [{ kind: 'priority', value: 'focus' }, { kind: 'person', id: 1 }] }] },
    }, names)
    expect(listFilterHint(items)).toBe('no status and (/focus or @Aisha)')
  })
})
