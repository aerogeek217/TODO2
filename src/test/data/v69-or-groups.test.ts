import { describe, it, expect, afterEach } from 'vitest'
import { db, CURRENT_DB_VERSION } from '../../data/database'
import { upgradeV69 } from '../../data/upgrades/v69-or-groups'
import { SCHEMA_UPGRADES, upgradeDataSet, type DataRow, type DataSet } from '../../data/schema-upgrades'
import { prepareImport } from '../../data/import-pipeline'
import { buildExportData } from '../../data/export-data'
import { SCHEMA_VERSION_KEY } from '../../data/file-version'
import { emptyFilterClauses, emptyPredicate } from '../../models/filter-predicate'
import { resetDb } from '../helpers'

/** A stored list as a v68 build wrote it (no or groups). */
const v68List = (): DataRow => ({
  id: 1, name: 'Mine', sortOrder: 0, sort: 'manual', grouping: 'none', owner: { layoutId: 1 },
  membership: { kind: 'custom', predicate: { ...emptyPredicate(), personIds: [2], negate: { personIds: true } } },
})

/** The same list with an or group, as this build writes it. */
const groupedList = (): DataRow => ({
  ...v68List(),
  membership: { kind: 'custom', predicate: { ...emptyPredicate(), orGroups: [{ ...emptyFilterClauses(), markers: 'hot', tags: [0] }] } },
})

describe('upgradeV69 (pure): a version marker, no data change', () => {
  it('is the v69 registry entry', () => {
    expect(CURRENT_DB_VERSION).toBeGreaterThanOrEqual(69)
    expect(SCHEMA_UPGRADES.get(69)).toBe(upgradeV69)
  })

  it('returns the input itself: every table, every row unchanged — also for v69 data, malformed rows and missing tables', () => {
    const data: DataSet = { listDefinitions: [v68List(), groupedList(), { membership: 5 }], todos: [] }
    expect(upgradeV69(data)).toBe(data)
    expect(upgradeV69({})).toEqual({})
    expect(upgradeDataSet(data, 68, CURRENT_DB_VERSION)).toBe(data)
    expect(upgradeDataSet(data, CURRENT_DB_VERSION, CURRENT_DB_VERSION)).toBe(data)
  })
})

describe('v69 files', () => {
  afterEach(async () => {
    await resetDb()
  })

  it('a v68 file imports as an upgraded file, its filters as they were', () => {
    const prepared = prepareImport(JSON.parse(JSON.stringify({ [SCHEMA_VERSION_KEY]: 68, todos: [], settings: [], listDefinitions: [v68List()] })) as unknown)
    if (!prepared.ok) throw new Error(prepared.error)
    expect(prepared.sourceVersion).toBe(68)
    expect(prepared.upgraded).toBe(true)
    expect(prepared.warnings).toEqual([])
    expect(prepared.data.listDefinitions[0]!.membership).toEqual(v68List().membership)
  })

  it('an export holding or groups is stamped v69 or later, so a v68 build refuses it as too new', async () => {
    await db.listDefinitions.add(groupedList() as never)
    const exported = await buildExportData()
    expect(exported[SCHEMA_VERSION_KEY]).toBe(CURRENT_DB_VERSION)
    expect(exported[SCHEMA_VERSION_KEY]).toBeGreaterThan(68)
    const prepared = prepareImport(JSON.parse(JSON.stringify(exported)) as unknown)
    if (!prepared.ok) throw new Error(prepared.error)
    expect(prepared.warnings).toEqual([])
    expect(prepared.data.listDefinitions[0]!.membership).toEqual(groupedList().membership)
  })
})
