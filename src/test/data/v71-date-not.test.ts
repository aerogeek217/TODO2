import { describe, it, expect, afterEach } from 'vitest'
import { db, CURRENT_DB_VERSION } from '../../data/database'
import { upgradeV71 } from '../../data/upgrades/v71-date-not'
import { SCHEMA_UPGRADES, upgradeDataSet, type DataRow, type DataSet } from '../../data/schema-upgrades'
import { prepareImport } from '../../data/import-pipeline'
import { buildExportData } from '../../data/export-data'
import { SCHEMA_VERSION_KEY } from '../../data/file-version'
import { emptyFilterClauses, emptyPredicate } from '../../models/filter-predicate'
import { resetDb } from '../helpers'

/** A stored list as a v70 build wrote it (an "is" range only). */
const v70List = (): DataRow => ({
  id: 1, name: 'Mine', sortOrder: 0, sort: 'followup', grouping: 'none', owner: { layoutId: 1 },
  membership: {
    kind: 'custom',
    predicate: { ...emptyPredicate(), dates: { followup: { match: 'range', start: { kind: 'relative', token: 'today' }, end: { kind: 'offset', days: 14 } } } },
  },
})

/** A list with "is not" ranges in an or group, as this build writes it. */
const notList = (): DataRow => ({
  ...v70List(),
  membership: {
    kind: 'custom',
    predicate: {
      ...emptyPredicate(),
      orGroups: [{
        ...emptyFilterClauses(),
        dates: {
          lastFollowup: { match: 'range', start: { kind: 'offset', days: -7 }, end: { kind: 'relative', token: 'today' }, not: true },
          followup: { match: 'range', start: { kind: 'relative', token: 'today' }, end: { kind: 'offset', days: 14 }, not: true },
        },
      }],
    },
  },
})

describe('upgradeV71 (pure): a version marker, no data change', () => {
  it('is the v71 registry entry', () => {
    expect(CURRENT_DB_VERSION).toBeGreaterThanOrEqual(71)
    expect(SCHEMA_UPGRADES.get(71)).toBe(upgradeV71)
  })

  it('returns the input itself: every table, every row unchanged — also for v71 data, malformed rows and missing tables', () => {
    const data: DataSet = { listDefinitions: [v70List(), notList(), { membership: 5 }], todos: [] }
    expect(upgradeV71(data)).toBe(data)
    expect(upgradeV71({})).toEqual({})
    // Up to v74: v75 turns or groups into expressions.
    expect(upgradeDataSet(data, 70, 74)).toBe(data)
    expect(upgradeDataSet(data, 68, 74)).toBe(data)
  })
})

describe('v71 files', () => {
  afterEach(async () => {
    await resetDb()
  })

  it('a v70 file imports as an upgraded file, its filters as they were', () => {
    const prepared = prepareImport(JSON.parse(JSON.stringify({ [SCHEMA_VERSION_KEY]: 70, todos: [], settings: [], listDefinitions: [v70List()] })) as unknown)
    if (!prepared.ok) throw new Error(prepared.error)
    expect(prepared.sourceVersion).toBe(70)
    expect(prepared.upgraded).toBe(true)
    expect(prepared.warnings).toEqual([])
    expect(prepared.data.listDefinitions[0]!.membership).toEqual(v70List().membership)
  })

  it('an export holding "is not" ranges is stamped v71 or later, so a v70 build refuses it as too new', async () => {
    await db.listDefinitions.add(notList() as never)
    const exported = await buildExportData()
    expect(exported[SCHEMA_VERSION_KEY]).toBe(CURRENT_DB_VERSION)
    expect(exported[SCHEMA_VERSION_KEY]).toBeGreaterThan(70)
    const prepared = prepareImport(JSON.parse(JSON.stringify(exported)) as unknown)
    if (!prepared.ok) throw new Error(prepared.error)
    expect(prepared.warnings).toEqual([])
    expect(prepared.data.listDefinitions[0]!.membership).toEqual(notList().membership)
  })
})
