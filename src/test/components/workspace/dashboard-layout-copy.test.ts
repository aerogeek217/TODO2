import { describe, it, expect } from 'vitest'
import { packSections, sectionRowTracks } from '../../../components/workspace/dashboard/dashboard-layout'
import {
  countOf, hotLineLabel, hotRuleInWords, listTileHint, nextDayLabels, signed, tileSubLine, trendBucketLabel,
} from '../../../components/workspace/dashboard/dashboard-copy'
import { computeTiles } from '../../../services/stats/tiles'
import { DEFAULT_HOT_RULE } from '../../../utils/hot'
import { SAMPLE_CTX } from '../../fixtures/dashboard-sample'
import { makeTodo } from '../../helpers'
import { filterChips } from '../../../utils/filter-chips'
import { emptyPredicate } from '../../../models'

const spans = (rows: ReturnType<typeof packSections>) => rows.map((r) => r.map((s) => `${s.id}:${s.span}`))

describe('packSections', () => {
  it('the default sections make the design rows: 5·4·3 and 5·3·4', () => {
    const rows = packSections([
      { id: 'hot', span: 5 }, { id: 'followup', span: 4 }, { id: 'next7', span: 3 },
      { id: 'trend', span: 5 }, { id: 'status', span: 3 }, { id: 'people', span: 4 },
    ])
    expect(spans(rows)).toEqual([['hot:5', 'followup:4', 'next7:3'], ['trend:5', 'status:3', 'people:4']])
  })

  it('a hidden section re-flows the rest; a row’s last section fills it', () => {
    const rows = packSections([
      { id: 'hot', span: 5 }, { id: 'next7', span: 3 }, { id: 'trend', span: 5 }, { id: 'status', span: 3 }, { id: 'people', span: 4 },
    ])
    expect(spans(rows)).toEqual([['hot:5', 'next7:7'], ['trend:5', 'status:3', 'people:4']])
  })

  it('no sections → no rows; spans are clamped to the grid', () => {
    expect(packSections([])).toEqual([])
    expect(spans(packSections([{ id: 'a', span: 20 }, { id: 'b', span: 0 }]))).toEqual([['a:12'], ['b:12']])
  })

  it('row tracks: one row shares the height; with more, the last is the 272px band', () => {
    expect(sectionRowTracks(0)).toEqual([])
    expect(sectionRowTracks(1)).toEqual(['minmax(0, 1fr)'])
    expect(sectionRowTracks(3)).toEqual(['minmax(0, 1fr)', 'minmax(0, 1fr)', '272px'])
  })
})

describe('dashboard copy', () => {
  it('countOf / signed', () => {
    expect(countOf(5, 5)).toBe('5')
    expect(countOf(5, 19)).toBe('5 of 19')
    expect([signed(3), signed(-2), signed(0)]).toEqual(['+3', '−2', '0'])
  })

  it('the Hot rule in words', () => {
    expect(hotRuleInWords(DEFAULT_HOT_RULE)).toBe('Urgent and important, or in Focus')
    expect(hotRuleInWords([{ focus: true }, { urgent: true }])).toBe('In Focus, or urgent')
    expect(hotRuleInWords([{ urgent: true, important: true, focus: true }])).toBe('Focus and urgent and important')
    expect(hotLineLabel({ important: true, urgent: true })).toBe('urgent + important')
  })

  it('tile sub-lines when nothing matches', () => {
    const tiles = computeTiles([makeTodo({ id: 1 })], SAMPLE_CTX)
    const ctx = { today: SAMPLE_CTX.today, trendNet: 0, trendRange: '4w' as const }
    expect(tileSubLine('open', tiles, ctx)).toBe('No change in the last 4 weeks')
    expect(tileSubLine('open', tiles, { ...ctx, trendNet: null })).toBe('')
    expect(tileSubLine('hot', tiles, ctx)).toBe('Nothing hot right now')
    expect(tileSubLine('urgent', tiles, ctx)).toBe('Nothing urgent')
    expect(tileSubLine('overdue', tiles, ctx)).toBe('Nothing overdue')
    expect(tileSubLine('followupDue', tiles, ctx)).toBe('Nothing due')
    expect(tileSubLine('focus', tiles, ctx)).toBe('None due today')
    expect(tileSubLine('dueToday', tiles, ctx)).toBe('None in the next 7 days')
    expect(tileSubLine('dueNext7', tiles, ctx)).toBe('')
  })

  it('day and bar labels', () => {
    expect(nextDayLabels(null, 0)).toEqual(['Late', '–'])
    expect(nextDayLabels(new Date(2026, 9, 10), 1)).toEqual(['Today', '10'])
    expect(nextDayLabels(new Date(2026, 9, 11), 2)).toEqual(['Sun', '11'])
    expect(trendBucketLabel(new Date(2026, 8, 27), 'day')).toBe('27')
    expect(trendBucketLabel(new Date(2026, 8, 27), 'week')).toBe('Sep 27')
  })

  it('a list tile hint: people as @, tags as #, the rest as Label: value', () => {
    expect(listTileHint([])).toBe('All tasks')
    expect(listTileHint([
      { field: 'people', label: 'People', value: 'Priya +1' },
      { field: 'tags', label: 'Tags', value: '#q4' },
      { field: 'status', label: 'Status', value: 'Waiting' },
    ])).toBe('@Priya +1 · #q4 · Status: Waiting')
  })

  it('a list tile hint names each date type that filters', () => {
    const chips = filterChips({
      ...emptyPredicate(),
      dates: { deadline: { match: 'set' }, created: { match: 'range', start: { kind: 'relative', token: 'start-of-month' }, end: null } },
    }, { people: [], tags: [], statuses: [] })
    expect(listTileHint(chips)).toBe('Due: has a date · Created: from start of month')
  })
})
