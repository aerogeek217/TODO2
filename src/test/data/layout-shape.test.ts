import { describe, it, expect } from 'vitest'
import { rowFixes, sanitizeRow, validateImportData, validateRow } from '../../data/import-validation'
import { addTab } from '../../utils/workspace-layout-ops'
import type { LayoutTab, WorkspaceLayout } from '../../models/workspace-layout'

const DATE = '2026-09-01T09:00:00.000Z'

function layoutRow(columns: unknown, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: 1, name: 'Daily', columns, createdAt: DATE, modifiedAt: DATE, ...extra }
}

function oneTab(tab: Record<string, unknown>, cell: Record<string, unknown> = {}): unknown[] {
  return [{ id: 'c', weight: 1, cells: [{ id: 'k', weight: 1, tabs: [tab], ...cell }] }]
}

/** Layout rows `checkLayout` rejects: label, row, the bad field it names. */
const REJECTED: Array<[string, Record<string, unknown>, string]> = [
  ['blank name', layoutRow([], { name: '  ' }), 'name'],
  ['bad date', layoutRow([], { modifiedAt: 'nope' }), 'modifiedAt'],
  ['columns not an array', layoutRow({}), 'columns'],
  ['column without cells', layoutRow([{ id: 'c', weight: 1, cells: [] }]), 'columns[0].cells'],
  ['zero weight', layoutRow([{ id: 'c', weight: 0, cells: [] }]), 'columns[0].weight'],
  ['unknown kind', layoutRow(oneTab({ id: 't', kind: 'horizons', config: {} })), 'columns[0].cells[0].tabs[0].kind'],
  ['retired Status widget', layoutRow(oneTab({ id: 't', kind: 'status', config: {} })), 'columns[0].cells[0].tabs[0].kind'],
  ['dashboard tiles not a list', layoutRow(oneTab({ id: 't', kind: 'dashboard', config: { tiles: 'open' } })), 'columns[0].cells[0].tabs[0].config.tiles'],
  ['dashboard list tiles not a list', layoutRow(oneTab({ id: 't', kind: 'dashboard', config: { listTiles: 3 } })), 'columns[0].cells[0].tabs[0].config.listTiles'],
  ['dashboard sections not a list', layoutRow(oneTab({ id: 't', kind: 'dashboard', config: { sections: {} } })), 'columns[0].cells[0].tabs[0].config.sections'],
  ['missing config', layoutRow(oneTab({ id: 't', kind: 'notes' })), 'columns[0].cells[0].tabs[0].config'],
  ['calendar date types not booleans', layoutRow(oneTab({ id: 't', kind: 'calendar', config: { dateTypes: { due: 1, followup: false } } })), 'columns[0].cells[0].tabs[0].config.dateTypes'],
  ['bad calendar view', layoutRow(oneTab({ id: 't', kind: 'calendar', config: { dateTypes: { due: true, followup: false } }, viewState: { view: 'year' } })), 'columns[0].cells[0].tabs[0].viewState.view'],
  ['bad Eisenhower collapsed', layoutRow(oneTab({ id: 't', kind: 'eisenhower', config: {}, viewState: { collapsed: ['later'] } })), 'columns[0].cells[0].tabs[0].viewState.collapsed'],
  ['Eisenhower collapsed not a list', layoutRow(oneTab({ id: 't', kind: 'eisenhower', config: {}, viewState: { collapsed: 'do' } })), 'columns[0].cells[0].tabs[0].viewState.collapsed'],
  ['bad list id', layoutRow(oneTab({ id: 't', kind: 'lens', config: { listDefinitionId: '3' } })), 'columns[0].cells[0].tabs[0].config.listDefinitionId'],
  ['bad collapsed', layoutRow(oneTab({ id: 't', kind: 'notes', config: {} }, { collapsed: 'yes' })), 'columns[0].cells[0].collapsed'],
  ['duplicate id', layoutRow(oneTab({ id: 'k', kind: 'notes', config: {} })), 'columns[0].cells[0].tabs[0].id'],
]

/** Columns holding every kind, an empty cell, view state and a collapsed cell. */
const EVERY_KIND = [
  { id: 'c1', weight: 1, cells: [
    { id: 'k1', weight: 1, activeTabId: 't2', collapsed: true, tabs: [
      { id: 't1', kind: 'lens', config: { listDefinitionId: 3 } },
      { id: 't2', kind: 'calendar', config: { dateTypes: { due: false, followup: true } }, viewState: { view: 'month', offset: -2 } },
      { id: 't3', kind: 'notes', config: {} },
      { id: 't4', kind: 'eisenhower', config: {}, viewState: { collapsed: ['do', 'drop'] } },
      { id: 't5', kind: 'dashboard', config: { tiles: ['open'], listTiles: [2], sections: [{ id: 'trend', options: { range: '4w' } }] } },
    ] },
    { id: 'k2', weight: 0.5, tabs: [] },
  ] },
  { id: 'c2', weight: 2, cells: [{ id: 'k3', weight: 1, tabs: [{ id: 't6', kind: 'notes', config: {} }] }] },
]

describe('layouts row validation', () => {
  it('accepts a layout with any number of columns, cells and tabs, as the workspace reducers build it', () => {
    // Nothing in the workspace limits the counts, so import must not either.
    let n = 0
    const genId = () => `w-${n++}`
    let layout: WorkspaceLayout = { id: 1, name: 'Big', columns: [], createdAt: new Date(DATE), modifiedAt: new Date(DATE) }
    const notes = (): LayoutTab => ({ id: genId(), kind: 'notes', config: {} })
    for (let c = 0; c < 40; c++) layout = addTab(layout, notes(), { kind: 'layout' }, genId)
    const firstCell = layout.columns[0]!.cells[0]!.id
    for (let t = 0; t < 40; t++) layout = addTab(layout, notes(), { kind: 'cell', cellId: firstCell }, genId)
    for (let k = 0; k < 40; k++) layout = addTab(layout, notes(), { kind: 'cell-edge', cellId: firstCell, edge: 'bottom' }, genId)
    expect(layout.columns).toHaveLength(40)
    expect(layout.columns[0]!.cells).toHaveLength(41)
    expect(layout.columns[0]!.cells.find((cell) => cell.id === firstCell)!.tabs).toHaveLength(41)

    const row = JSON.parse(JSON.stringify(layout)) as Record<string, unknown>
    expect(validateRow('layouts', row)).toBe(true)
    const result = validateImportData({ todos: [], settings: [], layouts: [row] })
    if (!result.ok) throw new Error(result.error)
    expect(result.data.layouts[0]!.columns).toEqual(layout.columns)
  })

  it('accepts every kind, an empty cell and an empty layout', () => {
    const columns = [
      { id: 'c1', weight: 1, cells: [
        { id: 'k1', weight: 1, activeTabId: 't2', collapsed: true, tabs: [
          { id: 't1', kind: 'lens', config: { listDefinitionId: 3 } },
          { id: 't2', kind: 'calendar', config: { dateTypes: { due: false, followup: true } }, viewState: { view: 'month', offset: -2 } },
          { id: 't3', kind: 'notes', config: {} },
          { id: 't4', kind: 'eisenhower', config: {}, viewState: { collapsed: ['do', 'drop'] } },
          { id: 't5', kind: 'dashboard', config: { tiles: ['open'], listTiles: [2], sections: [{ id: 'trend', options: { range: '4w' } }] } },
        ] },
        { id: 'k2', weight: 0.5, tabs: [] },
      ] },
    ]
    expect(validateRow('layouts', layoutRow(columns, { lastUsedAt: DATE }))).toBe(true)
    expect(validateRow('layouts', layoutRow([]))).toBe(true)
  })

  it.each(REJECTED)('rejects %s', (_label, row, field) => {
    expect(validateRow('layouts', row)).toBe(field)
  })

  it('import keeps only model keys and drops a stale activeTabId', () => {
    const columns = [{
      id: 'c', weight: 2, extra: 1, cells: [{
        id: 'k', weight: 1, activeTabId: 'gone', collapsed: false, junk: true,
        tabs: [
          { id: 't1', kind: 'notes', config: { stray: 1 }, viewState: { stray: 2 } },
          // A list tab saves no prompt picks.
          { id: 't3', kind: 'lens', config: { listDefinitionId: 4 }, viewState: { runtimeFilterValue: [1] } },
          { id: 't2', kind: 'calendar', config: { dateTypes: { due: true, followup: false, x: 1 } }, viewState: { offset: 500 } },
          // Collapsed quadrants: once each, in display order.
          { id: 't4', kind: 'eisenhower', config: { x: 1 }, viewState: { collapsed: ['drop', 'do', 'drop'], stray: 1 } },
          { id: 't5', kind: 'eisenhower', config: {}, viewState: { collapsed: [] } },
        ],
      }],
    }]
    const res = validateImportData({ todos: [], settings: [], layouts: [layoutRow(columns, { stray: 'x' })] })
    if (!res.ok) throw new Error(res.error)
    expect(res.data.layouts).toEqual([{
      id: 1, name: 'Daily', createdAt: new Date(DATE), modifiedAt: new Date(DATE),
      columns: [{ id: 'c', weight: 2, cells: [{ id: 'k', weight: 1, tabs: [
        { id: 't1', kind: 'notes', config: {} },
        { id: 't3', kind: 'lens', config: { listDefinitionId: 4 } },
        { id: 't2', kind: 'calendar', config: { dateTypes: { due: true, followup: false } }, viewState: { offset: 104 } },
        { id: 't4', kind: 'eisenhower', config: {}, viewState: { collapsed: ['do', 'drop'] } },
        { id: 't5', kind: 'eisenhower', config: {} },
      ] }] }],
    }])
  })

  it('import keeps a dashboard config’s known ids (once, in order) and options, drops the rest', () => {
    const config = {
      tiles: ['hot', 'nope', 'open', 'hot'],
      listTiles: [3, '4', 3, 1.5, -1, 7],
      sections: [
        { id: 'people', options: { showUnassigned: false, range: '4w' } },
        { id: 'gone' },
        'junk',
        { id: 'trend', options: { range: '12w' } },
        { id: 'followup', options: { lookAhead: 5 } },
        { id: 'trend' },
      ],
      stray: true,
    }
    const res = validateImportData({ todos: [], settings: [], layouts: [layoutRow(oneTab({ id: 't', kind: 'dashboard', config, viewState: { x: 1 } }))] })
    if (!res.ok) throw new Error(res.error)
    expect(res.data.layouts[0]!.columns[0]!.cells[0]!.tabs[0]).toEqual({
      id: 't',
      kind: 'dashboard',
      config: {
        tiles: ['hot', 'open'],
        listTiles: [3, 7],
        sections: [{ id: 'people', options: { showUnassigned: false } }, { id: 'trend', options: { range: '12w' } }, { id: 'followup' }],
      },
    })
  })

  it('import fills a dashboard config’s missing parts with the defaults', () => {
    const res = validateImportData({ todos: [], settings: [], layouts: [layoutRow(oneTab({ id: 't', kind: 'dashboard', config: { listTiles: [2] } }))] })
    if (!res.ok) throw new Error(res.error)
    expect(res.data.layouts[0]!.columns[0]!.cells[0]!.tabs[0]).toEqual({
      id: 't',
      kind: 'dashboard',
      config: {
        tiles: ['open', 'hot', 'urgent', 'overdue', 'followupDue', 'focus'],
        listTiles: [2],
        sections: ['hot', 'followup', 'next7', 'trend', 'status', 'people'].map((id) => ({ id })),
      },
    })
  })

  it('validates the activeLayoutId setting as a number', () => {
    expect(validateRow('settings', { key: 'activeLayoutId', value: '3' })).toBe(true)
    expect(validateRow('settings', { key: 'activeLayoutId', value: 'x' })).toBe('value (activeLayoutId must be numeric)')
  })
})

describe('repairing a layout row the schema rejects (audit cleanup)', () => {
  it.each(REJECTED)('repairs %s into a row the schema accepts, naming what changed', (_label, row) => {
    expect(rowFixes('layouts', row).length).toBeGreaterThan(0)
    expect(validateRow('layouts', JSON.parse(JSON.stringify(sanitizeRow('layouts', row))))).toBe(true)
  })

  it('a valid layout has nothing to fix, and its repair is the import pick', () => {
    const row = layoutRow(EVERY_KIND, { lastUsedAt: DATE })
    expect(validateRow('layouts', row)).toBe(true)
    expect(rowFixes('layouts', row)).toEqual([])
    const res = validateImportData({ todos: [], settings: [], layouts: [row] })
    if (!res.ok) throw new Error(res.error)
    expect(sanitizeRow('layouts', row)).toEqual(res.data.layouts[0])
  })

  it('counts each kind of fix', () => {
    const row = layoutRow([
      { id: 'c1', weight: 0, cells: [
        { id: 'k1', weight: 'big', collapsed: 'yes', tabs: [{ id: 't1', kind: 'nope', config: {} }, { id: 't2', kind: 'status', config: {} }, 5] },
      ] },
      { id: 'c1', weight: 1, cells: [] },
    ], { name: '', createdAt: 'never' })
    expect(rowFixes('layouts', row)).toEqual([
      'name reset', 'dates reset', '2 sizes reset', '3 tabs dropped', 'tab or cell settings reset', 'column dropped',
    ])
  })

  it('any corruption of a valid layout repairs into a valid one', () => {
    // mulberry32: a small seeded generator, so a failure reproduces.
    let seed = 20261016
    const random = () => {
      seed = (seed + 0x6d2b79f5) | 0
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
    const pick = <T,>(list: readonly T[]): T => list[Math.floor(random() * list.length)]!
    const JUNK: unknown[] = [null, undefined, 'x', '', -1, 0, 1.5, Infinity, true, [], {}, ['do'], { due: false }, 't1', 'c2', 'k1']

    /** Every (container, key) pair in a JSON tree. */
    const slots = (node: unknown, out: Array<[Record<string, unknown> | unknown[], string | number]> = []) => {
      if (Array.isArray(node)) node.forEach((v, i) => { out.push([node, i]); slots(v, out) })
      else if (node && typeof node === 'object') {
        for (const [k, v] of Object.entries(node)) { out.push([node as Record<string, unknown>, k]); slots(v, out) }
      }
      return out
    }

    for (let i = 0; i < 2000; i++) {
      const row = JSON.parse(JSON.stringify(layoutRow(EVERY_KIND, { lastUsedAt: DATE }))) as Record<string, unknown>
      const changes = 1 + Math.floor(random() * 3)
      for (let c = 0; c < changes; c++) {
        // The row's own id is how the audit finds it: never corrupted here.
        const [container, key] = pick(slots(row).filter(([c, k]) => !(c === row && k === 'id')))
        if (random() < 0.2 && !Array.isArray(container)) delete container[key as string]
        else {
          const junk = pick(JUNK)
          // A fresh copy: a shared junk object could end up inside itself.
          ;(container as Record<string | number, unknown>)[key] = junk !== null && typeof junk === 'object' ? JSON.parse(JSON.stringify(junk)) : junk
        }
      }
      const repaired = JSON.parse(JSON.stringify(sanitizeRow('layouts', row))) as unknown
      expect(validateRow('layouts', repaired), `case ${i}: ${JSON.stringify(row)}`).toBe(true)
      if (validateRow('layouts', row) === true) expect(rowFixes('layouts', row), `case ${i}`).toEqual([])
      else expect(rowFixes('layouts', row).length, `case ${i}: ${JSON.stringify(row)}`).toBeGreaterThan(0)
    }
  })
})
