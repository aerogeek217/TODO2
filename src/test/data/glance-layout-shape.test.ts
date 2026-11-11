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
import { cell, grid, numberTab, single } from '../helpers/layout-builders'
import { emptyPredicate } from '../../models/filter-predicate'

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
  ['trend', 'range', '12w', '1y', '14d'],
  ['pulse', 'tagIds', [2], { 0: 1 }, []],
]

describe('glance widget kinds', () => {
  it('are glance widgets in the Insights group; only a Number fits its height', () => {
    const glance = WIDGET_KINDS.filter((k) => WIDGET_KIND_SPECS[k].glance)
    expect(glance).toEqual(['number', 'breakdown', 'pivot', 'tagMap', 'trend', 'pulse'])
    expect(glance.every(isGlanceKind)).toBe(true)
    expect(WIDGET_KINDS.filter((k) => WIDGET_KIND_SPECS[k].fitHeight)).toEqual(['number'])
    expect(WIDGET_KINDS.filter((k) => WIDGET_KIND_SPECS[k].group === 'tasks')).toEqual(['lens', 'calendar', 'review', 'notes'])
    // Insights: the glance widgets, then the Neglect map — a whole widget, not a glance one. The group is the menus'
    // only: the Calendar (Tasks) and the Neglect map (Insights) alike are not glance kinds.
    expect(WIDGET_KINDS.filter((k) => WIDGET_KIND_SPECS[k].group === 'insights')).toEqual([...glance, 'neglect'])
    expect(['calendar', 'neglect'].some((k) => isWidgetKind(k) && isGlanceKind(k))).toBe(false)
    // The Dashboard (v77), the kinds D26 retired (v78) and the Eisenhower (after v78) are gone.
    for (const gone of ['dashboard', 'followup', 'next7', 'stale', 'recent', 'changes', 'today', 'eisenhowerSummary', 'people', 'tags', 'status', 'eisenhower']) {
      expect(isWidgetKind(gone), gone).toBe(false)
    }
  })

  it('a new tab has its defaults; a Number counts every open task', () => {
    expect(createTab('number', 'n')).toEqual({ id: 'n', kind: 'number', config: { name: 'Open', filter: emptyPredicate(), show: 'count', litWhen: 'never', compare: 'yesterday' } })
    expect(createTab('trend', 't').config).toEqual({ range: '14d' })
    expect(createTab('breakdown', 'b').config).toEqual({ name: 'Breakdown', filter: emptyPredicate(), splitBy: 'people', style: 'bars', show: 'count', showNone: true })
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

  // G5: Project pulse's rules (no schema step: absent = the defaults).
  it('Project pulse’s rules round-trip; a bad rule, name or filter is a fix and reads as its default', () => {
    const late = { name: 'Behind', filter: { ...emptyPredicate(), expression: { kind: 'tag', id: 4 } } }
    const config = { tagIds: [2], late, stale: { name: 'Quiet' } }
    const good = layoutRow({ id: 't', kind: 'pulse', config })
    expect(validateRow('layouts', good)).toBe(true)
    expect(rowFixes('layouts', good)).toEqual([])
    expect(tabOf(good)).toEqual({ id: 't', kind: 'pulse', config })

    const badRule = layoutRow({ id: 't', kind: 'pulse', config: { tagIds: [2], stale: 7 } })
    expect(checkLayoutBody(badRule)).toBe('cells[0].tabs[0].config.stale')
    expect(rowFixes('layouts', badRule)).toEqual(['tab or cell settings reset'])
    expect(tabOf(badRule)).toEqual({ id: 't', kind: 'pulse', config: { tagIds: [2] } })

    const badName = layoutRow({ id: 't', kind: 'pulse', config: { tagIds: [2], late: { ...late, name: null } } })
    expect(checkLayoutBody(badName)).toBe('cells[0].tabs[0].config.late.name')
    expect(tabOf(badName)).toEqual({ id: 't', kind: 'pulse', config: { tagIds: [2], late: { ...late, name: 'late' } } })

    // A filter without its required fields is read as a list's (a fix); one that isn't an object goes (the default).
    const badFilter = layoutRow({ id: 't', kind: 'pulse', config: { tagIds: [2], late: { name: 'L', filter: { tags: [3] } } } })
    expect(checkLayoutBody(badFilter)).toBe('cells[0].tabs[0].config.late.filter.showCompleted')
    expect(rowFixes('layouts', badFilter)).toEqual(['tab or cell settings reset'])
    const notObject = layoutRow({ id: 't', kind: 'pulse', config: { tagIds: [2], late: { name: 'L', filter: 'overdue' } } })
    expect(checkLayoutBody(notObject)).toBe('cells[0].tabs[0].config.late.filter.predicate')
    expect(tabOf(notObject)).toEqual({ id: 't', kind: 'pulse', config: { tagIds: [2], late: { name: 'L' } } })
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

  it('a Number (D26 P5): every field round-trips; Auto, never and following the lens are absent', () => {
    for (const config of [
      numberTab('t').config,
      numberTab('t', 'overdue', { breakdown: 'tags', ignoreLens: true, litWhen: 'below', litAt: 12, compare: 'none', color: '#abc' }).config,
      // The breakdowns that came later (no schema step): status and priority.
      numberTab('t', 'open', { breakdown: 'status' }).config,
      numberTab('t', 'open', { breakdown: 'priority' }).config,
      numberTab('t', 'open', { name: '', filter: { ...emptyPredicate(), expression: { kind: 'tag', id: 4 } } }).config,
    ]) {
      const good = layoutRow({ id: 't', kind: 'number', config })
      expect(validateRow('layouts', good)).toBe(true)
      expect(rowFixes('layouts', good)).toEqual([])
      expect(tabOf(good)).toEqual({ id: 't', kind: 'number', config })
    }
  })

  it.each([
    ['name', 7, { name: 'Number' }],
    ['name', 'x'.repeat(81), { name: 'Number' }],
    ['color', 'teal', {}],
    ['show', 'pie', { show: 'count' }],
    ['litWhen', 'always', { litWhen: 'never', litAt: undefined }],
    ['litAt', -1, { litAt: 0 }],
    ['litAt', 1.5, { litAt: 0 }],
    ['compare', 'lastYear', { compare: 'yesterday' }],
    ['ignoreLens', false, {}],
    ['breakdown', 'person', {}],
    ['breakdown', 'due', {}],
  ] as const)('a Number’s %s %j is reset (a fix)', (key, value, reset) => {
    const base = numberTab('t', 'overdue').config
    const row = layoutRow({ id: 't', kind: 'number', config: { ...base, [key]: value } })
    expect(checkLayoutBody(row)).toBe(`cells[0].tabs[0].config.${key}`)
    expect(rowFixes('layouts', row)).toEqual(['tab or cell settings reset'])
    const { [key]: _gone, ...rest } = base as unknown as Record<string, unknown>
    void _gone
    expect(tabOf(row)).toEqual({ id: 't', kind: 'number', config: { ...rest, ...reset } })
  })

  it('a Number’s threshold goes with never; a filter is read as a list’s is; a v77 metric reads as a new Number', () => {
    const never = layoutRow({ id: 't', kind: 'number', config: { ...numberTab('t').config, litAt: 3 } })
    expect(checkLayoutBody(never)).toBe('cells[0].tabs[0].config.litAt')
    expect(tabOf(never)).toEqual({ id: 't', kind: 'number', config: numberTab('t').config })
    // A filter without its required fields: no filter (every open task), a fix.
    const bad = layoutRow({ id: 't', kind: 'number', config: { ...numberTab('t', 'overdue').config, filter: { tags: [3] } } })
    expect(checkLayoutBody(bad)).toBe('cells[0].tabs[0].config.filter.showCompleted')
    expect(rowFixes('layouts', bad)).toEqual(['tab or cell settings reset'])
    expect((tabOf(bad)!.config as { filter: unknown }).filter).toEqual({ showCompleted: false, personIds: null, statusIds: null, searchText: '', dates: {}, tags: [3] })
    // A config only an older build wrote (its metric; v78 converts every stored one): reset to a new Number's.
    const old = layoutRow({ id: 't', kind: 'number', config: { metric: 'overdue' } })
    expect(checkLayoutBody(old)).toBe('cells[0].tabs[0].config.name')
    expect(tabOf(old)).toEqual({ id: 't', kind: 'number', config: { ...createTab('number', 'n').config, name: 'Number' } })
  })

  it('a glance widget drops a details width (no glance widget shows task rows)', () => {
    for (const kind of WIDGET_KINDS.filter(isGlanceKind)) {
      expect(tabOf(layoutRow({ ...createTab(kind, 't'), viewState: { detailsWidth: 280 } }))).toEqual(createTab(kind, 't'))
    }
  })

  it.each(['followup', 'next7', 'stale', 'recent', 'changes', 'today', 'eisenhowerSummary', 'people', 'tags', 'status'])(
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
