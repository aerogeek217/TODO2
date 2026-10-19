import { describe, it, expect, afterEach } from 'vitest'
import Dexie from 'dexie'
import { db, CURRENT_DB_VERSION } from '../../data/database'
import { upgradeV65 } from '../../data/upgrades/v65-is-not-and-eisenhower-list'
import { SCHEMA_UPGRADES, type DataRow, type DataSet } from '../../data/schema-upgrades'
import { prepareImport } from '../../data/import-pipeline'
import { buildExportData } from '../../data/export-data'
import { SCHEMA_VERSION_KEY } from '../../data/file-version'
import { resetDb, v64StoreSpecs } from '../helpers'

/** A stored list whose People / Status / Tags filters are "is not". */
const negatedList = (): DataRow => ({
  id: 1, name: 'Not mine', sortOrder: 0, sort: 'manual', grouping: 'none',
  membership: {
    kind: 'custom',
    predicate: {
      showCompleted: false, personIds: [2], statusIds: [3], searchText: '', dates: {}, markers: null, tags: [4],
      negate: { personIds: true, statusIds: true, tags: true },
    },
  },
})

/** A stored layout with an Eisenhower tab on that list. */
const eisenhowerLayout = (): DataRow => ({
  id: 1, name: 'Default', createdAt: new Date('2026-10-01T09:00:00.000Z'), modifiedAt: new Date('2026-10-01T09:00:00.000Z'),
  columns: [{ id: 'c1', weight: 1, cells: [{ id: 'k1', weight: 1, tabs: [{ id: 't1', kind: 'eisenhower', config: { listDefinitionId: 1 } }] }] }],
})

const v64Rows = (): DataSet => ({ listDefinitions: [negatedList()], layouts: [eisenhowerLayout()] })

describe('upgradeV65 (pure): a version marker, no data change', () => {
  it('is the v65 registry entry', () => {
    expect(CURRENT_DB_VERSION).toBeGreaterThanOrEqual(65)
    expect(SCHEMA_UPGRADES.get(65)).toBe(upgradeV65)
  })

  it('returns the input itself: every table, every row unchanged', () => {
    const data = v64Rows()
    expect(upgradeV65(data)).toBe(data)
    expect(upgradeV65({})).toEqual({})
  })
})

describe('v65 files', () => {
  afterEach(async () => {
    await resetDb()
  })

  it('a v64 file with "is not" switches and an Eisenhower list imports as an upgraded file, both kept', () => {
    const prepared = prepareImport(JSON.parse(JSON.stringify({ [SCHEMA_VERSION_KEY]: 64, todos: [], settings: [], ...v64Rows() })) as unknown)
    if (!prepared.ok) throw new Error(prepared.error)
    expect(prepared.sourceVersion).toBe(64)
    expect(prepared.upgraded).toBe(true)
    expect(prepared.warnings).toEqual([])
    expect(prepared.data.listDefinitions[0]!.membership).toMatchObject({ predicate: { negate: { personIds: true, statusIds: true, tags: true } } })
    expect(prepared.data.layouts[0]!.columns[0]!.cells[0]!.tabs[0]!.config).toEqual({ listDefinitionId: 1 })
  })

  it('an export holding "is not" switches is stamped v65 or later, so a v64 build refuses it as too new', async () => {
    await db.listDefinitions.add(negatedList() as never)
    const exported = await buildExportData()
    expect(exported[SCHEMA_VERSION_KEY]).toBe(CURRENT_DB_VERSION)
    expect(exported[SCHEMA_VERSION_KEY]).toBeGreaterThan(64)
  })
})

/** The live-DB path: a v64 database opened by the current build. */
describe('v65 Dexie upgrade', () => {
  afterEach(async () => {
    await resetDb()
  })

  it('opens a v64 database at the current version with every row as it was', async () => {
    db.close()
    await Dexie.delete(db.name)
    const v64 = new Dexie(db.name)
    v64.version(64).stores(v64StoreSpecs())
    await v64.open()
    for (const [table, rows] of Object.entries(v64Rows())) await v64.table(table).bulkAdd(rows)
    v64.close()
    await db.open()
    expect(db.verno).toBe(CURRENT_DB_VERSION)
    expect(await db.listDefinitions.toArray()).toEqual([negatedList()])
    expect(await db.layouts.toArray()).toEqual([eisenhowerLayout()])
  })
})
