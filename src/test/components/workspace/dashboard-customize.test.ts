import { describe, it, expect } from 'vitest'
import {
  customizeStateFrom,
  knownListTiles,
  moveItem,
  sectionOptionValues,
  sectionsFor,
  syncCustomizeState,
  tilesFor,
  toggled,
  withSectionOption,
} from '../../../components/workspace/dashboard/dashboard-customize'
import { resolvePanes } from '../../../utils/eisenhower-panes'
import { buildDashboardSummary, sectionSummaryLines } from '../../../components/workspace/dashboard/dashboard-summary'
import { hotRuleShort, tileCatalogHint } from '../../../components/workspace/dashboard/dashboard-copy'
import { defaultDashboardConfig, DASHBOARD_SECTION_IDS, DASHBOARD_TILE_IDS, type DashboardTabConfig } from '../../../models/dashboard-config'
import type { TileStats } from '../../../services/stats/tiles'
import { DEFAULT_HOT_RULE } from '../../../utils/hot'

const config = (c: Partial<DashboardTabConfig> = {}): DashboardTabConfig => ({ ...defaultDashboardConfig(), ...c })

describe('Customize dashboard — the dialog state', () => {
  it('lists the shown items first, in the config’s order, then the hidden ones in catalog order', () => {
    const state = customizeStateFrom(config({
      tiles: ['focus', 'open'],
      sections: [{ id: 'people', options: { showUnassigned: false } }, { id: 'hot' }],
    }))
    expect(state.tileOrder).toEqual(['focus', 'open', 'hot', 'urgent', 'overdue', 'followupDue', 'dueToday', 'dueNext7', 'noFollowup'])
    expect(state.sectionOrder).toEqual(['people', 'hot', 'followup', 'next7', 'trend', 'status', 'tags', 'stale', 'recent', 'eisenhower'])
    expect(state.options).toEqual({ people: { showUnassigned: false } })
  })

  it('reorders: the config follows the dialog’s order, hidden items keep their place', () => {
    const c = config()
    const state = customizeStateFrom(c)
    const moved = { ...state, tileOrder: moveItem(state.tileOrder, 0, 1) }
    expect(tilesFor(moved, new Set(c.tiles))).toEqual(['hot', 'open', 'focus', 'urgent', 'overdue', 'followupDue'])
    // A hidden tile moved above shown ones stays hidden.
    const hiddenUp = { ...state, tileOrder: moveItem(state.tileOrder, 8, 0) }
    expect(tilesFor(hiddenUp, new Set(c.tiles))[0]).toBe('open')
    expect(hiddenUp.tileOrder[0]).toBe('noFollowup')
  })

  it('shows / hides: a ticked tile lands at its place in the dialog, an unticked one leaves the config', () => {
    const c = config()
    const state = customizeStateFrom(c)
    expect(tilesFor(state, toggled(new Set(c.tiles), 'dueToday'))).toEqual([...c.tiles, 'dueToday'])
    expect(tilesFor(state, toggled(new Set(c.tiles), 'hot'))).toEqual(['open', 'focus', 'urgent', 'overdue', 'followupDue'])
    const sections = sectionsFor(state, toggled(new Set(c.sections.map((s) => s.id)), 'trend'))
    expect(sections.map((s) => s.id)).toEqual(['hot', 'followup', 'next7', 'status', 'people'])
  })

  it('options: stored only when not the default; a hidden section keeps its option for when it’s shown again', () => {
    const c = config()
    let state = customizeStateFrom(c)
    const all = new Set(c.sections.map((s) => s.id))
    state = withSectionOption(state, 'followup', 'lookAhead', 14)
    state = withSectionOption(state, 'trend', 'range', '4w')
    state = withSectionOption(state, 'people', 'showUnassigned', false)
    expect(sectionsFor(state, all)).toEqual([
      { id: 'hot' },
      { id: 'followup', options: { lookAhead: 14 } },
      { id: 'next7' },
      { id: 'trend', options: { range: '4w' } },
      { id: 'status' },
      { id: 'people', options: { showUnassigned: false } },
    ])
    const withoutTrend = toggled(all, 'trend')
    expect(sectionsFor(state, withoutTrend).find((s) => s.id === 'trend')).toBeUndefined()
    expect(sectionsFor(state, toggled(withoutTrend, 'trend')).find((s) => s.id === 'trend')).toEqual({ id: 'trend', options: { range: '4w' } })
    // Back to a default value: nothing stored.
    state = withSectionOption(state, 'trend', 'range', '14d')
    expect(sectionsFor(state, all).find((s) => s.id === 'trend')).toEqual({ id: 'trend' })
    expect(sectionOptionValues(undefined)).toEqual({
      lookAhead: 7, range: '14d', showUnassigned: true, showUntagged: true, staleDays: 14, recentDays: 7,
    })
  })

  it('options of the Tags / Stale tasks / Recently completed sections: stored only when not the default', () => {
    let state = customizeStateFrom(config())
    const shown = new Set(['tags', 'stale', 'recent', 'eisenhower'] as const)
    state = withSectionOption(state, 'stale', 'staleDays', 30)
    state = withSectionOption(state, 'recent', 'recentDays', 14)
    state = withSectionOption(state, 'tags', 'showUntagged', false)
    expect(sectionsFor(state, shown)).toEqual([
      { id: 'tags', options: { showUntagged: false } },
      { id: 'stale', options: { staleDays: 30 } },
      { id: 'recent', options: { recentDays: 14 } },
      { id: 'eisenhower' },
    ])
    state = withSectionOption(state, 'stale', 'staleDays', 14)
    state = withSectionOption(state, 'recent', 'recentDays', 7)
    state = withSectionOption(state, 'tags', 'showUntagged', true)
    expect(sectionsFor(state, shown)).toEqual([{ id: 'tags' }, { id: 'stale' }, { id: 'recent' }, { id: 'eisenhower' }])
  })

  it('reset: the default config’s state lists every item; the default sections shown, the newer four hidden', () => {
    const state = customizeStateFrom(defaultDashboardConfig())
    expect(state.tileOrder).toEqual([...DASHBOARD_TILE_IDS])
    expect(state.sectionOrder).toEqual([...DASHBOARD_SECTION_IDS])
    expect(defaultDashboardConfig().sections.map((s) => s.id)).toEqual(['hot', 'followup', 'next7', 'trend', 'status', 'people'])
    expect(sectionsFor(state, new Set(defaultDashboardConfig().sections.map((s) => s.id)))).toEqual(defaultDashboardConfig().sections)
  })

  it('syncCustomizeState keeps the state while the config is its own edit (a hidden row keeps its place), else follows the config', () => {
    const start = customizeStateFrom(config({ tiles: ['open', 'hot'] }))
    const moved = { ...start, tileOrder: moveItem(start.tileOrder, start.tileOrder.indexOf('dueToday'), 0) }
    // Its own edit: Hot hidden, the hidden Due today still first.
    const own = config({ tiles: tilesFor(moved, new Set(['open'] as const)) })
    expect(syncCustomizeState(moved, own)).toBe(moved)
    // Made elsewhere: the config's order, a hidden section's option kept.
    const withOption = withSectionOption(moved, 'stale', 'staleDays', 30)
    const elsewhere = config({ tiles: ['hot', 'open'] })
    const synced = syncCustomizeState(withOption, elsewhere)
    expect(synced.tileOrder.slice(0, 2)).toEqual(['hot', 'open'])
    expect(synced.options.stale).toEqual({ staleDays: 30 })
  })

  it('a deleted list’s tile is left out of what the dialog shows and writes', () => {
    expect(knownListTiles(config({ listTiles: [3, 9, 4] }), new Set([3, 4]))).toEqual([3, 4])
  })
})

describe('dashboard copy for the tab menu and Customize', () => {
  it('the Hot rule at a glance', () => {
    expect(hotRuleShort(DEFAULT_HOT_RULE)).toBe('U+I or Focus')
    expect(hotRuleShort([{ urgent: true }])).toBe('Urgent')
    expect(hotRuleShort([{ urgent: true, important: true, focus: true }, { important: true }])).toBe('F+U+I or Important')
  })

  it('what each tile counts, with the urgent range and the next-7-days end', () => {
    const today = new Date(2026, 9, 10)
    expect(tileCatalogHint('urgent', { today, urgentRange: 3 })).toBe('Flagged, or due within 3 days')
    expect(tileCatalogHint('urgent', { today, urgentRange: null })).toBe('Flagged urgent')
    expect(tileCatalogHint('urgent', { today, urgentRange: 0 })).toBe('Flagged, or due today or earlier')
    expect(tileCatalogHint('dueNext7', { today, urgentRange: 3 })).toBe('Today through Fri 16')
    expect(tileCatalogHint('noFollowup', { today, urgentRange: 3 })).toBe('Open, no next follow-up')
  })
})

describe('Copy summary', () => {
  const stats = (counts: Partial<Record<keyof TileStats, number>>): TileStats => {
    const ids = (n: number) => ({ ids: Array.from({ length: n }, (_, i) => i + 1) })
    const out: Record<string, unknown> = {}
    for (const id of DASHBOARD_TILE_IDS) out[id] = ids(counts[id] ?? 0)
    return out as unknown as TileStats
  }

  it('one line of tiles in the dashboard’s order, one of list tiles', () => {
    const tiles = stats({ open: 19, hot: 4, urgent: 8, overdue: 2, followupDue: 2, focus: 3 })
    const summary = buildDashboardSummary(
      ['open', 'hot', 'urgent', 'overdue', 'followupDue', 'focus'],
      { shown: tiles, total: tiles },
      [{ id: 1, name: 'Waiting on', shown: 2, total: 2 }, { id: 2, name: 'Priya <1:1>', shown: 1, total: 3 }],
    )
    expect(summary.plain).toBe('Open 19 · Hot 4 · Urgent 8 · Overdue 2 · Follow-up due 2 · Focus 3\nWaiting on 2 · Priya <1:1> 1 of 3')
    expect(summary.html).toBe(
      '<p><b>Open</b> 19 · <b>Hot</b> 4 · <b>Urgent</b> 8 · <b>Overdue</b> 2 · <b>Follow-up due</b> 2 · <b>Focus</b> 3</p>'
      + '<p><b>Waiting on</b> 2 · <b>Priya &lt;1:1&gt;</b> 1 of 3</p>',
    )
  })

  it('the Tags / Stale tasks / Recently completed / Eisenhower sections add a line each, in section order', () => {
    const row = (id: number, name: string, n: number) => ({ tag: { id, name, color: '#999' }, ids: Array.from({ length: n }, (_, i) => i + 1), hotIds: [], followupDueIds: [] })
    const empty = { ids: [], hotIds: [], followupDueIds: [] }
    const quadrants = (d: number, s: number, g: number, x: number) => ({
      do: { ids: Array.from({ length: d }, (_, i) => i), byDate: 0 },
      schedule: { ids: Array.from({ length: s }, (_, i) => i), byDate: 0 },
      delegate: { ids: Array.from({ length: g }, (_, i) => i), byDate: 0 },
      drop: { ids: Array.from({ length: x }, (_, i) => i), byDate: 0 },
    })
    const data = {
      tags: {
        shown: { rows: [row(1, 'q4', 2), row(3, 'home', 1)], untagged: { ...empty, ids: [9, 10] }, taggedIds: [1, 2] },
        total: { rows: [row(1, 'q4', 5), row(3, 'home', 1)], untagged: { ...empty, ids: [9, 10, 11] }, taggedIds: [1, 2, 3, 4, 5] },
      },
      stale: { shown: { ids: [1], oldestDays: 20 }, total: { ids: [1, 2], oldestDays: 30 } },
      recent: { shown: { ids: [4, 5, 6] }, total: { ids: [4, 5, 6] } },
      eisenhower: { shown: quadrants(1, 2, 0, 3), total: quadrants(1, 2, 1, 4) },
      eisenhowerSetup: { panes: resolvePanes({}), listName: null },
    }
    const lines = sectionSummaryLines(
      [{ id: 'hot' }, { id: 'eisenhower' }, { id: 'recent' }, { id: 'tags' }, { id: 'stale' }],
      data,
    )
    const summary = buildDashboardSummary(['open'], { shown: stats({ open: 6 }), total: stats({ open: 9 }) }, [], lines)
    expect(summary.plain).toBe([
      'Open 6 of 9',
      'Do 1 · Schedule 2 · Delegate 0 of 1 · Drop 3 of 4',
      'Recently completed 3',
      '#q4 2 of 5 · #home 1 · No tag 2 of 3',
      'Stale tasks 1 of 2',
    ].join('\n'))
    expect(summary.html).toContain('<p><b>#q4</b> 2 of 5 · <b>#home</b> 1 · <b>No tag</b> 2 of 3</p>')
    // The Untagged row hidden in the section: not in the summary either; a section with nothing to list adds no line.
    expect(sectionSummaryLines([{ id: 'tags', options: { showUntagged: false } }], data)).toEqual([
      [{ label: '#q4', count: '2 of 5' }, { label: '#home', count: '1' }],
    ])
    const none = { ...data, tags: { shown: { rows: [], untagged: empty, taggedIds: [] }, total: { rows: [], untagged: empty, taggedIds: [] } } }
    expect(sectionSummaryLines([{ id: 'tags' }], none)).toEqual([])
    // The Eisenhower line names the panes (the app-wide setting).
    const renamed = { ...data, eisenhowerSetup: { ...data.eisenhowerSetup, panes: resolvePanes({ delegate: { name: 'Hand off' } }) } }
    expect(sectionSummaryLines([{ id: 'eisenhower' }], renamed)).toEqual([[
      { label: 'Do', count: '1' }, { label: 'Schedule', count: '2' }, { label: 'Hand off', count: '0 of 1' }, { label: 'Drop', count: '3 of 4' },
    ]])
    // Only sections: no Open stand-in.
    expect(buildDashboardSummary([], { shown: stats({ open: 6 }), total: stats({ open: 6 }) }, [], [[{ label: 'Stale tasks', count: '1' }]]).plain).toBe('Stale tasks 1')
  })

  it('counts read shown of total under a screen filter; no tiles at all → the Open count', () => {
    const summary = buildDashboardSummary(['hot'], { shown: stats({ hot: 1 }), total: stats({ hot: 4 }) }, [])
    expect(summary.plain).toBe('Hot 1 of 4')
    expect(buildDashboardSummary([], { shown: stats({ open: 5 }), total: stats({ open: 5 }) }, []).plain).toBe('Open 5')
  })
})
