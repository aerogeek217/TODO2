import { describe, expect, it } from 'vitest'
import { upgradeV76 } from '../../data/upgrades/v76-layout-rows'
import { SCHEMA_UPGRADES, upgradeDataSet, type DataRow } from '../../data/schema-upgrades'
import { prepareImport } from '../../data/import-pipeline'
import { readLayoutDraft } from '../../data/draft-storage'
import { rowFixes, validateRow } from '../../data/import-validation'
import { LAYOUT_PART_LIMIT } from '../../data/layout-shape'
import { SCHEMA_VERSION_KEY } from '../../data/file-version'

const DATE = '2026-11-01T09:00:00.000Z'
const notes = (id: string) => ({ id, kind: 'notes', config: {} })
const layout = (body: Record<string, unknown>, id = 1): DataRow => ({ id, name: 'Daily', sortOrder: 0, createdAt: DATE, modifiedAt: DATE, ...body })
const upgraded = (row: DataRow): DataRow => upgradeV76({ layouts: [row] }).layouts![0]!

describe('v76 — every column is rows', () => {
  it('is registered as the v76 step', () => {
    expect(SCHEMA_UPGRADES.get(76)).toBe(upgradeV76)
  })

  it('each cell of a column becomes a one-cell row: its weight the row’s, its collapse the row’s, the cell weight 1', () => {
    const before = layout({
      columns: [
        { id: 'A', weight: 1.5, cells: [
          { id: 'k1', weight: 2, activeTabId: 't2', tabs: [notes('t1'), notes('t2')] },
          { id: 'k2', weight: 0.5, collapsed: true, tabs: [notes('t3')] },
          // An empty cell, just made by a split.
          { id: 'k3', weight: 1, tabs: [] },
        ] },
        { id: 'B', weight: 1, cells: [{ id: 'k4', weight: 1, tabs: [notes('t4')] }] },
      ],
    })
    expect(upgraded(before)).toEqual(layout({
      columns: [
        { id: 'A', weight: 1.5, rows: [
          { id: 'k1-r', weight: 2, cells: [{ id: 'k1', weight: 1, activeTabId: 't2', tabs: [notes('t1'), notes('t2')] }] },
          { id: 'k2-r', weight: 0.5, collapsed: true, cells: [{ id: 'k2', weight: 1, tabs: [notes('t3')] }] },
          { id: 'k3-r', weight: 1, cells: [{ id: 'k3', weight: 1, tabs: [] }] },
        ] },
        { id: 'B', weight: 1, rows: [{ id: 'k4-r', weight: 1, cells: [{ id: 'k4', weight: 1, tabs: [notes('t4')] }] }] },
      ],
    }))
    expect(rowFixes('layouts', upgraded(before))).toEqual([])
  })

  it('a band keeps its id, height and collapse; its tabs and active tab become its one cell', () => {
    const before = layout({
      columns: [],
      top: { id: 'T', height: 220, activeTabId: 't2', collapsed: true, tabs: [notes('t1'), notes('t2')] },
      bottom: { id: 'B', height: 140, tabs: [notes('t3')] },
    })
    expect(upgraded(before)).toEqual(layout({
      columns: [],
      top: { id: 'T', height: 220, collapsed: true, cells: [{ id: 'T-c', weight: 1, tabs: [notes('t1'), notes('t2')], activeTabId: 't2' }] },
      bottom: { id: 'B', height: 140, cells: [{ id: 'B-c', weight: 1, tabs: [notes('t3')] }] },
    }))
    expect(validateRow('layouts', upgraded(before))).toBe(true)
  })

  it('a fresh id never repeats one the layout holds, at any level, nor another fresh one', () => {
    const before = layout({
      columns: [
        // A tab already named `k-r`, a column named `k-r2`.
        { id: 'k-r2', weight: 1, cells: [{ id: 'k', weight: 1, tabs: [notes('k-r')] }] },
        { id: 'C', weight: 1, cells: [{ id: 'm', weight: 1, tabs: [notes('T-c')] }] },
      ],
      top: { id: 'T', height: 160, tabs: [notes('t1')] },
    })
    const out = upgraded(before)
    const cols = out.columns as Array<{ rows: Array<{ id: string }> }>
    expect(cols[0]!.rows[0]!.id).toBe('k-r3')
    expect(cols[1]!.rows[0]!.id).toBe('m-r')
    expect((out.top as { cells: Array<{ id: string }> }).cells[0]!.id).toBe('T-c2')
    expect(validateRow('layouts', out)).toBe(true)
    // The same layout always upgrades to the same ids.
    expect(upgraded(before)).toEqual(out)
  })

  it('a fresh id stays within the longest id a part may have', () => {
    const long = 'x'.repeat(100)
    const out = upgraded(layout({ columns: [{ id: 'A', weight: 1, cells: [{ id: long, weight: 1, tabs: [notes('t1')] }] }], top: { id: long.replace(/x$/, 'y'), height: 160, tabs: [notes('t2')] } }))
    const rowId = (out.columns as Array<{ rows: Array<{ id: string }> }>)[0]!.rows[0]!.id
    expect(rowId).toBe(`${'x'.repeat(98)}-r`)
    expect((out.top as { cells: Array<{ id: string }> }).cells[0]!.id).toBe(`${'x'.repeat(98)}-c`)
    expect(validateRow('layouts', out)).toBe(true)
  })

  it('keeps a layout at the part limit whole: as many rows as it had cells, none dropped', () => {
    const cells = Array.from({ length: LAYOUT_PART_LIMIT }, (_, k) => ({ id: `k${k}`, weight: 1, tabs: [] }))
    const out = upgraded(layout({ columns: [{ id: 'A', weight: 1, cells }] }))
    expect((out.columns as Array<{ rows: unknown[] }>)[0]!.rows).toHaveLength(LAYOUT_PART_LIMIT)
    expect(rowFixes('layouts', out)).toEqual([])
  })

  it('is idempotent, and leaves a layout in the rows shape (and every other table) as it is', () => {
    const data = { layouts: [layout({ columns: [{ id: 'A', weight: 1, cells: [{ id: 'k', weight: 1, tabs: [notes('t')] }] }], top: { id: 'T', height: 160, tabs: [notes('u')] } })], todos: [] }
    const once = upgradeV76(data)
    expect(once.todos).toBe(data.todos)
    expect(upgradeV76(once)).toBe(once)
    const empty = { layouts: [layout({ columns: [] })] }
    expect(upgradeV76(empty)).toBe(empty)
    const none = { todos: [] }
    expect(upgradeV76(none)).toBe(none)
  })

  it('passes through what it can’t read, for the layout repair to judge', () => {
    const odd = layout({
      columns: [
        'not a column',
        { id: 'A', weight: 1, cells: 'nope' },
        { id: 'B', weight: 1, cells: ['not a cell', { id: 'k', weight: -1, tabs: [notes('t')] }] },
      ],
      top: 7,
    })
    const out = upgraded(odd)
    const cols = out.columns as unknown[]
    expect(cols[0]).toBe('not a column')
    expect(cols[1]).toBe((odd.columns as unknown[])[1])
    expect(cols[2]).toEqual({ id: 'B', weight: 1, rows: ['not a cell', { id: 'k-r', weight: -1, cells: [{ id: 'k', weight: 1, tabs: [notes('t')] }] }] })
    expect(out.top).toBe(7)
    expect(rowFixes('layouts', out)).toEqual(['2 columns dropped', 'row dropped', 'size reset', 'band dropped'])
  })

  it('a v75 export imports in the rows shape', () => {
    const file = {
      [SCHEMA_VERSION_KEY]: 75,
      todos: [],
      settings: [],
      layouts: [layout({
        columns: [{ id: 'A', weight: 1, cells: [{ id: 'k1', weight: 3, tabs: [notes('t1')] }, { id: 'k2', weight: 1, collapsed: true, tabs: [notes('t2')] }] }],
        bottom: { id: 'B', height: 150, collapsed: true, tabs: [notes('t3')] },
      })],
    }
    const result = prepareImport(JSON.parse(JSON.stringify(file)))
    if (!result.ok) throw new Error(result.error)
    expect(result.warnings).toEqual([])
    const [row] = result.data.layouts
    expect(row?.columns).toEqual([{ id: 'A', weight: 1, rows: [
      { id: 'k1-r', weight: 3, cells: [{ id: 'k1', weight: 1, tabs: [notes('t1')] }] },
      { id: 'k2-r', weight: 1, collapsed: true, cells: [{ id: 'k2', weight: 1, tabs: [notes('t2')] }] },
    ] }])
    expect(row?.bottom).toEqual({ id: 'B', height: 150, collapsed: true, cells: [{ id: 'B-c', weight: 1, tabs: [notes('t3')] }] })
  })

  it('runs in the chain from the floor: a v68 file’s layout arrives in the rows shape', () => {
    const out = upgradeDataSet({ layouts: [layout({ columns: [{ id: 'A', weight: 1, cells: [{ id: 'k', weight: 1, tabs: [notes('t')] }] }] })] }, 68, 76)
    expect((out.layouts![0]!.columns as Array<{ rows: unknown[] }>)[0]!.rows).toEqual([{ id: 'k-r', weight: 1, cells: [{ id: 'k', weight: 1, tabs: [notes('t')] }] }])
  })
})

describe('a layout draft kept at v75', () => {
  it('reads back upgraded, its base the same ids its stored layout upgrades to', () => {
    const v75Columns = [{ id: 'A', weight: 1, cells: [{ id: 'k', weight: 2, collapsed: true, activeTabId: 'n', tabs: [notes('n')] }, { id: 'k2', weight: 1, tabs: [notes('m')] }] }]
    const v75Base = [{ id: 'A', weight: 1, cells: [{ id: 'k', weight: 2, collapsed: true, activeTabId: 'n', tabs: [notes('n')] }] }]
    localStorage.setItem('todo2-unsaved-layout', JSON.stringify({
      kind: 'saved', layoutId: 2, schemaVersion: 75,
      columns: v75Columns, top: { id: 'T', height: 120, tabs: [notes('t')] },
      baseColumns: v75Base,
    }))
    const rowK = { id: 'k-r', weight: 2, collapsed: true, cells: [{ id: 'k', weight: 1, activeTabId: 'n', tabs: [notes('n')] }] }
    expect(readLayoutDraft()).toEqual({
      kind: 'saved',
      layoutId: 2,
      base: { columns: [{ id: 'A', weight: 1, rows: [rowK] }] },
      body: {
        columns: [{ id: 'A', weight: 1, rows: [rowK, { id: 'k2-r', weight: 1, cells: [{ id: 'k2', weight: 1, tabs: [notes('m')] }] }] }],
        top: { id: 'T', height: 120, cells: [{ id: 'T-c', weight: 1, tabs: [notes('t')] }] },
      },
    })
    // The stored layout the base was made against upgrades to the same rows.
    expect(upgraded(layout({ columns: v75Base })).columns).toEqual([{ id: 'A', weight: 1, rows: [rowK] }])
  })
})
