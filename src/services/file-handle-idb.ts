const DB_NAME = 'todo2-meta'
const STORE_NAME = 'handles'
const KEY = 'todo2-primary'
const LEGACY_KEY = 'primary'
const DIR_KEY = 'todo2-last-directory'
const LEGACY_DIR_KEY = 'last-directory'

let cachedDB: IDBDatabase | null = null

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
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
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
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
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
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function saveLastPickerHandle(handle: FileSystemHandle): Promise<void> {
  const db = await openMetaDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).put(handle, DIR_KEY)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
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
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  }
  return legacy
}
