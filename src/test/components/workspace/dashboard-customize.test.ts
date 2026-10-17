import { describe, it, expect } from 'vitest'
import {
  customizeStateFrom,
  knownListTiles,
  moveItem,
  sectionOptionValues,
  sectionsFor,
  tilesFor,
  toggled,
  withSectionOption,
} from '../../../components/workspace/dashboard/dashboard-customize'
import { buildDashboardSummary } from '../../../components/workspace/dashboard/dashboard-summary'
import { hotRuleShort, tileCatalogHint } from '../../../components/workspace/dashboard/dashboard-copy'
import { defaultDashboardConfig, DASHBOARD_TILE_IDS, type DashboardTabConfig } from '../../../models/dashboard-config'
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
    expect(state.sectionOrder).toEqual(['people', 'hot', 'followup', 'next7', 'trend', 'status'])
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
    expect(sectionOptionValues(undefined)).toEqual({ lookAhead: 7, range: '14d', showUnassigned: true })
  })

  it('reset: the default config’s state lists every item with the defaults shown', () => {
    const state = customizeStateFrom(defaultDashboardConfig())
    expect(state.tileOrder).toEqual([...DASHBOARD_TILE_IDS])
    expect(sectionsFor(state, new Set(state.sectionOrder))).toEqual(defaultDashboardConfig().sections)
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

  it('counts read shown of total under a screen filter; no tiles at all → the Open count', () => {
    const summary = buildDashboardSummary(['hot'], { shown: stats({ hot: 1 }), total: stats({ hot: 4 }) }, [])
    expect(summary.plain).toBe('Hot 1 of 4')
    expect(buildDashboardSummary([], { shown: stats({ open: 5 }), total: stats({ open: 5 }) }, []).plain).toBe('Open 5')
  })
})
