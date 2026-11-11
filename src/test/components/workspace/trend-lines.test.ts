import { describe, expect, it } from 'vitest'
import type { PersistedTodoItem, TodoEvent, TodoEventType } from '../../../models'
import { computeTrend } from '../../../services/stats/trend'
import { signed, trendApproxLabel, trendBucketWords } from '../../../components/workspace/glance/glance-copy'
import { trendCumulativeDrill, trendOpenDrill, trendTotalDrill } from '../../../components/workspace/glance/glance-drills'
import { summaryOf, trendLines } from '../../../components/workspace/glance/glance-summary'
import { makeTodo } from '../../helpers'

/** Created vs completed's Copy and drills (widget feedback 2C): the lines follow the presentation shown. */

const today = new Date(2026, 9, 10) // Sat 10 Oct
const wd = (n: number, hour = 12) => new Date(2026, 8, 27 + n, hour)
const OLD = new Date(2026, 0, 1)
let seq = 0
const ev = (todoId: number, type: TodoEventType, at: Date): TodoEvent => ({ id: ++seq, todoId, type, fromValue: null, toValue: null, timestamp: at.toISOString() })
const task = (o: Partial<PersistedTodoItem> & { id: number }) => makeTodo({ createdAt: OLD, modifiedAt: OLD, ...o })

const trend = computeTrend(
  [task({ id: 1 }), task({ id: 2, isCompleted: true, completedAt: wd(12) }), task({ id: 3, createdAt: wd(13, 8) })],
  [ev(2, 'completed', wd(12)), ev(3, 'created', wd(13, 8))],
  { today, weekStartsOn: 0 },
  '14d',
)
const bucketLabels = trend.window.bucketStarts.map((s) => trendBucketWords(s, 'day', today))
const input = { name: 'Atlas', rangeLabel: 'Last 14 days', trend, exactFrom: 0, bucketLabels, signedNet: signed }

describe('trendLines', () => {
  it('Bars: the totals and the net, then a line per bar', () => {
    const lines = trendLines({ ...input, show: 'bars' })
    expect(lines[0]).toEqual([{ label: 'Atlas', count: 'Last 14 days' }])
    expect(summaryOf(lines).plain.split('\n').slice(0, 2)).toEqual(['Atlas Last 14 days', 'Completed 1 · Created 1 · Net 0'])
    expect(lines).toHaveLength(2 + 14)
    expect(lines.at(-1)).toEqual([{ label: 'Sat 10', count: '1 created · 0 completed' }])
  })

  it('Burndown: open at the start, now and the change, then the open count per day', () => {
    const lines = trendLines({ ...input, show: 'burndown' })
    expect(summaryOf(lines).plain.split('\n')[1]).toBe('Open at the start 2 · Open now 2 · Change 0')
    expect(lines.at(-2)?.[0]?.count).toBe('1 open')
    expect(lines.at(-1)?.[0]?.count).toBe('2 open')
  })

  it('Cumulative: running totals, the created line on top of the tasks open at the start', () => {
    const lines = trendLines({ ...input, show: 'cumulative' })
    expect(summaryOf(lines).plain.split('\n')[1]).toBe('Open at the start 2 · Created 1 · Completed 1')
    expect(lines.at(-1)?.[0]?.count).toBe('3 created · 1 completed')
  })

  it('marks the bars before the first exact day ≈', () => {
    const lines = trendLines({ ...input, show: 'bars', exactFrom: 3 })
    expect(lines[2]?.[0]?.label.endsWith(' ≈')).toBe(true)
    expect(lines[5]?.[0]?.label.endsWith(' ≈')).toBe(false)
    expect(trendApproxLabel(trend.window.days, 3, today)).toMatch(/^≈ before /)
    expect(trendApproxLabel(trend.window.days, 0, today)).toBeNull()
    expect(trendApproxLabel(trend.window.days, 14, today)).toBe('≈')
  })

  it('before the history is read: its name and range only', () => {
    expect(trendLines({ ...input, show: 'cumulative', trend: null })).toEqual([[{ label: 'Atlas', count: 'Last 14 days' }]])
  })
})

describe('trend drills', () => {
  it('title by the widget’s own name; the default name adds nothing', () => {
    expect(trendTotalDrill('created', 'the last 14 days', [1], 'Atlas').title).toBe('Atlas · Created')
    expect(trendTotalDrill('created', 'the last 14 days', [1], 'Created vs completed').title).toBe('Created')
    expect(trendOpenDrill(today, today, [1]).title).toBe('Open now')
    expect(trendOpenDrill(null, today, [1]).description).toBe('Tasks open when the range began.')
    const point = trendCumulativeDrill(today, today, { completed: [2], created: [3], openAtStart: [1] })
    expect(point.title).toBe('Through today')
    expect(point.source).toMatchObject({ kind: 'groups' })
  })
})
