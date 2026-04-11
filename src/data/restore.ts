import { db, ALL_DATA_TABLES } from './database'
import type { ImportData } from './import-validation'
import { validateImportData } from './import-validation'

/** The import data keys in the same order as ALL_DATA_TABLES */
const DATA_KEYS: (keyof ImportData)[] = [
  'todos', 'projects', 'canvases', 'listInsets', 'people', 'settings',
  'tags', 'todoTags', 'todoPeople', 'todoOrgs', 'personOrgs', 'orgs',
  'savedViews', 'stickyNotes',
]

/** Clear all data tables and bulk-add from validated import data. Must be called inside a transaction or will create its own. */
export async function restoreFromImportData(v: ImportData): Promise<void> {
  await db.transaction('rw', [...ALL_DATA_TABLES], async () => {
    for (const table of ALL_DATA_TABLES) await table.clear()

    for (let i = 0; i < ALL_DATA_TABLES.length; i++) {
      const rows = v[DATA_KEYS[i]]
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (rows?.length) await (ALL_DATA_TABLES[i] as any).bulkAdd(rows)
    }
  })
}

/** Parse a JSON string, validate it, and restore all data tables. Returns error string on failure. */
export async function parseAndRestore(jsonString: string): Promise<{ ok: true } | { ok: false; error: string }> {
  let parsed: unknown
  try {
    parsed = JSON.parse(jsonString)
  } catch {
    return { ok: false, error: 'Data is corrupted (invalid JSON)' }
  }

  const result = validateImportData(parsed)
  if (!result.ok) return { ok: false, error: result.error }

  await restoreFromImportData(result.data)
  return { ok: true }
}
