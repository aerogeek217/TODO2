import type { Page } from '@playwright/test'

/**
 * Straight-to-IndexedDB reads and writes of the app's database, for specs
 * that check what was stored or set up rows the UI can't make. Call them
 * once the app has booted (its Dexie open created the stores): opening a
 * database that doesn't exist yet would create an empty one. Rows cross the
 * page boundary through Playwright's serialisation, so Dates stay Dates.
 */

/** The app's IndexedDB database. */
export const DB_NAME = 'todo2'

export type Row = Record<string, unknown>

/** Every row of `store`. */
export async function readStore<T = Row>(page: Page, store: string): Promise<T[]> {
  const rows = await readStores(page, [store])
  return rows[store] as T[]
}

/**
 * Every row of each of `stores`, read in one transaction (one consistent
 * snapshot); every object store of the database when `stores` is omitted.
 */
export async function readStores(page: Page, stores?: readonly string[]): Promise<Record<string, Row[]>> {
  return page.evaluate(async ({ db, stores }) => {
    const idb = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(db)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    try {
      const names = stores ?? Array.from(idb.objectStoreNames)
      const tx = idb.transaction(names, 'readonly')
      const requests = names.map((name) => tx.objectStore(name).getAll())
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error ?? new Error('read aborted'))
      })
      return Object.fromEntries(names.map((name, i) => [name, requests[i]?.result as Array<Record<string, unknown>>]))
    } finally {
      idb.close()
    }
  }, { db: DB_NAME, stores: stores ? [...stores] : undefined })
}

export interface StoreWrites {
  /** Stores emptied first. */
  clear?: readonly string[]
  /** Rows added (a key clash fails the write). */
  add?: Readonly<Record<string, readonly object[]>>
  /** Rows put (added, or replacing the row with their key). */
  put?: Readonly<Record<string, readonly object[]>>
}

/** Writes rows in one readwrite transaction: `clear`, then `add`, then `put`. */
export async function writeStores(page: Page, writes: StoreWrites): Promise<void> {
  const clear = [...(writes.clear ?? [])]
  const add = Object.fromEntries(Object.entries(writes.add ?? {}).map(([store, rows]) => [store, [...rows]]))
  const put = Object.fromEntries(Object.entries(writes.put ?? {}).map(([store, rows]) => [store, [...rows]]))
  await page.evaluate(async ({ db, clear, add, put }) => {
    const idb = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(db)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    try {
      const names = [...new Set([...clear, ...Object.keys(add), ...Object.keys(put)])]
      const tx = idb.transaction(names, 'readwrite')
      for (const name of clear) tx.objectStore(name).clear()
      for (const [name, rows] of Object.entries(add)) for (const row of rows) tx.objectStore(name).add(row)
      for (const [name, rows] of Object.entries(put)) for (const row of rows) tx.objectStore(name).put(row)
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error ?? new Error('write aborted'))
      })
    } finally {
      idb.close()
    }
  }, { db: DB_NAME, clear, add, put })
}

/**
 * Resolves once every transaction the app started on `stores` before this
 * call has finished and its results reached the app: a readwrite
 * transaction over those stores (which writes nothing) only starts after
 * every earlier transaction that overlaps it has completed.
 */
export async function afterTransactionsOn(page: Page, stores: readonly string[]): Promise<void> {
  await page.evaluate(async ({ db, stores }) => {
    const idb = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(db)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    try {
      const tx = idb.transaction(stores, 'readwrite')
      // A request makes the transaction wait its turn behind earlier ones.
      tx.objectStore(stores[0] ?? '').count()
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
      })
    } finally {
      idb.close()
    }
  }, { db: DB_NAME, stores: [...stores] })
}

/** The names of the people (or tags) assigned to the task titled `title`, sorted; none when there is no such task. */
export async function assignedNames(page: Page, title: string, entities: 'people' | 'tags' = 'people'): Promise<string[]> {
  const [joinStore, key] = entities === 'people' ? ['todoPeople', 'personId'] : ['todoTags', 'tagId']
  const data = await readStores(page, ['todos', joinStore, entities])
  const todo = data.todos?.find((t) => t.title === title)
  if (!todo) return []
  const byId = new Map((data[entities] ?? []).map((e) => [e.id, e.name as string]))
  return (data[joinStore] ?? []).filter((j) => j.todoId === todo.id).map((j) => byId.get(j[key]) ?? '?').sort()
}
