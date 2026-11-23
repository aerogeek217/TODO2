import { describe, expect, it, vi, beforeEach } from 'vitest'
import { prepareImport } from '../../data/import-pipeline'
import { CURRENT_DB_VERSION } from '../../data/database'
import { storedListRefs } from '../../data/layout-repository'
import { rowFixes, sanitizeRow, validateRow } from '../../data/import-validation'
import { LAYOUT_FILE_PART_LIMIT, LAYOUT_FILE_WORK_LIMIT, layoutPartCount, layoutSizeProblem } from '../../data/layout-size'
import { LAYOUT_CLOSE_WORK_MAX, LAYOUT_PART_LIMIT } from '../../data/layout-shape'
import type { WorkspaceLayout } from '../../models/workspace-layout'
import { validateTiling } from '../../utils/workspace-grid'
import { expectWithin } from '../timing'

/**
 * A crafted file can't hang the import (cr34 S1 / M10, answer 21), which is
 * every launch when it is the sync file:
 *
 * - a layout holding far more parts than the app keeps is **refused with a
 *   message before anything else reads it** (`data/layout-size`);
 * - the layout check is one pass;
 * - the check and the repair stay within a time bound at the part limit,
 *   just past it, and at the most the import admits.
 *
 * The sizes are the security review's (its table: 40,000 tracks took 28 s,
 * 32,000 cells 12.8 s and 17.9 s, 16,000 emptied cells 3.8 s).
 */

const DATE = '2026-09-01T09:00:00.000Z'
const BASE = { id: 1, name: 'Big', sortOrder: 0, createdAt: DATE, modifiedAt: DATE }
type Body = Record<string, unknown>

const file = (...layouts: Body[]) => ({
  __schemaVersion: CURRENT_DB_VERSION, todos: [], settings: [],
  layouts: layouts.map((body, i) => ({ ...BASE, id: i + 1, ...body })),
})
const tab = (id: string, kind = 'notes') => ({ id, kind, config: {} })
const area = (col: number, row: number) => ({ col, row, colSpan: 1, rowSpan: 1 })

// ── The review's inputs ─────────────────────────────────────────────────────

/** (a) A table of `n` column tracks, two cells, one holding a removed-kind tab. */
const manyTracks = (n: number): Body => ({
  grid: { columns: Array.from({ length: n }, (_, i) => ({ id: `c${i}`, weight: 1 })), rows: [{ id: 'r', weight: 1 }] },
  cells: [
    { id: 'k1', area: area(0, 0), tabs: [tab('t1')] },
    { id: 'k2', area: area(1, 0), tabs: [tab('t2', 'eisenhower')] },
  ],
})
/** (b) A layout in the columns shape layouts had before the table: one row of `n` cells. */
const wideRow = (n: number): Body => ({
  columns: [{ id: 'col', weight: 1, rows: [{ id: 'row', weight: 1, cells: Array.from({ length: n }, (_, i) => ({ id: `k${i}`, weight: 1 + (i % 7), tabs: [tab(`t${i}`)] })) }] }],
})
/** (c), (d) A table of `n` cells stacked in one column, a tab of `kind` in each: a valid tiling. */
const stack = (n: number, kind = 'notes'): Body => ({
  grid: { columns: [{ id: 'c', weight: 1 }], rows: Array.from({ length: n }, (_, i) => ({ id: `r${i}`, weight: 1 })) },
  cells: Array.from({ length: n }, (_, i) => ({ id: `k${i}`, area: area(0, i), tabs: [tab(`t${i}`, kind)] })),
})
/**
 * The close's worst case: `n` cells of a removed kind that tile nothing —
 * each shares an edge coordinate with half of the others on every side and
 * matches none, so every close walks every cell and nothing closes.
 */
const chained = (n: number): Body => ({
  grid: { columns: [{ id: 'c', weight: 1 }], rows: [{ id: 'r', weight: 1 }] },
  cells: Array.from({ length: n }, (_, i) => ({ id: `k${i}`, area: area(i % 2, (i % 2) + 4 * i), tabs: [tab(`t${i}`, 'eisenhower')] })),
})

beforeEach(() => {
  // The import logs each warning; these files make long ones.
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('counting a raw layout row’s parts, in every schema version’s shape', () => {
  it('the table: tracks, cells and tabs', () => {
    expect(layoutPartCount(stack(10))).toBe(1 + 10 + 10 + 10)
    expect(layoutPartCount(manyTracks(500))).toBe(500 + 1 + 2 + 2)
    expect(layoutPartCount({ grid: { columns: [], rows: [] }, cells: [] })).toBe(0)
  })

  it('columns → rows → cells and the bands as rows of cells (the shape before the table)', () => {
    const cells = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `k${i}`, weight: 1, tabs: [tab(`t${i}`), tab(`u${i}`)] }))
    const layout = {
      columns: [{ id: 'A', weight: 1, rows: [{ id: 'r1', weight: 1, cells: cells(3) }, { id: 'r2', weight: 1, cells: cells(2) }] }, { id: 'B', weight: 1, rows: [] }],
      top: { id: 'top', height: 120, cells: cells(4) },
    }
    // 2 columns + 2 rows + (3 + 2 + 4) cells + twice that in tabs.
    expect(layoutPartCount(layout)).toBe(2 + 2 + 9 + 18)
    expect(layoutPartCount(wideRow(100))).toBe(1 + 1 + 100 + 100)
  })

  it('columns of cells and the bands’ own tab strips (the shape before that)', () => {
    const layout = {
      columns: [{ id: 'A', weight: 1, cells: [{ id: 'k1', weight: 1, tabs: [tab('t1'), tab('t2')] }, { id: 'k2', weight: 1, tabs: [] }] }],
      bottom: { id: 'bottom', height: 120, tabs: [tab('t3'), tab('t4'), tab('t5')] },
    }
    expect(layoutPartCount(layout)).toBe(1 + 2 + 2 + 3)
  })

  it('a retired Dashboard tab counts the cells its parts made: its lists, or their defaults', () => {
    const dash = (config: unknown) => ({ columns: [{ id: 'A', rows: [{ id: 'r', cells: [{ id: 'k', tabs: [{ id: 'd', kind: 'dashboard', config }] }] }] }] })
    const own = 1 + 1 + 1 + 1
    // No lists: the 5 tiles and 5 sections a new Dashboard had.
    expect(layoutPartCount(dash({}))).toBe(own + 10)
    expect(layoutPartCount(dash(null))).toBe(own + 10)
    expect(layoutPartCount(dash({ tiles: ['open'], listTiles: [3, 4, 5], sections: [] }))).toBe(own + 4)
    // At most its 8 tiles and 9 sections count; every list tile is a cell.
    const many = Array.from({ length: 5000 }, (_, i) => i + 1)
    expect(layoutPartCount(dash({ tiles: many, listTiles: many, sections: many }))).toBe(own + 8 + 5000 + 9)
  })

  it('a tab’s settings are not walked, and a row that is no layout counts nothing', () => {
    const config = { columns: Array.from({ length: 50 }, () => ({})), rows: 'people', cells: [1, 2, 3], tabs: [4] }
    expect(layoutPartCount({ grid: { columns: [{ id: 'c', weight: 1 }], rows: [{ id: 'r', weight: 1 }] }, cells: [{ id: 'k', area: area(0, 0), tabs: [{ id: 't', kind: 'breakdown', config }] }] })).toBe(4)
    for (const row of [null, 7, 'layout', [], { cells: 'none', grid: 3 }]) expect(layoutPartCount(row)).toBe(0)
  })

  it('counts a list nested at any depth without recursion', () => {
    // Cells inside cells, 50,000 deep: a recursive walk would overflow the stack.
    let nested: Record<string, unknown> = { id: 'leaf', tabs: [] }
    for (let i = 0; i < 50_000; i++) nested = { id: `k${i}`, cells: [nested] }
    expect(layoutPartCount(nested)).toBe(50_000)
  })
})

describe('a layout holding far more parts than the app keeps is refused before anything else reads it (answer 21)', () => {
  // Four times the largest size the review measured for each of its inputs.
  const INPUTS: Array<[string, () => Body, number]> = [
    ['(a) 160,000 tracks in a table', () => manyTracks(160_000), 160_000 + 1 + 2 + 2],
    ['(b) one row of 128,000 cells in the columns shape', () => wideRow(128_000), 1 + 1 + 2 * 128_000],
    ['(c) a valid tiling of 128,000 cells', () => stack(128_000), 1 + 3 * 128_000],
    ['(d) 64,000 cells of a removed kind in a table', () => stack(64_000, 'eisenhower'), 1 + 3 * 64_000],
  ]

  it.each(INPUTS)('%s: refused in under a second, with a message that says why', (_label, make, parts) => {
    const data = file(make())
    expectWithin(1000, () => {
      const result = prepareImport(data)
      expect(result).toEqual({
        ok: false,
        reason: 'invalid',
        error: `Layout "Big" holds too many parts to read: ${parts.toLocaleString('en-US')} columns, rows, cells and tabs. `
          + 'TODO2 reads at most 10,000 in one layout (and keeps 1,000 of each).',
      })
    })
  })

  it('the limits: ten times what a layout keeps of one sort; the file’s layouts together, one layout at the limit', () => {
    expect(LAYOUT_PART_LIMIT).toBe(1000)
    expect(LAYOUT_FILE_PART_LIMIT).toBe(10_000)
    expect(LAYOUT_FILE_WORK_LIMIT).toBe(10_000 ** 2)
  })

  it('a layout at the limit is read; one part more is refused', () => {
    // 1 column + 3 parts a cell (a row track, the cell, its tab).
    const atLimit = stack(3333)
    expect(layoutPartCount(atLimit)).toBe(LAYOUT_FILE_PART_LIMIT)
    expect(layoutSizeProblem([atLimit])).toBeNull()
    const past = { ...atLimit, cells: [...(atLimit.cells as unknown[]), { id: 'extra', area: area(0, 3333), tabs: [] }] }
    expect(layoutSizeProblem([past])).toMatch(/^A layout holds too many parts to read: 10,001 columns/)
    expect(layoutSizeProblem([{ ...past, name: 'x'.repeat(100) }])).toMatch(new RegExp(`^Layout "${'x'.repeat(60)}…" holds too many parts`))
  })

  it('a layout past what the app keeps and within the limit still imports, trimmed, with a warning', () => {
    const result = prepareImport(file(stack(3333)))
    if (!result.ok) throw new Error(result.error)
    expect(result.warnings).toEqual(['Fixed 1 layout: "Big" (2333 tracks past the limit of 1,000 dropped, 2333 cells past the limit of 1,000 dropped, cells restacked in one column)'])
    expect(result.data.layouts[0]!.cells).toHaveLength(1000)
    expect(validateTiling(result.data.layouts[0]!)).toBe(true)
  })

  it('many layouts: the sum of their parts squared is held to one layout at the limit', () => {
    // A stack of 1,000 cells is 3,001 parts: eleven of them are within the limit, twelve are not.
    const big = stack(1000)
    expect(layoutSizeProblem(Array.from({ length: 11 }, () => big))).toBeNull()
    expect(layoutSizeProblem(Array.from({ length: 12 }, () => big))).toBe(
      'The layouts in this file are too large to read together: 12 layouts holding 36,012 columns, rows, cells and tabs. '
      + 'TODO2 reads one layout of 10,000, or many smaller ones.',
    )
    // Layouts of the size people build are far within it: ten thousand of a hundred parts.
    const small = stack(33)
    expect(layoutPartCount(small)).toBe(100)
    expect(layoutSizeProblem(Array.from({ length: 10_000 }, () => small))).toBeNull()
    const refused = prepareImport(file(...Array.from({ length: 12 }, () => big)))
    expect(refused).toMatchObject({ ok: false, reason: 'invalid', error: expect.stringMatching(/^The layouts in this file are too large to read together: 12 layouts/) })
  })

  it('applies whatever the import is for: an append refuses the same file', () => {
    const result = prepareImport(file(manyTracks(40_000)), { purpose: 'append' })
    expect(result).toMatchObject({ ok: false, reason: 'invalid', error: expect.stringMatching(/^Layout "Big" holds too many parts to read: 40,005 /) })
  })
})

describe('the layout check takes one pass (the review’s sizes, run past the size check)', () => {
  it('the layout check of a valid tiling of 32,000 cells (its table is not checked past the part limit)', () => {
    const row = { ...BASE, ...stack(32_000) }
    expectWithin(1000, () => {
      expect(validateRow('layouts', row)).toBe(true)
    })
  })

  it('the repair’s close, at the most cells of a removed kind the import admits: its worst case', () => {
    // 4,999 cells and their tabs: 2 tracks short of the limit.
    const data = file(chained(4999))
    expectWithin(2000, () => {
      const result = prepareImport(data)
      if (!result.ok) throw new Error(result.error)
      expect(result.data.layouts[0]!.cells).toHaveLength(1000)
    })
  })

  it('the layout check’s line check: a line no cell’s edge lies on is still found', () => {
    const cells = [{ id: 'k', area: { col: 0, row: 0, colSpan: 2, rowSpan: 1 }, tabs: [] }]
    const grid = { columns: [{ id: 'c1', weight: 1 }, { id: 'c2', weight: 1 }], rows: [{ id: 'r', weight: 1 }] }
    expect(validateRow('layouts', { ...BASE, grid, cells })).toBe('grid.columns')
    const tall = [{ id: 'k', area: { col: 0, row: 0, colSpan: 1, rowSpan: 2 }, tabs: [] }]
    expect(validateRow('layouts', { ...BASE, grid: { columns: grid.rows, rows: grid.columns }, cells: tall })).toBe('grid.rows')
  })
})

describe('the check and the repair within a time bound: at the part limit, just past it, at the most the import admits', () => {
  it('the repair of a layout whose every tab is of an unknown kind: 1,000 cells, 1,001, and the most the import admits', () => {
    for (const n of [LAYOUT_PART_LIMIT - 1, LAYOUT_PART_LIMIT, LAYOUT_PART_LIMIT + 1, 3333]) {
      const row = { ...BASE, ...stack(n, 'horizons') }
      expectWithin(1000, () => {
        expect(rowFixes('layouts', row)).toContain(`${Math.min(n, LAYOUT_PART_LIMIT)} tabs dropped`)
        const repaired = sanitizeRow('layouts', row) as WorkspaceLayout
        // Closing a thousand emptied cells one by one took seconds: past the work bound they stay, empty.
        expect(repaired.cells).toHaveLength(Math.min(n, LAYOUT_PART_LIMIT))
        expect(repaired.cells.every((c) => c.tabs.length === 0)).toBe(true)
        expect(validateTiling(repaired)).toBe(true)
      })
    }
  })

  it('the repair still closes the cells it empties in a layout of any size built by hand', () => {
    // 100 cells over 101 lines, every tab unknown: 100 × 100 × 101 is within the bound.
    expect(100 * 100 * 101).toBeLessThanOrEqual(LAYOUT_CLOSE_WORK_MAX)
    const all = { ...BASE, ...stack(100, 'horizons') }
    const closed = sanitizeRow('layouts', all) as WorkspaceLayout
    // Each closes into its neighbour until one is left, which has none to take it.
    expect(closed.cells.map((c) => c.id)).toEqual(['k99'])
    expect(closed.grid.rows).toHaveLength(1)
    // A few emptied cells in a layout at the part limit close too.
    const few = stack(1000) as { cells: Array<{ id: string; tabs: Array<{ kind: string }> }> }
    few.cells[10]!.tabs[0]!.kind = 'horizons'
    const repaired = sanitizeRow('layouts', { ...BASE, ...few }) as WorkspaceLayout
    expect(rowFixes('layouts', { ...BASE, ...few })).toEqual(['tab dropped'])
    expect(repaired.cells).toHaveLength(999)
    expect(repaired.cells.some((c) => c.id === 'k10')).toBe(false)
  })

  it('the layout check and the repair of a valid layout at the part limit: tracks, cells and tabs', () => {
    const side = 31
    const grid = {
      grid: { columns: Array.from({ length: side }, (_, i) => ({ id: `c${i}`, weight: 1 })), rows: Array.from({ length: side }, (_, i) => ({ id: `r${i}`, weight: 1 })) },
      cells: Array.from({ length: side * side }, (_, i) => ({ id: `k${i}`, area: area(i % side, Math.floor(i / side)), tabs: [tab(`t${i}`)] })),
    }
    for (const body of [stack(LAYOUT_PART_LIMIT), stack(LAYOUT_PART_LIMIT + 1), grid]) {
      const row = { ...BASE, ...body }
      expectWithin(1000, () => {
        expect(validateRow('layouts', row)).toBe(true)
        rowFixes('layouts', row)
        sanitizeRow('layouts', row)
      })
    }
  })

  it('a file of the most layouts at the part limit the import admits', () => {
    for (const kind of ['notes', 'horizons', 'eisenhower']) {
      const data = file(...Array.from({ length: 11 }, () => stack(1000, kind)))
      expectWithin(3000, () => {
        const result = prepareImport(data)
        if (!result.ok) throw new Error(result.error)
        expect(result.data.layouts).toHaveLength(11)
      })
    }
  })
})

describe('a long list or deep nesting in a layout row is handled, never an obscure RangeError (cr34 S4)', () => {
  it('a 300,000-item list in a layout row: the file imports (the list is no part of a layout, and goes)', () => {
    const data = file({ ...stack(2), stray: Array.from({ length: 300_000 }, (_, i) => i) })
    expectWithin(2000, () => {
      const result = prepareImport(data)
      if (!result.ok) throw new Error(result.error)
      expect(result.data.layouts[0]).not.toHaveProperty('stray')
    })
  })

  it('parts nested thousands deep in a layout row: the file imports without them', () => {
    let nested: Record<string, unknown> = { id: 'leaf' }
    for (let i = 0; i < 20_000; i++) nested = { id: `n${i}`, child: nested }
    const result = prepareImport(file({ ...stack(2), deep: nested }))
    if (!result.ok) throw new Error(result.error)
    expect(result.data.layouts[0]).not.toHaveProperty('deep')
  })
})

describe('the list ids a stored row names (cr34 S4, layout-repository)', () => {
  it('a 300,000-item array in a row is walked without overflowing the call stack', () => {
    const long: unknown[] = Array.from({ length: 300_000 }, (_, i) => i)
    long.push({ listDefinitionId: 7 })
    const row = { ...BASE, cells: [{ id: 'k', tabs: [{ id: 't', kind: 'lens', config: { listDefinitionId: 3 } }], junk: long }] }
    expect([...storedListRefs(row)].sort()).toEqual([3, 7])
  })
})
