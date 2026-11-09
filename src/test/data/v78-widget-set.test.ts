import { describe, it, expect } from 'vitest'
import { upgradeV78 } from '../../data/upgrades/v78'
import { layoutWidgetSetOf, upgradeWidgetSet } from '../../data/upgrades/v78/widget-set'
import { prepareImport } from '../../data/import-pipeline'
import { SCHEMA_VERSION_KEY } from '../../data/file-version'
import { readLayoutDraft } from '../../data/draft-storage'
import { rowFixes, validateRow } from '../../data/import-validation'
import { isNormalized, validateTiling } from '../../utils/workspace-grid'
import { closeCell } from '../../utils/workspace-layout-ops'
import type { LayoutBody, LayoutTab } from '../../models/workspace-layout'
import { cell, grid, picture, type GridOptions } from '../helpers/layout-builders'

type Obj = Record<string, unknown>

const DATE = '2026-11-01T09:00:00.000Z'
const notes = (id: string): LayoutTab => ({ id, kind: 'notes', config: {} })
/** A tab of a kind this build may not know (stored data isn't typed). */
const raw = (id: string, kind: string, config: Obj = {}, extra: Obj = {}): LayoutTab => ({ id, kind, config, ...extra }) as unknown as LayoutTab
const layout = (body: LayoutBody): Obj => ({ id: 1, name: 'L', sortOrder: 0, createdAt: DATE, modifiedAt: DATE, ...body })
const REMOVED = ['followup', 'next7', 'stale', 'recent', 'changes', 'today'] as const

/** The widget-set part over a table layout row. */
function upgraded(matrix: Parameters<typeof grid>[0], opts?: GridOptions): LayoutBody & Obj {
  return layoutWidgetSetOf(layout(grid(matrix, opts))) as LayoutBody & Obj
}

/** Holds: a valid tiling, every line an edge, and a row the current schema takes as it is. */
function expectValid(row: Obj): void {
  const body = row as unknown as LayoutBody
  expect(validateTiling(body)).toBe(true)
  expect(isNormalized(body)).toBe(true)
  expect(validateRow('layouts', row)).toBe(true)
  expect(rowFixes('layouts', row)).toEqual([])
}

const weights = (body: LayoutBody, axis: 'columns' | 'rows') => body.grid[axis].map((t) => (t.px != null ? `${t.px}px` : t.weight))
const tabsOf = (body: LayoutBody, cellId: string) => body.cells.find((c) => c.id === cellId)?.tabs

describe('v78 widget-set: the Eisenhower summary becomes the Eisenhower; the removed kinds go', () => {
  it('an Eisenhower summary tab becomes an Eisenhower tab, keeping its id and place; any setting goes', () => {
    const a = cell('a', [notes('n1'), raw('s1', 'eisenhowerSummary', { stray: 1 }, { viewState: { detailsWidth: 200 } }), notes('n2')], { activeTabId: 's1' })
    const out = upgraded([[a]])
    expect(tabsOf(out, 'a')).toEqual([notes('n1'), { id: 's1', kind: 'eisenhower', config: {} }, notes('n2')])
    expect(out.cells[0]!.activeTabId).toBe('s1')
    expectValid(out)
  })

  it.each(REMOVED)('a %s tab goes; its cell keeps its other tabs', (kind) => {
    const a = cell('a', [notes('n1'), raw('gone', kind, { lookAhead: 7 }, { viewState: { detailsWidth: 280 } })])
    const out = upgraded([[a, cell('b', [notes('n2')])]])
    expect(tabsOf(out, 'a')).toEqual([notes('n1')])
    expect(picture(out)).toEqual(['a b'])
    expectValid(out)
  })

  it('a cell whose active tab went shows the tab before it, else the one after (as closing a tab)', () => {
    const before = upgraded([[cell('a', [notes('n1'), raw('g', 'today'), notes('n2')], { activeTabId: 'g' })]])
    expect(before.cells[0]!.activeTabId).toBe('n1')
    const after = upgraded([[cell('a', [raw('g', 'changes', { tagIds: [1] }), notes('n2')], { activeTabId: 'g' })]])
    expect(after.cells[0]!.activeTabId).toBe('n2')
    const kept = upgraded([[cell('a', [raw('g', 'stale'), notes('n2')], { activeTabId: 'n2' })]])
    expect(kept.cells[0]!.activeTabId).toBe('n2')
    const none = upgraded([[cell('a', [raw('g', 'stale'), notes('n2')])]])
    expect(none.cells[0]).not.toHaveProperty('activeTabId')
  })

  it('a cell left without tabs closes: the left neighbour sharing its whole edge takes it; the line goes, the weights add', () => {
    const a = cell('a', [notes('n1')])
    const x = cell('x', [raw('g1', 'followup'), raw('g2', 'next7')], { activeTabId: 'g2' })
    const out = upgraded([[a, x], [cell('c', [notes('n2')]), cell('d', [notes('n3')])]], { cols: [300, 700] })
    expect(picture(out)).toEqual(['a a', 'c d'])
    expect(tabsOf(out, 'a')).toEqual([notes('n1')])
    expectValid(out)
  })

  it('looks left, then above, then right, then below for the taker', () => {
    const t = (id: string) => cell(id, [notes(`${id}-t`)])
    const x = () => cell('x', [raw('g', 'recent')])
    // Left and above both share a whole edge: left takes it.
    expect(picture(upgraded([[t('u'), t('a')], [t('l'), x()]]))).toEqual(['u a', 'l l'])
    // No left (a taller cell): above — and the line between them goes.
    expect(picture(upgraded([[t('l'), t('a')], [t('l'), x()], [t('b'), t('b')]]))).toEqual(['l a', 'b b'])
    // Neither left nor above: right.
    expect(picture(upgraded([[t('l'), t('w'), t('w')], [t('l'), x(), t('r')], [t('b'), t('b'), t('b')]]))).toEqual(['l w', 'l r', 'b b'])
    // Only below.
    expect(picture(upgraded([[t('l'), x(), t('r')], [t('l'), t('b'), t('r')]]))).toEqual(['l b r'])
  })

  it('with no neighbour sharing a whole edge it stays as an empty cell', () => {
    const t = (id: string) => cell(id, [notes(`${id}-t`)])
    // A pinwheel: the centre's every neighbour is longer than its edge.
    const out = upgraded([
      [t('a'), t('a'), t('b')],
      [t('d'), cell('x', [raw('g', 'stale')], { activeTabId: 'g' }), t('b')],
      [t('d'), t('c'), t('c')],
    ])
    expect(picture(out)).toEqual(['a a b', 'd x b', 'd c c'])
    expect(out.cells.find((c) => c.id === 'x')).toEqual({ id: 'x', area: { col: 1, row: 1, colSpan: 1, rowSpan: 1 }, tabs: [] })
    expectValid(out)
  })

  it('with no single whole-edge neighbour, the neighbours along a side that cover its whole edge together grow across it', () => {
    const t = (id: string) => cell(id, [notes(`${id}-t`)])
    const x = () => cell('x', [raw('g', 'stale')])
    // a x      a and c together cover x's left edge.
    // c x
    expect(picture(upgraded([[t('a'), x()], [t('c'), x()]]))).toEqual(['a', 'c'])
    // x b      No left, no top: on its right b and d together cover it.
    // x d
    expect(picture(upgraded([[x(), t('b')], [x(), t('d')]]))).toEqual(['b', 'd'])
    // l a b    On its left l sticks out (taller), below f is wider; above, a and b
    // l x x    together cover its top edge: both grow down, the row line goes.
    // f f f
    const out = upgraded([[t('l'), t('a'), t('b')], [t('l'), x(), x()], [t('f'), t('f'), t('f')]], { cols: [200, 300, 500] })
    expect(picture(out)).toEqual(['l a b', 'f f f'])
    expect(weights(out, 'columns')).toEqual([200, 300, 500])
    expectValid(out)
    // A single whole-edge neighbour still comes first: h below takes x alone
    // (above, c and d wouldn't: d sticks out past x's right end).
    //   c d d
    //   x x g
    //   h h g
    expect(picture(upgraded([[t('c'), t('d'), t('d')], [x(), x(), t('g')], [t('h'), t('h'), t('g')]]))).toEqual(['c d d', 'h h g'])
  })

  it('closes as the live Close cell does, on the shapes that tell the two passes apart', () => {
    const t = (id: string) => cell(id, [notes(`${id}-t`)])
    const x = () => cell('x', [raw('g', 'today')])
    const shapes: Parameters<typeof grid>[0][] = [
      [[t('a'), x()], [t('c'), x()]],
      [[x(), t('b')], [x(), t('d')]],
      [[t('l'), t('a'), t('b')], [t('l'), x(), x()], [t('f'), t('f'), t('f')]],
      [[t('c'), t('d'), t('d')], [x(), x(), t('g')], [t('h'), t('h'), t('g')]],
      [[t('a'), t('a'), t('b')], [t('d'), x(), t('b')], [t('d'), t('c'), t('c')]],
      [[t('a'), t('b'), t('c')], [x(), x(), x()], [t('d'), t('d'), t('e')]],
    ]
    for (const shape of shapes) {
      const live = closeCell(grid(shape), 'x')
      expect(picture(upgraded(shape))).toEqual(picture(live))
    }
  })

  it('a cell that was empty before stays as it was; only the emptied ones close', () => {
    const out = upgraded([[cell('e'), cell('x', [raw('g', 'today')]), cell('b', [notes('n')])]])
    expect(picture(out)).toEqual(['e b'])
    expect(tabsOf(out, 'e')).toEqual([])
    expectValid(out)
  })

  it('several emptied cells close in reading order, each against the table the ones before left', () => {
    const out = upgraded([[cell('a', [notes('n')]), cell('x', [raw('g1', 'changes')]), cell('y', [raw('g2', 'today')])]], { cols: [200, 300, 500] })
    expect(picture(out)).toEqual(['a'])
    expect(weights(out, 'columns')).toEqual([1000])
    expectValid(out)
  })

  it('merged tracks: two fixed tracks add their px; collapsed only when both were; the first keeps its id', () => {
    const fixed = upgraded([[cell('a', [notes('n')])], [cell('x', [raw('g', 'next7')])]], { rows: [{ px: 100, collapsed: true }, { px: 60 }], rowIds: ['top', 'low'] })
    expect(picture(fixed)).toEqual(['a'])
    expect(fixed.grid.rows).toEqual([{ id: 'top', px: 160 }])
    const both = upgraded([[cell('a', [notes('n')])], [cell('x', [raw('g', 'next7')])]], { rows: [{ weight: 300, collapsed: true }, { weight: 700, collapsed: true }] })
    expect(both.grid.rows).toEqual([{ id: 'r1', weight: 1000, collapsed: true }])
    // A weighted and a fixed track: the weight alone.
    const mixed = upgraded([[cell('a', [notes('n')])], [cell('x', [raw('g', 'next7')])]], { rows: [400, { px: 60 }] })
    expect(mixed.grid.rows).toEqual([{ id: 'r1', weight: 400 }])
    expectValid(fixed)
    expectValid(both)
  })

  it('a column of glance widgets that all go collapses into the cell beside it; spans shift back', () => {
    const t = (id: string) => cell(id, [notes(`${id}-t`)])
    const g = (id: string, kind: string) => cell(id, [raw(`${id}-t`, kind)])
    const out = upgraded([
      [t('a'), g('f', 'followup'), t('z')],
      [t('a'), g('s', 'stale'), t('z')],
      [t('b'), t('b'), t('z')],
    ], { cols: [400, 300, 300] })
    expect(picture(out)).toEqual(['a z', 'b z'])
    expect(weights(out, 'columns')).toEqual([700, 300])
    expect(out.cells.map((c) => c.id)).toEqual(['a', 'z', 'b'])
    expectValid(out)
  })
})

describe('v78 widget-set: the contract', () => {
  it('a layout without these kinds is returned as it is; the part is idempotent', () => {
    const row = layout(grid([[cell('a', [notes('n')]), cell('e')]]))
    expect(layoutWidgetSetOf(row)).toBe(row)
    const data = { layouts: [layout(grid([[cell('a', [notes('n')]), cell('x', [raw('g', 'stale')])]]))] }
    const once = upgradeWidgetSet(data)
    expect(once).not.toBe(data)
    expect(upgradeWidgetSet(once)).toBe(once)
    const none = { todos: [] }
    expect(upgradeWidgetSet(none)).toBe(none)
  })

  it('is defensive: odd cells and tabs pass through; an unreadable table converts the tabs but closes nothing', () => {
    const odd = { id: 2, name: 'odd' }
    expect(layoutWidgetSetOf(odd)).toBe(odd)
    const messy = {
      ...layout(grid([[cell('a', [notes('n')])]])),
      cells: ['nope', { id: 'b', tabs: 'x' }, { id: 'c', tabs: [7, raw('g', 'followup'), raw('s', 'eisenhowerSummary')] }],
    }
    expect(layoutWidgetSetOf(messy).cells).toEqual(['nope', { id: 'b', tabs: 'x' }, { id: 'c', tabs: [7, { id: 's', kind: 'eisenhower', config: {} }] }])
    const noArea = { ...layout(grid([[cell('a', [notes('n')])]])), cells: [{ id: 'a', tabs: [notes('n')] }, { id: 'x', tabs: [raw('g', 'today')] }] }
    expect(layoutWidgetSetOf(noArea).cells).toEqual([{ id: 'a', tabs: [notes('n')] }, { id: 'x', tabs: [] }])
  })

  it('runs after layout-table in v78: a v77 layout’s removed widgets go and their cells close', () => {
    const v77 = {
      id: 1, name: 'L', sortOrder: 0, createdAt: DATE, modifiedAt: DATE,
      columns: [
        { id: 'A', weight: 1, rows: [
          { id: 'A1', weight: 1, cells: [{ id: 'a', weight: 1, tabs: [notes('n1')] }, { id: 'f', weight: 1, tabs: [raw('f1', 'followup', { lookAhead: 7 })] }] },
          { id: 'A2', weight: 1, cells: [{ id: 'e', weight: 1, tabs: [raw('e1', 'eisenhowerSummary')] }] },
        ] },
      ],
      bottom: { id: 'bot', height: 120, cells: [{ id: 'w', weight: 1, tabs: [raw('w1', 'changes', { tagIds: [] })] }, { id: 'k', weight: 1, tabs: [notes('n2')] }] },
    }
    const out = upgradeV78({ layouts: [v77] }).layouts![0] as unknown as LayoutBody & Obj
    expect(picture(out)).toEqual(['a', 'e', 'k'])
    expect(tabsOf(out, 'e')).toEqual([{ id: 'e1', kind: 'eisenhower', config: {} }])
    expectValid(out)
  })

  it('a v77 file imports through it: no removed kind arrives, nothing to repair', () => {
    const file = {
      [SCHEMA_VERSION_KEY]: 77,
      todos: [],
      settings: [],
      layouts: [{
        id: 1, name: 'L', sortOrder: 0, createdAt: DATE, modifiedAt: DATE,
        columns: [{ id: 'A', weight: 1, rows: [
          { id: 'A1', weight: 1, cells: [{ id: 'a', weight: 1, tabs: [notes('n'), raw('t', 'today', {}, { viewState: { detailsWidth: 300 } })], activeTabId: 't' }] },
          { id: 'A2', weight: 1, cells: [{ id: 's', weight: 1, tabs: [raw('s1', 'stale', { staleDays: 14 })] }] },
        ] }],
      }],
    }
    const result = prepareImport(JSON.parse(JSON.stringify(file)))
    if (!result.ok) throw new Error(result.error)
    expect(result.warnings).toEqual([])
    const out = result.data.layouts[0]!
    expect(picture(out)).toEqual(['a'])
    expect(out.cells[0]).toMatchObject({ tabs: [notes('n')], activeTabId: 'n' })
  })

  it('a kept v77 layout draft reads back without the removed kinds', () => {
    const body = { columns: [{ id: 'A', weight: 1, rows: [
      { id: 'A1', weight: 1, cells: [{ id: 'a', weight: 1, tabs: [notes('n')] }] },
      { id: 'A2', weight: 1, cells: [{ id: 'g', weight: 1, tabs: [raw('g1', 'recent', { recentDays: 7 })] }] },
    ] }] }
    localStorage.setItem('todo2-unsaved-layout', JSON.stringify({ kind: 'new', name: 'N', schemaVersion: 77, ...body }))
    const draft = readLayoutDraft()
    expect(draft?.kind === 'new' && picture(draft.body)).toEqual(['a'])
  })
})
