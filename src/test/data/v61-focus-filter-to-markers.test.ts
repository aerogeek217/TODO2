import { describe, it, expect, afterEach, vi } from 'vitest'
import Dexie from 'dexie'
import { db, CURRENT_DB_VERSION } from '../../data/database'
import { upgradeV61 } from '../../data/upgrades/v61-focus-filter-to-markers'
import { SCHEMA_UPGRADES, type DataRow, type DataSet } from '../../data/schema-upgrades'
import { prepareImport } from '../../data/import-pipeline'
import { resetDb, v60StoreSpecs } from '../helpers'

function predicate(extra: DataRow = {}): DataRow {
  return {
    showCompleted: false, personIds: null, statusIds: null, searchText: '',
    dateField: 'deadline', dateRangeStart: null, dateRangeEnd: null, dateRangeIncludeNoDate: false,
    hasDeadline: null, hasFollowup: null, tags: null, ...extra,
  }
}

function listDef(id: number, name: string, pred: DataRow): DataRow {
  return {
    id, name, sortOrder: id, pinnedToDashboard: true,
    membership: { kind: 'custom', predicate: pred },
    sort: 'manual', grouping: 'none',
  }
}

function v60DataSet(): DataSet {
  return {
    todos: [
      { id: 1, uid: 'u1', title: 'In focus', isCompleted: false, focus: true, createdAt: new Date('2026-10-01T09:00:00Z'), modifiedAt: new Date('2026-10-01T09:00:00Z'), sortOrder: 0 },
    ],
    listDefinitions: [
      listDef(1, 'Focus', predicate({ focus: true })),
      listDef(2, 'Not focused', predicate({ focus: false, personIds: [1] })),
      listDef(3, 'Any', predicate({ focus: null })),
      listDef(4, 'Plain', predicate()),
    ],
    settings: [{ key: 'weekStartsOn', value: '1' }],
  }
}

function predicateOf(out: DataSet, id: number): DataRow {
  const def = out.listDefinitions!.find((d) => d.id === id)!
  return (def.membership as { predicate: DataRow }).predicate
}

describe('upgradeV61 (pure)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('is the v61 registry entry', () => {
    expect(CURRENT_DB_VERSION).toBeGreaterThanOrEqual(61)
    expect(SCHEMA_UPGRADES.get(61)).toBe(upgradeV61)
  })

  it('focus: true → markers.focus; focus: null is removed; other fields stay', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const out = upgradeV61(v60DataSet())
    expect(predicateOf(out, 1)).toEqual(predicate({ markers: { focus: true } }))
    expect(predicateOf(out, 3)).toEqual(predicate())
  })

  it('focus: false ("not in focus") is dropped with a warning naming the list', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const out = upgradeV61(v60DataSet())
    expect(predicateOf(out, 2)).toEqual(predicate({ personIds: [1] }))
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]![0])).toContain('Not focused')
  })

  it('keeps markers a predicate already has', () => {
    const data: DataSet = { listDefinitions: [listDef(1, 'L', predicate({ focus: true, markers: { urgent: true } }))] }
    expect(predicateOf(upgradeV61(data), 1).markers).toEqual({ urgent: true, focus: true })
  })

  it('leaves lists without a focus field (and tasks) as the same objects', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const input = v60DataSet()
    const out = upgradeV61(input)
    expect(out.listDefinitions![3]).toBe(input.listDefinitions![3])
    expect(out.todos).toBe(input.todos)
    expect(out.settings).toBe(input.settings)
  })

  it('is idempotent and tolerates missing tables and malformed rows', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const once = upgradeV61(v60DataSet())
    expect(upgradeV61(once)).toBe(once)
    const archive: DataSet = { todos: [], todoPeople: [] }
    expect(upgradeV61(archive)).toBe(archive)
    const junk: DataSet = { listDefinitions: [null as never, 'x' as never, { id: 1, membership: 'nope' }, { id: 2, membership: { kind: 'custom', predicate: 7 } }] }
    expect(upgradeV61(junk)).toBe(junk)
  })
})

/** The live-DB path: a v60 database opened by the current build. */
describe('v61 Dexie upgrade', () => {
  afterEach(async () => {
    vi.restoreAllMocks()
    await resetDb()
  })

  it('rewrites stored predicates, matching the import path', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    db.close()
    await Dexie.delete(db.name)
    const v60 = new Dexie(db.name)
    v60.version(60).stores(v60StoreSpecs())
    await v60.open()
    for (const [table, rows] of Object.entries(v60DataSet())) {
      if (rows.length > 0) await v60.table(table).bulkAdd(rows)
    }
    v60.close()

    await db.open()
    expect(db.verno).toBe(CURRENT_DB_VERSION)
    const defs = await db.listDefinitions.orderBy('id').toArray()
    // The last list is the Eisenhower's (v67).
    expect(defs.map((d) => d.membership.predicate.markers ?? null)).toEqual([{ focus: true }, null, null, null, null])
    expect(defs.every((d) => !('focus' in d.membership.predicate))).toBe(true)
    expect((await db.todos.get(1))!.focus).toBe(true)

    const prepared = prepareImport(JSON.parse(JSON.stringify({ __schemaVersion: 60, ...v60DataSet() })) as unknown)
    if (!prepared.ok) throw new Error(prepared.error)
    expect(prepared.data.listDefinitions).toEqual(defs)
  })
})
