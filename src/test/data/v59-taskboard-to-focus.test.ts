import { afterEach, describe, expect, it } from 'vitest'
import Dexie from 'dexie'
import { CURRENT_DB_VERSION, db } from '../../data/database'
import { SCHEMA_UPGRADES, upgradeDataSet, type DataRow, type DataSet } from '../../data/schema-upgrades'
import { upgradeV59 } from '../../data/upgrades/v59-taskboard-to-focus'
import { prepareImport } from '../../data/import-pipeline'
import { validateImportData } from '../../data/import-validation'
import { auditData } from '../../data/audit'
import { resetDb, v58StoreSpecs } from '../helpers'

const AT = new Date('2026-10-01T09:00:00.000Z')

function todo(id: number, extra: DataRow = {}): DataRow {
  return { id, uid: `u${id}`, title: `T${id}`, isCompleted: false, createdAt: AT, modifiedAt: AT, sortOrder: id, ...extra }
}

const PREDICATE = {
  showCompleted: false, personIds: null, projectIds: null, statusIds: null, searchText: '', dateField: 'deadline',
  dateRangeStart: null, dateRangeEnd: null, dateRangeIncludeNoDate: false, hasDeadline: null, hasFollowup: null, tags: null,
}

function rails(): string {
  return JSON.stringify({
    left: null, top: null, bottom: null,
    right: { orientation: 'vertical', slots: [{ id: 's1', activeTabId: 'tb', tabs: [{ id: 'n1', type: 'notes' }, { id: 'tb', type: 'taskboard' }] }] },
  })
}

/** A v58 dataset with two taskboard "singletons" (the fresh-DB startup race). */
function v58DataSet(): DataSet {
  return {
    canvases: [{ id: 1, name: 'Main', sortOrder: 0, createdAt: AT }],
    todos: [todo(1), todo(2), todo(3), todo(4)],
    settings: [{ key: 'themeMode', value: 'dark' }, { key: 'canvasRails', value: rails() }, { key: 'activeLayoutId', value: '1' }],
    listDefinitions: [
      { id: 2, name: 'Inbox', sortOrder: 0, pinnedToDashboard: true, sort: 'manual', grouping: 'none', membership: { kind: 'custom', predicate: PREDICATE } },
      { id: 7, name: 'Later', sortOrder: 3, pinnedToDashboard: true, sort: 'deadline', grouping: 'none', membership: { kind: 'custom', predicate: PREDICATE } },
    ],
    listOrders: [{ id: 4, listDefinitionId: 2, todoId: 1, rank: 1 }],
    listInsets: [{ id: 3, listDefinitionId: 2, canvasId: 1, x: 0, y: 0, width: 300, height: 200, isCollapsed: false }],
    layouts: [{
      id: 1, name: 'Default', createdAt: AT, modifiedAt: AT,
      columns: [{
        id: 'c1', weight: 1, cells: [{
          id: 'k1', weight: 1, activeTabId: 'tb', tabs: [
            { id: 'l1', kind: 'lens', config: { listDefinitionId: 2 } },
            { id: 'tb', kind: 'taskboard', config: {} },
          ],
        }],
      }],
    }],
    taskboards: [
      // Second row first: rows are read in id order, not array order.
      { id: 2, entries: [{ todoId: 2, sortOrder: 0 }, { todoId: 4, sortOrder: 1 }], createdAt: AT, updatedAt: AT },
      // Entries out of sortOrder, a duplicate of a task on the other board, and a deleted task.
      { id: 1, entries: [{ todoId: 99, sortOrder: 0 }, { todoId: 4, sortOrder: 2 }, { todoId: 3, sortOrder: 1 }], createdAt: AT, updatedAt: AT },
    ],
    floatingTaskboards: [{ id: 1, canvasId: 1, x: 10, y: 20, width: 320, height: 400, collapsed: true }],
  }
}

describe('upgradeV59 (pure)', () => {
  it('is registered for v59', () => {
    expect(SCHEMA_UPGRADES.get(59)).toBe(upgradeV59)
  })

  it('unions every taskboard (id order, sortOrder within, first seen wins), skipping deleted tasks', () => {
    const out = upgradeV59(v58DataSet())
    expect(out.todos!.filter((t) => t.focus === true).map((t) => t.id)).toEqual([2, 3, 4])
    // Board 1: 3 (sortOrder 1), 4 (sortOrder 2); board 2 adds 2 (4 already seen).
    expect(out.listOrders!.filter((r) => r.listDefinitionId === 8).map((r) => [r.todoId, r.rank])).toEqual([[3, 1], [4, 2], [2, 3]])
    expect(out.todos!.find((t) => t.id === 2)!.focus).toBe(true)
    expect('focus' in out.todos!.find((t) => t.id === 1)!).toBe(false)
  })

  it('creates the Focus list after the last list id / sortOrder; existing ranks stay', () => {
    const out = upgradeV59(v58DataSet())
    expect(out.listDefinitions).toHaveLength(3)
    expect(out.listDefinitions![2]).toEqual({
      id: 8, name: 'Focus', sortOrder: 4, pinnedToDashboard: true, sort: 'manual', grouping: 'none',
      membership: { kind: 'custom', predicate: { ...PREDICATE, focus: true } },
    })
    expect(out.listOrders![0]).toEqual({ id: 4, listDefinitionId: 2, todoId: 1, rank: 1 })
    expect(out.listOrders!.slice(1).map((r) => r.id)).toEqual([5, 6, 7])
  })

  it('taskboard widgets become widgets of the Focus list; tables dropped', () => {
    const out = upgradeV59(v58DataSet())
    expect('taskboards' in out).toBe(false)
    expect('floatingTaskboards' in out).toBe(false)
    const cell = (out.layouts![0]!.columns as Array<{ cells: Array<{ activeTabId: string; tabs: unknown[] }> }>)[0]!.cells[0]!
    expect(cell.activeTabId).toBe('tb')
    expect(cell.tabs).toEqual([
      { id: 'l1', kind: 'lens', config: { listDefinitionId: 2 } },
      { id: 'tb', kind: 'lens', config: { listDefinitionId: 8 } },
    ])
    const railsValue = JSON.parse(out.settings!.find((s) => s.key === 'canvasRails')!.value as string)
    expect(railsValue.right.slots[0]).toEqual({ id: 's1', activeTabId: 'tb', tabs: [{ id: 'n1', type: 'notes' }, { id: 'tb', type: 'lens', listDefinitionId: 8 }] })
    expect(out.listInsets).toEqual([
      { id: 3, listDefinitionId: 2, canvasId: 1, x: 0, y: 0, width: 300, height: 200, isCollapsed: false },
      { id: 4, listDefinitionId: 8, canvasId: 1, x: 10, y: 20, width: 320, height: 400, isCollapsed: true },
    ])
  })

  it('creates the Focus list even when no task was on a taskboard', () => {
    const out = upgradeV59({ settings: [], listDefinitions: [], taskboards: [] })
    expect(out.listDefinitions!.map((d) => [d.id, d.name, d.sortOrder])).toEqual([[1, 'Focus', 0]])
    expect('listOrders' in out).toBe(false)
  })

  it('the result, upgraded to the current version, passes import validation', () => {
    const res = validateImportData(upgradeDataSet(upgradeV59(v58DataSet()), 59, CURRENT_DB_VERSION))
    if (!res.ok) throw new Error(res.error)
    expect(res.data.todos.filter((t) => t.focus).map((t) => t.id)).toEqual([2, 3, 4])
  })

  it('is idempotent and leaves v59 data alone', () => {
    const once = upgradeV59(v58DataSet())
    expect(upgradeV59(once)).toBe(once)
    const current: DataSet = { settings: [], listDefinitions: [] }
    expect(upgradeV59(current)).toBe(current)
  })

  it('a partial dataset (task archive) only gets its focus flags', () => {
    const out = upgradeV59({ todos: [todo(1), todo(2)], taskboards: [{ id: 1, entries: [{ todoId: 2, sortOrder: 0 }] }] })
    expect(out.todos!.map((t) => t.focus)).toEqual([undefined, true])
    expect(Object.keys(out).sort()).toEqual(['todos'])
  })

  it('skips malformed rows instead of throwing', () => {
    const out = upgradeV59({
      settings: [{ key: 'canvasRails', value: 'not json' }],
      todos: [todo(1)],
      taskboards: [null as never, { id: 'x', entries: 'nope' }, { entries: [{ todoId: 'a' }, { todoId: 1 }] }],
      floatingTaskboards: [{ id: 1, canvasId: 1 }],
      layouts: [{ id: 1, columns: 'bad' }],
    })
    expect(out.todos![0]!.focus).toBe(true)
    expect(out.listInsets).toBeUndefined()
    expect(out.settings![0]!.value).toBe('not json')
  })
})

describe('v59 Dexie upgrade', () => {
  afterEach(async () => {
    await resetDb()
  })

  async function buildV58Db(): Promise<void> {
    db.close()
    await Dexie.delete(db.name)
    const v58 = new Dexie(db.name)
    v58.version(58).stores(v58StoreSpecs())
    await v58.open()
    for (const [table, rows] of Object.entries(v58DataSet())) await v58.table(table).bulkAdd(rows)
    v58.close()
  }

  it('drops the taskboard stores and matches the import path row for row', async () => {
    await buildV58Db()
    await db.open()
    expect(db.verno).toBe(CURRENT_DB_VERSION)
    const stores = Array.from(db.backendDB().objectStoreNames)
    expect(stores).not.toContain('taskboards')
    expect(stores).not.toContain('floatingTaskboards')

    const todos = await db.todos.orderBy('id').toArray()
    expect(todos.filter((t) => t.focus).map((t) => t.id)).toEqual([2, 3, 4])

    const prepared = prepareImport(JSON.parse(JSON.stringify({ __schemaVersion: 58, ...v58DataSet() })) as unknown)
    if (!prepared.ok) throw new Error(prepared.error)
    expect(prepared.warnings).toEqual([])
    const byId = <T extends { id?: number }>(rows: readonly T[]) => [...rows].sort((a, b) => a.id! - b.id!)
    expect(byId(prepared.data.todos)).toEqual(todos)
    expect(byId(prepared.data.listDefinitions)).toEqual(await db.listDefinitions.orderBy('id').toArray())
    expect(byId(prepared.data.listOrders)).toEqual(await db.listOrders.orderBy('id').toArray())
    // (The inset the floating taskboard becomes goes with the canvas at v60;
    // the pure transform test covers it.)
    expect(byId(prepared.data.layouts)).toEqual(await db.layouts.orderBy('id').toArray())
    const settings = await db.settings.orderBy('key').toArray()
    expect([...prepared.data.settings].sort((a, b) => a.key.localeCompare(b.key))).toEqual(settings)
  })

  it('leaves nothing for the audit to flag', async () => {
    await buildV58Db()
    await db.open()
    const report = await auditData()
    expect(report.issues).toEqual([])
  })
})
