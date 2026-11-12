import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CURRENT_DB_VERSION, db } from '../../data/database'
import { backupRepository } from '../../data/backup-repository'
import { buildExportData } from '../../data/export-data'
import { prepareImport, prepareImportText } from '../../data/import-pipeline'
import { SCHEMA_VERSION_KEY } from '../../data/file-version'
import { appendImportTasks } from '../../data/append-import'
import { todoRepository } from '../../data/todo-repository'
import { auditData } from '../../data/audit'
import { formatCheckinFilterSetting } from '../../data/checkin-filter-shape'
import { emptyPredicate } from '../../models/filter-predicate'
import { browserMatchesFile } from '../../services/file-sync-compare'
import { defaultAppendChoices, findAppendDuplicates } from '../../services/append-import'
import { restoreBackup, restoreFromImport } from '../../services/replace-data'
import { usePersonStore } from '../../stores/person-store'
import { useSettingsStore } from '../../stores/settings-store'
import { resetDb } from '../helpers'

/**
 * v80 through every real way in: a v79 dataset with people's addresses and
 * the check-in open method's settings row goes through the browser
 * database's own upgrade, Settings import, a backup restore and an append
 * import, and the result exports at v80 with none of it. The check-in
 * filter, the tasks' stamps and the history log's start stay. (The sync
 * file's load is `file-storage.test` › a v79 sync file.)
 */

const AT = '2026-11-01T09:00:00.000Z'
const FILTER = formatCheckinFilterSetting({ ...emptyPredicate(), searchText: 'review' })

/** A v79 export as the deployed build writes it. */
function v79File(): Record<string, unknown> {
  return {
    [SCHEMA_VERSION_KEY]: 79,
    todos: [
      { id: 1, uid: 'u1', title: 'Kept', isCompleted: false, sortOrder: 0, createdAt: AT, modifiedAt: AT },
      { id: 2, uid: 'u2', title: 'Also kept', isCompleted: false, sortOrder: 1, createdAt: AT, modifiedAt: '2026-11-02T09:00:00.000Z' },
    ],
    people: [
      { id: 1, name: 'Ada Lovelace', initials: 'AL', color: '#336699', email: 'ada@example.com' },
      { id: 2, name: 'Bob Stone', initials: 'BS', email: 'bob@example.com' },
    ],
    todoPeople: [{ id: 1, todoId: 1, personId: 1 }, { id: 2, todoId: 2, personId: 2 }],
    todoEvents: [{ id: 1, todoId: 1, type: 'created', fromValue: null, toValue: null, timestamp: AT }],
    settings: [
      { key: 'historyLogSince', value: AT },
      { key: 'checkinOpenMethod', value: 'eml' },
      { key: 'checkinTaskFilter', value: FILTER },
    ],
  }
}

/** What v80 leaves, read from the database and the stores; and an export holding none of the retired parts. */
async function expectV80Data(): Promise<void> {
  expect(await db.people.toArray()).toEqual([
    { id: 1, name: 'Ada Lovelace', initials: 'AL', color: '#336699' },
    { id: 2, name: 'Bob Stone', initials: 'BS' },
  ])
  expect(await db.settings.get('checkinOpenMethod')).toBeUndefined()
  expect(await db.settings.get('checkinTaskFilter')).toEqual({ key: 'checkinTaskFilter', value: FILTER })
  expect(await db.settings.get('historyLogSince')).toEqual({ key: 'historyLogSince', value: AT })
  expect((await db.todos.get(2))?.modifiedAt).toEqual(new Date('2026-11-02T09:00:00.000Z'))
  expect(await db.todoPeople.count()).toBe(2)
  expect((await auditData()).issues).toEqual([])

  await usePersonStore.getState().load()
  await useSettingsStore.getState().load()
  expect(usePersonStore.getState().people.map((p) => p.name)).toEqual(['Ada Lovelace', 'Bob Stone'])
  expect(useSettingsStore.getState().checkinTaskFilter.searchText).toBe('review')

  const exported = await buildExportData()
  expect(exported[SCHEMA_VERSION_KEY]).toBe(CURRENT_DB_VERSION)
  const text = JSON.stringify(exported)
  for (const gone of ['"email"', 'example.com', 'checkinOpenMethod']) expect(text, gone).not.toContain(gone)
  const back = prepareImportText(text)
  if (!back.ok) throw new Error(back.error)
  expect(back.upgraded).toBe(false)
  expect(back.warnings).toEqual([])
}

beforeEach(async () => {
  await resetDb()
})

describe('v80 through the real ways in', () => {
  it('Settings import of a v79 file', async () => {
    const prepared = prepareImportText(JSON.stringify(v79File()))
    if (!prepared.ok) throw new Error(prepared.error)
    expect(prepared.upgraded).toBe(true)
    expect(prepared.warnings).toEqual([])
    expect(await restoreFromImport(prepared.data)).toMatchObject({ status: 'done' })
    await expectV80Data()
  })

  it('a backup taken by a v79 build, restored', async () => {
    const id = await backupRepository.createSnapshotFromJson(JSON.stringify(v79File()), 'manual')
    expect(await restoreBackup(id)).toMatchObject({ status: 'done' })
    await expectV80Data()
  })

  it('an append import of a v79 file makes its people without addresses and takes none of its settings', async () => {
    const prepared = prepareImportText(JSON.stringify(v79File()), { purpose: 'append' })
    if (!prepared.ok) throw new Error(prepared.error)
    expect(prepared.warnings).toEqual([])
    const cands = findAppendDuplicates(prepared.data.todos, await todoRepository.getAll())
    expect(await appendImportTasks(prepared.data, defaultAppendChoices(cands))).toMatchObject({ imported: 2 })
    const people = await db.people.toArray()
    expect(people.map((p) => p.name).sort()).toEqual(['Ada Lovelace', 'Bob Stone'])
    expect(people.every((p) => !('email' in p))).toBe(true)
    expect(await db.settings.get('checkinOpenMethod')).toBeUndefined()
  })
})

// ── The browser database's own upgrade ─────────────────────────────────────────

type IndexSpec = [name: string, keyPath: string | string[], unique?: 'unique']

/** The stores and indexes a v79 build left (no store changed after v73). */
const V79_LAYOUT: Record<string, { auto: boolean; keyPath: string; indexes: IndexSpec[] }> = {
  backups: { keyPath: 'id', auto: true, indexes: [['createdAt', 'createdAt'], ['trigger', 'trigger']] },
  layouts: { keyPath: 'id', auto: true, indexes: [] },
  listDefinitions: { keyPath: 'id', auto: true, indexes: [['sortOrder', 'sortOrder']] },
  listOrders: { keyPath: 'id', auto: true, indexes: [['[listDefinitionId+todoId]', ['listDefinitionId', 'todoId'], 'unique'], ['listDefinitionId', 'listDefinitionId'], ['todoId', 'todoId']] },
  notes: { keyPath: 'id', auto: true, indexes: [['modifiedAt', 'modifiedAt']] },
  people: { keyPath: 'id', auto: true, indexes: [['name', 'name']] },
  settings: { keyPath: 'key', auto: false, indexes: [] },
  statuses: { keyPath: 'id', auto: true, indexes: [['sortOrder', 'sortOrder']] },
  statusUpdates: { keyPath: 'id', auto: true, indexes: [['todoId', 'todoId'], ['date', 'date']] },
  subtasks: { keyPath: 'id', auto: true, indexes: [['todoId', 'todoId']] },
  tags: { keyPath: 'id', auto: true, indexes: [['name', 'name']] },
  todoEvents: { keyPath: 'id', auto: true, indexes: [['timestamp', 'timestamp'], ['todoId', 'todoId'], ['type', 'type']] },
  todoPeople: { keyPath: 'id', auto: true, indexes: [['personId', 'personId'], ['todoId', 'todoId']] },
  todoTags: { keyPath: 'id', auto: true, indexes: [['tagId', 'tagId'], ['todoId', 'todoId']] },
  todos: { keyPath: 'id', auto: true, indexes: [['dueDate', 'dueDate'], ['isCompleted', 'isCompleted'], ['sortOrder', 'sortOrder'], ['statusId', 'statusId'], ['uid', 'uid', 'unique']] },
}

/** A raw `todo2` database as a v79 build left it — made without Dexie, so no second instance lingers. */
function createV79Db(rows: Record<string, Record<string, unknown>[]>): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('todo2', 790)
    req.onupgradeneeded = () => {
      for (const [name, spec] of Object.entries(V79_LAYOUT)) {
        const store = req.result.createObjectStore(name, { keyPath: spec.keyPath, autoIncrement: spec.auto })
        for (const [index, keyPath, unique] of spec.indexes) store.createIndex(index, keyPath, { unique: unique === 'unique' })
      }
      for (const [name, list] of Object.entries(rows)) {
        const store = req.transaction!.objectStore(name)
        for (const row of list) store.add(row)
      }
    }
    req.onsuccess = () => { req.result.close(); resolve() }
    req.onerror = () => reject(req.error)
  })
}

/** The v79 file's rows as a v79 database holds them: dates as Dates. */
function v79Rows(): Record<string, Record<string, unknown>[]> {
  const file = v79File()
  const dated = (rows: unknown, keys: string[]) => (rows as Record<string, unknown>[]).map((r) => {
    const out = { ...r }
    for (const k of keys) if (typeof out[k] === 'string') out[k] = new Date(out[k])
    return out
  })
  return {
    todos: dated(file.todos, ['createdAt', 'modifiedAt']),
    people: file.people as Record<string, unknown>[],
    todoPeople: file.todoPeople as Record<string, unknown>[],
    todoEvents: file.todoEvents as Record<string, unknown>[],
    settings: file.settings as Record<string, unknown>[],
  }
}

describe('v80 through the browser database’s own upgrade', () => {
  afterEach(async () => {
    db.close()
    await resetDb()
  })

  it('a v79 database opens at v80 converted, and reads as the same data imported as a v79 file', async () => {
    db.close()
    await db.delete()
    await createV79Db(v79Rows())
    await db.open()
    expect(db.verno).toBe(CURRENT_DB_VERSION)
    expect(db.backendDB().version).toBe(CURRENT_DB_VERSION * 10)
    await expectV80Data()

    const file = prepareImport(JSON.parse(JSON.stringify(v79File())))
    if (!file.ok) throw new Error(file.error)
    expect(await browserMatchesFile(file.data)).toBe(true)
  })
})
