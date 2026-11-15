import { describe, expect, it } from 'vitest'
import { upgradeV82 } from '../../data/upgrades/v82'
import { CURRENT_DB_VERSION } from '../../data/database'
import { SCHEMA_UPGRADES, upgradeDataSet, type DataRow, type DataSet } from '../../data/schema-upgrades'
import { prepareImport } from '../../data/import-pipeline'
import { SCHEMA_VERSION_KEY } from '../../data/file-version'
import { pickLayoutBody } from '../../data/layout-shape'

/**
 * v82 — Numbers as a strip (flair P10): in each row track that fits (every
 * cell lying only in it holds one Number), each run of side-by-side Number
 * cells becomes one cell holding those Numbers, and the column lines nothing
 * else uses go. The transform's own tests, then the pipeline.
 */

const DATE = '2026-11-01T09:00:00.000Z'
const num = (id: string): DataRow => ({ id, kind: 'number', config: { name: id, filter: { showCompleted: false, personIds: null, statusIds: null, searchText: '', dates: {}, markers: null, tags: null }, show: 'count', litWhen: 'never', compare: 'yesterday' } })
const notes = (id: string): DataRow => ({ id, kind: 'notes', config: {} })

interface CellSpec { id: string; col: number; row: number; colSpan?: number; rowSpan?: number; tabs: DataRow[] }

function layout(columns: number, rows: DataRow[], cells: CellSpec[]): DataRow {
  return {
    id: 1,
    name: 'Main',
    sortOrder: 0,
    grid: { columns: Array.from({ length: columns }, (_, i) => ({ id: `c${i}`, weight: 100 * (i + 1) })), rows },
    cells: cells.map((c) => ({ id: c.id, area: { col: c.col, row: c.row, colSpan: c.colSpan ?? 1, rowSpan: c.rowSpan ?? 1 }, tabs: c.tabs, activeTabId: (c.tabs[0] as { id: string }).id })),
    createdAt: DATE,
    modifiedAt: DATE,
  }
}

const cellsOf = (row: DataRow) => (row.cells as Array<{ id: string; area: unknown; tabs: Array<{ id: string }>; activeTabId?: string }>)
  .map((c) => ({ id: c.id, area: c.area, tabs: c.tabs.map((t) => t.id), active: c.activeTabId }))

describe('v82: registered', () => {
  it('is the current schema, after v81', () => {
    expect(CURRENT_DB_VERSION).toBe(82)
    expect(SCHEMA_UPGRADES.get(82)).toBe(upgradeV82)
  })
})

describe('v82: strips', () => {
  it('a row of four Numbers over a notes row: one strip cell (the first’s id), its columns kept for the row below', () => {
    const before = layout(4, [{ id: 'r0', weight: 100, fitPx: 70 }, { id: 'r1', weight: 900 }], [
      { id: 'a', col: 0, row: 0, tabs: [num('na')] },
      { id: 'b', col: 1, row: 0, tabs: [num('nb')] },
      { id: 'c', col: 2, row: 0, tabs: [num('nc')] },
      { id: 'd', col: 3, row: 0, tabs: [num('nd')] },
      { id: 'n', col: 0, row: 1, colSpan: 4, tabs: [notes('t')] },
    ])
    const out = upgradeV82({ layouts: [before] }).layouts![0]!
    expect(cellsOf(out)).toEqual([
      { id: 'a', area: { col: 0, row: 0, colSpan: 1, rowSpan: 1 }, tabs: ['na', 'nb', 'nc', 'nd'], active: 'na' },
      { id: 'n', area: { col: 0, row: 1, colSpan: 1, rowSpan: 1 }, tabs: ['t'], active: 't' },
    ])
    // Every column line went (nothing else lay on them): one track, the weights added. The row and its fitPx stay.
    expect((out.grid as { columns: unknown; rows: unknown }).columns).toEqual([{ id: 'c0', weight: 1000 }])
    expect((out.grid as { rows: unknown }).rows).toEqual([{ id: 'r0', weight: 100, fitPx: 70 }, { id: 'r1', weight: 900 }])
    expect(pickLayoutBody(out as never).fixes).toEqual([])
  })

  it('a cell spanning through the row splits it into two runs; the column lines the spanning cell needs stay', () => {
    const before = layout(5, [{ id: 'r0', weight: 100 }, { id: 'r1', weight: 900 }], [
      { id: 'a', col: 0, row: 0, tabs: [num('na')] },
      { id: 'b', col: 1, row: 0, tabs: [num('nb')] },
      { id: 'tall', col: 2, row: 0, rowSpan: 2, tabs: [notes('t')] },
      { id: 'c', col: 3, row: 0, tabs: [num('nc')] },
      { id: 'd', col: 4, row: 0, tabs: [num('nd')] },
      { id: 'left', col: 0, row: 1, colSpan: 2, tabs: [notes('l')] },
      { id: 'right', col: 3, row: 1, colSpan: 2, tabs: [notes('r')] },
    ])
    const out = upgradeV82({ layouts: [before] }).layouts![0]!
    expect(cellsOf(out).map((c) => [c.id, c.tabs, c.area])).toEqual([
      ['a', ['na', 'nb'], { col: 0, row: 0, colSpan: 1, rowSpan: 1 }],
      ['tall', ['t'], { col: 1, row: 0, colSpan: 1, rowSpan: 2 }],
      ['c', ['nc', 'nd'], { col: 2, row: 0, colSpan: 1, rowSpan: 1 }],
      ['left', ['l'], { col: 0, row: 1, colSpan: 1, rowSpan: 1 }],
      ['right', ['r'], { col: 2, row: 1, colSpan: 1, rowSpan: 1 }],
    ])
    expect((out.grid as { columns: Array<{ weight: number }> }).columns.map((c) => c.weight)).toEqual([300, 300, 900])
  })

  it('a row holding another kind beside its Numbers, and a lone Number, are left alone (the same array)', () => {
    const mixed = layout(3, [{ id: 'r0', weight: 1000 }], [
      { id: 'a', col: 0, row: 0, tabs: [num('na')] },
      { id: 'b', col: 1, row: 0, tabs: [num('nb')] },
      { id: 'x', col: 2, row: 0, tabs: [notes('t')] },
    ])
    const lone = layout(1, [{ id: 'r0', weight: 1000 }], [{ id: 'a', col: 0, row: 0, tabs: [num('na')] }])
    const data: DataSet = { layouts: [mixed, lone] }
    expect(upgradeV82(data)).toBe(data)
  })

  it('is idempotent: a converted layout comes back as it is', () => {
    const before = layout(2, [{ id: 'r0', weight: 1000 }], [
      { id: 'a', col: 0, row: 0, tabs: [num('na')] },
      { id: 'b', col: 1, row: 0, tabs: [num('nb')] },
    ])
    const once = upgradeV82({ layouts: [before] })
    expect(upgradeV82(once)).toBe(once)
  })

  it('tolerates missing tables and malformed rows (left for the repair)', () => {
    const empty: DataSet = {}
    expect(upgradeV82(empty)).toBe(empty)
    const odd: DataSet = {
      layouts: [null as unknown as DataRow, { id: 2, cells: 'none' }, { id: 3, grid: { columns: [], rows: [] }, cells: [null] }, { id: 4, grid: 'x', cells: [] }],
    }
    expect(upgradeV82(odd)).toBe(odd)
  })
})

describe('v82 through the pipeline', () => {
  const v81File = () => ({
    [SCHEMA_VERSION_KEY]: 81,
    todos: [{ id: 1, uid: 'u1', title: 'Kept', isCompleted: false, sortOrder: 0, createdAt: DATE, modifiedAt: DATE }],
    layouts: [layout(2, [{ id: 'r0', weight: 1000 }], [
      { id: 'a', col: 0, row: 0, tabs: [num('na')] },
      { id: 'b', col: 1, row: 0, tabs: [num('nb')] },
    ])],
    settings: [{ key: 'weekStartsOn', value: '1' }],
  })

  it('a v81 file imports with its Numbers row as one strip, and no warning', () => {
    const result = prepareImport(JSON.parse(JSON.stringify(v81File())))
    if (!result.ok) throw new Error(result.error)
    expect(result.upgraded).toBe(true)
    expect(result.warnings).toEqual([])
    expect(result.data.layouts[0]!.cells.map((c) => c.tabs.map((t) => t.id))).toEqual([['na', 'nb']])
  })

  it('a file at the floor (v68) runs the whole chain to v82', () => {
    const chained = upgradeDataSet(JSON.parse(JSON.stringify({ ...v81File(), [SCHEMA_VERSION_KEY]: 68 })) as DataSet, 81, CURRENT_DB_VERSION)
    expect((chained.layouts![0]!.cells as unknown[]).length).toBe(1)
  })
})
