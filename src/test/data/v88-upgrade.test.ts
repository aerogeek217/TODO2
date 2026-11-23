import { describe, expect, it } from 'vitest'
import { upgradeV88 } from '../../data/upgrades/v88'
import { CURRENT_DB_VERSION, OLDEST_SUPPORTED_DB_VERSION } from '../../data/database'
import { SCHEMA_UPGRADES, upgradeDataSet, type DataRow, type DataSet } from '../../data/schema-upgrades'
import { prepareImport } from '../../data/import-pipeline'
import { SCHEMA_VERSION_KEY } from '../../data/file-version'
import { rowFixes, validateRow } from '../../data/import-validation'
import type { LayoutBody, LayoutTab } from '../../models/workspace-layout'
import { cell, grid } from '../helpers/layout-builders'

/**
 * v88 — the List wall and Shortcuts are one widget, the List board: every
 * `listwall` tab becomes `{ kind: 'shortcuts', config: { source: 'layout' } }`,
 * its id, name, icon and place kept. The transform's own tests, then the
 * pipeline.
 */

type Obj = Record<string, unknown>

const DATE = '2026-11-23T09:00:00.000Z'
const notes = (id: string): LayoutTab => ({ id, kind: 'notes', config: {} })
/** A stored tab of any shape (stored data isn't typed — the kind is gone from the model). */
const raw = (tab: Obj): LayoutTab => tab as unknown as LayoutTab
const wall = (id: string, extra: Obj = {}): LayoutTab => raw({ id, kind: 'listwall', config: {}, ...extra })
const board = (id: string, extra: Obj = {}) => ({ id, kind: 'shortcuts', config: { source: 'layout' }, ...extra })
const layout = (body: LayoutBody, extra: Obj = {}): DataRow => ({ id: 1, name: 'L', sortOrder: 0, createdAt: DATE, modifiedAt: DATE, ...body, ...extra })
const bodyOf = (row: DataRow) => row as unknown as LayoutBody
const tabsOf = (row: DataRow, cellId: string) => bodyOf(row).cells.find((c) => c.id === cellId)?.tabs
const upgradeOne = (row: DataRow): DataRow => upgradeV88({ layouts: [row] }).layouts![0]!

/** A row the current schema takes as it is (no repair). */
function expectClean(row: DataRow): void {
  expect(validateRow('layouts', row)).toBe(true)
  expect(rowFixes('layouts', row)).toEqual([])
}

describe('v88: registered', () => {
  it('is the current version, above the floor', () => {
    expect(CURRENT_DB_VERSION).toBe(88)
    expect(OLDEST_SUPPORTED_DB_VERSION).toBe(87)
    expect(SCHEMA_UPGRADES.get(88)).toBe(upgradeV88)
  })
})

describe('v88: a List wall becomes a List board of its layout’s lists', () => {
  it('keeps its id, name, icon and place in its cell; the cell’s active tab stays', () => {
    const icon = { kind: 'emoji', emoji: '🧱' }
    const a = cell('a', [notes('n1'), wall('w', { name: 'Everything', icon }), notes('n2')], { activeTabId: 'w' })
    const out = upgradeOne(layout(grid([[a, cell('b', [notes('n3')])]])))
    expect(tabsOf(out, 'a')).toEqual([notes('n1'), board('w', { name: 'Everything', icon }), notes('n2')])
    expect(bodyOf(out).cells[0]?.activeTabId).toBe('w')
    expect(tabsOf(out, 'b')).toEqual([notes('n3')])
    expectClean(out)
  })

  it('an unnamed one stays unnamed (it reads List board); a stray config key goes', () => {
    const out = upgradeOne(layout(grid([[cell('a', [wall('w', { config: { stray: 1 } })])]])))
    expect(tabsOf(out, 'a')).toEqual([board('w')])
    expectClean(out)
  })

  it('every layout and every cell is walked; a layout without one comes back as the same object', () => {
    const plain = layout(grid([[cell('a', [notes('n')])]]), { id: 2 })
    const out = upgradeV88({ layouts: [layout(grid([[cell('a', [wall('w1')]), cell('b', [notes('n'), wall('w2')])]])), plain] })
    expect(tabsOf(out.layouts![0]!, 'a')).toEqual([board('w1')])
    expect(tabsOf(out.layouts![0]!, 'b')).toEqual([notes('n'), board('w2')])
    expect(out.layouts![1]).toBe(plain)
  })

  it('a List board already there is left as it is', () => {
    const picked = { id: 's', kind: 'shortcuts', config: { lists: [3] } }
    const data: DataSet = { layouts: [layout(grid([[cell('a', [raw(picked)])]]))] }
    expect(upgradeV88(data)).toBe(data)
  })
})

describe('v88: the contract', () => {
  it('pure and idempotent: the input untouched; run again, the same object back', () => {
    const data: DataSet = { layouts: [layout(grid([[cell('a', [wall('w')]), cell('b', [notes('n')])]]))] }
    const before = JSON.parse(JSON.stringify(data)) as DataSet
    const once = upgradeV88(data)
    expect(data).toEqual(before)
    expect(once).not.toBe(data)
    expect(upgradeV88(once)).toBe(once)
  })

  it('touches no other table: lists, settings and tasks are the same arrays', () => {
    const todos: DataRow[] = [{ id: 1, uid: 'u1', title: 'Kept', isCompleted: false, sortOrder: 0, createdAt: DATE, modifiedAt: DATE }]
    const settings: DataRow[] = [{ key: 'staleAfterDays', value: '30' }]
    const listDefinitions: DataRow[] = [{ id: 5, name: 'Inbox' }]
    const out = upgradeV88({ todos, settings, listDefinitions, layouts: [layout(grid([[cell('a', [wall('w')])]]))] })
    expect(out.todos).toBe(todos)
    expect(out.settings).toBe(settings)
    expect(out.listDefinitions).toBe(listDefinitions)
  })

  it('tolerates missing tables and malformed rows (left for the repair)', () => {
    const empty: DataSet = {}
    expect(upgradeV88(empty)).toBe(empty)
    const odd: DataSet = {
      layouts: [null as unknown as DataRow, { id: 2, cells: 'none' }, { id: 3, cells: [null, { id: 'k', tabs: 'x' }, { id: 'j', tabs: [null, 4] }] }],
    }
    expect(upgradeV88(odd)).toBe(odd)
  })
})

describe('v88 through the pipeline', () => {
  const v87File = () => ({
    [SCHEMA_VERSION_KEY]: 87,
    todos: [{ id: 1, uid: 'u1', title: 'Kept', isCompleted: false, sortOrder: 0, createdAt: DATE, modifiedAt: DATE }],
    layouts: [layout(grid([[cell('a', [notes('n'), wall('w', { name: 'All lists' })], { activeTabId: 'w' })]]))],
    settings: [{ key: 'weekStartsOn', value: '1' }],
  })

  it('a v87 file imports with its List wall a List board of its layout’s lists, and no warning', () => {
    const result = prepareImport(JSON.parse(JSON.stringify(v87File())))
    if (!result.ok) throw new Error(result.error)
    expect(result.upgraded).toBe(true)
    expect(result.warnings).toEqual([])
    const cells = result.data.layouts[0]!.cells
    expect(cells[0]?.tabs).toEqual([notes('n'), board('w', { name: 'All lists' })])
    expect(cells[0]?.activeTabId).toBe('w')
  })

  it('the registry runs it from v87 to the current version', () => {
    const chained = upgradeDataSet(JSON.parse(JSON.stringify(v87File())) as DataSet, 87, CURRENT_DB_VERSION)
    expect(tabsOf(chained.layouts![0]!, 'a')?.[1]).toEqual(board('w', { name: 'All lists' }))
  })
})
