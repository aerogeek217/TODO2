import { describe, it, expect, afterEach } from 'vitest'
import { db, CURRENT_DB_VERSION } from '../../data/database'
import { upgradeV73 } from '../../data/upgrades/v73-subtasks'
import { SCHEMA_UPGRADES, upgradeDataSet, type DataRow, type DataSet } from '../../data/schema-upgrades'
import { prepareImport } from '../../data/import-pipeline'
import { buildExportData } from '../../data/export-data'
import { restoreFromImportData } from '../../data/restore'
import { sanitizeRow, validateRow } from '../../data/import-validation'
import { SCHEMA_VERSION_KEY } from '../../data/file-version'
import { resetDb } from '../helpers'

const created = new Date(2026, 8, 1, 9, 0)

/** A task as a v72 build stored it (ISO dates, as in a file). */
const v72Todo = (over: DataRow = {}): DataRow => ({
  id: 1, uid: 'u1', title: 'Q4 budget', isCompleted: false, sortOrder: 0,
  createdAt: created.toISOString(), modifiedAt: created.toISOString(),
  ...over,
})

describe('upgradeV73 (pure): a version marker for the subtasks table', () => {
  it('is the v73 registry entry, and the current version is v73 or later', () => {
    expect(CURRENT_DB_VERSION).toBeGreaterThanOrEqual(73)
    expect(SCHEMA_UPGRADES.get(73)).toBe(upgradeV73)
  })

  it('returns its input itself — every v72 dataset is a v73 dataset', () => {
    const data: DataSet = { todos: [v72Todo()], statusUpdates: [] }
    expect(upgradeV73(data)).toBe(data)
    expect(upgradeDataSet(data, 72, CURRENT_DB_VERSION)).toBe(data)
    expect('subtasks' in upgradeDataSet(data, 68, CURRENT_DB_VERSION)).toBe(false)
  })
})

describe('subtask rows', () => {
  const row = { id: 1, todoId: 1, title: 'Collect the numbers', isCompleted: true, sortOrder: 0, createdAt: created.toISOString() }

  it('validate: a title (one to 500 characters), a boolean done state, a finite order and a creation date', () => {
    expect(validateRow('subtasks', row)).toBe(true)
    expect(validateRow('subtasks', { ...row, title: '' })).toContain('title')
    expect(validateRow('subtasks', { ...row, title: 'x'.repeat(501) })).toContain('title')
    expect(validateRow('subtasks', { ...row, isCompleted: 'yes' })).toContain('isCompleted')
    expect(validateRow('subtasks', { ...row, isCompleted: undefined })).toContain('isCompleted')
    expect(validateRow('subtasks', { ...row, sortOrder: 'first' })).toContain('sortOrder')
    expect(validateRow('subtasks', { ...row, createdAt: 'yesterday' })).toContain('createdAt')
    expect(validateRow('subtasks', { ...row, todoId: undefined })).toContain('todoId')
  })

  it('sanitize: revives the date, keeps every field and drops unknown ones', () => {
    const picked = sanitizeRow('subtasks', { ...row, extra: 1 }) as unknown as Record<string, unknown>
    expect(picked).toEqual({ id: 1, todoId: 1, title: 'Collect the numbers', isCompleted: true, sortOrder: 0, createdAt: created })
    expect(picked.createdAt).toBeInstanceOf(Date)
  })
})

describe('the browser database’s v73 step', () => {
  afterEach(async () => {
    db.close()
    await resetDb()
  })

  it('opens at v73 with an empty subtasks table indexed by todoId; a task’s subtasks are read by it', async () => {
    db.close()
    await db.delete()
    await db.open()
    expect(db.verno).toBe(CURRENT_DB_VERSION)
    expect(await db.subtasks.count()).toBe(0)
    const todoId = await db.todos.add({ uid: 'u1', title: 'Q4 budget', isCompleted: false, sortOrder: 0, createdAt: created, modifiedAt: created })
    await db.subtasks.bulkAdd([
      { todoId, title: 'b', isCompleted: false, sortOrder: 1, createdAt: created },
      { todoId: todoId + 1, title: 'other', isCompleted: false, sortOrder: 0, createdAt: created },
      { todoId, title: 'a', isCompleted: true, sortOrder: 0, createdAt: created },
    ])
    expect((await db.subtasks.where('todoId').equals(todoId).sortBy('sortOrder')).map((r) => r.title)).toEqual(['a', 'b'])
  })
})

describe('v73 files', () => {
  afterEach(async () => {
    await resetDb()
  })

  it('a v72 file imports as an upgraded file with no subtasks; the browser then holds none', async () => {
    const prepared = prepareImport(JSON.parse(JSON.stringify({ [SCHEMA_VERSION_KEY]: 72, todos: [v72Todo()], settings: [] })) as unknown)
    if (!prepared.ok) throw new Error(prepared.error)
    expect(prepared.sourceVersion).toBe(72)
    expect(prepared.upgraded).toBe(true)
    expect(prepared.warnings).toEqual([])
    expect(prepared.data.subtasks).toEqual([])
    await restoreFromImportData(prepared.data)
    expect(await db.subtasks.count()).toBe(0)
  })

  it('an export carries the subtasks and a restore puts them back as they were', async () => {
    const todoId = await db.todos.add({ uid: 'u1', title: 'Q4 budget', isCompleted: false, sortOrder: 0, createdAt: created, modifiedAt: created })
    await db.subtasks.bulkAdd([
      { todoId, title: 'Collect the numbers', isCompleted: true, sortOrder: 0, createdAt: created },
      { todoId, title: 'Draft the charts', isCompleted: false, sortOrder: 1, createdAt: created },
    ])
    const exported = await buildExportData()
    expect(exported[SCHEMA_VERSION_KEY]).toBe(CURRENT_DB_VERSION)
    expect(exported.subtasks).toHaveLength(2)
    const before = await db.subtasks.toArray()

    await resetDb()
    const prepared = prepareImport(JSON.parse(JSON.stringify(exported)) as unknown)
    if (!prepared.ok) throw new Error(prepared.error)
    expect(prepared.upgraded).toBe(false)
    await restoreFromImportData(prepared.data)
    expect(await db.subtasks.toArray()).toEqual(before)
  })
})
