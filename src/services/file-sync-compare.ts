import { db } from '../data/database'
import { DATA_TABLE_NAMES } from '../data/tables'
import { prepareImport } from '../data/import-pipeline'
import type { ImportData } from '../data/import-validation'
import { buildExportData } from '../data/export-data'
import { SYNC_NEUTRAL_SETTING_KEYS } from '../data/setting-keys'

/** JSON with object keys sorted recursively — key order never matters. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const o = v as Record<string, unknown>
      return Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]))
    }
    return v
  })
}

function tableRows(data: ImportData, name: string): unknown[] {
  const rows = (data as unknown as Record<string, unknown>)[name]
  return Array.isArray(rows) ? rows : []
}

/**
 * True when two prepared (validated, `pick*`-normalized) datasets hold the
 * same rows in every data table, ignoring row order and key order. `Date`s
 * vs ISO strings are equalized by a JSON round-trip.
 */
export function importDataEqual(a: ImportData, b: ImportData): boolean {
  const ja = JSON.parse(JSON.stringify(a)) as ImportData
  const jb = JSON.parse(JSON.stringify(b)) as ImportData
  for (const name of DATA_TABLE_NAMES) {
    const ra = tableRows(ja, name).map(canonical).sort()
    const rb = tableRows(jb, name).map(canonical).sort()
    if (ra.length !== rb.length) return false
    for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return false
  }
  return true
}

/**
 * Does the browser database hold exactly the data in `fileData` (a prepared,
 * current-schema dataset)? The browser side goes through the same
 * export → `prepareImport` normalization so `pick*` differences (dropped
 * nulls, defaulted flags) don't read as a conflict.
 */
export async function browserMatchesFile(fileData: ImportData): Promise<boolean> {
  const exported = await buildExportData()
  const browser = prepareImport(JSON.parse(JSON.stringify(exported)))
  if (!browser.ok) return false
  return importDataEqual(withoutSyncNeutralSettings(browser.data), withoutSyncNeutralSettings(fileData))
}

/** `data` without the settings the two sides aren't compared on (`SYNC_NEUTRAL_SETTING_KEYS`). */
function withoutSyncNeutralSettings(data: ImportData): ImportData {
  return { ...data, settings: data.settings.filter((row) => !SYNC_NEUTRAL_SETTING_KEYS.has(row.key)) }
}

/** Number of tasks in the browser database (conflict-dialog summary). */
export async function browserTaskCount(): Promise<number> {
  return db.todos.count()
}
