import { describe, it, expect, afterEach } from 'vitest'
import Dexie from 'dexie'
import { db, CURRENT_DB_VERSION } from '../../data/database'
import { upgradeV54 } from '../../data/upgrades/v54-remove-hidden-statuses'
import { SCHEMA_UPGRADES, type DataRow, type DataSet } from '../../data/schema-upgrades'
import { prepareImport } from '../../data/import-pipeline'
import { resetDb, v52StoreSpecs } from '../helpers'

function predicate(extra: DataRow = {}): DataRow {
  return {
    showCompleted: false, showHiddenStatuses: false,
    personIds: null, personFilterMode: 'include-orgs', orgIds: null, orgFilterMode: 'include-people',
    projectIds: null, statusIds: null, searchText: '',
    dateField: 'deadline', dateRangeStart: null, dateRangeEnd: null, dateRangeIncludeNoDate: false,
    hasDeadline: null, hasFollowup: null, tags: null,
    ...extra,
  }
}

function listDef(id: number, pred: DataRow): DataRow {
  return {
    id, name: `List ${id}`, sortOrder: id, pinnedToDashboard: true, favorited: false,
    membership: { kind: 'custom', predicate: predicate(pred) },
    sort: 'manual', grouping: 'none',
  }
}

function v53DataSet(): DataSet {
  const created = new Date(2026, 8, 1, 9, 0)
  return {
    canvases: [{ id: 1, name: 'Main', sortOrder: 0, createdAt: created }],
    statuses: [
      { id: 1, name: 'Assigned', color: '#888888', sortOrder: 0, icon: 'person', hideByDefault: true },
      { id: 2, name: 'Waiting', color: '#a070e0', sortOrder: 1, hideByDefault: false },
      // Never had the flag: same object out.
      { id: 3, name: 'Doing', color: '#50a050', sortOrder: 2, icon: 'circle' },
    ],
    todos: [
      { id: 1, uid: 'uid-1', title: 'Hidden-status task', isCompleted: false, createdAt: created, modifiedAt: created, sortOrder: 1, statusId: 1 },
    ],
    listDefinitions: [
      listDef(1, { showHiddenStatuses: false }),
      listDef(2, { showHiddenStatuses: true, statusIds: [1, 2] }),
    ],
    settings: [{ key: 'themeMode', value: 'dark' }],
  }
}

function byId(rows: DataRow[] | undefined, id: number): DataRow {
  const row = rows?.find((r) => r.id === id)
  if (!row) throw new Error(`row ${id} missing`)
  return row
}

function predicateOf(row: DataRow): DataRow {
  return (row.membership as { predicate: DataRow }).predicate
}

describe('upgradeV54 (pure transform)', () => {
  it('is the v54 registry entry', () => {
    expect(CURRENT_DB_VERSION).toBeGreaterThanOrEqual(54)
    expect(SCHEMA_UPGRADES.get(54)).toBe(upgradeV54)
  })

  it('strips hideByDefault from every status and keeps the rest of the row', () => {
    const input = v53DataSet()
    const out = upgradeV54(input)
    for (const row of out.statuses!) expect('hideByDefault' in row, `status ${String(row.id)}`).toBe(false)
    expect(byId(out.statuses, 1)).toEqual({ id: 1, name: 'Assigned', color: '#888888', sortOrder: 0, icon: 'person' })
    expect(byId(out.statuses, 3)).toBe(byId(input.statuses, 3))
  })

  it('strips showHiddenStatuses from stored predicates without adding a status filter', () => {
    const out = upgradeV54(v53DataSet())
    for (const def of out.listDefinitions!) {
      expect('showHiddenStatuses' in predicateOf(def), `list ${String(def.id)}`).toBe(false)
    }
    expect(predicateOf(byId(out.listDefinitions, 1)).statusIds).toBeNull()
    expect(predicateOf(byId(out.listDefinitions, 2)).statusIds).toEqual([1, 2])
    expect(predicateOf(byId(out.listDefinitions, 1)).showCompleted).toBe(false)
  })

  it('leaves untouched tables as the same array and does not touch todos', () => {
    const input = v53DataSet()
    const out = upgradeV54(input)
    expect(out.todos).toBe(input.todos)
    expect(out.settings).toBe(input.settings)
    expect(out.canvases).toBe(input.canvases)
  })

  it('is idempotent', () => {
    const once = upgradeV54(v53DataSet())
    const twice = upgradeV54(once)
    expect(twice.statuses).toBe(once.statuses)
    expect(twice.listDefinitions).toBe(once.listDefinitions)
  })

  it('tolerates missing tables, partial archives and malformed rows', () => {
    expect(upgradeV54({})).toEqual({})
    const archive: DataSet = { statuses: [{ id: 1, name: 'Assigned', color: '#888', sortOrder: 0, hideByDefault: true }] }
    expect(upgradeV54(archive).statuses).toEqual([{ id: 1, name: 'Assigned', color: '#888', sortOrder: 0 }])
    expect('listDefinitions' in upgradeV54(archive)).toBe(false)
    const odd = [null as never, { id: 9 }, { id: 10, membership: { kind: 'custom' } }, { id: 11, membership: { kind: 'custom', predicate: null } }]
    const out = upgradeV54({ statuses: [null as never], listDefinitions: odd })
    expect(out.statuses).toEqual([null])
    expect(out.listDefinitions).toBe(odd)
  })
})

/** The live-DB path: a v53 database opened by the current build. */
describe('v54 Dexie upgrade', () => {
  afterEach(async () => {
    await resetDb()
  })

  async function buildV53Db(): Promise<void> {
    db.close()
    await Dexie.delete(db.name)
    const v53 = new Dexie(db.name)
    v53.version(53).stores(v52StoreSpecs())
    await v53.open()
    for (const [table, rows] of Object.entries(v53DataSet())) await v53.table(table).bulkAdd(rows)
    v53.close()
  }

  it('strips the hidden flags from the stored rows and matches the import path', async () => {
    await buildV53Db()
    await db.open()
    expect(db.verno).toBe(CURRENT_DB_VERSION)

    const statuses = await db.statuses.orderBy('id').toArray()
    for (const s of statuses) expect('hideByDefault' in s, `status ${s.id}`).toBe(false)
    const defs = await db.listDefinitions.orderBy('id').toArray()
    for (const d of defs) expect('showHiddenStatuses' in d.membership.predicate, `list ${d.id}`).toBe(false)

    // A JSON copy of the same v53 data (an export carries the empty
    // taskboards table) upgrades to the same rows.
    const prepared = prepareImport(JSON.parse(JSON.stringify({ __schemaVersion: 53, taskboards: [], ...v53DataSet() })) as unknown)
    if (!prepared.ok) throw new Error(prepared.error)
    expect(prepared.warnings).toEqual([])
    expect([...prepared.data.statuses].sort((a, b) => a.id! - b.id!)).toEqual(statuses)
    expect([...prepared.data.listDefinitions].sort((a, b) => a.id! - b.id!)).toEqual(defs)
  })
})
