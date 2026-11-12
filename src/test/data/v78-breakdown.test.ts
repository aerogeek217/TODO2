import { describe, expect, it } from 'vitest'
import { upgradeV78 } from '../../data/upgrades/v78'
import { breakdownConfigOfKind, layoutBreakdownsOf, upgradeBreakdown } from '../../data/upgrades/v78/breakdown'
import { numberConfigOfMetric } from '../../data/upgrades/v78/number-metrics'
import { prepareImport } from '../../data/import-pipeline'
import { SCHEMA_VERSION_KEY } from '../../data/file-version'
import { readLayoutDraft } from '../../data/draft-storage'
import { rowFixes, validateRow } from '../../data/import-validation'
import { emptyPredicate } from '../../models/filter-predicate'
import { defaultBreakdownColumns } from '../../models/chart-widgets'
import { DEFAULT_TAB_BADGES } from '../../utils/tab-badges'
import type { LayoutTab } from '../../models/workspace-layout'
import { cell, grid } from '../helpers/layout-builders'

type Obj = Record<string, unknown>

const DATE = '2026-11-01T09:00:00.000Z'
const AREA = { col: 0, row: 0, colSpan: 1, rowSpan: 1 }
const layout = (cells: unknown[]): Obj => ({ id: 1, name: 'L', sortOrder: 0, createdAt: DATE, modifiedAt: DATE, ...grid([[cell('a')]]), cells })
const v77 = (id: string, kind: string, config: Obj = {}) => ({ id, kind, config }) as unknown as LayoutTab

const breakdown = (name: string, splitBy: string, showNone: boolean) => ({
  name, filter: emptyPredicate(), splitBy, style: 'bars', show: 'count', showNone,
})
/** The Breakdown after the whole chain: v79 wrote its count columns (Settings' default ranges, none stored). */
const throughV79 = (config: Obj) => ({ ...config, columns: defaultBreakdownColumns(DEFAULT_TAB_BADGES) })

describe('v78 breakdown: People, Tags and Status become Breakdowns (D26 P8)', () => {
  it.each([
    ['people', { showUnassigned: true }, breakdown('People', 'people', true)],
    ['people', { showUnassigned: false }, breakdown('People', 'people', false)],
    ['tags', { showUntagged: false }, breakdown('Tags', 'tags', false)],
    ['tags', {}, breakdown('Tags', 'tags', true)],
    ['status', {}, breakdown('Status', 'status', true)],
  ] as const)('%s %j → %j', (kind, config, expected) => {
    expect(breakdownConfigOfKind(kind, config)).toEqual(expected)
  })

  it('a bad or missing none-row option reads as shown, the old default', () => {
    expect(breakdownConfigOfKind('people', { showUnassigned: 'no' })).toMatchObject({ showNone: true })
    expect(breakdownConfigOfKind('tags', 'x')).toMatchObject({ showNone: true })
  })

  it('keeps each tab’s id, its place and the active tab; the row is one the current schema takes as it is', () => {
    const row = layout([{ id: 'a', area: AREA, tabs: [
      v77('n', 'notes'),
      v77('p', 'people', { showUnassigned: false }),
      v77('t', 'tags', { showUntagged: true }),
      v77('s', 'status'),
    ], activeTabId: 's' }])
    const out = layoutBreakdownsOf(row) as Obj & { cells: Array<{ tabs: LayoutTab[]; activeTabId: string }> }
    expect(out.cells[0]!.tabs).toEqual([
      { id: 'n', kind: 'notes', config: {} },
      { id: 'p', kind: 'breakdown', config: breakdown('People', 'people', false) },
      { id: 't', kind: 'breakdown', config: breakdown('Tags', 'tags', true) },
      { id: 's', kind: 'breakdown', config: breakdown('Status', 'status', true) },
    ])
    expect(out.cells[0]!.activeTabId).toBe('s')
    expect(validateRow('layouts', out)).toBe(true)
    expect(rowFixes('layouts', out)).toEqual([])
  })

  it('is idempotent and defensive: a Breakdown, an odd cell or tab, a dataset without layouts is left as it is', () => {
    const data = { layouts: [layout([{ id: 'a', area: AREA, tabs: [v77('p', 'people')] }])] }
    const once = upgradeBreakdown(data)
    expect(once).not.toBe(data)
    expect(upgradeBreakdown(once)).toBe(once)
    const odd = layout(['x', { id: 'b', tabs: 'nope' }, { id: 'c', tabs: [7, null, v77('l', 'lens')] }])
    expect(layoutBreakdownsOf(odd)).toBe(odd)
    const none = { todos: [] }
    expect(upgradeBreakdown(none)).toBe(none)
  })

  it('runs last in v78, after the table, the widget set and the Numbers', () => {
    const v77Layout = {
      id: 1, name: 'L', sortOrder: 0, createdAt: DATE, modifiedAt: DATE,
      columns: [{ id: 'A', weight: 1, rows: [{ id: 'A1', weight: 1, cells: [{ id: 'a', weight: 1, tabs: [
        { id: 'n', kind: 'number', config: { metric: 'open' } },
        v77('p', 'people', { showUnassigned: false }),
        { id: 'g', kind: 'today', config: {} },
      ] }] }] }],
    }
    const out = upgradeV78({ layouts: [v77Layout] }).layouts![0] as Obj & { cells: Array<{ tabs: LayoutTab[] }> }
    expect(out.cells[0]!.tabs).toEqual([
      { id: 'n', kind: 'number', config: numberConfigOfMetric('open') },
      { id: 'p', kind: 'breakdown', config: breakdown('People', 'people', false) },
    ])
  })

  it('a v77 file imports through v78: its People, Tags and Status arrive as Breakdowns, nothing to repair', () => {
    const file = {
      [SCHEMA_VERSION_KEY]: 77,
      todos: [],
      settings: [],
      layouts: [{
        id: 1, name: 'L', sortOrder: 0, createdAt: DATE, modifiedAt: DATE,
        columns: [{ id: 'A', weight: 1, rows: [{ id: 'A1', weight: 1, cells: [
          { id: 'a', weight: 1, tabs: [v77('t', 'tags', { showUntagged: false })] },
          { id: 'b', weight: 1, tabs: [v77('s', 'status')] },
        ] }] }],
      }],
    }
    const result = prepareImport(JSON.parse(JSON.stringify(file)))
    if (!result.ok) throw new Error(result.error)
    expect(result.warnings).toEqual([])
    expect(result.data.layouts[0]!.cells.flatMap((c) => c.tabs)).toEqual([
      { id: 't', kind: 'breakdown', config: throughV79(breakdown('Tags', 'tags', false)) },
      { id: 's', kind: 'breakdown', config: throughV79(breakdown('Status', 'status', true)) },
    ])
  })

  it('a kept v77 layout draft reads back with its People as a Breakdown', () => {
    const body = { columns: [{ id: 'A', weight: 1, rows: [{ id: 'A1', weight: 1, cells: [{ id: 'a', weight: 1, tabs: [v77('p', 'people', { showUnassigned: true })] }] }] }] }
    localStorage.setItem('todo2-unsaved-layout', JSON.stringify({ kind: 'new', name: 'N', schemaVersion: 77, ...body }))
    const draft = readLayoutDraft()
    const tabs = draft?.kind === 'new' ? draft.body.cells.flatMap((c) => c.tabs) : []
    expect(tabs).toEqual([{ id: 'p', kind: 'breakdown', config: throughV79(breakdown('People', 'people', true)) }])
  })
})
