const CURRENT_DB_VERSION = 20
// Dexie multiplies version numbers by 10 for the native IDB version
const CURRENT_IDB_VERSION = CURRENT_DB_VERSION * 10

export interface PendingMigration {
  version: number
  description: string
}

const DATA_MIGRATIONS: PendingMigration[] = [
  {
    version: 20,
    description: 'Starred and Assigned flags are merged into the new Status system. Default "Assigned" and "Follow-up" statuses will be created, and starred list insets will be removed.',
  },
]

export interface MigrationInfo {
  currentVersion: number
  targetVersion: number
  migrations: PendingMigration[]
}

export interface LegacyImportInfo {
  starredCount: number
  assignedCount: number
  starredInsetCount: number
  descriptions: string[]
}

export async function checkMigrationNeeded(): Promise<MigrationInfo | null> {
  if (!indexedDB.databases) return null

  try {
    const databases = await indexedDB.databases()
    const existing = databases.find(d => d.name === 'todo2')

    if (!existing?.version || existing.version >= CURRENT_IDB_VERSION) return null

    // Convert IDB version back to Dexie version for migration filtering
    const dexieVersion = Math.floor(existing.version / 10)
    const pending = DATA_MIGRATIONS.filter(m => m.version > dexieVersion)
    if (pending.length === 0) return null

    return {
      currentVersion: dexieVersion,
      targetVersion: CURRENT_DB_VERSION,
      migrations: pending,
    }
  } catch {
    return null
  }
}

export function detectLegacyFormat(raw: unknown): LegacyImportInfo | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>

  const todos = Array.isArray(r.todos) ? r.todos : []
  const listInsets = Array.isArray(r.listInsets) ? r.listInsets : []

  let starredCount = 0
  let assignedCount = 0
  for (const t of todos) {
    if (t && typeof t === 'object') {
      if ((t as Record<string, unknown>).isStarred === true) starredCount++
      if ((t as Record<string, unknown>).isAssigned === true) assignedCount++
    }
  }

  const starredInsetCount = listInsets.filter(
    li => li && typeof li === 'object' && (li as Record<string, unknown>).preset === 'starred'
  ).length

  if (starredCount === 0 && assignedCount === 0 && starredInsetCount === 0) return null

  const descriptions: string[] = []
  if (starredCount > 0) descriptions.push(`${starredCount} starred task(s) will be converted to "Follow-up" status`)
  if (assignedCount > 0) descriptions.push(`${assignedCount} assigned task(s) will be converted to "Assigned" status`)
  if (starredInsetCount > 0) descriptions.push(`${starredInsetCount} starred list inset(s) will be removed`)

  return { starredCount, assignedCount, starredInsetCount, descriptions }
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
