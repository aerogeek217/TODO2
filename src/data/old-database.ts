import { db, Todo2Database } from './database'
import { SCHEMA_VERSION_KEY } from './file-version'
import type { ImportData } from './import-validation'
import { restoreFromImportData } from './restore'
import { clearUnsavedDrafts } from './draft-storage'

const DB_NAME = 'todo2'

/** Stores never written to a file: the automatic backups (whole snapshots of older data). */
const NOT_EXPORTED: ReadonlySet<string> = new Set(['backups'])

/**
 * The browser's database as an export file's text — read raw, without
 * opening it through this build's schema, so a database below the floor
 * (which this build refuses to open) can still be saved: every store but
 * the backups, stamped with its own schema version (`__schemaVersion`), so
 * the build that still upgrades it (`BELOW_FLOOR_BUILD`) imports the file.
 * The open has no version, which never upgrades; one that would create the
 * database is aborted (there is nothing to save then: `null`).
 */
export function readRawDatabaseExport(now: Date = new Date()): Promise<{ json: string; storedVersion: number } | null> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME)
    req.onupgradeneeded = () => {
      // No database yet: an open with no version upgrades only from nothing.
      req.transaction?.abort()
    }
    req.onerror = () => {
      if (req.error?.name === 'AbortError') resolve(null)
      else reject(req.error ?? new Error('The browser’s data could not be read'))
    }
    req.onsuccess = () => {
      const raw = req.result
      const names = Array.from(raw.objectStoreNames).filter((n) => !NOT_EXPORTED.has(n))
      const storedVersion = Math.floor(raw.version / 10)
      if (names.length === 0) {
        raw.close()
        resolve({ json: JSON.stringify({ [SCHEMA_VERSION_KEY]: storedVersion, exportedAt: now.toISOString() }, null, 2), storedVersion })
        return
      }
      const tx = raw.transaction(names, 'readonly')
      const tables: Record<string, unknown[]> = {}
      for (const name of names) {
        const get = tx.objectStore(name).getAll()
        get.onsuccess = () => { tables[name] = get.result }
      }
      tx.oncomplete = () => {
        raw.close()
        const file = { [SCHEMA_VERSION_KEY]: storedVersion, ...tables, exportedAt: now.toISOString() }
        resolve({ json: JSON.stringify(file, null, 2), storedVersion })
      }
      tx.onerror = () => {
        raw.close()
        reject(tx.error ?? new Error('The browser’s data could not be read'))
      }
    }
  })
}

/**
 * Replaces the browser's whole database with `data` (validated, current
 * shape — `prepareImport`'s), when this build can't open the one there (it
 * is below the floor): deletes it — every table, the automatic backups too —,
 * creates a fresh one at this build's version, and restores `data` into it.
 * The fresh database goes through its own `Todo2Database` instance: an open
 * the floor refused leaves the app's `db` holding the floor's tables only.
 * The unsaved layout and list edits kept for a reload go too (they name the
 * old data's ids). The caller reloads the page after.
 */
export async function replaceUnreadableDatabase(data: ImportData): Promise<void> {
  await db.delete()
  const fresh = new Todo2Database()
  try {
    await fresh.open()
    await restoreFromImportData(data, fresh)
  } finally {
    fresh.close()
  }
  clearUnsavedDrafts()
}
