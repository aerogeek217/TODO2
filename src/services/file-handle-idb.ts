import { registerModuleReset } from '../utils/module-reset'

const DB_NAME = 'todo2-meta'
const STORE_NAME = 'handles'
const KEY = 'todo2-primary'
const LEGACY_KEY = 'primary'
const DIR_KEY = 'todo2-last-directory'
const LEGACY_DIR_KEY = 'last-directory'

let cachedDB: IDBDatabase | null = null

/**
 * Closes and forgets the cached connection, for tests that share one module
 * instance (e.g. before deleting the database). The next call reopens it.
 */
export function resetFileHandleCache(): void {
  cachedDB?.close()
  cachedDB = null
}
registerModuleReset(resetFileHandleCache)

/**
 * Settles a write transaction: resolves when it commits, rejects when it
 * fails or aborts (a quota abort fires `abort`, not `error`, on the
 * transaction — without it the promise would never settle).
 */
function settleOnDone(tx: IDBTransaction, resolve: () => void, reject: (reason: unknown) => void): void {
  tx.oncomplete = () => resolve()
  tx.onerror = () => reject(tx.error)
  tx.onabort = () => reject(tx.error ?? new DOMException('The write was aborted', 'AbortError'))
}

function openMetaDB(): Promise<IDBDatabase> {
  if (cachedDB) return Promise.resolve(cachedDB)
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME)
    }
    req.onsuccess = () => {
      cachedDB = req.result
      cachedDB.onclose = () => { cachedDB = null }
      // Drop the cache + close on a version-change event so a concurrent tab
      // running a newer schema can upgrade the meta DB without our held
      // handle blocking it. Without this, the second tab would hang on
      // openMetaDB() forever.
      cachedDB.onversionchange = () => {
        cachedDB?.close()
        cachedDB = null
      }
      resolve(cachedDB)
    }
    req.onerror = () => reject(req.error)
  })
}

export async function saveFileHandle(handle: FileSystemFileHandle): Promise<void> {
  const db = await openMetaDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).put(handle, KEY)
    settleOnDone(tx, resolve, reject)
  })
}

export async function loadFileHandle(): Promise<FileSystemFileHandle | null> {
  const db = await openMetaDB()
  const current = await new Promise<FileSystemFileHandle | null>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const req = tx.objectStore(STORE_NAME).get(KEY)
    req.onsuccess = () => resolve(req.result ?? null)
    req.onerror = () => reject(req.error)
  })
  if (current) return current
  const legacy = await new Promise<FileSystemFileHandle | null>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const req = tx.objectStore(STORE_NAME).get(LEGACY_KEY)
    req.onsuccess = () => resolve(req.result ?? null)
    req.onerror = () => reject(req.error)
  })
  if (legacy) {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)
      store.put(legacy, KEY)
      store.delete(LEGACY_KEY)
      settleOnDone(tx, resolve, reject)
    })
  }
  return legacy
}

export async function clearFileHandle(): Promise<void> {
  const db = await openMetaDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    store.delete(KEY)
    store.delete(LEGACY_KEY)
    settleOnDone(tx, resolve, reject)
  })
}

export async function saveLastPickerHandle(handle: FileSystemHandle): Promise<void> {
  const db = await openMetaDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).put(handle, DIR_KEY)
    settleOnDone(tx, resolve, reject)
  })
}

export async function loadLastPickerHandle(): Promise<FileSystemHandle | null> {
  const db = await openMetaDB()
  const current = await new Promise<FileSystemHandle | null>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const req = tx.objectStore(STORE_NAME).get(DIR_KEY)
    req.onsuccess = () => resolve(req.result ?? null)
    req.onerror = () => reject(req.error)
  })
  if (current) return current
  const legacy = await new Promise<FileSystemHandle | null>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const req = tx.objectStore(STORE_NAME).get(LEGACY_DIR_KEY)
    req.onsuccess = () => resolve(req.result ?? null)
    req.onerror = () => reject(req.error)
  })
  if (legacy) {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)
      store.put(legacy, DIR_KEY)
      store.delete(LEGACY_DIR_KEY)
      settleOnDone(tx, resolve, reject)
    })
  }
  return legacy
}
