import { describe, it, expect, afterEach } from 'vitest'
import { db, CURRENT_DB_VERSION } from '../../data/database'
import { upgradeV86 } from '../../data/upgrades/v86'
import { SCHEMA_UPGRADES, upgradeDataSet, type DataRow, type DataSet } from '../../data/schema-upgrades'
import { prepareImport } from '../../data/import-pipeline'
import { restoreFromImportData } from '../../data/restore'
import { buildExportData } from '../../data/export-data'
import { SCHEMA_VERSION_KEY } from '../../data/file-version'
import { resetDb } from '../helpers'

/**
 * v86 — a version marker for a task held in the Planner's Unplanned tray
 * (`TodoItem.unplanned`): no row changes, the stamp alone makes a v85 build
 * refuse the data. The transform's own tests, then the pipeline.
 */

const CREATED = '2026-10-01T09:00:00.000Z'
const MODIFIED = '2026-11-02T09:00:00.000Z'

/** A task as a v85 build wrote it (a planned day, never held), in a file's form. */
const v85Task = (): DataRow => ({
  id: 1, uid: 'u1', title: 'Draft the plan', isCompleted: false, sortOrder: 0,
  createdAt: CREATED, modifiedAt: MODIFIED,
  dueDate: '2026-11-23T06:00:00.000Z', doDate: '2026-11-20T06:00:00.000Z',
})

/** A task held in Unplanned, as this build writes it. */
const heldTask = (): DataRow => ({
  id: 2, uid: 'u2', title: 'Call the vendor', isCompleted: false, sortOrder: 1,
  createdAt: CREATED, modifiedAt: MODIFIED,
  nextFollowupAt: '2026-11-23T06:00:00.000Z', unplanned: true,
})

describe('upgradeV86 (pure): a version marker, no data change', () => {
  it('is the current schema’s registry entry, after v85', () => {
    expect(CURRENT_DB_VERSION).toBeGreaterThanOrEqual(86)
    expect(SCHEMA_UPGRADES.get(86)).toBe(upgradeV86)
  })

  it('returns the input itself: every table, every row unchanged — also for v86 data, malformed rows and missing tables', () => {
    const data: DataSet = { todos: [v85Task(), heldTask(), { unplanned: 5 }], settings: [] }
    expect(upgradeV86(data)).toBe(data)
    expect(upgradeV86({})).toEqual({})
    expect(upgradeDataSet(data, 85, 86)).toBe(data)
  })
})

describe('v86 files', () => {
  afterEach(async () => {
    await resetDb()
  })

  it('a v85 file imports as an upgraded file, its tasks as they were — the planned day kept, none held', () => {
    const prepared = prepareImport(JSON.parse(JSON.stringify({ [SCHEMA_VERSION_KEY]: 85, todos: [v85Task()], settings: [] })) as unknown)
    if (!prepared.ok) throw new Error(prepared.error)
    expect(prepared.sourceVersion).toBe(85)
    expect(prepared.upgraded).toBe(true)
    expect(prepared.warnings).toEqual([])
    const [task] = prepared.data.todos
    expect(task?.title).toBe('Draft the plan')
    expect(task?.modifiedAt).toEqual(new Date(MODIFIED))
    expect(task?.doDate).toEqual(new Date('2026-11-20T06:00:00.000Z'))
    expect(task?.unplanned).toBeUndefined()
  })

  it('an export holding a held task is stamped v86 or later, so a v85 build refuses it as too new, and a restore puts both plan states back', async () => {
    const doDate = new Date(2026, 10, 20)
    const base = { isCompleted: false, createdAt: new Date(CREATED), modifiedAt: new Date(MODIFIED) }
    await db.todos.bulkAdd([
      { ...base, uid: 'u1', title: 'Draft the plan', sortOrder: 0, doDate },
      { ...base, uid: 'u2', title: 'Call the vendor', sortOrder: 1, nextFollowupAt: new Date(2026, 10, 23), unplanned: true },
      { ...base, uid: 'u3', title: 'No plan', sortOrder: 2 },
    ])
    const exported = await buildExportData()
    expect(exported[SCHEMA_VERSION_KEY]).toBe(CURRENT_DB_VERSION)
    expect(exported[SCHEMA_VERSION_KEY]).toBeGreaterThan(85)
    const before = await db.todos.orderBy('sortOrder').toArray()

    await resetDb()
    const prepared = prepareImport(JSON.parse(JSON.stringify(exported)) as unknown)
    if (!prepared.ok) throw new Error(prepared.error)
    expect(prepared.upgraded).toBe(false)
    expect(prepared.warnings).toEqual([])
    await restoreFromImportData(prepared.data)
    const after = await db.todos.orderBy('sortOrder').toArray()
    expect(after).toEqual(before)
    expect(after.map((t) => [t.doDate, t.unplanned])).toEqual([[doDate, undefined], [undefined, true], [undefined, undefined]])
    expect('unplanned' in after[2]!).toBe(false)
  })

  it('`unplanned` is not an index: the todos store is the floor’s', () => {
    expect(db.todos.schema.indexes.map((i) => i.name)).not.toContain('unplanned')
  })
})
