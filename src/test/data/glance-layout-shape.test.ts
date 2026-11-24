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
import { cell, grid, numberItem, single } from '../helpers/layout-builders'
import { emptyPredicate } from '../../models/filter-predicate'

const DATE = '2026-09-01T09:00:00.000Z'

function layoutRow(tab: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 1, name: 'Glance', sortOrder: 0, createdAt: DATE, modifiedAt: DATE,
    ...single({ id: 'k', tabs: [tab as unknown as LayoutTab] }),
  }
}

const tabOf = (row: Record<string, unknown>) => (sanitizeRow('layouts', row) as WorkspaceLayout).cells[0]!.tabs[0]
/** A stored Numbers widget `w` of one Number, `config`, its id `t` (v90). */
const numbersRaw = (config: unknown) => ({ id: 'w', kind: 'numbers', config: { items: [{ id: 't', ...(config as object) }] } })
/** A Number's config as `numberItem` builds it, without its id. */
const configOf = (...args: Parameters<typeof numberItem>) => {
  const { id: _id, ...config } = numberItem(...args)
  void _id
  return config
}

/** Each glance kind with a setting: a config it keeps (not its default), one it repairs, and the default. */
const SETTINGS: Array<[GlanceWidgetKind, string, unknown, unknown, unknown]> = [
  ['trend', 'range', '12w', '1y', '14d'],
]

describe('glance widget kinds', () => {
  it('are glance widgets in the Insights group; only the Numbers fit their height', () => {
    const glance = WIDGET_KINDS.filter((k) => WIDGET_KIND_SPECS[k].glance)
    expect(glance).toEqual(['numbers', 'breakdown', 'pivot', 'trend'])
    expect(glance.every(isGlanceKind)).toBe(true)
    expect(WIDGET_KINDS.filter((k) => WIDGET_KIND_SPECS[k].fitHeight)).toEqual(['numbers'])
    expect(WIDGET_KINDS.filter((k) => WIDGET_KIND_SPECS[k].group === 'tasks')).toEqual(['lens', 'calendar', 'review', 'planner', 'notes', 'shortcuts'])
    // Insights: the glance widgets, then the Neglect map and Work clusters — whole widgets, not glance ones. The group
    // is the menus' only: the Calendar (Tasks) and the Neglect map (Insights) alike are not glance kinds.
    expect(WIDGET_KINDS.filter((k) => WIDGET_KIND_SPECS[k].group === 'insights')).toEqual([...glance, 'neglect', 'clusters'])
    expect(['calendar', 'neglect', 'clusters'].some((k) => isWidgetKind(k) && isGlanceKind(k))).toBe(false)
    // The Number tab (v90), the Dashboard (v77), the kinds D26 retired (v78), the Eisenhower (after v78), Project pulse and the Pressure radar (v83) and the List wall (v88) are gone.
    for (const gone of ['number', 'dashboard', 'followup', 'next7', 'stale', 'recent', 'changes', 'today', 'eisenhowerSummary', 'people', 'tags', 'status', 'eisenhower', 'pulse', 'radar', 'listwall']) {
      expect(isWidgetKind(gone), gone).toBe(false)
    }
  })

  it('a new tab has its defaults; a new Numbers widget holds one Number counting every open task', () => {
    expect(createTab('numbers', 'w', { numberItemId: 'n' })).toEqual({ id: 'w', kind: 'numbers', config: { items: [{ id: 'n', name: 'Open', filter: emptyPredicate(), show: 'count', litWhen: 'never', compare: 'yesterday' }] } })
    expect(createTab('numbers', 'w').config.items[0]?.id).toBe('w-1')
    expect(createTab('trend', 't').config).toEqual({ range: '14d', name: 'Created vs completed', show: 'bars' })
    expect(createTab('breakdown', 'b').config).toEqual({ name: 'Breakdown', filter: emptyPredicate(), splitBy: 'people', style: 'bars', show: 'count', showNone: true })
  })

  // Widget feedback 2C: Created vs completed's name, filter and Show as (no schema step: absent = the defaults).
  it('Created vs completed’s name, filter and Show as round-trip; absent they stay absent; a bad one is a fix and goes', () => {
    const filter = { ...emptyPredicate(), expression: { kind: 'tag', id: 4 } }
    const config = { range: '4w', name: 'Atlas', filter, show: 'burndown' }
    const good = layoutRow({ id: 't', kind: 'trend', config })
    expect(validateRow('layouts', good)).toBe(true)
    expect(rowFixes('layouts', good)).toEqual([])
    expect(tabOf(good)).toEqual({ id: 't', kind: 'trend', config })

    const old = layoutRow({ id: 't', kind: 'trend', config: { range: '14d' } })
    expect(rowFixes('layouts', old)).toEqual([])
    expect(tabOf(old)).toEqual({ id: 't', kind: 'trend', config: { range: '14d' } })

    const badShow = layoutRow({ id: 't', kind: 'trend', config: { range: '14d', show: 'pie', name: 'X' } })
    expect(checkLayoutBody(badShow)).toBe('cells[0].tabs[0].config.show')
    expect(rowFixes('layouts', badShow)).toEqual(['tab or cell settings reset'])
    expect(tabOf(badShow)).toEqual({ id: 't', kind: 'trend', config: { range: '14d', name: 'X' } })

    const badName = layoutRow({ id: 't', kind: 'trend', config: { range: '14d', name: 4 } })
    expect(checkLayoutBody(badName)).toBe('cells[0].tabs[0].config.name')
    expect(tabOf(badName)).toEqual({ id: 't', kind: 'trend', config: { range: '14d' } })

    // A filter without its required fields is read as a list's (a fix); one that isn't an object goes.
    const badFilter = layoutRow({ id: 't', kind: 'trend', config: { range: '14d', filter: { tags: [3] } } })
    expect(checkLayoutBody(badFilter)).toBe('cells[0].tabs[0].config.filter.showCompleted')
    expect(rowFixes('layouts', badFilter)).toEqual(['tab or cell settings reset'])
    const notObject = layoutRow({ id: 't', kind: 'trend', config: { range: '14d', filter: 'overdue' } })
    expect(checkLayoutBody(notObject)).toBe('cells[0].tabs[0].config.filter')
    expect(tabOf(notObject)).toEqual({ id: 't', kind: 'trend', config: { range: '14d' } })

    // The lens switch v81 removed, whatever it holds: dropped quietly, no fix.
    for (const ignoreLens of [true, 'yes']) {
      const lensed = layoutRow({ id: 't', kind: 'trend', config: { range: '14d' }, viewState: { ignoreLens } })
      expect(checkLayoutBody(lensed)).toBe(true)
      expect(rowFixes('layouts', lensed)).toEqual([])
      expect(tabOf(lensed)).toEqual({ id: 't', kind: 'trend', config: { range: '14d' } })
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

  it('a Number (D26 P5): every field round-trips; Auto and never are absent', () => {
    for (const config of [
      configOf('t'),
      configOf('t', 'overdue', { breakdown: 'tags', litWhen: 'below', litAt: 12, compare: 'none', color: '#abc' }),
      // The colour while not lit (widget feedback 2D; optional, no schema step), with and without the lit one.
      configOf('t', 'overdue', { litWhen: 'above', litAt: 0, color: '#abc', unlitColor: '#7ec4bc' }),
      configOf('t', 'open', { unlitColor: '#7EC4BC' }),
      // The breakdowns that came later (no schema step): status and priority.
      configOf('t', 'open', { breakdown: 'status' }),
      configOf('t', 'open', { breakdown: 'priority' }),
      configOf('t', 'open', { name: '', filter: { ...emptyPredicate(), expression: { kind: 'tag', id: 4 } } }),
    ]) {
      const good = layoutRow(numbersRaw(config))
      expect(validateRow('layouts', good)).toBe(true)
      expect(rowFixes('layouts', good)).toEqual([])
      expect(tabOf(good)).toEqual(numbersRaw(config))
    }
  })

  it.each([
    ['name', 7, { name: 'Number' }],
    ['color', 'teal', {}],
    ['unlitColor', 'teal', {}],
    ['unlitColor', 7, {}],
    ['show', 'pie', { show: 'count' }],
    ['litWhen', 'always', { litWhen: 'never', litAt: undefined }],
    ['litAt', -1, { litAt: 0 }],
    ['litAt', 1.5, { litAt: 0 }],
    ['compare', 'lastYear', { compare: 'yesterday' }],
    ['breakdown', 'person', {}],
    ['breakdown', 'due', {}],
  ] as const)('a Number’s %s %j is reset (a fix)', (key, value, reset) => {
    const base = configOf('t', 'overdue')
    const row = layoutRow(numbersRaw({ ...base, [key]: value }))
    expect(checkLayoutBody(row)).toBe(`cells[0].tabs[0].config.items[0].${key}`)
    expect(rowFixes('layouts', row)).toEqual(['tab or cell settings reset'])
    const { [key]: _gone, ...rest } = base as unknown as Record<string, unknown>
    void _gone
    expect(tabOf(row)).toEqual(numbersRaw(JSON.parse(JSON.stringify({ ...rest, ...reset }))))
  })

  it('a Number’s threshold goes with never; a filter is read as a list’s is; a v77 metric reads as a new Number', () => {
    const never = layoutRow(numbersRaw({ ...configOf('t'), litAt: 3 }))
    expect(checkLayoutBody(never)).toBe('cells[0].tabs[0].config.items[0].litAt')
    expect(tabOf(never)).toEqual(numbersRaw(configOf('t')))
    // A filter without its required fields: no filter (every open task), a fix.
    const bad = layoutRow(numbersRaw({ ...configOf('t', 'overdue'), filter: { tags: [3] } }))
    expect(checkLayoutBody(bad)).toBe('cells[0].tabs[0].config.items[0].filter.showCompleted')
    expect(rowFixes('layouts', bad)).toEqual(['tab or cell settings reset'])
    expect((tabOf(bad)!.config as { items: Array<{ filter: unknown }> }).items[0]?.filter).toEqual({ showCompleted: false, personIds: null, statusIds: null, searchText: '', dates: {}, tags: [3] })
    // A config only an older build wrote (its metric; v78 converts every stored one): reset to a new Number's.
    const old = layoutRow(numbersRaw({ metric: 'overdue' }))
    expect(checkLayoutBody(old)).toBe('cells[0].tabs[0].config.items[0].name')
    expect(tabOf(old)).toEqual(numbersRaw({ ...configOf('t'), filter: emptyPredicate(), name: 'Number' }))
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
