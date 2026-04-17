const CURRENT_DB_VERSION = 21
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
  {
    version: 21,
    description: 'Priority is removed and replaced with Scheduled Date + Deadline (hard due-date). Tasks with a recurrence rule or hard-deadline flag keep their due date. Soft-due tasks move their date to "Scheduled". Priority-based list insets are removed.',
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
  /** v20→v21: todos with a legacy `priority: number` field (any value) */
  priorityTaskCount: number
  /** v20→v21: todos with `isHardDeadline === true` */
  hardDeadlineCount: number
  /** v20→v21: listInsets with preset='high-priority' or attributeFilter.type='priority' */
  priorityInsetCount: number
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
  let priorityTaskCount = 0
  let hardDeadlineCount = 0
  for (const t of todos) {
    if (t && typeof t === 'object') {
      const to = t as Record<string, unknown>
      if (to.isStarred === true) starredCount++
      if (to.isAssigned === true) assignedCount++
      if (typeof to.priority === 'number') priorityTaskCount++
      if (to.isHardDeadline === true) hardDeadlineCount++
    }
  }

  const starredInsetCount = listInsets.filter(
    li => li && typeof li === 'object' && (li as Record<string, unknown>).preset === 'starred'
  ).length

  let priorityInsetCount = 0
  for (const li of listInsets) {
    if (!li || typeof li !== 'object') continue
    const lo = li as Record<string, unknown>
    if (lo.preset === 'high-priority') {
      priorityInsetCount++
      continue
    }
    const af = lo.attributeFilter as Record<string, unknown> | undefined
    if (af && af.type === 'priority') priorityInsetCount++
  }

  const totalLegacy = starredCount + assignedCount + starredInsetCount
    + priorityTaskCount + hardDeadlineCount + priorityInsetCount
  if (totalLegacy === 0) return null

  const descriptions: string[] = []
  if (starredCount > 0) descriptions.push(`${starredCount} starred task(s) will be converted to "Follow-up" status`)
  if (assignedCount > 0) descriptions.push(`${assignedCount} assigned task(s) will be converted to "Assigned" status`)
  if (starredInsetCount > 0) descriptions.push(`${starredInsetCount} starred list inset(s) will be removed`)
  if (priorityTaskCount > 0) descriptions.push(
    `Priority values will be removed from ${priorityTaskCount} task(s) (task titles and dates are preserved)`
  )
  if (hardDeadlineCount > 0) descriptions.push(
    `${hardDeadlineCount} task(s) marked "hard deadline" will keep their due date as the new Deadline`
  )
  if (priorityInsetCount > 0) descriptions.push(
    `${priorityInsetCount} priority-based list inset(s) will be removed`
  )

  return {
    starredCount,
    assignedCount,
    starredInsetCount,
    priorityTaskCount,
    hardDeadlineCount,
    priorityInsetCount,
    descriptions,
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
