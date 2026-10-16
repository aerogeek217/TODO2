import { db } from './database'
import { readDataTables } from './export-data'
import { DATA_TABLE_NAMES } from './tables'
import {
  KNOWN_DB_TABLES,
  validateRow,
  isKnownSettingKey,
  rowFixes,
  sanitizeRow,
} from './import-validation'
import { hasRecurrenceAnchor } from './recurrence-anchor'

export interface AuditSample {
  /** The full offending record. JSON-serialised verbatim in the detail popup. */
  row: Record<string, unknown>
  /**
   * The row's primary key — numeric `id` for most tables, string `key` for
   * settings, undefined when the source row has no stable identity (sample
   * pulled from an unknown store with no key path).
   */
  id?: number | string
  /**
   * Field names whose value triggered the issue. The detail popup highlights
   * these to point the eye at the broken column without forcing the user to
   * eyeball the whole record. Examples: the FK column whose target was
   * deleted (`todoId` for an orphaned join), the dangling-FK field that the
   * cleanup will null out, or the bad field reported by `validateRow`.
   */
  badFields?: string[]
  /** Plain-English context shown above the JSON, e.g. "todoId 999 not in todos". */
  note?: string
}

export interface AuditIssue {
  table: string
  description: string
  count: number
  /** IDs of rows to delete (join orphans) or update (dangling FK) */
  ids: number[]
  /**
   * String keys for delete-by-key tables. Used by the unknown-setting check —
   * `db.settings` is keyed by `key`, not numeric `id`.
   */
  keys?: string[]
  /**
   * `'drop-store'` wipes an entire IDB object store via raw IDB (Dexie does
   * not expose deleteObjectStore at runtime; the closest safe primitive is
   * `clear()`). The empty store remains until a future schema bump.
   * `'sanitize'` rewrites each row the way import stores it (`sanitizeRow`),
   * dropping the malformed parts `rowFixes` names.
   */
  fix: 'delete' | 'clear-field' | 'drop-store' | 'sanitize'
  field?: string
  /**
   * Up to `MAX_SAMPLES_PER_ISSUE` of the offending rows for the detail popup.
   * Capped to keep the in-memory report light when an unknown table holds
   * thousands of rows. The full `count` still drives cleanup.
   */
  samples?: AuditSample[]
}

/**
 * Cap on per-issue sample collection. The popup shows "N of M" when truncated.
 * 25 fits comfortably in the dialog without paging and bounds report size.
 */
export const MAX_SAMPLES_PER_ISSUE = 25

export interface AuditReport {
  issues: AuditIssue[]
  totalOrphans: number
  scannedAt: Date
}

function rawCount(idb: IDBDatabase, name: string): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const tx = idb.transaction([name], 'readonly')
    const req = tx.objectStore(name).count()
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function rawClear(idb: IDBDatabase, name: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const tx = idb.transaction([name], 'readwrite')
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
    tx.objectStore(name).clear()
  })
}

/**
 * Pull up to `limit` rows from an IDB object store via raw IDB. The audit's
 * unknown-store detection runs before Dexie has registered the store, so we
 * cannot use `db.table(name).limit(...)` here.
 */
function rawSample(idb: IDBDatabase, name: string, limit: number): Promise<unknown[]> {
  return new Promise<unknown[]>((resolve, reject) => {
    const tx = idb.transaction([name], 'readonly')
    const req = tx.objectStore(name).getAll(null, limit)
    req.onsuccess = () => resolve(req.result as unknown[])
    req.onerror = () => reject(req.error)
  })
}

/**
 * Strip Dexie/IDB internals from the row before handing it to the popup so
 * the JSON view shows the same shape the user authored. We don't have any
 * such fields today, but this is the choke point if we ever do.
 */
function toSampleRow(row: unknown): Record<string, unknown> {
  if (row !== null && typeof row === 'object') return { ...(row as Record<string, unknown>) }
  return { value: row }
}

/**
 * Map an FK column on a join row to the table it points at, for the popup's
 * "todoId 999 not in todos" hover note.
 */
function joinTargetTable(field: string): string {
  switch (field) {
    case 'todoId': return 'todos'
    case 'personId': return 'people'
    case 'tagId': return 'tags'
    case 'statusId': return 'statuses'
    case 'listDefinitionId': return 'listDefinitions'
    default: return field
  }
}

/** Scan all tables for orphaned join rows and dangling foreign keys. */
export async function auditData(): Promise<AuditReport> {
  const issues: AuditIssue[] = []

  // --- Unknown IDB object stores (loudest signal of a cross-floor load) ---
  // Walk the native IDB store list rather than `db.tables` so we catch stores
  // left behind by older schemas that are no longer Dexie-registered.
  const idb = db.backendDB()
  const allStoreNames = Array.from(idb.objectStoreNames)
  for (const name of allStoreNames) {
    if (KNOWN_DB_TABLES.has(name)) continue
    const count = await rawCount(idb, name)
    if (count === 0) continue
    const sampleRows = await rawSample(idb, name, MAX_SAMPLES_PER_ISSUE)
    issues.push({
      table: name,
      description: `Unknown table "${name}" — drop the entire store`,
      count,
      ids: [],
      fix: 'drop-store',
      field: '__store__',
      samples: sampleRows.map((r) => {
        const row = toSampleRow(r)
        const id = typeof row.id === 'number' || typeof row.id === 'string' ? row.id : undefined
        return { row, id, note: `Row in unregistered store "${name}"` }
      }),
    })
  }

  const tables = await readDataTables()
  const { todos, people, statuses, tags, todoPeople, todoTags, todoEvents, listDefinitions, listOrders } = tables
  const settingsRows = tables.settings

  // --- Unknown rows in known tables ---
  // Run validateRow over every row so a forced cross-floor load surfaces any
  // pre-strip-shape data the current validators reject. Skip `settings` —
  // it's keyed by string (`key`) rather than numeric `id`, so the two
  // dedicated settings passes below handle it via delete-by-key: the
  // unknown-key pass for rows whose `key` isn't recognized, and the
  // invalid-value pass for rows whose `key` is fine but whose `value`
  // fails the per-key value validator (legacy shapes, stale formats).
  for (const tableKey of DATA_TABLE_NAMES) {
    if (tableKey === 'settings' || tableKey === 'layouts') continue
    const rows: readonly unknown[] = tables[tableKey]
    const badIds: number[] = []
    const badSamples: AuditSample[] = []
    const fixIds: number[] = []
    const fixSamples: AuditSample[] = []
    for (const row of rows) {
      const result = validateRow(tableKey, row)
      if (result === true) {
        // Readable, but with parts an import would drop (e.g. a malformed
        // list filter stored before import checked them).
        const fixes = rowFixes(tableKey, row)
        const id = (row as { id?: number }).id
        if (fixes.length > 0 && typeof id === 'number') {
          fixIds.push(id)
          if (fixSamples.length < MAX_SAMPLES_PER_ISSUE) {
            fixSamples.push({ row: toSampleRow(row), id, note: `Cleanup: ${fixes.join(', ')}` })
          }
        }
        continue
      }
      const id = (row as { id?: number }).id
      if (typeof id !== 'number') continue
      badIds.push(id)
      if (badSamples.length < MAX_SAMPLES_PER_ISSUE) {
        // `validateRow` returns the bad field name (or a short phrase like
        // "key (unrecognized)") on failure. Strip the parenthetical so the
        // popup can highlight the field name reliably.
        const badField = result.replace(/\s*\(.*\)$/, '').trim()
        badSamples.push({
          row: toSampleRow(row),
          id,
          badFields: badField ? [badField] : [],
          note: `Schema validator rejected this row: ${result}`,
        })
      }
    }
    if (badIds.length > 0) {
      issues.push({
        table: tableKey,
        description: `Rows in "${tableKey}" that the current schema cannot read`,
        count: badIds.length,
        ids: badIds,
        fix: 'delete',
        samples: badSamples,
      })
    }
    if (fixIds.length > 0) {
      issues.push({
        table: tableKey,
        description: `Rows in "${tableKey}" with malformed parts (cleanup drops those parts, as an import would)`,
        count: fixIds.length,
        ids: fixIds,
        fix: 'sanitize',
        samples: fixSamples,
      })
    }
  }

  // --- Unknown setting keys ---
  const unknownSettings = settingsRows.filter((s) => !isKnownSettingKey(s.key))
  if (unknownSettings.length > 0) {
    issues.push({
      table: 'settings',
      description: 'Unrecognized settings — no UI will read or write them',
      count: unknownSettings.length,
      ids: [],
      keys: unknownSettings.map((s) => s.key),
      fix: 'delete',
      samples: unknownSettings.slice(0, MAX_SAMPLES_PER_ISSUE).map((s) => ({
        row: { key: s.key, value: s.value },
        id: s.key,
        badFields: ['key'],
        note: `"${s.key}" is not a setting any code in this build reads or writes`,
      })),
    })
  }

  // --- Settings rows with recognized keys but invalid values ---
  // The store-load code silently falls back to defaults for a row whose value
  // fails to parse (e.g. a malformed `followupDefaultInterval`), so the user
  // sees missing state, and exporting the DB round-trips the bad row into a backup that
  // `validateImportData` then refuses to re-import. Surface it here so the
  // audit cleanup can drop the row and let the next save re-seed.
  const invalidSettings = settingsRows
    .map((s) => ({ row: s, result: validateRow('settings', s) }))
    .filter((p): p is { row: typeof p.row; result: string } =>
      p.result !== true && isKnownSettingKey(p.row.key),
    )
  if (invalidSettings.length > 0) {
    issues.push({
      table: 'settings',
      description: 'Settings rows whose value the current schema cannot read',
      count: invalidSettings.length,
      ids: [],
      keys: invalidSettings.map((p) => p.row.key),
      fix: 'delete',
      samples: invalidSettings.slice(0, MAX_SAMPLES_PER_ISSUE).map(({ row, result }) => {
        const badField = result.replace(/\s*\(.*\)$/, '').trim()
        return {
          row: { key: row.key, value: row.value },
          id: row.key,
          badFields: badField ? [badField] : [],
          note: `Schema validator rejected this row: ${result}`,
        }
      }),
    })
  }

  const todoIds = new Set(todos.map((t) => t.id!))
  const personIds = new Set(people.map((p) => p.id!))
  const statusIds = new Set(statuses.map((s) => s.id!))
  const tagIds = new Set(tags.map((t) => t.id!))

  // --- Orphaned join rows ---

  /**
   * One `delete` issue for the rows of `table` with a foreign key whose
   * target is gone (`fks`: each column and the ids it may hold); nothing when
   * every row is whole. Each sample names the missing targets.
   */
  const orphanJoinRows = <R extends { id?: number }>(
    table: string,
    description: string,
    rows: readonly R[],
    fks: ReadonlyArray<{ field: keyof R & string; ids: ReadonlySet<number> }>,
  ): void => {
    const missingOf = (row: R) => fks.filter(({ field, ids }) => !ids.has(row[field] as number)).map((fk) => fk.field)
    const orphans = rows.filter((r) => missingOf(r).length > 0)
    if (orphans.length === 0) return
    issues.push({
      table,
      description,
      count: orphans.length,
      ids: orphans.map((r) => r.id!),
      fix: 'delete',
      samples: orphans.slice(0, MAX_SAMPLES_PER_ISSUE).map((r) => {
        const row = r as unknown as Record<string, unknown>
        const missing = missingOf(r)
        return {
          row: toSampleRow(row),
          id: typeof row.id === 'number' ? row.id : undefined,
          badFields: missing,
          note: missing.map((f) => `${f} ${String(row[f])} not in ${joinTargetTable(f)}`).join(' • '),
        }
      }),
    })
  }

  orphanJoinRows('todoPeople', 'Person assignments referencing deleted todos or people', todoPeople, [
    { field: 'todoId', ids: todoIds },
    { field: 'personId', ids: personIds },
  ])
  orphanJoinRows('todoTags', 'Tag assignments referencing deleted todos or tags', todoTags, [
    { field: 'todoId', ids: todoIds },
    { field: 'tagId', ids: tagIds },
  ])
  orphanJoinRows('listOrders', 'Manual list order entries referencing deleted todos or lists', listOrders, [
    { field: 'todoId', ids: todoIds },
    { field: 'listDefinitionId', ids: new Set(listDefinitions.map((d) => d.id!)) },
  ])
  orphanJoinRows('todoEvents', 'Event-log entries referencing deleted todos', todoEvents, [
    { field: 'todoId', ids: todoIds },
  ])

  // Helper: sample a row whose single FK column points at a deleted entity.
  // The popup highlights the dangling field and notes the missing target.
  const fkSample = (
    rows: { id?: number }[],
    field: string,
  ): AuditSample[] =>
    rows.slice(0, MAX_SAMPLES_PER_ISSUE).map((r) => {
      const obj = r as unknown as Record<string, unknown>
      return {
        row: toSampleRow(obj),
        id: typeof obj.id === 'number' ? (obj.id as number) : undefined,
        badFields: [field],
        note: `${field} ${String(obj[field])} not in ${joinTargetTable(field)}`,
      }
    })

  // --- Dangling foreign keys on entities ---

  const todosWithBadStatus = todos.filter(
    (t) => t.statusId != null && !statusIds.has(t.statusId),
  )
  if (todosWithBadStatus.length > 0) {
    issues.push({
      table: 'todos',
      description: 'Todos referencing deleted statuses',
      count: todosWithBadStatus.length,
      ids: todosWithBadStatus.map((t) => t.id!),
      fix: 'clear-field',
      field: 'statusId',
      samples: fkSample(todosWithBadStatus, 'statusId'),
    })
  }

  // --- Orphaned recurrence rules: rule set, but no due date to advance.
  // `recurrenceAnchor` (services/recurrence.ts) returns null without a
  // `dueDate`, so `advanceRecurring` short-circuits
  // and the rule never fires — the row carries dead data on disk. The
  // repository invariant (`todoRepository.update` / `bulkUpdate`) catches
  // this on every new write; this audit pass catches legacy rows that
  // pre-date the invariant or were written by a path that bypassed the
  // repository (e.g. raw `db.todos.update` somewhere). `clear-field` cleanup
  // strips `recurrenceRule`, leaving the rest of the row intact.
  const orphanedRecurrence = todos.filter(
    (t) => t.recurrenceRule != null && !hasRecurrenceAnchor(t),
  )
  if (orphanedRecurrence.length > 0) {
    issues.push({
      table: 'todos',
      description: 'Todos with a recurrence rule but no due date (rule never fires)',
      count: orphanedRecurrence.length,
      ids: orphanedRecurrence.map((t) => t.id!),
      fix: 'clear-field',
      field: 'recurrenceRule',
      samples: orphanedRecurrence.slice(0, MAX_SAMPLES_PER_ISSUE).map((t) => ({
        row: toSampleRow(t as unknown as Record<string, unknown>),
        id: t.id,
        badFields: ['recurrenceRule'],
        note: 'Recurrence rule has no anchor (no dueDate) — the rule can never fire',
      })),
    })
  }

  return {
    issues,
    totalOrphans: issues.reduce((sum, i) => sum + i.count, 0),
    scannedAt: new Date(),
  }
}

/** Clean up all issues found by auditData. */
export async function cleanupIssues(issues: AuditIssue[]): Promise<number> {
  let cleaned = 0

  // drop-store issues bypass Dexie — unknown stores aren't in the registered
  // schema, so `db.table(name)` would throw. Use raw IDB transactions.
  for (const issue of issues) {
    if (issue.fix !== 'drop-store') continue
    await rawClear(db.backendDB(), issue.table)
    cleaned += issue.count
  }

  await db.transaction('rw', db.tables, async () => {
    for (const issue of issues) {
      if (issue.fix === 'drop-store') continue
      if (issue.fix === 'delete') {
        const table = db.table(issue.table)
        if (issue.keys && issue.keys.length > 0) {
          await table.bulkDelete(issue.keys)
        } else {
          await table.bulkDelete(issue.ids)
        }
        cleaned += issue.count
      } else if (issue.fix === 'sanitize') {
        const table = db.table(issue.table)
        const key = issue.table as Parameters<typeof sanitizeRow>[0]
        for (const id of issue.ids) {
          const row: unknown = await table.get(id)
          if (row !== undefined) await table.put(sanitizeRow(key, row))
        }
        cleaned += issue.count
      } else if (issue.fix === 'clear-field' && issue.field) {
        const table = db.table(issue.table)
        for (const id of issue.ids) {
          await table.update(id, { [issue.field]: undefined })
        }
        cleaned += issue.count
      }
    }
  })
  return cleaned
}
