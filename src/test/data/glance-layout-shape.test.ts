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
import { cell, grid, single } from '../helpers/layout-builders'

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
  ['trend', 'range', '12w', '1y', '14d'],
  ['people', 'showUnassigned', false, 'no', true],
  ['tags', 'showUntagged', false, 0, true],
  ['pulse', 'tagIds', [2], { 0: 1 }, []],
]

describe('glance widget kinds', () => {
  it('are glance widgets in the Numbers & charts group; only a Number fits its height', () => {
    const glance = WIDGET_KINDS.filter((k) => WIDGET_KIND_SPECS[k].glance)
    expect(glance).toEqual(['number', 'trend', 'status', 'people', 'tags', 'pulse'])
    expect(glance.every(isGlanceKind)).toBe(true)
    expect(WIDGET_KINDS.filter((k) => WIDGET_KIND_SPECS[k].fitHeight)).toEqual(['number'])
    expect(WIDGET_KINDS.filter((k) => WIDGET_KIND_SPECS[k].group === 'tasks')).toEqual(['lens', 'notes'])
    // Numbers & charts (D26): the glance widgets, then the Calendar, the Eisenhower and the Neglect map — whole widgets, not glance ones.
    expect(WIDGET_KINDS.filter((k) => WIDGET_KIND_SPECS[k].group === 'glance')).toEqual([...glance, 'calendar', 'eisenhower', 'neglect'])
    expect(['calendar', 'eisenhower', 'neglect'].some((k) => isWidgetKind(k) && isGlanceKind(k))).toBe(false)
    // The Dashboard (v77) and the kinds D26 retired (v78) are gone.
    for (const gone of ['dashboard', 'followup', 'next7', 'stale', 'recent', 'changes', 'today', 'eisenhowerSummary']) {
      expect(isWidgetKind(gone), gone).toBe(false)
    }
  })

  it('a new tab has its defaults; a Number counts Overdue', () => {
    expect(createTab('number', 'n')).toEqual({ id: 'n', kind: 'number', config: { metric: 'overdue' } })
    expect(createTab('trend', 't').config).toEqual({ range: '14d' })
    expect(createTab('people', 'p').config).toEqual({ showUnassigned: true })
    expect(createTab('tags', 'g').config).toEqual({ showUntagged: true })
    expect(createTab('status', 'x').config).toEqual({})
    // Project pulse reads the tags it's seeded with (the store passes the `Project: …` tags).
    expect(createTab('pulse', 'x').config).toEqual({ tagIds: [] })
    expect(createTab('pulse', 'x', { tagIds: [4, 2] }).config).toEqual({ tagIds: [4, 2] })
  })

  it('a tag pick list keeps its numbers once each, in order: a repeat goes quietly, anything else is a fix', () => {
    for (const kind of ['pulse'] as const) {
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
    for (const kind of ['status'] as const) {
      const row = layoutRow({ id: 't', kind, config: { stray: 1 }, viewState: { detailsWidth: 300 } })
      expect(checkLayoutBody(row)).toBe(true)
      expect(tabOf(row)).toEqual({ id: 't', kind, config: {} })
    }
  })

  it('a glance widget drops a details width (no glance widget shows task rows)', () => {
    for (const kind of WIDGET_KINDS.filter(isGlanceKind)) {
      expect(tabOf(layoutRow({ ...createTab(kind, 't'), viewState: { detailsWidth: 280 } }))).toEqual(createTab(kind, 't'))
    }
  })

  it.each(['followup', 'next7', 'stale', 'recent', 'changes', 'today', 'eisenhowerSummary'])(
    'a %s tab that slips past v78 (an older draft) is dropped by the repair; its emptied cell closes',
    (kind) => {
      const body = grid([[cell('a', [{ id: 'gone', kind, config: {} } as unknown as LayoutTab]), cell('b', [createTab('notes', 'n')])]])
      expect(checkLayoutBody(body)).toBe('cells[0].tabs[0].kind')
      const picked = pickLayoutBody(body)
      expect(picked.fixes).toEqual(['tab dropped'])
      expect(picked.cells.map((c) => c.id)).toEqual(['b'])
      expect(picked.cells[0]!.area).toEqual({ col: 0, row: 0, colSpan: 1, rowSpan: 1 })
    },
  )

  it('every glance kind’s new tab passes the check unchanged', () => {
    const tabs = WIDGET_KINDS.filter(isGlanceKind).map((k) => createTab(k, `t-${k}`))
    const body = single({ id: 'k', tabs })
    expect(checkLayoutBody(body)).toBe(true)
    expect(pickLayoutBody(body)).toEqual({ ...body, fixes: [] })
  })
})
