import { describe, it, expect } from 'vitest'
import { rowFixes, sanitizeRow, validateImportData, validateRow } from '../../data/import-validation'
import { addTab } from '../../utils/workspace-layout-ops'
import type { LayoutTab, WorkspaceLayout } from '../../models/workspace-layout'

const DATE = '2026-09-01T09:00:00.000Z'

function layoutRow(columns: unknown, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: 1, name: 'Daily', sortOrder: 0, columns, createdAt: DATE, modifiedAt: DATE, ...extra }
}

function oneTab(tab: Record<string, unknown>, cell: Record<string, unknown> = {}): unknown[] {
  return [{ id: 'c', weight: 1, cells: [{ id: 'k', weight: 1, tabs: [tab], ...cell }] }]
}

/** Layout rows `checkLayout` rejects: label, row, the bad field it names. */
const REJECTED: Array<[string, Record<string, unknown>, string]> = [
  ['blank name', layoutRow([], { name: '  ' }), 'name'],
  ['bad date', layoutRow([], { modifiedAt: 'nope' }), 'modifiedAt'],
  ['lens pick not an id', layoutRow([], { lensId: 7 }), 'lensId'],
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
  ['calendar titles not a boolean', layoutRow(oneTab({ id: 't', kind: 'calendar', config: { dateTypes: { due: true, followup: false } }, viewState: { titles: 'on' } })), 'columns[0].cells[0].tabs[0].viewState.titles'],
  ['bad Eisenhower collapsed', layoutRow(oneTab({ id: 't', kind: 'eisenhower', config: {}, viewState: { collapsed: ['later'] } })), 'columns[0].cells[0].tabs[0].viewState.collapsed'],
  ['Eisenhower collapsed not a list', layoutRow(oneTab({ id: 't', kind: 'eisenhower', config: {}, viewState: { collapsed: 'do' } })), 'columns[0].cells[0].tabs[0].viewState.collapsed'],
  ['bad list id', layoutRow(oneTab({ id: 't', kind: 'lens', config: { listDefinitionId: '3' } })), 'columns[0].cells[0].tabs[0].config.listDefinitionId'],
  ['bad collapsed', layoutRow(oneTab({ id: 't', kind: 'notes', config: {} }, { collapsed: 'yes' })), 'columns[0].cells[0].collapsed'],
  ['duplicate id', layoutRow(oneTab({ id: 'k', kind: 'notes', config: {} })), 'columns[0].cells[0].tabs[0].id'],
  ['details width not a number', layoutRow(oneTab({ id: 't', kind: 'lens', config: {}, viewState: { detailsWidth: '262' } })), 'columns[0].cells[0].tabs[0].viewState.detailsWidth'],
  ['negative details width', layoutRow(oneTab({ id: 't', kind: 'eisenhower', config: {}, viewState: { detailsWidth: -1 } })), 'columns[0].cells[0].tabs[0].viewState.detailsWidth'],
  ['band not an object', layoutRow([], { bottom: 'yes' }), 'bottom'],
  ['band with no tabs', layoutRow([], { top: { id: 'b', height: 160, tabs: [] } }), 'top.tabs'],
  ['band tabs not a list', layoutRow([], { top: { id: 'b', height: 160, tabs: {} } }), 'top.tabs'],
  ['band without a height', layoutRow([], { top: { id: 'b', tabs: [{ id: 't', kind: 'notes', config: {} }] } }), 'top.height'],
  ['band height zero', layoutRow([], { top: { id: 'b', height: 0, tabs: [{ id: 't', kind: 'notes', config: {} }] } }), 'top.height'],
  ['band id repeats a cell id', layoutRow(oneTab({ id: 't', kind: 'notes', config: {} }), { top: { id: 'k', height: 160, tabs: [{ id: 't2', kind: 'notes', config: {} }] } }), 'top.id'],
  ['band tab id repeats a tab id', layoutRow(oneTab({ id: 't', kind: 'notes', config: {} }), { bottom: { id: 'b', height: 160, tabs: [{ id: 't', kind: 'notes', config: {} }] } }), 'bottom.tabs[0].id'],
  ['the two bands share an id', layoutRow([], { top: { id: 'b', height: 160, tabs: [{ id: 't1', kind: 'notes', config: {} }] }, bottom: { id: 'b', height: 160, tabs: [{ id: 't2', kind: 'notes', config: {} }] } }), 'bottom.id'],
  ['unknown band tab kind', layoutRow([], { bottom: { id: 'b', height: 160, tabs: [{ id: 't', kind: 'status', config: {} }] } }), 'bottom.tabs[0].kind'],
  ['bad band collapsed', layoutRow([], { top: { id: 'b', height: 160, collapsed: 1, tabs: [{ id: 't', kind: 'notes', config: {} }] } }), 'top.collapsed'],
  ['bad band tab settings', layoutRow([], { top: { id: 'b', height: 160, tabs: [{ id: 't', kind: 'calendar', config: {} }] } }), 'top.tabs[0].config.dateTypes'],
]

/** A top band (dashboard + a list) and a bottom band (a week calendar), as the layout row stores them. */
const BANDS = {
  top: { id: 'b1', height: 112, activeTabId: 'bt2', tabs: [
    { id: 'bt1', kind: 'dashboard', config: { tiles: ['open'], listTiles: [], sections: [] } },
    { id: 'bt2', kind: 'lens', config: { listDefinitionId: 3 }, viewState: { detailsWidth: 280 } },
  ] },
  bottom: { id: 'b2', height: 150, collapsed: true, tabs: [
    { id: 'bt3', kind: 'calendar', config: { dateTypes: { due: true, followup: false } }, viewState: { view: 'week' } },
  ] },
}

/** Columns holding every kind, an empty cell, view state and a collapsed cell. */
const EVERY_KIND = [
  { id: 'c1', weight: 1, cells: [
    { id: 'k1', weight: 1, activeTabId: 't2', collapsed: true, tabs: [
      { id: 't1', kind: 'lens', config: { listDefinitionId: 3 }, viewState: { detailsWidth: 300 } },
      { id: 't2', kind: 'calendar', config: { dateTypes: { due: false, followup: true } }, viewState: { view: 'month', offset: -2, titles: true } },
      { id: 't3', kind: 'notes', config: {} },
      { id: 't4', kind: 'eisenhower', config: {}, viewState: { collapsed: ['do', 'drop'], detailsWidth: 0 } },
      { id: 't5', kind: 'dashboard', config: { tiles: ['open'], listTiles: [2], sections: [{ id: 'trend', options: { range: '4w' } }] }, viewState: { detailsWidth: 4000 } },
    ] },
    { id: 'k2', weight: 0.5, tabs: [] },
  ] },
  { id: 'c2', weight: 2, cells: [{ id: 'k3', weight: 1, tabs: [{ id: 't6', kind: 'notes', config: {} }] }] },
]

describe('layouts row validation', () => {
  it('accepts a layout with many columns, cells and tabs, as the workspace reducers build it', () => {
    // Nothing in the workspace limits the counts; import keeps up to 1,000 of each.
    let n = 0
    const genId = () => `w-${n++}`
    let layout: WorkspaceLayout = { id: 1, sortOrder: 0, name: 'Big', columns: [], createdAt: new Date(DATE), modifiedAt: new Date(DATE) }
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
    expect(validateRow('layouts', layoutRow(columns, { lastUsedAt: DATE, lensId: 'lens-a' }))).toBe(true)
    expect(validateRow('layouts', layoutRow([]))).toBe(true)
  })

  it.each(REJECTED)('rejects %s', (_label, row, field) => {
    expect(validateRow('layouts', row)).toBe(field)
  })

  it('accepts a top and a bottom band; a layout without bands needs none', () => {
    expect(validateRow('layouts', layoutRow(EVERY_KIND, BANDS))).toBe(true)
    expect(validateRow('layouts', layoutRow([], { top: BANDS.top }))).toBe(true)
    expect(validateRow('layouts', layoutRow(EVERY_KIND))).toBe(true)
    const res = validateImportData({ todos: [], settings: [], layouts: [layoutRow(EVERY_KIND, BANDS), layoutRow([], { id: 2 })] })
    if (!res.ok) throw new Error(res.error)
    expect(res.data.layouts[0]).toMatchObject(BANDS)
    expect('top' in res.data.layouts[1]!).toBe(false)
    expect('bottom' in res.data.layouts[1]!).toBe(false)
  })

  it('import keeps only a band’s model keys and drops its stale activeTabId', () => {
    const top = { id: 'b', height: 90.5, activeTabId: 'gone', collapsed: false, stray: 1, tabs: [{ id: 't', kind: 'notes', config: { x: 1 } }] }
    const res = validateImportData({ todos: [], settings: [], layouts: [layoutRow([], { top })] })
    if (!res.ok) throw new Error(res.error)
    expect(res.data.layouts[0]!.top).toEqual({ id: 'b', height: 90.5, tabs: [{ id: 't', kind: 'notes', config: {} }] })
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
          { id: 't4', kind: 'eisenhower', config: {}, viewState: { collapsed: ['drop', 'do', 'drop'], stray: 1 } },
          { id: 't5', kind: 'eisenhower', config: {}, viewState: { collapsed: [] } },
        ],
      }],
    }]
    const res = validateImportData({ todos: [], settings: [], layouts: [layoutRow(columns, { stray: 'x' })] })
    if (!res.ok) throw new Error(res.error)
    expect(res.data.layouts).toEqual([{
      id: 1, name: 'Daily', sortOrder: 0, createdAt: new Date(DATE), modifiedAt: new Date(DATE),
      columns: [{ id: 'c', weight: 2, cells: [{ id: 'k', weight: 1, tabs: [
        { id: 't1', kind: 'notes', config: {} },
        { id: 't3', kind: 'lens', config: { listDefinitionId: 4 } },
        { id: 't2', kind: 'calendar', config: { dateTypes: { due: true, followup: false } }, viewState: { offset: 104 } },
        { id: 't4', kind: 'eisenhower', config: {}, viewState: { collapsed: ['do', 'drop'] } },
        { id: 't5', kind: 'eisenhower', config: {} },
      ] }] }],
    }])
  })

  it('import keeps a list, Eisenhower or dashboard tab’s details width, rounded', () => {
    const columns = [{ id: 'c', weight: 1, cells: [{ id: 'k', weight: 1, tabs: [
      { id: 't1', kind: 'lens', config: {}, viewState: { detailsWidth: 262.6 } },
      { id: 't2', kind: 'eisenhower', config: {}, viewState: { detailsWidth: 180 } },
      { id: 't3', kind: 'dashboard', config: { tiles: [], listTiles: [], sections: [] }, viewState: { detailsWidth: 0.4 } },
      // Only tabs that show task rows keep it.
      { id: 't4', kind: 'notes', config: {}, viewState: { detailsWidth: 200 } },
    ] }] }]
    const res = validateImportData({ todos: [], settings: [], layouts: [layoutRow(columns)] })
    if (!res.ok) throw new Error(res.error)
    expect(res.data.layouts[0]!.columns[0]!.cells[0]!.tabs.map((t) => t.viewState)).toEqual([
      { detailsWidth: 263 }, { detailsWidth: 180 }, { detailsWidth: 0 }, undefined,
    ])
  })

  it('a details width past 4000 — a very wide list’s divider — is valid and read as 4000', () => {
    // The divider stores up to the list's own room, which a wide band can put past 4000 px.
    const row = layoutRow(oneTab({ id: 't', kind: 'lens', config: {}, viewState: { detailsWidth: 4630 } }))
    expect(validateRow('layouts', row)).toBe(true)
    expect(rowFixes('layouts', row)).toEqual([])
    const res = validateImportData({ todos: [], settings: [], layouts: [row] })
    if (!res.ok) throw new Error(res.error)
    expect(res.data.layouts[0]!.columns[0]!.cells[0]!.tabs[0]!.viewState).toEqual({ detailsWidth: 4000 })
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

  it('import keeps the Tags / Stale tasks / Recently completed / Eisenhower sections and their own options only', () => {
    const config = {
      tiles: ['open'],
      listTiles: [],
      sections: [
        { id: 'eisenhower', options: { staleDays: 30 } },
        { id: 'stale', options: { staleDays: 30, recentDays: 14 } },
        { id: 'recent', options: { recentDays: 14, staleDays: 7 } },
        { id: 'tags', options: { showUntagged: false, showUnassigned: false } },
        { id: 'stale' },
      ],
    }
    const res = validateImportData({ todos: [], settings: [], layouts: [layoutRow(oneTab({ id: 't', kind: 'dashboard', config }))] })
    if (!res.ok) throw new Error(res.error)
    expect(res.data.layouts[0]!.columns[0]!.cells[0]!.tabs[0]).toEqual({
      id: 't',
      kind: 'dashboard',
      config: {
        tiles: ['open'],
        listTiles: [],
        sections: [
          { id: 'eisenhower' },
          { id: 'stale', options: { staleDays: 30 } },
          { id: 'recent', options: { recentDays: 14 } },
          { id: 'tags', options: { showUntagged: false } },
        ],
      },
    })
  })

  it('import drops option values a section doesn’t offer', () => {
    const config = {
      sections: [{ id: 'stale', options: { staleDays: 15 } }, { id: 'recent', options: { recentDays: '7' } }, { id: 'tags', options: { showUntagged: 'no' } }],
    }
    const res = validateImportData({ todos: [], settings: [], layouts: [layoutRow(oneTab({ id: 't', kind: 'dashboard', config }))] })
    if (!res.ok) throw new Error(res.error)
    const tab = res.data.layouts[0]!.columns[0]!.cells[0]!.tabs[0]!
    expect(tab.kind === 'dashboard' && tab.config.sections).toEqual([{ id: 'stale' }, { id: 'recent' }, { id: 'tags' }])
  })

  it('import fills a dashboard config’s missing parts with the defaults', () => {
    const res = validateImportData({ todos: [], settings: [], layouts: [layoutRow(oneTab({ id: 't', kind: 'dashboard', config: { listTiles: [2] } }))] })
    if (!res.ok) throw new Error(res.error)
    expect(res.data.layouts[0]!.columns[0]!.cells[0]!.tabs[0]).toEqual({
      id: 't',
      kind: 'dashboard',
      config: {
        tiles: ['open', 'hot', 'focus', 'urgent', 'overdue', 'followupDue'],
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

describe('a layout past the limit of 1,000 columns, cells or tabs', () => {
  const notes = (id: string) => ({ id, kind: 'notes', config: {} })

  it('imports with the parts past the limit dropped, and a warning that says so', () => {
    const columns = Array.from({ length: 1003 }, (_, c) => ({ id: `c${c}`, weight: 1, cells: [{ id: `k${c}`, weight: 1, tabs: [] }] }))
    const row = layoutRow(columns)
    expect(validateRow('layouts', row)).toBe(true)
    const res = validateImportData({ todos: [], settings: [], layouts: [row] })
    if (!res.ok) throw new Error(res.error)
    expect(res.data.layouts[0]!.columns).toHaveLength(1000)
    expect(res.data.layouts[0]!.columns.at(-1)!.id).toBe('c999')
    expect(res.warnings).toEqual(['Fixed 1 layout: "Daily" (3 columns past the limit of 1,000 dropped)'])
  })

  it('counts cells and tabs over the whole layout, bands included', () => {
    const many = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => notes(`${prefix}${i}`))
    const row = layoutRow([
      { id: 'c0', weight: 1, cells: [{ id: 'k0', weight: 1, tabs: many('a', 600) }] },
      { id: 'c1', weight: 1, cells: [{ id: 'k1', weight: 1, tabs: many('b', 600) }] },
    ], { top: { id: 'b', height: 160, tabs: many('t', 2) } })
    expect(validateRow('layouts', row)).toBe(true)
    expect(rowFixes('layouts', row)).toEqual(['202 tabs past the limit of 1,000 dropped', 'band dropped'])
    const repaired = sanitizeRow('layouts', row) as WorkspaceLayout
    expect(repaired.columns[1]!.cells[0]!.tabs).toHaveLength(400)
    expect('top' in repaired).toBe(false)

    const cells = Array.from({ length: 1001 }, (_, k) => ({ id: `k${k}`, weight: 1, tabs: [] }))
    expect(rowFixes('layouts', layoutRow([{ id: 'c', weight: 1, cells }, { id: 'd', weight: 1, cells: [{ id: 'x', weight: 1, tabs: [] }] }])))
      .toEqual(['2 cells past the limit of 1,000 dropped', 'column past the limit of 1,000 dropped'])
  })

  it('a dashboard tab keeps its first 1,000 list tiles', () => {
    const listTiles = Array.from({ length: 1005 }, (_, i) => i + 1)
    const row = layoutRow(oneTab({ id: 't', kind: 'dashboard', config: { listTiles } }))
    expect(validateRow('layouts', row)).toBe(true)
    expect(rowFixes('layouts', row)).toEqual(['5 list tiles past the limit of 1,000 dropped'])
    const tab = (sanitizeRow('layouts', row) as WorkspaceLayout).columns[0]!.cells[0]!.tabs[0]!
    expect(tab.kind === 'dashboard' && tab.config.listTiles).toEqual(listTiles.slice(0, 1000))
  })
})

describe('repairing a layout row the schema rejects (audit cleanup)', () => {
  it.each(REJECTED)('repairs %s into a row the schema accepts, naming what changed', (_label, row) => {
    expect(rowFixes('layouts', row).length).toBeGreaterThan(0)
    expect(validateRow('layouts', JSON.parse(JSON.stringify(sanitizeRow('layouts', row))))).toBe(true)
  })

  it('a valid layout has nothing to fix, and its repair is the import pick', () => {
    const row = layoutRow(EVERY_KIND, { lastUsedAt: DATE, lensId: 'lens-a', ...BANDS })
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

  it('an Eisenhower tab’s config keys (it has none: its list and panes are settings) are dropped with a warning, its view state kept', () => {
    const row = layoutRow(oneTab({ id: 't', kind: 'eisenhower', config: { listDefinitionId: 7, panes: { do: { name: 'Now' } } }, viewState: { collapsed: ['do'] } }))
    expect(validateRow('layouts', row)).toBe(true)
    expect(rowFixes('layouts', row)).toEqual(['2 Eisenhower tab settings dropped'])
    const res = validateImportData({ todos: [], settings: [], layouts: [row] })
    if (!res.ok) throw new Error(res.error)
    expect(res.warnings).toEqual(['Fixed 1 layout: "Daily" (2 Eisenhower tab settings dropped)'])
    expect(res.data.layouts[0]!.columns[0]!.cells[0]!.tabs[0]).toEqual({ id: 't', kind: 'eisenhower', config: {}, viewState: { collapsed: ['do'] } })
    // Not an object: the tab's settings reset, as for any kind.
    expect(rowFixes('layouts', layoutRow(oneTab({ id: 't', kind: 'eisenhower', config: 7 })))).toEqual(['tab or cell settings reset'])
  })

  it('a bad band is dropped, a band left without tabs too; a bad height becomes the default', () => {
    const row = layoutRow([], {
      top: { id: 'b1', height: -5, tabs: [{ id: 't1', kind: 'notes', config: {} }, { id: 't2', kind: 'nope', config: {} }] },
      bottom: { id: 'b2', height: 160, tabs: [{ id: 't1', kind: 'notes', config: {} }] },
    })
    expect(rowFixes('layouts', row)).toEqual(['size reset', '2 tabs dropped', 'band dropped'])
    const repaired = sanitizeRow('layouts', row) as WorkspaceLayout
    expect(repaired.top).toEqual({ id: 'b1', height: 160, tabs: [{ id: 't1', kind: 'notes', config: {} }] })
    expect('bottom' in repaired).toBe(false)
    expect(rowFixes('layouts', layoutRow([], { bottom: 7 }))).toEqual(['band dropped'])
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
      const row = JSON.parse(JSON.stringify(layoutRow(EVERY_KIND, { lastUsedAt: DATE, ...BANDS }))) as Record<string, unknown>
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
      // A valid row loses nothing but keys an Eisenhower tab's config can't hold (dropped with a warning).
      if (validateRow('layouts', row) === true) expect(rowFixes('layouts', row).filter((f) => !/Eisenhower tab settings? dropped$/.test(f)), `case ${i}`).toEqual([])
      else expect(rowFixes('layouts', row).length, `case ${i}: ${JSON.stringify(row)}`).toBeGreaterThan(0)
    }
  })
})
