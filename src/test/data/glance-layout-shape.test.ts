import { describe, expect, it } from 'vitest'
import { rowFixes, sanitizeRow, validateRow } from '../../data/import-validation'
import { checkLayoutBody, pickLayoutBody } from '../../data/layout-shape'
import {
  createTab,
  isGlanceKind,
  isWidgetKind,
  WIDGET_KIND_SPECS,
  WIDGET_KINDS,
  type GlanceWidgetKind,
  type LayoutTab,
  type WorkspaceLayout,
} from '../../models/workspace-layout'
import { single } from '../helpers/layout-builders'

const DATE = '2026-09-01T09:00:00.000Z'

function layoutRow(tab: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 1, name: 'Glance', sortOrder: 0, createdAt: DATE, modifiedAt: DATE,
    ...single({ id: 'k', tabs: [tab as unknown as LayoutTab] }),
  }
}

const tabOf = (row: Record<string, unknown>) => (sanitizeRow('layouts', row) as WorkspaceLayout).cells[0]!.tabs[0]

/** Each glance kind with a setting: a config it keeps (not its default), one it repairs, and the default. */
const SETTINGS: Array<[GlanceWidgetKind, string, unknown, unknown, unknown]> = [
  ['number', 'metric', 'closedThisWeek', 'late', 'overdue'],
  ['followup', 'lookAhead', 14, 5, 7],
  ['trend', 'range', '12w', '1y', '14d'],
  ['people', 'showUnassigned', false, 'no', true],
  ['tags', 'showUntagged', false, 0, true],
  ['stale', 'staleDays', 60, 15, 14],
  ['recent', 'recentDays', 30, 31, 7],
  ['changes', 'tagIds', [3, 1], 'tags', []],
  ['pulse', 'tagIds', [2], { 0: 1 }, []],
]

describe('glance widget kinds', () => {
  it('are glance widgets in the Numbers & charts group; only a Number fits its height', () => {
    const glance = WIDGET_KINDS.filter((k) => WIDGET_KIND_SPECS[k].glance)
    expect(glance).toEqual([
      'number', 'followup', 'next7', 'trend', 'status', 'people', 'tags', 'stale', 'recent', 'eisenhowerSummary',
      'changes', 'today', 'pulse',
    ])
    expect(glance.every(isGlanceKind)).toBe(true)
    expect(WIDGET_KINDS.filter((k) => WIDGET_KIND_SPECS[k].fitHeight)).toEqual(['number'])
    expect(WIDGET_KINDS.filter((k) => WIDGET_KIND_SPECS[k].group === 'tasks')).toEqual(['lens', 'calendar', 'notes', 'eisenhower', 'neglect'])
    // The Dashboard is gone (v77 made its tabs these widgets): every Numbers & charts kind is a glance widget.
    expect(WIDGET_KINDS.filter((k) => WIDGET_KIND_SPECS[k].group === 'glance')).toEqual(glance)
    expect(isWidgetKind('dashboard')).toBe(false)
  })

  it('a new tab has its defaults; a Number counts Overdue', () => {
    expect(createTab('number', 'n')).toEqual({ id: 'n', kind: 'number', config: { metric: 'overdue' } })
    expect(createTab('followup', 'f').config).toEqual({ lookAhead: 7 })
    expect(createTab('trend', 't').config).toEqual({ range: '14d' })
    expect(createTab('people', 'p').config).toEqual({ showUnassigned: true })
    expect(createTab('tags', 'g').config).toEqual({ showUntagged: true })
    expect(createTab('stale', 's').config).toEqual({ staleDays: 14 })
    expect(createTab('recent', 'r').config).toEqual({ recentDays: 7 })
    for (const kind of ['next7', 'status', 'eisenhowerSummary', 'today'] as const) expect(createTab(kind, 'x').config).toEqual({})
    // What changed and Project pulse read the tags they're seeded with (the store passes the `Project: …` tags).
    for (const kind of ['changes', 'pulse'] as const) {
      expect(createTab(kind, 'x').config).toEqual({ tagIds: [] })
      expect(createTab(kind, 'x', { tagIds: [4, 2] }).config).toEqual({ tagIds: [4, 2] })
    }
  })

  it('a tag pick list keeps its numbers once each, in order: a repeat goes quietly, anything else is a fix', () => {
    for (const kind of ['changes', 'pulse'] as const) {
      expect(tabOf(layoutRow({ id: 't', kind, config: { tagIds: [2, 1, 2] } }))).toEqual({ id: 't', kind, config: { tagIds: [2, 1] } })
      expect(rowFixes('layouts', layoutRow({ id: 't', kind, config: { tagIds: [2, 1, 2] } }))).toEqual([])
      const mixed = layoutRow({ id: 't', kind, config: { tagIds: [2, 'x', null, 5] } })
      expect(checkLayoutBody(mixed)).toBe('cells[0].tabs[0].config.tagIds')
      expect(rowFixes('layouts', mixed)).toEqual(['tab or cell settings reset'])
      expect(tabOf(mixed)).toEqual({ id: 't', kind, config: { tagIds: [2, 5] } })
    }
  })

  it.each(SETTINGS)('%s: a known %s round-trips; a bad or missing one is reset to its default', (kind, key, kept, bad, fallback) => {
    const good = layoutRow({ id: 't', kind, config: { [key]: kept } })
    expect(validateRow('layouts', good)).toBe(true)
    expect(rowFixes('layouts', good)).toEqual([])
    expect(tabOf(good)).toEqual({ id: 't', kind, config: { [key]: kept } })

    for (const config of [{ [key]: bad }, {}]) {
      const row = layoutRow({ id: 't', kind, config })
      expect(checkLayoutBody(row)).toBe(`cells[0].tabs[0].config.${key}`)
      expect(rowFixes('layouts', row)).toEqual(['tab or cell settings reset'])
      expect(tabOf(row)).toEqual({ id: 't', kind, config: { [key]: fallback } })
    }
    // A stray key goes without a fix; a config that isn't an object resets.
    expect(tabOf(layoutRow({ id: 't', kind, config: { [key]: kept, extra: 1 } }))).toEqual({ id: 't', kind, config: { [key]: kept } })
    expect(tabOf(layoutRow({ id: 't', kind, config: 'x' }))).toEqual({ id: 't', kind, config: { [key]: fallback } })
  })

  it('a Number’s breakdown (D25 R): a known one round-trips, none absent; a bad one is dropped (reads as none)', () => {
    for (const breakdown of ['none', 'people', 'tags']) {
      const good = layoutRow({ id: 't', kind: 'number', config: { metric: 'open', breakdown } })
      expect(validateRow('layouts', good)).toBe(true)
      expect(rowFixes('layouts', good)).toEqual([])
      expect(tabOf(good)).toEqual({ id: 't', kind: 'number', config: { metric: 'open', breakdown } })
    }
    // A Number from before P4: no breakdown, nothing to fix.
    const old = layoutRow({ id: 't', kind: 'number', config: { metric: 'open' } })
    expect(rowFixes('layouts', old)).toEqual([])
    expect(tabOf(old)).toEqual({ id: 't', kind: 'number', config: { metric: 'open' } })
    for (const breakdown of ['status', 1, null]) {
      const bad = layoutRow({ id: 't', kind: 'number', config: { metric: 'open', breakdown } })
      expect(checkLayoutBody(bad)).toBe('cells[0].tabs[0].config.breakdown')
      expect(rowFixes('layouts', bad)).toEqual(['tab or cell settings reset'])
      expect(tabOf(bad)).toEqual({ id: 't', kind: 'number', config: { metric: 'open' } })
    }
    // A bad metric beside a good breakdown: the metric resets, the breakdown stays.
    expect(tabOf(layoutRow({ id: 't', kind: 'number', config: { metric: 'late', breakdown: 'tags' } })))
      .toEqual({ id: 't', kind: 'number', config: { metric: 'overdue', breakdown: 'tags' } })
  })

  it('the kinds without settings keep an empty config, any key dropped', () => {
    for (const kind of ['next7', 'status', 'eisenhowerSummary'] as const) {
      const row = layoutRow({ id: 't', kind, config: { stray: 1 }, viewState: { detailsWidth: 300 } })
      expect(checkLayoutBody(row)).toBe(true)
      expect(tabOf(row)).toEqual({ id: 't', kind, config: {} })
    }
  })

  it('the row widgets keep a details width (view state); the others drop it', () => {
    for (const kind of ['followup', 'stale', 'recent', 'today'] as const) {
      const tab = { ...createTab(kind, 't'), viewState: { detailsWidth: 280 } }
      expect(tabOf(layoutRow(tab))).toEqual(tab)
      const bad = layoutRow({ ...tab, viewState: { detailsWidth: -1 } })
      expect(checkLayoutBody(bad)).toBe('cells[0].tabs[0].viewState.detailsWidth')
      expect(tabOf(bad)).toEqual(createTab(kind, 't'))
    }
    expect(tabOf(layoutRow({ ...createTab('number', 't'), viewState: { detailsWidth: 280 } }))).toEqual(createTab('number', 't'))
  })

  it('every glance kind’s new tab passes the check unchanged', () => {
    const tabs = WIDGET_KINDS.filter(isGlanceKind).map((k) => createTab(k, `t-${k}`))
    const body = single({ id: 'k', tabs })
    expect(checkLayoutBody(body)).toBe(true)
    expect(pickLayoutBody(body)).toEqual({ ...body, fixes: [] })
  })
})
