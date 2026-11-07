import { describe, it, expect, afterEach, vi } from 'vitest'
import { CURRENT_DB_VERSION, OLDEST_SUPPORTED_DB_VERSION, db } from '../../data/database'

/**
 * The database declares the floor's store layout (no versions before it)
 * and the version steps after it: v69 – v71 change no store, v72 adds
 * `statusUpdates`, v73 adds `subtasks`. A v68 database as the builds that
 * declared every version left it — the layout below, read from one — must
 * open with only the version steps: no Dexie schema patch (which would add
 * a `$meta` store), every store and index kept, the two tables added, its
 * rows untouched.
 */

type IndexSpec = [name: string, keyPath: string | string[], unique?: 'unique']
interface StoreSpec { keyPath: string; auto: boolean; indexes: IndexSpec[] }

/** The v68 stores and indexes, frozen. */
const V68_LAYOUT: Record<string, StoreSpec> = {
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

/** The current layout: the floor's plus v72's `statusUpdates` and v73's `subtasks`. */
const V73_LAYOUT: Record<string, StoreSpec> = {
  ...V68_LAYOUT,
  statusUpdates: { keyPath: 'id', auto: true, indexes: [['date', 'date'], ['todoId', 'todoId']] },
  subtasks: { keyPath: 'id', auto: true, indexes: [['todoId', 'todoId']] },
}

const task = { id: 1, uid: 'u1', title: 'Kept', isCompleted: false, sortOrder: 0 }

/** A raw `todo2` database at native version `version` with `layout`'s stores and one task. */
function createRawDb(version: number, layout: Record<string, StoreSpec>): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('todo2', version)
    req.onupgradeneeded = () => {
      for (const [name, spec] of Object.entries(layout)) {
        const store = req.result.createObjectStore(name, { keyPath: spec.keyPath, autoIncrement: spec.auto })
        for (const [index, keyPath, unique] of spec.indexes) store.createIndex(index, keyPath, { unique: unique === 'unique' })
      }
      req.transaction!.objectStore('todos').add(task)
    }
    req.onsuccess = () => { req.result.close(); resolve() }
    req.onerror = () => reject(req.error)
  })
}

/** The raw database's native version, stores and indexes, and tasks. */
function readRawDb(): Promise<{ version: number; layout: Record<string, StoreSpec>; todos: unknown[] }> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('todo2')
    req.onsuccess = () => {
      const idb = req.result
      const names = Array.from(idb.objectStoreNames).sort()
      const tx = idb.transaction(names, 'readonly')
      const layout: Record<string, StoreSpec> = {}
      for (const name of names) {
        const store = tx.objectStore(name)
        layout[name] = {
          keyPath: store.keyPath as string,
          auto: store.autoIncrement,
          indexes: Array.from(store.indexNames).sort().map((i): IndexSpec => {
            const index = store.index(i)
            return index.unique ? [index.name, index.keyPath, 'unique'] : [index.name, index.keyPath]
          }),
        }
      }
      const get = tx.objectStore('todos').getAll()
      get.onsuccess = () => { idb.close(); resolve({ version: idb.version, layout, todos: get.result }) }
      get.onerror = () => { idb.close(); reject(get.error) }
    }
    req.onerror = () => reject(req.error)
  })
}

afterEach(async () => {
  db.close()
  await db.delete()
})

describe('the floor’s store layout', () => {
  it('the floor is v68, the current version v77', () => {
    expect(OLDEST_SUPPORTED_DB_VERSION).toBe(68)
    expect(CURRENT_DB_VERSION).toBe(77)
  })

  it('a v68 database as the full version chain left it opens at v77 with its stores, indexes and rows kept, statusUpdates and subtasks added: no patch', async () => {
    db.close()
    await db.delete()
    await createRawDb(680, V68_LAYOUT)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await db.open()
    expect(await db.todos.toArray()).toEqual([task])
    db.close()
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('SchemaDiff'))
    expect(await readRawDb()).toEqual({ version: 770, layout: V73_LAYOUT, todos: [task] })
  })

  it('a new database gets exactly the v68 layout plus statusUpdates and subtasks, at v77 (v69, v70, v71, v74, v75, v76 and v77 changed no store)', async () => {
    db.close()
    await db.delete()
    await db.open()
    db.close()
    const raw = await readRawDb()
    expect(raw.version).toBe(770)
    expect(raw.layout).toEqual(V73_LAYOUT)
  })
})
