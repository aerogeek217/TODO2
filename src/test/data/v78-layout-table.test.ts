import { describe, it, expect } from 'vitest'
import { upgradeV78 } from '../../data/upgrades/v78'
import { layoutTableOf } from '../../data/upgrades/v78/layout-table'
import { upgradeDataSet, SCHEMA_UPGRADES } from '../../data/schema-upgrades'
import { CURRENT_DB_VERSION } from '../../data/database'
import { rowFixes, validateRow } from '../../data/import-validation'
import { readLayoutDraft } from '../../data/draft-storage'
import { LAYOUT_PART_LIMIT } from '../../data/layout-shape'
import { isNormalized, validateTiling } from '../../utils/workspace-grid'
import { isFitTrack } from '../../utils/workspace-rows'
import type { LayoutBody } from '../../models/workspace-layout'
import { picture } from '../helpers/layout-builders'

type Obj = Record<string, unknown>

const DATE = '2026-11-01T09:00:00.000Z'
const notes = (id: string): Obj => ({ id, kind: 'notes', config: {} })
const number = (id: string): Obj => ({ id, kind: 'number', config: { metric: 'open' } })
const cellOf = (id: string, tabs: Obj[] = [notes(`${id}-t`)], extra: Obj = {}): Obj => ({ id, weight: 1, tabs, ...extra })
const rowOf = (id: string, cells: Obj[], extra: Obj = {}): Obj => ({ id, weight: 1, cells, ...extra })
const col = (id: string, rows: Obj[], weight = 1): Obj => ({ id, weight, rows })
const layout = (body: Obj, extra: Obj = {}): Obj => ({ id: 1, name: 'L', sortOrder: 0, ...body, createdAt: DATE, modifiedAt: DATE, ...extra })

/** The v78 table of a v77 layout row. */
function table(body: Obj): LayoutBody & Obj {
  return layoutTableOf(layout(body)) as LayoutBody & Obj
}

/** Holds: a valid tiling, every line an edge, and a row the v78 schema takes as it is. */
function expectValid(row: Obj): void {
  const body = row as unknown as LayoutBody
  expect(validateTiling(body)).toBe(true)
  expect(isNormalized(body)).toBe(true)
  expect(validateRow('layouts', row)).toBe(true)
  expect(rowFixes('layouts', row)).toEqual([])
}

const weights = (body: LayoutBody, axis: 'columns' | 'rows') => body.grid[axis].map((t) => t.px != null ? `${t.px}px` : t.weight)

describe('v78 layout-table: columns, rows and bands become a table', () => {
  it('columns of one-cell rows: their lines meet where the weights agree', () => {
    const out = table({ columns: [
      col('A', [rowOf('A1', [cellOf('a')]), rowOf('A2', [cellOf('b')])]),
      col('B', [rowOf('B1', [cellOf('c')])]),
    ] })
    expect(picture(out)).toEqual(['a c', 'b c'])
    expect(weights(out, 'columns')).toEqual([500, 500])
    expect(weights(out, 'rows')).toEqual([500, 500])
    expectValid(out)
  })

  it('rows whose lines differ across columns make a track per distinct line; cells span them', () => {
    const out = table({ columns: [
      col('A', [rowOf('A1', [cellOf('a')], { weight: 1 }), rowOf('A2', [cellOf('b')], { weight: 3 })]),
      col('B', [rowOf('B1', [cellOf('c')], { weight: 1 }), rowOf('B2', [cellOf('d')], { weight: 1 })]),
    ] })
    // Lines down at 0.25 (A) and 0.5 (B).
    expect(picture(out)).toEqual(['a c', 'b c', 'b d'])
    expect(weights(out, 'rows')).toEqual([250, 250, 500])
    expectValid(out)
  })

  it('a multi-cell row beside another column: its cells split its column’s width', () => {
    const out = table({ columns: [
      col('A', [rowOf('A1', [cellOf('a', undefined, { weight: 1 }), cellOf('b', undefined, { weight: 3 })]), rowOf('A2', [cellOf('c')])], 2),
      col('B', [rowOf('B1', [cellOf('d')])], 1),
    ] })
    expect(picture(out)).toEqual(['a b d', 'c c d'])
    // A is 2/3 of the width: a 1/6, b 1/2, d 1/3.
    expect(weights(out, 'columns')).toEqual([167, 500, 333])
    expectValid(out)
  })

  it('bands become fixed tracks at the top and bottom, keeping their ids, heights and collapse', () => {
    const out = table({
      columns: [col('A', [rowOf('A1', [cellOf('a')])]), col('B', [rowOf('B1', [cellOf('b')])])],
      top: { id: 'top', height: 120, cells: [cellOf('t1'), cellOf('t2', undefined, { weight: 3 })] },
      bottom: { id: 'bot', height: 90, collapsed: true, cells: [cellOf('z')] },
    })
    // The top band's cells split at 1/4: a line of its own across the table.
    expect(picture(out)).toEqual(['t1 t2 t2', 'a a b', 'z z z'])
    expect(out.grid.rows).toEqual([
      { id: 'top', px: 120 },
      { id: 'grid-r1', weight: 1000 },
      { id: 'bot', px: 90, collapsed: true },
    ])
    expect(weights(out, 'columns')).toEqual([250, 250, 500])
    expect('top' in out || 'bottom' in out || 'columns' in out).toBe(false)
    expectValid(out)
  })

  it('a fit row counts as a nominal 76px of 800 and derives as fit again', () => {
    const out = table({ columns: [col('A', [
      rowOf('N', [cellOf('n1', [number('x1')]), cellOf('n2', [number('x2')])]),
      rowOf('L', [cellOf('l')]),
    ])] })
    expect(picture(out)).toEqual(['n1 n2', 'l l'])
    expect(weights(out, 'rows')).toEqual([95, 905])
    expect(isFitTrack(out, 0)).toBe(true)
    expect(isFitTrack(out, 1)).toBe(false)
    expectValid(out)
  })

  it('collapse: a row track is collapsed when every cell covering it was', () => {
    const out = table({ columns: [
      col('A', [rowOf('A1', [cellOf('a')], { collapsed: true }), rowOf('A2', [cellOf('b')])]),
      col('B', [rowOf('B1', [cellOf('c')], { collapsed: true }), rowOf('B2', [cellOf('d')])]),
      col('C', [rowOf('C1', [cellOf('e')], { collapsed: true })]),
    ] })
    expect(picture(out)).toEqual(['a c e', 'b d e'])
    // Row 1 holds b and d (expanded) and e (collapsed): not collapsed.
    expect(out.grid.rows.map((t) => t.collapsed === true)).toEqual([true, false])
    expectValid(out)
  })

  it('drops stripShown, a cell’s weight and the phone’s activeColumnId; keeps tabs, active tab and empty cells', () => {
    const out = table({
      columns: [col('A', [rowOf('A1', [cellOf('a', [notes('t1'), notes('t2')], { activeTabId: 't2', stripShown: false }), cellOf('e', [])])])],
      activeColumnId: 'A',
    })
    expect(out.cells).toEqual([
      { id: 'a', area: { col: 0, row: 0, colSpan: 1, rowSpan: 1 }, tabs: [notes('t1'), notes('t2')], activeTabId: 't2' },
      { id: 'e', area: { col: 1, row: 0, colSpan: 1, rowSpan: 1 }, tabs: [] },
    ])
    expect('activeColumnId' in out).toBe(false)
    expectValid(out)
  })

  it('bands with no columns keep the empty column area as one empty cell', () => {
    const out = table({ columns: [], top: { id: 'top', height: 160, cells: [cellOf('t')] } })
    expect(picture(out)).toEqual(['t', 'grid-empty'])
    expect(out.grid.rows).toEqual([{ id: 'top', px: 160 }, { id: 'grid-r1', weight: 1000 }])
    expectValid(out)
  })

  it('an empty layout has no tracks and no cells', () => {
    const out = table({ columns: [] })
    expect(out.grid).toEqual({ columns: [], rows: [] })
    expect(out.cells).toEqual([])
    expectValid(out)
  })

  it('fresh track ids skip every id the layout holds', () => {
    const out = table({ columns: [col('A', [rowOf('grid-r1', [cellOf('grid-c1')])])] })
    expect(out.grid.columns[0]?.id).toBe('grid-c1_2')
    expect(out.grid.rows[0]?.id).toBe('grid-r1_2')
    expectValid(out)
  })

  it('is defensive: unreadable parts are left out, bad weights count as 1, a bad band height as 160px', () => {
    const out = table({
      columns: [col('A', [rowOf('A1', [cellOf('a'), 'junk' as unknown as Obj], { weight: -3 }), { id: 'x' }]), 7 as unknown as Obj, col('B', [rowOf('B1', [cellOf('b')])], Infinity)],
      top: { id: 'top', height: 'tall', cells: [cellOf('t')] },
    })
    expect(picture(out)).toEqual(['t t', 'a b'])
    expect(out.grid.rows[0]).toEqual({ id: 'top', px: 160 })
    expectValid(out)
  })

  it('keeps the structure exact for many parts within the limits', () => {
    const rows = Array.from({ length: 40 }, (_, r) => rowOf(`R${r}`, [cellOf(`k${r}`)], { weight: 1 + (r % 3) }))
    const out = table({ columns: [col('A', rows), col('B', [rowOf('B1', [cellOf('b')])])] })
    expect(out.cells).toHaveLength(41)
    expect(out.grid.rows.length + out.grid.columns.length).toBeLessThanOrEqual(LAYOUT_PART_LIMIT)
    expectValid(out)
  })

  it('is idempotent; a row without columns passes through; other tables are left alone', () => {
    const once = upgradeV78({ layouts: [layout({ columns: [col('A', [rowOf('A1', [cellOf('a')])])] })], todos: [] })
    expect(upgradeV78(once)).toBe(once)
    expect(once.todos).toEqual([])
    const odd = { id: 2, name: 'odd' }
    expect(layoutTableOf(odd)).toBe(odd)
    const none = { todos: [] }
    expect(upgradeV78(none)).toBe(none)
  })

  it('is registered as v78, the current schema; a v77 file upgrades through it', () => {
    expect(CURRENT_DB_VERSION).toBe(78)
    expect(SCHEMA_UPGRADES.get(78)).toBe(upgradeV78)
    const out = upgradeDataSet({ layouts: [layout({ columns: [col('A', [rowOf('A1', [cellOf('a')])])] })] }, 77, 78)
    expect(picture(out.layouts![0] as unknown as LayoutBody)).toEqual(['a'])
  })
})

describe('a kept v77 layout draft reads back upgraded', () => {
  it('its body and base become tables, the base matching what the stored layout upgrades to', () => {
    const base = { columns: [col('A', [rowOf('A1', [cellOf('a')])])], bottom: { id: 'bot', height: 100, cells: [cellOf('z')] } }
    const body = { columns: [col('A', [rowOf('A1', [cellOf('a')]), rowOf('A2', [cellOf('b')])])], bottom: base.bottom }
    localStorage.setItem('todo2-unsaved-layout', JSON.stringify({
      kind: 'saved', layoutId: 1, schemaVersion: 77,
      ...body, baseColumns: base.columns, baseBottom: base.bottom,
    }))
    const draft = readLayoutDraft()
    expect(draft?.kind).toBe('saved')
    if (draft?.kind !== 'saved') return
    expect(picture(draft.body)).toEqual(['a', 'b', 'z'])
    expect(picture(draft.base)).toEqual(['a', 'z'])
    const stored = layoutTableOf(layout(base)) as unknown as LayoutBody
    expect(draft.base).toEqual({ grid: stored.grid, cells: stored.cells })
  })

  it('a new layout’s draft too', () => {
    localStorage.setItem('todo2-unsaved-layout', JSON.stringify({ kind: 'new', name: 'N', schemaVersion: 76, columns: [col('A', [rowOf('A1', [cellOf('a')])])] }))
    const draft = readLayoutDraft()
    expect(draft?.kind === 'new' && picture(draft.body)).toEqual(['a'])
  })
})
