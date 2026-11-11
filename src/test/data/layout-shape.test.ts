import { describe, it, expect } from 'vitest'
import { rowFixes, sanitizeRow, validateImportData, validateRow } from '../../data/import-validation'
import { addTab } from '../../utils/workspace-layout-ops'
import { LAYOUT_SIZE_MAX } from '../../data/layout-shape'
import { validateTiling, isNormalized } from '../../utils/workspace-grid'
import type { LayoutTab, WorkspaceLayout } from '../../models/workspace-layout'
import { emptyBody, numberTab } from '../helpers/layout-builders'

const DATE = '2026-09-01T09:00:00.000Z'

const EMPTY = { grid: { columns: [], rows: [] }, cells: [] }
const AREA = { col: 0, row: 0, colSpan: 1, rowSpan: 1 }

function layoutRow(body: unknown, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: 1, name: 'Daily', sortOrder: 0, ...(body as Record<string, unknown>), createdAt: DATE, modifiedAt: DATE, ...extra }
}

/** One column, one row, one cell `k` holding `tab`. */
function oneTab(tab: Record<string, unknown>, cell: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    grid: { columns: [{ id: 'c', weight: 1000 }], rows: [{ id: 'r', weight: 1000 }] },
    cells: [{ id: 'k', area: AREA, tabs: [tab], ...cell }],
  }
}

/** Two cells side by side (k1 | k2) over one row, with `patch` merged into the grid's tracks or cells. */
function twoCells(tracks: { columns?: unknown[]; rows?: unknown[] } = {}, cells?: unknown[]): Record<string, unknown> {
  return {
    grid: {
      columns: tracks.columns ?? [{ id: 'c1', weight: 500 }, { id: 'c2', weight: 500 }],
      rows: tracks.rows ?? [{ id: 'r1', weight: 1000 }],
    },
    cells: cells ?? [
      { id: 'k1', area: { col: 0, row: 0, colSpan: 1, rowSpan: 1 }, tabs: [] },
      { id: 'k2', area: { col: 1, row: 0, colSpan: 1, rowSpan: 1 }, tabs: [] },
    ],
  }
}

/** Layout rows `checkLayout` rejects: label, row, the bad field it names. */
const REJECTED: Array<[string, Record<string, unknown>, string]> = [
  ['blank name', layoutRow(EMPTY, { name: '  ' }), 'name'],
  ['bad date', layoutRow(EMPTY, { modifiedAt: 'nope' }), 'modifiedAt'],
  ['hue neither a preset name nor a hex colour', layoutRow(EMPTY, { hue: 'mauve' }), 'hue'],
  ['no grid', layoutRow({ cells: [] }), 'grid'],
  ['grid in the v77 shape (columns of rows)', layoutRow({ columns: [{ id: 'c', weight: 1, rows: [] }] }), 'grid'],
  ['grid rows not a list', layoutRow({ grid: { columns: [], rows: {} }, cells: [] }), 'grid'],
  ['cells not a list', layoutRow({ grid: { columns: [], rows: [] } }), 'cells'],
  ['track not an object', layoutRow(twoCells({ columns: ['c1', { id: 'c2', weight: 1 }] })), 'grid.columns[0]'],
  ['track weight zero', layoutRow(twoCells({ columns: [{ id: 'c1', weight: 0 }, { id: 'c2', weight: 1 }] })), 'grid.columns[0].weight'],
  ['track weight past the size cap', layoutRow(twoCells({ columns: [{ id: 'c1', weight: 9e307 }, { id: 'c2', weight: 1 }] })), 'grid.columns[0].weight'],
  ['track with a weight and px', layoutRow(twoCells({ rows: [{ id: 'r1', weight: 1, px: 100 }] })), 'grid.rows[0].px'],
  ['track px past the size cap', layoutRow(twoCells({ rows: [{ id: 'r1', px: 1e308 }] })), 'grid.rows[0].px'],
  ['column track collapsed', layoutRow(twoCells({ columns: [{ id: 'c1', weight: 1, collapsed: true }, { id: 'c2', weight: 1 }] })), 'grid.columns[0].collapsed'],
  ['row collapsed not a boolean', layoutRow(twoCells({ rows: [{ id: 'r1', weight: 1, collapsed: 'yes' }] })), 'grid.rows[0].collapsed'],
  ['row fitPx not positive', layoutRow(twoCells({ rows: [{ id: 'r1', weight: 1, fitPx: 0 }] })), 'grid.rows[0].fitPx'],
  ['column track fitPx', layoutRow(twoCells({ columns: [{ id: 'c1', weight: 1, fitPx: 90 }, { id: 'c2', weight: 1 }] })), 'grid.columns[0].fitPx'],
  ['track id repeats another', layoutRow(twoCells({ columns: [{ id: 'c1', weight: 1 }, { id: 'c1', weight: 1 }] })), 'grid.columns[1].id'],
  ['cell id repeats a track id', layoutRow(twoCells({}, [
    { id: 'c1', area: { col: 0, row: 0, colSpan: 1, rowSpan: 1 }, tabs: [] },
    { id: 'k2', area: { col: 1, row: 0, colSpan: 1, rowSpan: 1 }, tabs: [] },
  ])), 'cells[0].id'],
  ['cell without an area', layoutRow(twoCells({}, [{ id: 'k1', tabs: [] }, { id: 'k2', area: { col: 1, row: 0, colSpan: 1, rowSpan: 1 }, tabs: [] }])), 'cells[0].area'],
  ['cell area not whole tracks', layoutRow(twoCells({}, [
    { id: 'k1', area: { col: 0, row: 0, colSpan: 0.5, rowSpan: 1 }, tabs: [] },
    { id: 'k2', area: { col: 1, row: 0, colSpan: 1, rowSpan: 1 }, tabs: [] },
  ])), 'cells[0].area'],
  ['cells leaving a gap', layoutRow(twoCells({}, [{ id: 'k1', area: { col: 0, row: 0, colSpan: 1, rowSpan: 1 }, tabs: [] }])), 'cells'],
  ['cells overlapping', layoutRow(twoCells({}, [
    { id: 'k1', area: { col: 0, row: 0, colSpan: 2, rowSpan: 1 }, tabs: [] },
    { id: 'k2', area: { col: 1, row: 0, colSpan: 1, rowSpan: 1 }, tabs: [] },
  ])), 'cells'],
  ['a cell outside the grid', layoutRow(twoCells({}, [
    { id: 'k1', area: { col: 0, row: 0, colSpan: 1, rowSpan: 1 }, tabs: [] },
    { id: 'k2', area: { col: 1, row: 0, colSpan: 2, rowSpan: 1 }, tabs: [] },
  ])), 'cells'],
  ['a line no cell edge lies on', layoutRow(twoCells({}, [{ id: 'k1', area: { col: 0, row: 0, colSpan: 2, rowSpan: 1 }, tabs: [] }])), 'grid.columns'],
  ['tracks without cells', layoutRow({ grid: { columns: [{ id: 'c', weight: 1 }], rows: [{ id: 'r', weight: 1 }] }, cells: [] }), 'cells'],
  ['unknown kind', layoutRow(oneTab({ id: 't', kind: 'horizons', config: {} })), 'cells[0].tabs[0].kind'],
  ['retired Taskboard widget', layoutRow(oneTab({ id: 't', kind: 'taskboard', config: {} })), 'cells[0].tabs[0].kind'],
  // Retired in v77 (its tabs became glance widgets): past v77 an unknown kind.
  ['retired Dashboard widget', layoutRow(oneTab({ id: 't', kind: 'dashboard', config: { tiles: ['open'], listTiles: [], sections: [] } })), 'cells[0].tabs[0].kind'],
  ['missing config', layoutRow(oneTab({ id: 't', kind: 'notes' })), 'cells[0].tabs[0].config'],
  ['calendar date types not booleans', layoutRow(oneTab({ id: 't', kind: 'calendar', config: { dateTypes: { due: 1, followup: false } } })), 'cells[0].tabs[0].config.dateTypes'],
  ['bad calendar view', layoutRow(oneTab({ id: 't', kind: 'calendar', config: { dateTypes: { due: true, followup: false } }, viewState: { view: 'year' } })), 'cells[0].tabs[0].viewState.view'],
  ['calendar titles not a boolean', layoutRow(oneTab({ id: 't', kind: 'calendar', config: { dateTypes: { due: true, followup: false } }, viewState: { titles: 'on' } })), 'cells[0].tabs[0].viewState.titles'],
  ['bad list id', layoutRow(oneTab({ id: 't', kind: 'lens', config: { listDefinitionId: '3' } })), 'cells[0].tabs[0].config.listDefinitionId'],
  ['duplicate id', layoutRow(oneTab({ id: 'k', kind: 'notes', config: {} })), 'cells[0].tabs[0].id'],
  ['details width not a number', layoutRow(oneTab({ id: 't', kind: 'lens', config: {}, viewState: { detailsWidth: '262' } })), 'cells[0].tabs[0].viewState.detailsWidth'],
  ['negative details width', layoutRow(oneTab({ id: 't', kind: 'lens', config: {}, viewState: { detailsWidth: -1 } })), 'cells[0].tabs[0].viewState.detailsWidth'],
  ['unknown list zoom', layoutRow(oneTab({ id: 't', kind: 'lens', config: {}, viewState: { zoom: 'huge' } })), 'cells[0].tabs[0].viewState.zoom'],
  ['Neglect map without colourBy', layoutRow(oneTab({ id: 't', kind: 'neglect', config: { untouchedDays: 14 } })), 'cells[0].tabs[0].config.colourBy'],
  ['Neglect map colouring by an unknown kind', layoutRow(oneTab({ id: 't', kind: 'neglect', config: { colourBy: { kind: 'status' }, untouchedDays: 14 } })), 'cells[0].tabs[0].config.colourBy'],
  ['Neglect map tags not a list', layoutRow(oneTab({ id: 't', kind: 'neglect', config: { colourBy: { kind: 'tags', tagIds: 3 }, untouchedDays: 14 } })), 'cells[0].tabs[0].config.colourBy'],
  ['Neglect map threshold past the cap', layoutRow(oneTab({ id: 't', kind: 'neglect', config: { colourBy: { kind: 'none' }, untouchedDays: 60 } })), 'cells[0].tabs[0].config.untouchedDays'],
  ['Neglect map threshold not whole', layoutRow(oneTab({ id: 't', kind: 'neglect', config: { colourBy: { kind: 'none' }, untouchedDays: 2.5 } })), 'cells[0].tabs[0].config.untouchedDays'],
]

/**
 * A table holding every kind, an empty cell, view state, a fixed and a
 * collapsed row, and a cell spanning rows:
 *
 *     k1 k1 k3
 *     k2 k4 k3
 *     k5 k5 k5   (fixed 112px)
 */
const EVERY_KIND = {
  grid: {
    columns: [{ id: 'c1', weight: 300 }, { id: 'c2', weight: 300 }, { id: 'c3', weight: 400 }],
    rows: [{ id: 'r1', weight: 600, collapsed: true }, { id: 'r2', weight: 400 }, { id: 'r3', px: 112 }],
  },
  cells: [
    { id: 'k1', area: { col: 0, row: 0, colSpan: 2, rowSpan: 1 }, activeTabId: 't2', tabs: [
      { id: 't1', kind: 'lens', config: { listDefinitionId: 3 }, viewState: { detailsWidth: 300 } },
      { id: 't2', kind: 'calendar', config: { dateTypes: { due: false, followup: true } }, viewState: { view: 'month', offset: -2, titles: true } },
      { id: 't3', kind: 'notes', config: {} },
      { id: 't4', kind: 'lens', config: {}, viewState: { detailsWidth: 0 } },
      { id: 't5', kind: 'trend', config: { range: '4w' } },
    ] },
    { id: 'k3', area: { col: 2, row: 0, colSpan: 1, rowSpan: 2 }, tabs: [
      { id: 't6', kind: 'notes', config: {} },
      { id: 't7', kind: 'neglect', config: { colourBy: { kind: 'tags', tagIds: [4, 9] }, untouchedDays: 21 } },
    ] },
    { id: 'k2', area: { col: 0, row: 1, colSpan: 1, rowSpan: 1 }, tabs: [] },
    { id: 'k4', area: { col: 1, row: 1, colSpan: 1, rowSpan: 1 }, tabs: [{ id: 't8', kind: 'notes', config: {} }] },
    { id: 'k5', area: { col: 0, row: 2, colSpan: 3, rowSpan: 1 }, tabs: [numberTab('t9', 'overdue', { breakdown: 'tags', ignoreLens: true })] },
  ],
}

describe('layouts row validation', () => {
  it('accepts a layout with many tracks, cells and tabs, as the workspace reducers build it', () => {
    // Nothing in the workspace limits the counts; import keeps up to 1,000 of each.
    let n = 0
    const genId = () => `w-${n++}`
    let layout: WorkspaceLayout = { id: 1, sortOrder: 0, name: 'Big', ...emptyBody(), createdAt: new Date(DATE), modifiedAt: new Date(DATE) }
    const notes = (): LayoutTab => ({ id: genId(), kind: 'notes', config: {} })
    for (let c = 0; c < 40; c++) layout = addTab(layout, notes(), { kind: 'layout' }, genId)
    const firstCell = layout.cells[0]!.id
    for (let t = 0; t < 40; t++) layout = addTab(layout, notes(), { kind: 'cell', cellId: firstCell }, genId)
    for (let k = 0; k < 40; k++) layout = addTab(layout, notes(), { kind: 'split', cellId: firstCell, side: 'bottom' }, genId)
    for (let k = 0; k < 10; k++) layout = addTab(layout, notes(), { kind: 'split', cellId: firstCell, side: 'right' }, genId)
    expect(layout.cells).toHaveLength(90)
    expect(layout.cells.find((cell) => cell.id === firstCell)!.tabs).toHaveLength(41)

    const row = JSON.parse(JSON.stringify(layout)) as Record<string, unknown>
    expect(validateRow('layouts', row)).toBe(true)
    const result = validateImportData({ todos: [], settings: [], layouts: [row] })
    if (!result.ok) throw new Error(result.error)
    expect(result.data.layouts[0]!.cells).toEqual(layout.cells)
    expect(result.data.layouts[0]!.grid).toEqual(layout.grid)
  })

  it('accepts every kind, an empty cell, fixed and collapsed rows, and an empty layout', () => {
    expect(validateRow('layouts', layoutRow(EVERY_KIND, { lastUsedAt: DATE, hue: 'violet' }))).toBe(true)
    expect(validateRow('layouts', layoutRow(EMPTY))).toBe(true)
  })

  it.each(REJECTED)('rejects %s', (_label, row, field) => {
    expect(validateRow('layouts', row)).toBe(field)
  })

  it('import keeps only model keys, puts the cells in reading order and drops a stale activeTabId', () => {
    const body = {
      grid: { columns: [{ id: 'c', weight: 2, extra: 1 }, { id: 'd', weight: 1 }], rows: [{ id: 'r', weight: 1, collapsed: false }] },
      cells: [
        { id: 'k2', area: { col: 1, row: 0, colSpan: 1, rowSpan: 1, x: 1 }, tabs: [] },
        {
          id: 'k', area: { col: 0, row: 0, colSpan: 1, rowSpan: 1 }, activeTabId: 'gone', junk: true,
          tabs: [
            { id: 't1', kind: 'notes', config: { stray: 1 }, viewState: { stray: 2 } },
            // A list tab saves no prompt picks.
            { id: 't3', kind: 'lens', config: { listDefinitionId: 4 }, viewState: { runtimeFilterValue: [1] } },
            { id: 't2', kind: 'calendar', config: { dateTypes: { due: true, followup: false, x: 1 } }, viewState: { offset: 500 } },
          ],
        },
      ],
    }
    const res = validateImportData({ todos: [], settings: [], layouts: [layoutRow(body, { stray: 'x' })] })
    if (!res.ok) throw new Error(res.error)
    expect(res.data.layouts).toEqual([{
      id: 1, name: 'Daily', sortOrder: 0, createdAt: new Date(DATE), modifiedAt: new Date(DATE),
      grid: { columns: [{ id: 'c', weight: 2 }, { id: 'd', weight: 1 }], rows: [{ id: 'r', weight: 1 }] },
      cells: [
        { id: 'k', area: { col: 0, row: 0, colSpan: 1, rowSpan: 1 }, tabs: [
          { id: 't1', kind: 'notes', config: {} },
          { id: 't3', kind: 'lens', config: { listDefinitionId: 4 } },
          { id: 't2', kind: 'calendar', config: { dateTypes: { due: true, followup: false } }, viewState: { offset: 104 } },
        ] },
        { id: 'k2', area: { col: 1, row: 0, colSpan: 1, rowSpan: 1 }, tabs: [] },
      ],
    }])
  })

  it('a Numbers-only row’s height (fitPx) is valid beside its weight and kept on import', () => {
    const row = layoutRow(twoCells({ rows: [{ id: 'r1', weight: 1000, fitPx: 116 }] }))
    expect(validateRow('layouts', row)).toBe(true)
    const res = validateImportData({ todos: [], settings: [], layouts: [row] })
    if (!res.ok) throw new Error(res.error)
    expect(res.data.layouts[0]!.grid.rows).toEqual([{ id: 'r1', weight: 1000, fitPx: 116 }])
  })

  it('import keeps a list tab’s details width, rounded', () => {
    const body = oneTab({ id: 't1', kind: 'lens', config: {}, viewState: { detailsWidth: 262.6 } })
    ;(body.cells as Array<{ tabs: unknown[] }>)[0]!.tabs.push(
      { id: 't2', kind: 'lens', config: {}, viewState: { detailsWidth: 180 } },
      { id: 't3', kind: 'lens', config: {}, viewState: { detailsWidth: 0.4 } },
      // Only tabs that show task rows keep it.
      { id: 't4', kind: 'notes', config: {}, viewState: { detailsWidth: 200 } },
    )
    const res = validateImportData({ todos: [], settings: [], layouts: [layoutRow(body)] })
    if (!res.ok) throw new Error(res.error)
    expect(res.data.layouts[0]!.cells[0]!.tabs.map((t) => t.viewState)).toEqual([
      { detailsWidth: 263 }, { detailsWidth: 180 }, { detailsWidth: 0 }, undefined,
    ])
  })

  it('a details width past 4000 — a very wide list’s divider — is valid and read as 4000', () => {
    const row = layoutRow(oneTab({ id: 't', kind: 'lens', config: {}, viewState: { detailsWidth: 4630 } }))
    expect(validateRow('layouts', row)).toBe(true)
    expect(rowFixes('layouts', row)).toEqual([])
    const res = validateImportData({ todos: [], settings: [], layouts: [row] })
    if (!res.ok) throw new Error(res.error)
    expect(res.data.layouts[0]!.cells[0]!.tabs[0]!.viewState).toEqual({ detailsWidth: 4000 })
  })

  it('validates the activeLayoutId setting as a number', () => {
    expect(validateRow('settings', { key: 'activeLayoutId', value: '3' })).toBe(true)
    expect(validateRow('settings', { key: 'activeLayoutId', value: 'x' })).toBe('value (activeLayoutId must be numeric)')
  })
})

describe('a layout past the limit of 1,000 columns, rows, cells or tabs', () => {
  const notes = (id: string) => ({ id, kind: 'notes', config: {} })
  /** A column of `n` cells, one per row, each holding `tabsOf(i)`. */
  const stack = (n: number, tabsOf: (i: number) => unknown[] = () => []) => ({
    grid: { columns: [{ id: 'c', weight: 1000 }], rows: Array.from({ length: n }, (_, i) => ({ id: `r${i}`, weight: 1 })) },
    cells: Array.from({ length: n }, (_, i) => ({ id: `k${i}`, area: { col: 0, row: i, colSpan: 1, rowSpan: 1 }, tabs: tabsOf(i) })),
  })

  it('imports with the tabs past the limit dropped, and a warning that says so', () => {
    const many = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => notes(`${prefix}${i}`))
    const row = layoutRow(stack(2, (i) => many(`t${i}-`, 600)))
    expect(validateRow('layouts', row)).toBe(true)
    expect(rowFixes('layouts', row)).toEqual(['200 tabs past the limit of 1,000 dropped'])
    const res = validateImportData({ todos: [], settings: [], layouts: [row] })
    if (!res.ok) throw new Error(res.error)
    expect(res.data.layouts[0]!.cells[1]!.tabs).toHaveLength(400)
    expect(res.warnings).toEqual(['Fixed 1 layout: "Daily" (200 tabs past the limit of 1,000 dropped)'])
  })

  it('tracks past the limit go, and the cells left restack in one column', () => {
    const row = layoutRow(stack(1002))
    expect(validateRow('layouts', row)).toBe(true)
    expect(rowFixes('layouts', row)).toEqual(['2 tracks past the limit of 1,000 dropped', '2 cells past the limit of 1,000 dropped', 'cells restacked in one column'])
    const repaired = sanitizeRow('layouts', row) as WorkspaceLayout
    expect(repaired.grid.rows).toHaveLength(1000)
    expect(validateTiling(repaired)).toBe(true)
  })
})

describe('layout sizes are bounded (cr33 S4)', () => {
  it('keeps a weight up to LAYOUT_SIZE_MAX, and repairs one past it, so no sum of weights is Infinity', () => {
    expect(validateRow('layouts', layoutRow(twoCells({ columns: [{ id: 'c1', weight: LAYOUT_SIZE_MAX }, { id: 'c2', weight: 1 }] })))).toBe(true)
    const past = layoutRow(twoCells({ columns: [{ id: 'c1', weight: 9e307 }, { id: 'c2', weight: 9e307 }] }))
    expect(rowFixes('layouts', past)).toEqual(['2 sizes reset'])
    const repaired = sanitizeRow('layouts', past) as unknown as WorkspaceLayout
    expect(repaired.grid.columns.map((c) => c.weight)).toEqual([1000, 1000])
    // A bad one beside good ones takes their average.
    const mixed = sanitizeRow('layouts', layoutRow(twoCells({ columns: [{ id: 'c1', weight: 300 }, { id: 'c2', weight: -1 }] }))) as unknown as WorkspaceLayout
    expect(mixed.grid.columns.map((c) => c.weight)).toEqual([300, 300])
  })
})

describe('repairing a layout row the schema rejects (audit cleanup)', () => {
  it.each(REJECTED)('repairs %s into a row the schema accepts, naming what changed', (_label, row) => {
    expect(rowFixes('layouts', row).length).toBeGreaterThan(0)
    expect(validateRow('layouts', JSON.parse(JSON.stringify(sanitizeRow('layouts', row))))).toBe(true)
  })

  it('a valid layout has nothing to fix, and its repair is the import pick', () => {
    const row = layoutRow(EVERY_KIND, { lastUsedAt: DATE, hue: 'amber' })
    expect(validateRow('layouts', row)).toBe(true)
    expect(rowFixes('layouts', row)).toEqual([])
    const res = validateImportData({ todos: [], settings: [], layouts: [row] })
    if (!res.ok) throw new Error(res.error)
    expect(sanitizeRow('layouts', row)).toEqual(res.data.layouts[0])
  })

  it('a lens pick an earlier build stored on a layout (any value) is no fix: import and the repair drop it', () => {
    for (const lensId of ['lens-a', 7]) {
      const row = layoutRow(EVERY_KIND, { lastUsedAt: DATE, lensId })
      expect(validateRow('layouts', row)).toBe(true)
      expect(rowFixes('layouts', row)).toEqual([])
      const res = validateImportData({ todos: [], settings: [], layouts: [row] })
      if (!res.ok) throw new Error(res.error)
      expect(res.warnings).toEqual([])
      expect(res.data.layouts[0]).not.toHaveProperty('lensId')
      expect(sanitizeRow('layouts', row)).not.toHaveProperty('lensId')
    }
  })

  it('a broken tiling is rebuilt: every cell kept, in its old reading order, stacked in one column', () => {
    // k2 is gone (a bad id): k1 and k3 can't tile the grid any more.
    const body = {
      grid: { columns: [{ id: 'c1', weight: 500 }, { id: 'c2', weight: 500 }], rows: [{ id: 'r1', weight: 600 }, { id: 'r2', px: 120, collapsed: true }] },
      cells: [
        { id: 'k3', area: { col: 0, row: 1, colSpan: 2, rowSpan: 1 }, tabs: [notes('t3')] },
        { id: 'k1', area: { col: 0, row: 0, colSpan: 1, rowSpan: 1 }, tabs: [notes('t1')] },
        { id: 'c1', area: { col: 1, row: 0, colSpan: 1, rowSpan: 1 }, tabs: [notes('t2')] },
      ],
    }
    const row = layoutRow(body)
    expect(rowFixes('layouts', row)).toEqual(['cell dropped', 'cells restacked in one column'])
    const repaired = sanitizeRow('layouts', row) as WorkspaceLayout
    expect(repaired.cells.map((c) => [c.id, c.area.row])).toEqual([['k1', 0], ['k3', 1]])
    // The stored row tracks keep their place: the second a fixed, collapsed one.
    expect(repaired.grid).toEqual({ columns: [{ id: 'c1', weight: 1000 }], rows: [{ id: 'r1', weight: 1000 }, { id: 'r2', px: 120, collapsed: true }] })
    expect(validateTiling(repaired)).toBe(true)
  })

  it('a line no cell edge lies on is merged away; a cell whose every tab was dropped closes', () => {
    const merged = sanitizeRow('layouts', layoutRow(twoCells({}, [{ id: 'k1', area: { col: 0, row: 0, colSpan: 2, rowSpan: 1 }, tabs: [] }]))) as WorkspaceLayout
    expect(rowFixes('layouts', layoutRow(twoCells({}, [{ id: 'k1', area: { col: 0, row: 0, colSpan: 2, rowSpan: 1 }, tabs: [] }])))).toEqual(['grid line merged'])
    expect(merged.grid.columns).toEqual([{ id: 'c1', weight: 1000 }])
    const unknown = layoutRow(twoCells({}, [
      { id: 'k1', area: { col: 0, row: 0, colSpan: 1, rowSpan: 1 }, tabs: [notes('t1')] },
      { id: 'k2', area: { col: 1, row: 0, colSpan: 1, rowSpan: 1 }, tabs: [{ id: 't2', kind: 'nope', config: {} }] },
    ]))
    // The closed cell's line goes with it: no fix of its own.
    expect(rowFixes('layouts', unknown)).toEqual(['tab dropped'])
    const closed = sanitizeRow('layouts', unknown) as WorkspaceLayout
    expect(closed.cells.map((c) => c.id)).toEqual(['k1'])
    expect(isNormalized(closed)).toBe(true)
  })

  it('counts each kind of fix', () => {
    const body = {
      grid: { columns: [{ id: 'c1', weight: 0 }, { id: 'c2', weight: 'big' }], rows: [{ id: 'r1', weight: 1, collapsed: 'yes' }] },
      cells: [
        { id: 'k1', area: { col: 0, row: 0, colSpan: 1, rowSpan: 1 }, tabs: [{ id: 't1', kind: 'nope', config: {} }, { id: 't2', kind: 'taskboard', config: {} }, 5, notes('t3')] },
        { id: 'k2', area: { col: 1, row: 0, colSpan: 1, rowSpan: 1 }, tabs: [] },
      ],
    }
    expect(rowFixes('layouts', layoutRow(body, { name: '', createdAt: 'never' }))).toEqual([
      'name reset', 'dates reset', '2 sizes reset', 'tab or cell settings reset', '3 tabs dropped',
    ])
  })

  it('a retired Eisenhower tab passes the check (a v78 file still imports) and is dropped with a warning', () => {
    const row = layoutRow(oneTab({ id: 't', kind: 'eisenhower', config: { listDefinitionId: 7 }, viewState: { collapsed: 'do' } }))
    expect(validateRow('layouts', row)).toBe(true)
    expect(rowFixes('layouts', row)).toEqual(['tab dropped'])
    const res = validateImportData({ todos: [], settings: [], layouts: [row] })
    if (!res.ok) throw new Error(res.error)
    expect(res.warnings).toEqual(['Fixed 1 layout: "Daily" (tab dropped)'])
    expect(res.data.layouts[0]!.cells.flatMap((k) => k.tabs)).toEqual([])
  })

  it('a list tab’s zoom round-trips with its details width; an unknown one is dropped (the tab opens at the Settings default)', () => {
    const tabOf = (row: Record<string, unknown>) => (sanitizeRow('layouts', row) as WorkspaceLayout).cells[0]!.tabs[0]
    for (const zoom of ['stacked', 'rows', 'lines']) {
      const row = layoutRow(oneTab({ id: 't', kind: 'lens', config: { listDefinitionId: 3 }, viewState: { detailsWidth: 280, zoom } }))
      expect(validateRow('layouts', row), zoom).toBe(true)
      expect(rowFixes('layouts', row)).toEqual([])
    }
    const strips = layoutRow(oneTab({ id: 't', kind: 'lens', config: {}, viewState: { zoom: 'strips' } }))
    expect(validateRow('layouts', strips)).toBe(true)
    expect(tabOf(strips)).toEqual({ id: 't', kind: 'lens', config: {}, viewState: { zoom: 'lines' } })
    const bad = layoutRow(oneTab({ id: 't', kind: 'lens', config: {}, viewState: { detailsWidth: 300, zoom: 'mosaic' } }))
    expect(rowFixes('layouts', bad)).toEqual(['tab or cell settings reset'])
    expect(tabOf(bad)).toEqual({ id: 't', kind: 'lens', config: {}, viewState: { detailsWidth: 300 } })
  })

  it('a Neglect map’s config keeps only its keys; a bad part falls back to its default', () => {
    const tabOf = (row: Record<string, unknown>) => (sanitizeRow('layouts', row) as WorkspaceLayout).cells[0]!.tabs[0]
    const valid = layoutRow(oneTab({ id: 't', kind: 'neglect', config: { colourBy: { kind: 'tags', tagIds: [3, 3, 5], extra: 1 }, untouchedDays: 7, x: 1 }, viewState: { detailsWidth: 300 } }))
    expect(rowFixes('layouts', valid)).toEqual([])
    expect(tabOf(valid)).toEqual({ id: 't', kind: 'neglect', config: { colourBy: { kind: 'tags', tagIds: [3, 5] }, untouchedDays: 7 } })
    const bad = layoutRow(oneTab({ id: 't', kind: 'neglect', config: { colourBy: { kind: 'rainbow' }, untouchedDays: 0 } }))
    expect(rowFixes('layouts', bad)).toEqual(['tab or cell settings reset'])
    expect(tabOf(bad)).toEqual({ id: 't', kind: 'neglect', config: { colourBy: { kind: 'none' }, untouchedDays: 14 } })
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
    const JUNK: unknown[] = [null, undefined, 'x', '', -1, 0, 1, 2, 1.5, Infinity, true, [], {}, ['do'], { due: false }, 't1', 'c2', 'k1']

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

function notes(id: string): Record<string, unknown> {
  return { id, kind: 'notes', config: {} }
}
