import { CURRENT_DB_VERSION, OLDEST_SUPPORTED_DB_VERSION } from '../data/database'

const DB_NAME = 'todo2'

// Dexie multiplies version numbers by 10 for the native IDB version
const FLOOR_IDB_VERSION = OLDEST_SUPPORTED_DB_VERSION * 10

/**
 * The native IndexedDB version of the app's database (Dexie stores schema ×
 * 10), or 0 when there is none — read without opening it through the schema:
 * from the browser's list of databases, or, where the browser can't list
 * them, from a raw open with no version (which never upgrades; one that would
 * create the database is aborted, so none is made).
 */
async function storedNativeVersion(): Promise<number> {
  try {
    if (indexedDB.databases) {
      const databases = await indexedDB.databases()
      return databases.find(d => d.name === DB_NAME)?.version ?? 0
    }
  } catch {
    // Listing failed: read it from the database instead.
  }
  return probeNativeVersion()
}

function probeNativeVersion(): Promise<number> {
  return new Promise((resolve) => {
    let req: IDBOpenDBRequest
    try {
      req = indexedDB.open(DB_NAME)
    } catch {
      resolve(0)
      return
    }
    req.onupgradeneeded = () => {
      // No database yet (an open with no version upgrades only from nothing).
      req.transaction?.abort()
    }
    req.onsuccess = () => {
      const version = req.result.version
      req.result.close()
      resolve(version)
    }
    req.onerror = () => resolve(0)
    req.onblocked = () => resolve(0)
  })
}

/** The browser's database, below the floor: its schema version and the floor. */
export interface TooOldDBInfo {
  storedVersion: number
  floorVersion: number
}

/**
 * The browser's database when it is below the floor
 * (`OLDEST_SUPPORTED_DB_VERSION`), else null. Read without opening it through
 * the schema (`storedNativeVersion`), before anything else opens it: this
 * build neither reads nor writes (nor upgrades) it. Should anything open it
 * anyway, the database's own open refuses it (`DatabaseTooOldError`).
 */
export async function checkTooOldDB(): Promise<TooOldDBInfo | null> {
  const version = await storedNativeVersion()
  if (!version || version >= FLOOR_IDB_VERSION) return null
  return {
    storedVersion: Math.floor(version / 10),
    floorVersion: OLDEST_SUPPORTED_DB_VERSION,
  }
}

/** The browser's database, written by a newer build: its schema version and this build's. */
export interface TooNewDBInfo {
  storedVersion: number
  buildVersion: number
}

/**
 * The browser's database when a newer build wrote it (its version is above
 * `CURRENT_DB_VERSION`), else null. Read without opening it through the
 * schema (`storedNativeVersion`), before anything else opens it, so this
 * build neither reads nor writes it (the database's own open refuses it too
 * — `DatabaseTooNewError` — though only after Dexie has opened it).
 */
export async function checkTooNewDB(): Promise<TooNewDBInfo | null> {
  const storedVersion = Math.floor(await storedNativeVersion() / 10)
  if (storedVersion <= CURRENT_DB_VERSION) return null
  return { storedVersion, buildVersion: CURRENT_DB_VERSION }
}
