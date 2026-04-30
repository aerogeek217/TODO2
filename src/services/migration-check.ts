import { CURRENT_DB_VERSION, OLDEST_SUPPORTED_DB_VERSION } from '../data/database'

export const SCHEMA_VERSION_KEY = '__schemaVersion'

// Dexie multiplies version numbers by 10 for the native IDB version
const FLOOR_IDB_VERSION = OLDEST_SUPPORTED_DB_VERSION * 10

export interface UnsupportedDBInfo {
  currentVersion: number
  targetVersion: number
}

export interface UnsupportedImportInfo {
  /**
   * Source schema version, when the file embeds `__schemaVersion` (true for any
   * file written by this build of the app or later). `null` for legacy files
   * that lack the marker; in that case `descriptions` is empty and the dialog
   * falls back to "an earlier format that this build no longer supports"
   * wording — heuristic detection of pre-floor field shapes was removed once
   * the translators those signals pointed at were stripped.
   */
  sourceVersion: number | null
  targetVersion: number
  descriptions: string[]
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

export function detectUnsupportedImport(raw: unknown): UnsupportedImportInfo | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>

  // Authoritative path: file embeds its own schema version (every export
  // written after the migration-check rewrite carries `__schemaVersion`).
  // Below the floor → prompt; at-or-above → no prompt.
  const embedded = r[SCHEMA_VERSION_KEY]
  if (typeof embedded === 'number' && Number.isFinite(embedded)) {
    if (embedded >= OLDEST_SUPPORTED_DB_VERSION) return null
    return {
      sourceVersion: embedded,
      targetVersion: CURRENT_DB_VERSION,
      descriptions: [],
    }
  }

  // Marker-less file: this build's exports have always carried
  // `__schemaVersion` since the migration-check rewrite, so a missing marker
  // means the file was written by an older build. We can't tell which version
  // — could be anywhere from the original v16 schema up to v(floor-1) — so we
  // prompt with empty descriptions and the dialog explains the file is in an
  // earlier format that this build no longer supports.
  return {
    sourceVersion: null,
    targetVersion: CURRENT_DB_VERSION,
    descriptions: [],
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
