import { describe, it, expect, afterEach } from 'vitest'
import { db, CURRENT_DB_VERSION } from '../../data/database'
import { upgradeV70 } from '../../data/upgrades/v70-date-types'
import { SCHEMA_UPGRADES, upgradeDataSet, type DataRow, type DataSet } from '../../data/schema-upgrades'
import { prepareImport } from '../../data/import-pipeline'
import { buildExportData } from '../../data/export-data'
import { SCHEMA_VERSION_KEY } from '../../data/file-version'
import { emptyPredicate } from '../../models/filter-predicate'
import { resetDb } from '../helpers'

/** A stored list as a v69 build wrote it (no Last followed up / Completed clause or sort). */
const v69List = (): DataRow => ({
  id: 1, name: 'Mine', sortOrder: 0, sort: 'followup', grouping: 'none', owner: { layoutId: 1 },
  membership: { kind: 'custom', predicate: { ...emptyPredicate(), dates: { followup: { match: 'set' } } } },
})

/** A list using both new date types and a new sort, as this build writes it. */
const newDatesList = (): DataRow => ({
  ...v69List(),
  sort: 'completed', sortDirection: 'desc',
  membership: {
    kind: 'custom',
    predicate: {
      ...emptyPredicate(),
      dates: {
        lastFollowup: { match: 'range', start: null, end: { kind: 'offset', days: -14 }, includeNoDate: true },
        completed: { match: 'range', start: { kind: 'relative', token: 'start-of-week' }, end: { kind: 'relative', token: 'today' } },
      },
    },
  },
})

describe('upgradeV70 (pure): a version marker, no data change', () => {
  it('is the v70 registry entry', () => {
    expect(CURRENT_DB_VERSION).toBeGreaterThanOrEqual(70)
    expect(SCHEMA_UPGRADES.get(70)).toBe(upgradeV70)
  })

  it('returns the input itself: every table, every row unchanged — also for v70 data, malformed rows and missing tables', () => {
    const data: DataSet = { listDefinitions: [v69List(), newDatesList(), { membership: 5 }], todos: [] }
    expect(upgradeV70(data)).toBe(data)
    expect(upgradeV70({})).toEqual({})
    expect(upgradeDataSet(data, 69, CURRENT_DB_VERSION)).toBe(data)
    expect(upgradeDataSet(data, 68, CURRENT_DB_VERSION)).toBe(data)
  })
})

describe('v70 files', () => {
  afterEach(async () => {
    await resetDb()
  })

  it('a v69 file imports as an upgraded file, its filters and sort as they were', () => {
    const prepared = prepareImport(JSON.parse(JSON.stringify({ [SCHEMA_VERSION_KEY]: 69, todos: [], settings: [], listDefinitions: [v69List()] })) as unknown)
    if (!prepared.ok) throw new Error(prepared.error)
    expect(prepared.sourceVersion).toBe(69)
    expect(prepared.upgraded).toBe(true)
    expect(prepared.warnings).toEqual([])
    expect(prepared.data.listDefinitions[0]!.membership).toEqual(v69List().membership)
    expect(prepared.data.listDefinitions[0]!.sort).toBe('followup')
  })

  it('an export holding the new date clauses and sort is stamped v70 or later, so a v69 build refuses it as too new', async () => {
    await db.listDefinitions.add(newDatesList() as never)
    const exported = await buildExportData()
    expect(exported[SCHEMA_VERSION_KEY]).toBe(CURRENT_DB_VERSION)
    expect(exported[SCHEMA_VERSION_KEY]).toBeGreaterThan(69)
    const prepared = prepareImport(JSON.parse(JSON.stringify(exported)) as unknown)
    if (!prepared.ok) throw new Error(prepared.error)
    expect(prepared.warnings).toEqual([])
    expect(prepared.data.listDefinitions[0]!.membership).toEqual(newDatesList().membership)
    expect(prepared.data.listDefinitions[0]!.sort).toBe('completed')
  })
})
