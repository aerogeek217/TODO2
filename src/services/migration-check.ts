import { CURRENT_DB_VERSION } from '../data/database'

export const SCHEMA_VERSION_KEY = '__schemaVersion'

// Dexie multiplies version numbers by 10 for the native IDB version
const CURRENT_IDB_VERSION = CURRENT_DB_VERSION * 10

export interface MigrationInfo {
  currentVersion: number
  targetVersion: number
}

export interface LegacyImportInfo {
  /**
   * Source schema version, when the file embeds `__schemaVersion` (true for any
   * file written by this build of the app or later). `null` for legacy files
   * that lack the marker; in that case `descriptions` carries field-shape
   * signals from heuristic detection (pre-v23 fields) and the dialog falls
   * back to "an earlier format" wording.
   */
  sourceVersion: number | null
  targetVersion: number
  descriptions: string[]
}

export async function checkMigrationNeeded(): Promise<MigrationInfo | null> {
  if (!indexedDB.databases) return null

  try {
    const databases = await indexedDB.databases()
    const existing = databases.find(d => d.name === 'todo2')

    if (!existing?.version || existing.version >= CURRENT_IDB_VERSION) return null

    return {
      currentVersion: Math.floor(existing.version / 10),
      targetVersion: CURRENT_DB_VERSION,
    }
  } catch {
    return null
  }
}

export function detectLegacyFormat(raw: unknown): LegacyImportInfo | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>

  // Authoritative path: file embeds its own schema version (every export
  // written after the migration-check rewrite carries `__schemaVersion`).
  // Anything below current → prompt; equal-or-above → no prompt.
  const embedded = r[SCHEMA_VERSION_KEY]
  if (typeof embedded === 'number' && Number.isFinite(embedded)) {
    if (embedded >= CURRENT_DB_VERSION) return null
    return {
      sourceVersion: embedded,
      targetVersion: CURRENT_DB_VERSION,
      descriptions: [],
    }
  }

  // Heuristic fallback for files that pre-date the `__schemaVersion` marker:
  // sniff for the field shapes that existed in v20–v22 and got rewritten in
  // v20→v23. We can't tell apart v23..v(current-1) without the marker; the
  // restore pipeline transforms those rows in place either way, so this prompt
  // is only a courtesy when we know we're touching pre-v23 data.
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

  let starredInsetCount = 0
  let priorityInsetCount = 0
  let legacyInsetCount = 0
  for (const li of listInsets) {
    if (!li || typeof li !== 'object') continue
    const lo = li as Record<string, unknown>
    if (lo.preset === 'starred') {
      starredInsetCount++
      continue
    }
    if (lo.preset === 'high-priority') {
      priorityInsetCount++
      continue
    }
    const af = lo.attributeFilter as Record<string, unknown> | undefined
    if (af && af.type === 'priority') {
      priorityInsetCount++
      continue
    }
    const hasLegacyPreset = typeof lo.preset === 'string'
    const hasLegacyAttr = af && typeof af.type === 'string'
    if (lo.listDefinitionId == null && (hasLegacyPreset || hasLegacyAttr)) {
      legacyInsetCount++
    }
  }

  const totalLegacy = starredCount + assignedCount + starredInsetCount
    + priorityTaskCount + hardDeadlineCount + priorityInsetCount + legacyInsetCount
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
  if (legacyInsetCount > 0) descriptions.push(
    `${legacyInsetCount} canvas list inset(s) will be converted to list definitions`
  )

  return {
    sourceVersion: null,
    targetVersion: CURRENT_DB_VERSION,
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
