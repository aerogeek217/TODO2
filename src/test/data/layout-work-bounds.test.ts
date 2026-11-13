import { describe, expect, it, vi, beforeEach } from 'vitest'
import { prepareImport } from '../../data/import-pipeline'
import { rowFixes, sanitizeRow, validateRow } from '../../data/import-validation'
import { LAYOUT_FILE_PART_LIMIT, LAYOUT_FILE_WORK_LIMIT, layoutPartCount, layoutSizeProblem } from '../../data/layout-size'
import { LAYOUT_CLOSE_WORK_MAX, LAYOUT_PART_LIMIT } from '../../data/layout-shape'
import { upgradeDataSet, type DataRow } from '../../data/schema-upgrades'
import { layoutTabsOf, type Obj, type TabStep } from '../../data/upgrades/layout-tabs'
import { layoutTableOf } from '../../data/upgrades/v78/layout-table'
import { layoutV79Of } from '../../data/upgrades/v79/layouts'
import type { WorkspaceLayout } from '../../models/workspace-layout'
import { validateTiling } from '../../utils/workspace-grid'
import { expectWithin } from '../timing'
import { layoutTabsOf as layoutTabsBefore } from './reference/layout-tabs-before-cr34'
import { layoutTableOf as layoutTableBefore } from './reference/layout-table-before-cr34'

/**
 * A crafted file can't hang the import (cr34 S1 / M10, answer 21), which is
 * every launch when it is the sync file:
 *
 * - a layout holding far more parts than the app keeps is **refused with a
 *   message before the upgrades run** (`data/layout-size`);
 * - the loops that were quadratic in the upgrades and the layout check are
 *   one pass, and produce what they produced (held to the copies from
 *   before, `./reference`);
 * - the upgrades, the check and the repair stay within a time bound at the
 *   part limit, just past it, and at the most the import admits.
 *
 * The sizes are the security review's (its table: 40,000 tracks took 28 s,
 * 32,000 cells 12.8 s and 17.9 s, 16,000 emptied cells 3.8 s).
 */

const DATE = '2026-09-01T09:00:00.000Z'
const BASE = { id: 1, name: 'Big', sortOrder: 0, createdAt: DATE, modifiedAt: DATE }
type Body = Record<string, unknown>

const file = (version: number, ...layouts: Body[]) => ({
  __schemaVersion: version, todos: [], settings: [],
  layouts: layouts.map((body, i) => ({ ...BASE, id: i + 1, ...body })),
})
const tab = (id: string, kind = 'notes') => ({ id, kind, config: {} })
const area = (col: number, row: number) => ({ col, row, colSpan: 1, rowSpan: 1 })

// ── The review's inputs ─────────────────────────────────────────────────────

/** (a) A table of `n` column tracks, two cells, one holding a removed-kind tab: v79's close, then its line merge. */
const manyTracks = (n: number): Body => ({
  grid: { columns: Array.from({ length: n }, (_, i) => ({ id: `c${i}`, weight: 1 })), rows: [{ id: 'r', weight: 1 }] },
  cells: [
    { id: 'k1', area: area(0, 0), tabs: [tab('t1')] },
    { id: 'k2', area: area(1, 0), tabs: [tab('t2', 'eisenhower')] },
  ],
})
/** (b) A v77 layout: one row of `n` cells (v78's table conversion looks up a line four times per cell). */
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
  it('the table (v78 on): tracks, cells and tabs', () => {
    expect(layoutPartCount(stack(10))).toBe(1 + 10 + 10 + 10)
    expect(layoutPartCount(manyTracks(500))).toBe(500 + 1 + 2 + 2)
    expect(layoutPartCount({ grid: { columns: [], rows: [] }, cells: [] })).toBe(0)
  })

  it('columns → rows → cells and the bands as rows of cells (v76, v77)', () => {
    const cells = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `k${i}`, weight: 1, tabs: [tab(`t${i}`), tab(`u${i}`)] }))
    const layout = {
      columns: [{ id: 'A', weight: 1, rows: [{ id: 'r1', weight: 1, cells: cells(3) }, { id: 'r2', weight: 1, cells: cells(2) }] }, { id: 'B', weight: 1, rows: [] }],
      top: { id: 'top', height: 120, cells: cells(4) },
    }
    // 2 columns + 2 rows + (3 + 2 + 4) cells + twice that in tabs.
    expect(layoutPartCount(layout)).toBe(2 + 2 + 9 + 18)
    expect(layoutPartCount(wideRow(100))).toBe(1 + 1 + 100 + 100)
  })

  it('columns of cells and the bands’ own tab strips (before v76)', () => {
    const layout = {
      columns: [{ id: 'A', weight: 1, cells: [{ id: 'k1', weight: 1, tabs: [tab('t1'), tab('t2')] }, { id: 'k2', weight: 1, tabs: [] }] }],
      bottom: { id: 'bottom', height: 120, tabs: [tab('t3'), tab('t4'), tab('t5')] },
    }
    expect(layoutPartCount(layout)).toBe(1 + 2 + 2 + 3)
  })

  it('a retired Dashboard tab counts the cells v77 makes of it: its lists, or their defaults', () => {
    const dash = (config: unknown) => ({ columns: [{ id: 'A', rows: [{ id: 'r', cells: [{ id: 'k', tabs: [{ id: 'd', kind: 'dashboard', config }] }] }] }] })
    const own = 1 + 1 + 1 + 1
    // No lists: the 5 tiles and 5 sections a new Dashboard had.
    expect(layoutPartCount(dash({}))).toBe(own + 10)
    expect(layoutPartCount(dash(null))).toBe(own + 10)
    expect(layoutPartCount(dash({ tiles: ['open'], listTiles: [3, 4, 5], sections: [] }))).toBe(own + 4)
    // v77 reads at most its 8 tiles and 9 sections; every list tile is a cell.
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

describe('a layout holding far more parts than the app keeps is refused before the upgrades run (answer 21)', () => {
  // Four times the largest size the review measured for each of its inputs.
  const INPUTS: Array<[string, number, () => Body, number]> = [
    ['(a) 160,000 tracks in a v78 table', 78, () => manyTracks(160_000), 160_000 + 1 + 2 + 2],
    ['(b) one row of 128,000 cells in a v77 layout', 77, () => wideRow(128_000), 1 + 1 + 2 * 128_000],
    ['(c) a valid tiling of 128,000 cells at the current version', 80, () => stack(128_000), 1 + 3 * 128_000],
    ['(d) 64,000 cells of a removed kind in a v78 table', 78, () => stack(64_000, 'eisenhower'), 1 + 3 * 64_000],
  ]

  it.each(INPUTS)('%s: refused in under a second, with a message that says why', (_label, version, make, parts) => {
    const data = file(version, make())
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
    const result = prepareImport(file(80, stack(3333)))
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
    const refused = prepareImport(file(80, ...Array.from({ length: 12 }, () => big)))
    expect(refused).toMatchObject({ ok: false, reason: 'invalid', error: expect.stringMatching(/^The layouts in this file are too large to read together: 12 layouts/) })
  })

  it('applies whatever the import is for: an append refuses the same file', () => {
    const result = prepareImport(file(78, manyTracks(40_000)), { purpose: 'append' })
    expect(result).toMatchObject({ ok: false, reason: 'invalid', error: expect.stringMatching(/^Layout "Big" holds too many parts to read: 40,005 /) })
  })
})

describe('the loops that were quadratic take one pass (the review’s sizes, run past the size check)', () => {
  it('(a) v79’s line merge over 160,000 tracks', () => {
    const row = { ...BASE, ...manyTracks(160_000) }
    expectWithin(1000, () => {
      const out = layoutV79Of(row) as unknown as WorkspaceLayout
      // k2 closed into k1; every line but k1's far edge merged away: two tracks are left.
      expect(out.cells.map((c) => [c.id, c.area])).toEqual([['k1', { col: 0, row: 0, colSpan: 1, rowSpan: 1 }]])
      expect(out.grid.columns).toEqual([{ id: 'c0', weight: 2 }, { id: 'c2', weight: 159_998 }])
    })
  })

  it('(b) v78’s table conversion of one row of 32,000 cells', () => {
    const row = { ...BASE, ...wideRow(32_000) }
    expectWithin(1500, () => {
      const out = layoutTableOf(row) as unknown as WorkspaceLayout
      expect(out.cells).toHaveLength(32_000)
      expect(out.grid.columns).toHaveLength(32_000)
      expect(out.cells.at(-1)!.area).toEqual({ col: 31_999, row: 0, colSpan: 1, rowSpan: 1 })
    })
  })

  it('(c) the layout check of a valid tiling of 32,000 cells (its table is not checked past the part limit)', () => {
    const row = { ...BASE, ...stack(32_000) }
    expectWithin(1000, () => {
      expect(validateRow('layouts', row)).toBe(true)
    })
  })

  it('(d) the close, at the most cells of a removed kind the import admits: its worst case', () => {
    // 4,999 cells and their tabs: 2 tracks short of the limit.
    const data = file(78, chained(4999))
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

describe('the upgrades, the check and the repair within a time bound: at the part limit, just past it, at the most the import admits', () => {
  /** A layout of `n` cells, each a tab of `kind`, in the shape schema `version` held. */
  function layoutAt(version: number, n: number, kind: string): Body {
    if (version >= 78) return stack(n, kind)
    const cells = Array.from({ length: n }, (_, i) => ({ id: `k${i}`, weight: 1 + (i % 3), tabs: [tab(`t${i}`, kind)] }))
    // v76, v77: columns → rows → cells (one cell a row); before: a column of cells.
    if (version >= 76) return { columns: [{ id: 'col', weight: 1, rows: cells.map((c, i) => ({ id: `r${i}`, weight: 1, cells: [c] })) }] }
    return { columns: [{ id: 'col', weight: 1, cells }], top: { id: 'top', height: 120, tabs: [tab('band')] } }
  }
  /** The kind each step has work to do on: v77 converts Dashboards, v78 and v79 drop kinds (and close their cells). */
  const STEPS: Array<[number, string]> = [[75, 'notes'], [76, 'dashboard'], [77, 'followup'], [78, 'eisenhower'], [79, 'notes']]
  // At the part limit, just past it, and the most the import admits (a cell with its row track and tab is
  // 3 parts). A Dashboard counts the ten cells v77 makes of it: a hundred of them reach the part limit.
  const sizes = (kind: string) => (kind === 'dashboard' ? [100, 101, 760] : [LAYOUT_PART_LIMIT, LAYOUT_PART_LIMIT + 1, 3300])

  it.each(STEPS)('the step from v%i (cells of %s)', (version, kind) => {
    for (const n of sizes(kind)) {
      const data = { layouts: [{ ...BASE, ...layoutAt(version, n, kind) } as DataRow] }
      expect(layoutSizeProblem(data.layouts), `${n} cells`).toBeNull()
      expectWithin(1000, () => {
        const out = upgradeDataSet(data, version, version + 1)
        expect(out.layouts).toHaveLength(1)
      })
    }
  })

  it.each(STEPS)('a whole import from v%i (cells of %s)', (version, kind) => {
    for (const n of sizes(kind)) {
      const data = file(version, layoutAt(version, n, kind))
      expectWithin(2000, () => {
        const result = prepareImport(data)
        if (!result.ok) throw new Error(result.error)
        expect(validateRow('layouts', JSON.parse(JSON.stringify(result.data.layouts[0])))).toBe(true)
      })
    }
  })

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
    for (const [version, kind] of [[80, 'notes'], [80, 'horizons'], [78, 'eisenhower']] as const) {
      const data = file(version, ...Array.from({ length: 11 }, () => stack(1000, kind)))
      expectWithin(3000, () => {
        const result = prepareImport(data)
        if (!result.ok) throw new Error(result.error)
        expect(result.data.layouts).toHaveLength(11)
      })
    }
  })
})

// ── The same output as before ───────────────────────────────────────────────

/** mulberry32: a small seeded generator, so a failure reproduces. */
function seeded(seed: number): () => number {
  let s = seed
  return () => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

describe('the one-pass loops produce what the loops before them did', () => {
  const KINDS = ['notes', 'lens', 'number', 'eisenhower', 'tagMap', 'followup', 'today', 'eisenhowerSummary'] as const
  /** v78's and v79's steps, and one that drops by the tab's place: what the walk is run with. */
  const STEPS: TabStep[] = [
    (t) => (t.kind === 'eisenhowerSummary' ? { id: t.id, kind: 'eisenhower', config: {} } : typeof t.kind === 'string' && ['followup', 'today'].includes(t.kind) ? null : t),
    (t) => (typeof t.kind === 'string' && ['eisenhower', 'tagMap', 'eisenhowerSummary'].includes(t.kind) ? null : t),
    (t) => (typeof t.id === 'string' && t.id.length % 2 === 0 ? null : t),
  ]

  it('the tab walk: the close and the line merge, on tilings and on tables that tile nothing', () => {
    const random = seeded(20261112)
    const int = (n: number) => Math.floor(random() * n)
    const pick = <T,>(list: readonly T[]): T => list[int(list.length)]!
    const track = (id: string): unknown => pick<() => unknown>([
      () => ({ id, weight: 1 + int(900) }), () => ({ id, weight: 1 + int(900) }), () => ({ id, px: 40 + int(200) }),
      () => ({ id, weight: 1 + int(9), collapsed: true }), () => ({ id, px: 60, collapsed: true }), () => ({ id }), () => 'track', () => null,
    ])()
    const tabs = (cell: number) => Array.from({ length: int(4) }, (_, i) => (random() < 0.05 ? 7 : { id: `t${cell}${'x'.repeat(i)}`, kind: pick(KINDS), config: {} }))

    /** A tiling of `cols` × `rows` tracks: rectangles packed in reading order. */
    const tiling = (cols: number, rows: number) => {
      const taken = Array.from({ length: rows }, () => Array.from({ length: cols }, () => false))
      const free = (r: number, c: number, w: number) => Array.from({ length: w }, (_, k) => taken[r]?.[c + k]).every((v) => v === false)
      const rects: Array<{ col: number; row: number; colSpan: number; rowSpan: number }> = []
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (taken[r]![c]) continue
          let w = 1
          while (c + w < cols && !taken[r]![c + w] && random() < 0.4) w++
          let h = 1
          while (r + h < rows && free(r + h, c, w) && random() < 0.4) h++
          for (let y = r; y < r + h; y++) for (let x = c; x < c + w; x++) taken[y]![x] = true
          rects.push({ col: c, row: r, colSpan: w, rowSpan: h })
        }
      }
      return rects
    }

    let closed = 0
    for (let i = 0; i < 4000; i++) {
      const cols = 1 + int(6)
      const rows = 1 + int(6)
      const hostile = random() < 0.35
      const rects = hostile
        ? Array.from({ length: int(9) }, () => ({ col: int(5), row: int(5), colSpan: 1 + int(3), rowSpan: 1 + int(3) }))
        : tiling(cols, rows)
      const cells: unknown[] = rects.map((r, k) => ({
        id: `k${k}`, area: random() < 0.02 ? { col: 'x' } : r, tabs: random() < 0.03 ? 'none' : tabs(k),
        ...(random() < 0.5 ? { activeTabId: `t${k}${'x'.repeat(int(3))}` } : {}),
      }))
      if (random() < 0.03) cells.push(null)
      // Sometimes more tracks than the cells use (lines no edge lies on), sometimes fewer.
      const extra = random() < 0.3 ? int(4) : 0
      const row: DataRow = {
        ...BASE,
        grid: random() < 0.02 ? 'grid' : {
          columns: Array.from({ length: Math.max(0, cols + extra - (hostile ? int(3) : 0)) }, (_, k) => track(`c${k}`)),
          rows: Array.from({ length: Math.max(0, rows + extra - (hostile ? int(3) : 0)) }, (_, k) => track(`r${k}`)),
        },
        // In any order: the walk closes in reading order whatever the list's.
        cells: random() < 0.5 ? cells : [...cells].reverse(),
      }
      const step = pick(STEPS)
      const before = layoutTabsBefore(row, step)
      const after = layoutTabsOf(row, step)
      expect(after, `case ${i}: ${JSON.stringify(row)}`).toEqual(before)
      // A layout no step changes is returned as it is, by both.
      expect(after === row).toBe(before === row)
      if ((after.cells as unknown[]).length < cells.length) closed++
    }
    // The cases reach the close and the merge (not only the pass-through).
    expect(closed).toBeGreaterThan(500)
  })

  it('the tab walk on larger tables: many closes and long runs of lines to merge', () => {
    const random = seeded(7)
    const int = (n: number) => Math.floor(random() * n)
    for (let i = 0; i < 60; i++) {
      const cols = 5 + int(30)
      const rows = 5 + int(30)
      const unused = int(40)
      const row: DataRow = {
        ...BASE,
        grid: {
          columns: Array.from({ length: cols + unused }, (_, k) => ({ id: `c${k}`, weight: 1 + int(50) })),
          rows: Array.from({ length: rows }, (_, k) => (k % 5 === 0 ? { id: `r${k}`, px: 80 } : { id: `r${k}`, weight: 1 + int(50), ...(k % 7 === 0 ? { collapsed: true } : {}) })),
        },
        cells: Array.from({ length: cols * rows }, (_, k) => ({
          id: `k${k}`, area: area(k % cols, Math.floor(k / cols)), tabs: [{ id: `t${k}`, kind: random() < 0.6 ? 'eisenhower' : 'notes', config: {} }],
        })),
      }
      const step: TabStep = (t: Obj) => (t.kind === 'eisenhower' ? null : t)
      expect(layoutTabsOf(row, step), `case ${i}`).toEqual(layoutTabsBefore(row, step))
    }
  })

  it('v78’s table conversion: the nearest line by a binary search', () => {
    const random = seeded(78)
    const int = (n: number) => Math.floor(random() * n)
    const pick = <T,>(list: readonly T[]): T => list[int(list.length)]!
    const WEIGHTS: readonly unknown[] = [1, 1, 1, 2, 3, 0.5, 0.25, 333.3, 1000, 7, 1e-7, 1e6, 0, -1, 'wide', undefined, 1e7]
    const cell = (id: string, fit: boolean): unknown => {
      if (random() < 0.02) return 'cell'
      const tabs = fit ? [{ id: `${id}-n`, kind: 'number', config: { metric: 'open' } }] : Array.from({ length: int(3) }, (_, k) => ({ id: `${id}-t${k}`, kind: pick(['notes', 'lens', 'followup']), config: {} }))
      return { id, weight: pick(WEIGHTS), tabs: random() < 0.02 ? 'tabs' : tabs, ...(random() < 0.3 ? { stripShown: true } : {}), ...(random() < 0.3 ? { activeTabId: `${id}-t0` } : {}) }
    }
    const rowOf = (id: string): unknown => {
      if (random() < 0.02) return null
      const fit = random() < 0.2
      return {
        id, weight: pick(WEIGHTS), ...(random() < 0.2 ? { collapsed: true } : {}),
        cells: random() < 0.02 ? 'cells' : Array.from({ length: int(4) }, (_, k) => cell(`${id}k${k}`, fit)),
      }
    }
    const band = (id: string): unknown => ({
      id: random() < 0.1 ? '' : id, height: pick([120, 160, 0, 'tall', 1e7]), ...(random() < 0.3 ? { collapsed: true } : {}),
      cells: Array.from({ length: int(4) }, (_, k) => cell(`${id}k${k}`, false)),
    })
    for (let i = 0; i < 3000; i++) {
      // A few wide cases: many columns and rows make many lines to look up among.
      const wide = i % 50 === 0
      const row: DataRow = {
        ...BASE,
        columns: Array.from({ length: wide ? 20 + int(40) : int(5) }, (_, c) => (random() < 0.02 ? 'column' : {
          id: `C${c}`, weight: pick(WEIGHTS),
          rows: random() < 0.02 ? undefined : Array.from({ length: wide ? 1 + int(30) : int(5) }, (_, r) => rowOf(`C${c}r${r}`)),
        })),
        ...(random() < 0.3 ? { top: band('top') } : {}),
        ...(random() < 0.3 ? { bottom: band('bottom') } : {}),
        ...(random() < 0.2 ? { activeColumnId: 'C0' } : {}),
      }
      expect(layoutTableOf(row), `case ${i}: ${JSON.stringify(row)}`).toEqual(layoutTableBefore(row))
    }
  })
})
