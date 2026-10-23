import { ALL_DATA_TABLES, CURRENT_DB_VERSION, db } from './database'
import { prepareImportText } from './import-pipeline'
import { SCHEMA_VERSION_KEY } from './file-version'
import type { DataTableArrays } from './tables'

/** `buildExportData`'s return: every data table (`tables.ts`) by name, plus `__schemaVersion`. */
export type ExportData = { [SCHEMA_VERSION_KEY]: number } & DataTableArrays

/**
 * Reads every data table (`ALL_DATA_TABLES`, the registry in `tables.ts`)
 * inside one read-only Dexie transaction, so the result is a consistent
 * snapshot (a concurrent write can't land between two table reads and leave
 * e.g. a join row without its todo).
 */
export async function readDataTables(): Promise<DataTableArrays> {
  const entries = await db.transaction('r', [...ALL_DATA_TABLES], () =>
    Promise.all(
      ALL_DATA_TABLES.map(async (table) => [table.name, await table.toArray()] as const),
    ),
  )
  return Object.fromEntries(entries) as DataTableArrays
}

/**
 * Reads all database tables (`readDataTables`) and returns a plain object
 * suitable for JSON serialization (export, file-storage save, or backup
 * snapshot) — every data table, so it round-trips through `parseAndRestore`
 * without silent loss.
 *
 * The returned object is stamped with `__schemaVersion = CURRENT_DB_VERSION` so
 * the import path can detect older files without reaching for field-shape
 * heuristics (`data/import-pipeline.ts` `prepareImport`).
 */
export async function buildExportData(): Promise<ExportData> {
  return {
    [SCHEMA_VERSION_KEY]: CURRENT_DB_VERSION,
    ...await readDataTables(),
  }
}

/**
 * Export self-check: runs the serialized export back through the real import
 * pipeline (`prepareImportText` — version check, upgrade, validation). Returns
 * `null` when the file would import, or the validator's message naming the
 * failing table / row / field when it would not.
 *
 * Takes the JSON string (not the object) so it checks exactly what is written
 * — `Date`s already serialized, `undefined`s already dropped.
 */
export function selfCheckExportJson(json: string): string | null {
  const result = prepareImportText(json)
  return result.ok ? null : result.error
}
