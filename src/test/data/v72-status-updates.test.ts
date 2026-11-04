import { describe, it, expect, afterEach } from 'vitest'
import { db, CURRENT_DB_VERSION } from '../../data/database'
import { upgradeV72 } from '../../data/upgrades/v72-status-updates'
import { SCHEMA_UPGRADES, upgradeDataSet, type DataRow, type DataSet } from '../../data/schema-upgrades'
import { prepareImport } from '../../data/import-pipeline'
import { buildExportData } from '../../data/export-data'
import { restoreFromImportData } from '../../data/restore'
import { sanitizeRow, validateRow } from '../../data/import-validation'
import { SCHEMA_VERSION_KEY } from '../../data/file-version'
import { resetDb } from '../helpers'

const modified = new Date(2026, 9, 5, 14, 30)
const created = new Date(2026, 8, 1, 9, 0)

/** A task as a v71 build stored it, with its one-line Progress (ISO dates, as in a file). */
const v71Todo = (over: DataRow = {}): DataRow => ({
  id: 1, uid: 'u1', title: 'Q4 budget', isCompleted: false, sortOrder: 0,
  createdAt: created.toISOString(), modifiedAt: modified.toISOString(), progress: '  waiting on numbers  ',
  ...over,
})

describe('upgradeV72 (pure): a task’s Progress becomes its first status update', () => {
  it('is the v72 registry entry, and the current version is v72 or later', () => {
    expect(CURRENT_DB_VERSION).toBeGreaterThanOrEqual(72)
    expect(SCHEMA_UPGRADES.get(72)).toBe(upgradeV72)
  })

  it('ISO strings in, ISO strings out: the day of modifiedAt, the trimmed text, createdAt = modifiedAt; progress leaves the row', () => {
    const data: DataSet = { todos: [v71Todo()], people: [] }
    const out = upgradeV72(data)
    expect(out.statusUpdates).toEqual([{
      todoId: 1, date: new Date(2026, 9, 5).toISOString(), text: 'waiting on numbers', createdAt: modified.toISOString(),
    }])
    const rest: DataRow = v71Todo()
    delete rest.progress
    expect(out.todos).toEqual([rest])
    expect(out.people).toBe(data.people)
  })

  it('Dates in, Dates out (the Dexie side)', () => {
    const out = upgradeV72({ todos: [{ ...v71Todo(), createdAt: created, modifiedAt: modified }] })
    expect(out.statusUpdates).toEqual([{ todoId: 1, date: new Date(2026, 9, 5), text: 'waiting on numbers', createdAt: modified }])
    expect(out.statusUpdates?.[0]?.date).toBeInstanceOf(Date)
  })

  it('caps the text at 500 characters', () => {
    const out = upgradeV72({ todos: [v71Todo({ progress: 'x'.repeat(600) })] })
    expect(out.statusUpdates?.[0]?.text).toBe('x'.repeat(500))
  })

  it('a modifiedAt that doesn’t read falls back to createdAt; with neither the task gets no entry', () => {
    const fallback = upgradeV72({ todos: [v71Todo({ modifiedAt: 'not a date' })] })
    expect(fallback.statusUpdates).toEqual([{
      todoId: 1, date: new Date(2026, 8, 1).toISOString(), text: 'waiting on numbers', createdAt: created.toISOString(),
    }])
    const neither = upgradeV72({ todos: [v71Todo({ modifiedAt: 5, createdAt: undefined })] })
    expect('statusUpdates' in neither).toBe(false)
    expect(neither.todos?.[0]).not.toHaveProperty('progress')
  })

  it('a blank, non-string or unowned Progress makes no entry, and its key still goes', () => {
    const data: DataSet = {
      todos: [
        v71Todo({ id: 1, progress: '   ' }),
        v71Todo({ id: 2, progress: 42 }),
        v71Todo({ id: 0 }),
        v71Todo({ id: 'x' }),
        v71Todo({ id: 2.5 }),
      ],
    }
    const out = upgradeV72(data)
    expect('statusUpdates' in out).toBe(false)
    expect(out.todos?.every((t) => !('progress' in t))).toBe(true)
  })

  it('passes malformed rows through and doesn’t touch its input', () => {
    const odd = [5, null, 'row'] as unknown as DataRow[]
    const data: DataSet = { todos: [...odd, v71Todo()] }
    const before = JSON.stringify(data)
    const out = upgradeV72(data)
    expect(out.todos?.slice(0, 3)).toEqual(odd)
    expect(JSON.stringify(data)).toBe(before)
  })

  it('returns its input itself when no task has a Progress key — also for a missing todos table', () => {
    const data: DataSet = { todos: [{ id: 1, title: 'a' }], statusUpdates: [] }
    expect(upgradeV72(data)).toBe(data)
    const archive: DataSet = { people: [] }
    expect(upgradeV72(archive)).toBe(archive)
    expect(upgradeV72({})).toEqual({})
  })

  it('is idempotent: the upgraded data is returned as it is, and an entry already held isn’t added twice', () => {
    const once = upgradeV72({ todos: [v71Todo()] })
    expect(upgradeV72(once)).toBe(once)
    const held = { todoId: 1, date: '2026-10-01T00:00:00.000Z', text: 'waiting on numbers', createdAt: '2026-10-01T10:00:00.000Z' }
    const partly: DataSet = { todos: [v71Todo()], statusUpdates: [held] }
    const out = upgradeV72(partly)
    expect(out.statusUpdates).toBe(partly.statusUpdates)
    expect(out.todos?.[0]).not.toHaveProperty('progress')
  })

  it('keeps the entries already there and adds after them', () => {
    const other = { id: 9, todoId: 2, date: '2026-10-01T00:00:00.000Z', text: 'other', createdAt: '2026-10-01T10:00:00.000Z' }
    const out = upgradeV72({ todos: [v71Todo()], statusUpdates: [other] })
    expect(out.statusUpdates?.map((r) => r.text)).toEqual(['other', 'waiting on numbers'])
  })

  it('runs through the registry from v71 and from the floor', () => {
    const data: DataSet = { todos: [v71Todo()] }
    expect(upgradeDataSet(data, 71, CURRENT_DB_VERSION).statusUpdates).toHaveLength(1)
    expect(upgradeDataSet(data, 68, CURRENT_DB_VERSION).statusUpdates).toHaveLength(1)
  })
})

type IndexSpec = [name: string, keyPath: string | string[], unique?: 'unique']

/** The stores and indexes a v71 build left (the v68 floor's: v69 – v71 changed none). */
const V71_LAYOUT: Record<string, { auto: boolean; keyPath: string; indexes: IndexSpec[] }> = {
  backups: { keyPath: 'id', auto: true, indexes: [['createdAt', 'createdAt'], ['trigger', 'trigger']] },
  layouts: { keyPath: 'id', auto: true, indexes: [] },
  listDefinitions: { keyPath: 'id', auto: true, indexes: [['sortOrder', 'sortOrder']] },
  listOrders: { keyPath: 'id', auto: true, indexes: [['[listDefinitionId+todoId]', ['listDefinitionId', 'todoId'], 'unique'], ['listDefinitionId', 'listDefinitionId'], ['todoId', 'todoId']] },
  notes: { keyPath: 'id', auto: true, indexes: [['modifiedAt', 'modifiedAt']] },
  people: { keyPath: 'id', auto: true, indexes: [['name', 'name']] },
  settings: { keyPath: 'key', auto: false, indexes: [] },
  statuses: { keyPath: 'id', auto: true, indexes: [['sortOrder', 'sortOrder']] },
  tags: { keyPath: 'id', auto: true, indexes: [['name', 'name']] },
  todoEvents: { keyPath: 'id', auto: true, indexes: [['timestamp', 'timestamp'], ['todoId', 'todoId'], ['type', 'type']] },
  todoPeople: { keyPath: 'id', auto: true, indexes: [['personId', 'personId'], ['todoId', 'todoId']] },
  todoTags: { keyPath: 'id', auto: true, indexes: [['tagId', 'tagId'], ['todoId', 'todoId']] },
  todos: { keyPath: 'id', auto: true, indexes: [['dueDate', 'dueDate'], ['isCompleted', 'isCompleted'], ['sortOrder', 'sortOrder'], ['statusId', 'statusId'], ['uid', 'uid', 'unique']] },
}

/**
 * A raw `todo2` database as a v71 build left it, holding `todos` — made
 * without Dexie, so no second Dexie instance of the database lingers (one
 * would open it again at v71 on its next use).
 */
function createV71Db(todos: readonly Record<string, unknown>[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('todo2', 710)
    req.onupgradeneeded = () => {
      for (const [name, spec] of Object.entries(V71_LAYOUT)) {
        const store = req.result.createObjectStore(name, { keyPath: spec.keyPath, autoIncrement: spec.auto })
        for (const [index, keyPath, unique] of spec.indexes) store.createIndex(index, keyPath, { unique: unique === 'unique' })
      }
      const store = req.transaction!.objectStore('todos')
      for (const t of todos) store.add(t)
    }
    req.onsuccess = () => { req.result.close(); resolve() }
    req.onerror = () => reject(req.error)
  })
}

describe('the browser database’s v72 upgrade', () => {
  afterEach(async () => {
    db.close()
    await resetDb()
  })

  it('a v71 database opens at v72 with each Progress as the task’s first entry, the key gone', async () => {
    db.close()
    await db.delete()
    await createV71Db([
      { id: 1, uid: 'u1', title: 'Q4 budget', isCompleted: false, sortOrder: 0, createdAt: created, modifiedAt: modified, progress: 'half way' },
      { id: 2, uid: 'u2', title: 'No progress', isCompleted: false, sortOrder: 1, createdAt: created, modifiedAt: modified },
      { id: 3, uid: 'u3', title: 'Blank', isCompleted: false, sortOrder: 2, createdAt: created, modifiedAt: modified, progress: '' },
    ])

    await db.open()
    expect(db.verno).toBe(CURRENT_DB_VERSION)
    const rows = await db.statusUpdates.toArray()
    expect(rows).toEqual([{ id: 1, todoId: 1, date: new Date(2026, 9, 5), text: 'half way', createdAt: modified }])
    const todos = await db.todos.toArray()
    expect(todos.map((t) => t.title)).toEqual(['Q4 budget', 'No progress', 'Blank'])
    expect(todos.every((t) => !('progress' in t))).toBe(true)
  })
})

describe('v72 files', () => {
  afterEach(async () => {
    await resetDb()
  })

  it('a v71 file imports as an upgraded file: its Progress texts are entries (revived dates), the tasks without them', () => {
    const prepared = prepareImport(JSON.parse(JSON.stringify({ [SCHEMA_VERSION_KEY]: 71, todos: [v71Todo()], settings: [] })) as unknown)
    if (!prepared.ok) throw new Error(prepared.error)
    expect(prepared.sourceVersion).toBe(71)
    expect(prepared.upgraded).toBe(true)
    expect(prepared.warnings).toEqual([])
    expect(prepared.data.statusUpdates).toEqual([{ todoId: 1, date: new Date(2026, 9, 5), text: 'waiting on numbers', createdAt: modified }])
    expect(prepared.data.todos[0]).not.toHaveProperty('progress')
  })

  it('a v71 task archive (a partial dataset) appends with its Progress as an entry', () => {
    const prepared = prepareImport(
      JSON.parse(JSON.stringify({ [SCHEMA_VERSION_KEY]: 71, kind: 'task-archive', todos: [v71Todo()], todoPeople: [], todoTags: [], todoEvents: [], people: [], tags: [], statuses: [] })) as unknown,
      { purpose: 'append' },
    )
    if (!prepared.ok) throw new Error(prepared.error)
    expect(prepared.data.statusUpdates.map((r) => r.text)).toEqual(['waiting on numbers'])
  })

  it('export → restore keeps every entry as it was', async () => {
    const todoId = await db.todos.add({ uid: 'u1', title: 'Q4 budget', isCompleted: false, sortOrder: 0, createdAt: created, modifiedAt: modified })
    await db.statusUpdates.bulkAdd([
      { todoId, date: new Date(2026, 9, 1), text: 'Asked for the numbers', createdAt: new Date(2026, 9, 1, 10) },
      { todoId, date: new Date(2026, 9, 5), text: 'Numbers in', createdAt: modified, followedUp: true },
    ])
    const stored = await db.statusUpdates.toArray()
    const exported = await buildExportData()
    expect(exported[SCHEMA_VERSION_KEY]).toBe(CURRENT_DB_VERSION)
    await db.statusUpdates.clear()
    const prepared = prepareImport(JSON.parse(JSON.stringify(exported)) as unknown)
    if (!prepared.ok) throw new Error(prepared.error)
    expect(prepared.upgraded).toBe(false)
    await restoreFromImportData(prepared.data)
    expect(await db.statusUpdates.toArray()).toEqual(stored)
  })
})

describe('statusUpdates rows on import', () => {
  const row = (over: DataRow = {}): DataRow => ({
    id: 1, todoId: 1, date: '2026-10-05T00:00:00.000Z', text: 'half way', createdAt: '2026-10-05T12:00:00.000Z', ...over,
  })

  it('accepts a whole row, `followedUp: true` included', () => {
    expect(validateRow('statusUpdates', row())).toBe(true)
    expect(validateRow('statusUpdates', row({ followedUp: true }))).toBe(true)
  })

  it.each([
    ['text', { text: '' }],
    ['text', { text: 'x'.repeat(501) }],
    ['text', { text: 5 }],
    ['date', { date: 'soon' }],
    ['date', { date: undefined }],
    ['createdAt', { createdAt: undefined }],
    ['todoId', { todoId: 'one' }],
    ['id', { id: 0 }],
    ['followedUp', { followedUp: 'yes' }],
  ])('rejects a bad %s', (field, over) => {
    expect(validateRow('statusUpdates', row(over))).toBe(field)
  })

  it('revives the dates and keeps only a true followedUp', () => {
    expect(sanitizeRow('statusUpdates', row({ followedUp: true }))).toEqual({
      id: 1, todoId: 1, date: new Date('2026-10-05T00:00:00.000Z'), text: 'half way', createdAt: new Date('2026-10-05T12:00:00.000Z'), followedUp: true,
    })
    expect(sanitizeRow('statusUpdates', row({ followedUp: false }))).not.toHaveProperty('followedUp')
    expect(sanitizeRow('statusUpdates', row({ stray: 1 }))).not.toHaveProperty('stray')
  })
})
