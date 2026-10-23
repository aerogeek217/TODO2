import { CURRENT_DB_VERSION, OLDEST_SUPPORTED_DB_VERSION } from '../data/database'

// Dexie multiplies version numbers by 10 for the native IDB version
const FLOOR_IDB_VERSION = OLDEST_SUPPORTED_DB_VERSION * 10

/** The browser's database, below the floor: its schema version and the floor. */
export interface TooOldDBInfo {
  storedVersion: number
  floorVersion: number
}

/**
 * The browser's database when it is below the floor
 * (`OLDEST_SUPPORTED_DB_VERSION`), else null. Read from the browser's list of
 * databases, so it is checked before anything opens the database: this
 * build neither reads nor writes (nor upgrades) it. Where the browser can't
 * list its databases, the database's own open refuses it
 * (`DatabaseTooOldError`).
 */
export async function checkTooOldDB(): Promise<TooOldDBInfo | null> {
  if (!indexedDB.databases) return null

  try {
    const databases = await indexedDB.databases()
    const existing = databases.find(d => d.name === 'todo2')

    if (!existing?.version || existing.version >= FLOOR_IDB_VERSION) return null

    return {
      storedVersion: Math.floor(existing.version / 10),
      floorVersion: OLDEST_SUPPORTED_DB_VERSION,
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
