import { describe, it, expect, afterEach } from 'vitest'
import { db, CURRENT_DB_VERSION } from '../../data/database'
import { upgradeV85 } from '../../data/upgrades/v85'
import { SCHEMA_UPGRADES, upgradeDataSet, type DataRow, type DataSet } from '../../data/schema-upgrades'
import { prepareImport } from '../../data/import-pipeline'
import { restoreFromImportData } from '../../data/restore'
import { buildExportData } from '../../data/export-data'
import { SCHEMA_VERSION_KEY } from '../../data/file-version'
import { resetDb } from '../helpers'

/**
 * v85 — a version marker for a task's Do day (`TodoItem.doDate`, the
 * Planner's): no row changes, the stamp alone makes a v84 build refuse the
 * data. The transform's own tests, then the pipeline.
 */

const CREATED = '2026-10-01T09:00:00.000Z'
const MODIFIED = '2026-11-02T09:00:00.000Z'

/** A task as a v84 build wrote it (no Do day), in a file's form. */
const v84Task = (): DataRow => ({
  id: 1, uid: 'u1', title: 'Draft the plan', isCompleted: false, sortOrder: 0,
  createdAt: CREATED, modifiedAt: MODIFIED,
  dueDate: '2026-11-23T06:00:00.000Z', recurrenceRule: { every: { count: 2, unit: 'w' } },
})

/** The same task planned for a day, as this build writes it. */
const plannedTask = (): DataRow => ({ ...v84Task(), doDate: '2026-11-20T06:00:00.000Z' })

describe('upgradeV85 (pure): a version marker, no data change', () => {
  it('is the v85 registry entry', () => {
    expect(CURRENT_DB_VERSION).toBeGreaterThanOrEqual(85)
    expect(SCHEMA_UPGRADES.get(85)).toBe(upgradeV85)
  })

  it('returns the input itself: every table, every row unchanged — also for v85 data, malformed rows and missing tables', () => {
    const data: DataSet = { todos: [v84Task(), plannedTask(), { doDate: 5 }], settings: [] }
    expect(upgradeV85(data)).toBe(data)
    expect(upgradeV85({})).toEqual({})
    expect(upgradeDataSet(data, 84, 85)).toBe(data)
  })
})

describe('v85 files', () => {
  afterEach(async () => {
    await resetDb()
  })

  it('a v84 file imports as an upgraded file, its tasks as they were and without a Do day', () => {
    const prepared = prepareImport(JSON.parse(JSON.stringify({ [SCHEMA_VERSION_KEY]: 84, todos: [v84Task()], settings: [] })) as unknown)
    if (!prepared.ok) throw new Error(prepared.error)
    expect(prepared.sourceVersion).toBe(84)
    expect(prepared.upgraded).toBe(true)
    expect(prepared.warnings).toEqual([])
    const [task] = prepared.data.todos
    expect(task?.title).toBe('Draft the plan')
    expect(task?.modifiedAt).toEqual(new Date(MODIFIED))
    expect(task?.doDate).toBeUndefined()
  })

  it('an export holding a Do day is stamped v85 or later, so a v84 build refuses it as too new, and a restore puts the day back', async () => {
    const doDate = new Date(2026, 10, 20)
    await db.todos.add({ uid: 'u1', title: 'Draft the plan', isCompleted: false, sortOrder: 0, createdAt: new Date(CREATED), modifiedAt: new Date(MODIFIED), doDate })
    const exported = await buildExportData()
    expect(exported[SCHEMA_VERSION_KEY]).toBe(CURRENT_DB_VERSION)
    expect(exported[SCHEMA_VERSION_KEY]).toBeGreaterThan(84)
    const before = await db.todos.toArray()

    await resetDb()
    const prepared = prepareImport(JSON.parse(JSON.stringify(exported)) as unknown)
    if (!prepared.ok) throw new Error(prepared.error)
    expect(prepared.upgraded).toBe(false)
    expect(prepared.warnings).toEqual([])
    await restoreFromImportData(prepared.data)
    const after = await db.todos.toArray()
    expect(after).toEqual(before)
    expect(after[0]?.doDate).toEqual(doDate)
    expect(after[0]?.doDate).toBeInstanceOf(Date)
  })

  it('`doDate` is not an index: the todos store is the floor’s', () => {
    expect(db.todos.schema.indexes.map((i) => i.name)).not.toContain('doDate')
  })
})
