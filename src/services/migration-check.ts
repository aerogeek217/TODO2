import { CURRENT_DB_VERSION, OLDEST_SUPPORTED_DB_VERSION } from '../data/database'

// Dexie multiplies version numbers by 10 for the native IDB version
const FLOOR_IDB_VERSION = OLDEST_SUPPORTED_DB_VERSION * 10

export interface UnsupportedDBInfo {
  currentVersion: number
  targetVersion: number
}

export async function checkUnsupportedOldDB(): Promise<UnsupportedDBInfo | null> {
  if (!indexedDB.databases) return null

  try {
    const databases = await indexedDB.databases()
    const existing = databases.find(d => d.name === 'todo2')

    if (!existing?.version || existing.version >= FLOOR_IDB_VERSION) return null

    return {
      currentVersion: Math.floor(existing.version / 10),
      targetVersion: CURRENT_DB_VERSION,
    }
  } catch {
    return null
  }
}

/** The browser's database, written by a newer build: its schema version and this build's. */
export interface TooNewDBInfo {
  storedVersion: number
  buildVersion: number
}

/**
 * The browser's database when a newer build wrote it (its version is above
 * `CURRENT_DB_VERSION`), else null. Checked before anything opens the
 * database, so this build neither reads nor writes it (the database's own
 * open refuses it too — `DatabaseTooNewError`).
 */
export async function checkTooNewDB(): Promise<TooNewDBInfo | null> {
  if (!indexedDB.databases) return null

  try {
    const databases = await indexedDB.databases()
    const existing = databases.find(d => d.name === 'todo2')
    const storedVersion = existing?.version ? Math.floor(existing.version / 10) : 0
    if (storedVersion <= CURRENT_DB_VERSION) return null
    return { storedVersion, buildVersion: CURRENT_DB_VERSION }
  } catch {
    return null
  }
}

export async function exportCurrentDatabase(dexieVersion: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('todo2', dexieVersion * 10)

    request.onsuccess = () => {
      const idb = request.result
      const tableNames = Array.from(idb.objectStoreNames)

      if (tableNames.length === 0) {
        idb.close()
        resolve(JSON.stringify({}, null, 2))
        return
      }

      const tx = idb.transaction(tableNames, 'readonly')
      const data: Record<string, unknown[]> = {}
      let completed = 0

      for (const name of tableNames) {
        const store = tx.objectStore(name)
        const req = store.getAll()
        req.onsuccess = () => {
          data[name] = req.result
          completed++
          if (completed === tableNames.length) {
            idb.close()
            resolve(JSON.stringify(data, null, 2))
          }
        }
        req.onerror = () => {
          idb.close()
          reject(new Error(`Failed to read table ${name}`))
        }
      }
    }

    request.onerror = () => reject(new Error('Failed to open database for export'))
  })
}
