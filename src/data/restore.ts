import { db, ensureSeededStatuses, type Todo2Database } from './database'
import type { ImportData } from './import-validation'
import { prepareImportText } from './import-pipeline'
import { DATA_TABLE_NAMES } from './tables'

/**
 * Clear all data tables and bulk-add validated rows verbatim. After the
 * bulk pass, `ensureSeededStatuses` fills in the seeded statuses if the
 * imported data lacks them. List definitions are not seeded — an import with
 * none restores with none. `database`: the app's (default), or a fresh
 * instance (`replaceUnreadableDatabase`, after a refused open left the app's
 * with the floor's tables only).
 */
export async function restoreFromImportData(v: ImportData, database: Todo2Database = db): Promise<void> {
  const tables = DATA_TABLE_NAMES.map((name) => database.table(name))
  await database.transaction('rw', tables, async () => {
    for (const table of tables) await table.clear()

    for (const name of DATA_TABLE_NAMES) {
      const rows = v[name]
      if (rows.length > 0) await database.table(name).bulkAdd(rows)
    }

    await ensureSeededStatuses(database.statuses, database.settings)
  })
}

/**
 * Parse a JSON string, run it through the unified import pipeline
 * (`prepareImport`: version check → schema upgrade → validation), and restore
 * all data tables. Returns an error string on failure — also for a file
 * below the floor or newer than this build, which restores nothing.
 */
export async function parseAndRestore(jsonString: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const result = prepareImportText(jsonString)
  if (!result.ok) return { ok: false, error: result.error }

  await restoreFromImportData(result.data)
  return { ok: true }
}
