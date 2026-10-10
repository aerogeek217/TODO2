import type { Table } from 'dexie'
import { db, ensureSeededStatuses } from './database'
import type { ImportData } from './import-validation'
import { prepareImportText } from './import-pipeline'
import type { Taskboard } from '../models'

/**
 * Restricts to keys whose value type is an array. The bulk-add dispatch only
 * walks these keys; non-array fields (none today) wouldn't make sense.
 */
type ImportArrayKey = keyof {
  [K in keyof ImportData as Required<ImportData>[K] extends ReadonlyArray<unknown> ? K : never]: ImportData[K]
}

type RowOf<K extends keyof ImportData> =
  Required<ImportData>[K] extends ReadonlyArray<infer R> ? R : never

interface BulkAddPair {
  key: ImportArrayKey
  table: Table
  bulkAddIfPresent(data: ImportData): Promise<void>
}

/**
 * Binds a key from `ImportData` to its destination Dexie table at construction
 * time. The closure-captured `table` keeps its full generic shape so
 * `bulkAdd(rows)` typechecks without per-call-site casts.
 */
function bulkAddPair<K extends ImportArrayKey & keyof ImportData>(
  key: K,
  table: Table<RowOf<K>>,
): BulkAddPair {
  return {
    key,
    table: table as unknown as Table,
    async bulkAddIfPresent(data: ImportData) {
      const rows = data[key] as ReadonlyArray<RowOf<K>> | undefined
      if (rows && rows.length > 0) {
        await table.bulkAdd(rows)
      }
    },
  }
}

const TABLE_KEY_PAIRS: BulkAddPair[] = [
  bulkAddPair('todos', db.todos),
  bulkAddPair('projects', db.projects),
  bulkAddPair('canvases', db.canvases),
  bulkAddPair('people', db.people),
  bulkAddPair('settings', db.settings),
  bulkAddPair('todoPeople', db.todoPeople),
  bulkAddPair('todoOrgs', db.todoOrgs),
  bulkAddPair('personOrgs', db.personOrgs),
  bulkAddPair('orgs', db.orgs),
  bulkAddPair('floatingTaskboards', db.floatingTaskboards),
  bulkAddPair('statuses', db.statuses),
  bulkAddPair('listDefinitions', db.listDefinitions),
  bulkAddPair('floatingCalendars', db.floatingCalendars),
  bulkAddPair('floatingNotes', db.floatingNotes),
  bulkAddPair('floatingStatus', db.floatingStatus),
  bulkAddPair('tags', db.tags),
  bulkAddPair('todoTags', db.todoTags),
  bulkAddPair('todoEvents', db.todoEvents),
]

/**
 * Clear all data tables and bulk-add validated rows verbatim. The taskboards
 * table is a singleton — if no row is imported, seed an empty one. After the
 * bulk pass, `ensureSeededStatuses` fills in the seeded statuses if the
 * imported data lacks them. List definitions are not seeded — an import with
 * none restores with none.
 */
export async function restoreFromImportData(v: ImportData): Promise<void> {
  const tables = TABLE_KEY_PAIRS.map((p) => p.table).concat([db.listInsets, db.notes, db.taskboards])
  await db.transaction('rw', tables, async () => {
    for (const p of TABLE_KEY_PAIRS) await p.table.clear()
    await db.listInsets.clear()
    await db.notes.clear()
    await db.taskboards.clear()

    for (const p of TABLE_KEY_PAIRS) {
      await p.bulkAddIfPresent(v)
    }

    if (v.listInsets.length > 0) {
      await db.listInsets.bulkAdd(v.listInsets)
    }

    if (v.notes.length > 0) {
      await db.notes.bulkAdd(v.notes)
    }

    if (v.taskboards.length > 0) {
      await db.taskboards.bulkAdd(v.taskboards)
    } else {
      const now = new Date()
      await db.taskboards.add({
        entries: [],
        createdAt: now,
        updatedAt: now,
      } as Taskboard)
    }

    await ensureSeededStatuses(db.statuses, db.settings)
  })
}

/**
 * Parse a JSON string, run it through the unified import pipeline
 * (`prepareImport`: version check → schema upgrade → validation), and restore
 * all data tables. Returns an error string on failure.
 *
 * Does not prompt for below-floor files — callers that may see one (backup
 * restore in Settings) check `prepareImportText(...).legacy` and confirm via
 * `MigrationDialog` first.
 */
export async function parseAndRestore(jsonString: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const result = prepareImportText(jsonString)
  if (!result.ok) return { ok: false, error: result.error }

  await restoreFromImportData(result.data)
  return { ok: true }
}
