import { ALL_DATA_TABLES, DATA_TABLES, db, ensureSeededStatuses } from './database'
import type { ImportData } from './import-validation'
import { prepareImportText } from './import-pipeline'
import { DATA_TABLE_NAMES, type DataTableName } from './tables'

/** Adds `data`'s rows of one table (none when it has none). */
async function bulkAddRows<K extends DataTableName>(name: K, data: ImportData): Promise<void> {
  const rows = data[name]
  if (rows.length > 0) await DATA_TABLES[name].bulkAdd(rows)
}

/**
 * Clear all data tables and bulk-add validated rows verbatim. After the
 * bulk pass, `ensureSeededStatuses` fills in the seeded statuses if the
 * imported data lacks them. List definitions are not seeded — an import with
 * none restores with none.
 */
export async function restoreFromImportData(v: ImportData): Promise<void> {
  await db.transaction('rw', [...ALL_DATA_TABLES], async () => {
    for (const table of ALL_DATA_TABLES) await table.clear()

    for (const name of DATA_TABLE_NAMES) await bulkAddRows(name, v)

    await ensureSeededStatuses(db.statuses, db.settings)
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
