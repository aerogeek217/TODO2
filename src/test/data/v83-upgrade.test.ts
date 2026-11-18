import { describe, expect, it } from 'vitest'
import { upgradeV83 } from '../../data/upgrades/v83'
import { CURRENT_DB_VERSION } from '../../data/database'
import { SCHEMA_UPGRADES, upgradeDataSet, type DataRow, type DataSet } from '../../data/schema-upgrades'
import { prepareImport } from '../../data/import-pipeline'
import { SCHEMA_VERSION_KEY } from '../../data/file-version'
import { rowFixes, validateRow } from '../../data/import-validation'
import type { LayoutBody, LayoutTab } from '../../models/workspace-layout'
import { cell, grid, picture } from '../helpers/layout-builders'

/**
 * v83 — Project pulse and the Pressure radar removed: every `pulse` and
 * `radar` tab goes, a cell left without tabs closes by the absorb rule (the
 * tab walk v79 uses, `upgrades/layout-tabs`). The transform's own tests,
 * then the pipeline.
 */

type Obj = Record<string, unknown>

const DATE = '2026-11-01T09:00:00.000Z'
const notes = (id: string): LayoutTab => ({ id, kind: 'notes', config: {} })
/** A stored tab of any shape (stored data isn't typed — the kinds are gone from the model). */
const raw = (tab: Obj): LayoutTab => tab as unknown as LayoutTab
const pulse = (id: string): LayoutTab => raw({ id, kind: 'pulse', config: { tagIds: [3, 4], late: { name: 'behind' } } })
const radar = (id: string): LayoutTab => raw({ id, kind: 'radar', config: { waitingStatusIds: [2] } })
const layout = (body: LayoutBody, extra: Obj = {}): DataRow => ({ id: 1, name: 'L', sortOrder: 0, createdAt: DATE, modifiedAt: DATE, ...body, ...extra })
const bodyOf = (row: DataRow) => row as unknown as LayoutBody
const tabsOf = (row: DataRow, cellId: string) => bodyOf(row).cells.find((c) => c.id === cellId)?.tabs
const upgradeOne = (row: DataRow): DataRow => upgradeV83({ layouts: [row] }).layouts![0]!

/** A row the current schema takes as it is (no repair). */
function expectClean(row: DataRow): void {
  expect(validateRow('layouts', row)).toBe(true)
  expect(rowFixes('layouts', row)).toEqual([])
}

describe('v83: registered', () => {
  it('is the current schema, after v82', () => {
    expect(CURRENT_DB_VERSION).toBe(83)
    expect(SCHEMA_UPGRADES.get(83)).toBe(upgradeV83)
  })
})

describe('v83: the removed kinds go', () => {
  it.each([['pulse', pulse], ['radar', radar]] as const)('a %s tab goes; its cell keeps its other tabs, the active tab moving to the one before', (_kind, make) => {
    const a = cell('a', [notes('n1'), make('gone'), notes('n2')], { activeTabId: 'gone' })
    const out = upgradeOne(layout(grid([[a, cell('b', [notes('n3')])]])))
    expect(tabsOf(out, 'a')).toEqual([notes('n1'), notes('n2')])
    expect(bodyOf(out).cells[0]?.activeTabId).toBe('n1')
    expect(picture(bodyOf(out))).toEqual(['a b'])
    expectClean(out)
  })

  it('the first tab active and removed: the one after it shows', () => {
    const a = cell('a', [radar('gone'), notes('n1')], { activeTabId: 'gone' })
    const out = upgradeOne(layout(grid([[a]])))
    expect(bodyOf(out).cells[0]?.activeTabId).toBe('n1')
    expectClean(out)
  })

  it('a cell left without tabs closes by the absorb rule: the neighbour sharing its whole edge takes its space', () => {
    const out = upgradeOne(layout(grid([[cell('a', [pulse('p'), radar('r')]), cell('b', [notes('n')])]], { cols: [300, 700] })))
    expect(picture(bodyOf(out))).toEqual(['b'])
    expect(bodyOf(out).grid.columns).toEqual([{ id: 'c1', weight: 1000 }])
    expectClean(out)
  })

  it('a cell with no whole-edge neighbour: the cells along a side that cover its edge grow across it', () => {
    const t = cell('t', [radar('r')])
    const out = upgradeOne(layout(grid([[t, t], [cell('l', [notes('n1')]), cell('r', [notes('n2')])]])))
    expect(picture(bodyOf(out))).toEqual(['l r'])
    expectClean(out)
  })

  it('a pinwheel’s centre has no taker: it stays as an empty cell', () => {
    const [a, b, c, d] = ['a', 'b', 'c', 'd'].map((id) => cell(id, [notes(`n-${id}`)])) as [ReturnType<typeof cell>, ReturnType<typeof cell>, ReturnType<typeof cell>, ReturnType<typeof cell>]
    const e = cell('e', [pulse('p')])
    const out = upgradeOne(layout(grid([[a, a, b], [d, e, b], [d, c, c]])))
    expect(picture(bodyOf(out))).toEqual(['a a b', 'd e b', 'd c c'])
    expect(tabsOf(out, 'e')).toEqual([])
    expectClean(out)
  })

  it('a cell that was empty before is left as it was', () => {
    const out = upgradeOne(layout(grid([[cell('a'), cell('b', [notes('n'), pulse('p')])]])))
    expect(picture(bodyOf(out))).toEqual(['a b'])
    expect(tabsOf(out, 'b')).toEqual([notes('n')])
  })

  it('every layout is walked; one with neither kind comes back as the same object', () => {
    const plain = layout(grid([[cell('a', [notes('n')])]]), { id: 2 })
    const out = upgradeV83({ layouts: [layout(grid([[cell('a', [notes('n'), radar('r')])]])), plain] })
    expect(tabsOf(out.layouts![0]!, 'a')).toEqual([notes('n')])
    expect(out.layouts![1]).toBe(plain)
  })
})

describe('v83: the contract', () => {
  it('pure and idempotent: the input untouched; run again, the same object back', () => {
    const data: DataSet = { layouts: [layout(grid([[cell('a', [pulse('p')]), cell('b', [notes('n')])]]))] }
    const before = JSON.parse(JSON.stringify(data)) as DataSet
    const once = upgradeV83(data)
    expect(data).toEqual(before)
    expect(once).not.toBe(data)
    expect(upgradeV83(once)).toBe(once)
  })

  it('touches no other table: lists, settings and tasks are the same arrays', () => {
    const todos: DataRow[] = [{ id: 1, uid: 'u1', title: 'Kept', isCompleted: false, sortOrder: 0, createdAt: DATE, modifiedAt: DATE }]
    const settings: DataRow[] = [{ key: 'staleAfterDays', value: '30' }]
    const listDefinitions: DataRow[] = [{ id: 5, name: 'Inbox' }]
    const out = upgradeV83({ todos, settings, listDefinitions, layouts: [layout(grid([[cell('a', [radar('r'), notes('n')])]]))] })
    expect(out.todos).toBe(todos)
    expect(out.settings).toBe(settings)
    expect(out.listDefinitions).toBe(listDefinitions)
  })

  it('a layout with neither kind leaves the dataset as it was (the same object)', () => {
    const data: DataSet = { layouts: [layout(grid([[cell('a', [notes('n')])]]))] }
    expect(upgradeV83(data)).toBe(data)
  })

  it('tolerates missing tables and malformed rows (left for the repair)', () => {
    const empty: DataSet = {}
    expect(upgradeV83(empty)).toBe(empty)
    const odd: DataSet = {
      layouts: [null as unknown as DataRow, { id: 2, cells: 'none' }, { id: 3, grid: { columns: [], rows: [] }, cells: [null] }, { id: 4, grid: 'x', cells: [] }],
    }
    expect(upgradeV83(odd)).toBe(odd)
  })

  it('a table that doesn’t read: the tabs still go, no cell closes (the repair closes what’s left empty)', () => {
    const row: DataRow = { id: 5, grid: 'x', cells: [{ id: 'a', tabs: [pulse('p')] }, { id: 'b', tabs: [notes('n')] }] }
    const out = upgradeOne(row) as { cells: Array<{ id: string; tabs: unknown[] }> }
    expect(out.cells.map((c) => [c.id, c.tabs.length])).toEqual([['a', 0], ['b', 1]])
  })
})

describe('v83 through the pipeline', () => {
  const v82File = (version: number) => ({
    [SCHEMA_VERSION_KEY]: version,
    todos: [{ id: 1, uid: 'u1', title: 'Kept', isCompleted: false, sortOrder: 0, createdAt: DATE, modifiedAt: DATE }],
    layouts: [layout(grid([[cell('a', [pulse('p')]), cell('b', [notes('n'), radar('r')], { activeTabId: 'r' })]]))],
    settings: [{ key: 'weekStartsOn', value: '1' }],
  })

  it('a v82 file imports without its Project pulse and Pressure radar tabs, and no warning', () => {
    const result = prepareImport(JSON.parse(JSON.stringify(v82File(82))))
    if (!result.ok) throw new Error(result.error)
    expect(result.upgraded).toBe(true)
    expect(result.warnings).toEqual([])
    const cells = result.data.layouts[0]!.cells
    expect(cells).toHaveLength(1)
    expect(cells[0]?.tabs.map((t) => t.id)).toEqual(['n'])
    expect(cells[0]?.activeTabId).toBe('n')
  })

  it('the registry runs it from v82 to the current version', () => {
    const chained = upgradeDataSet(JSON.parse(JSON.stringify(v82File(82))) as DataSet, 82, CURRENT_DB_VERSION)
    expect((chained.layouts![0]!.cells as unknown[]).length).toBe(1)
  })
})
