import type { Table } from 'dexie'
import { db } from './database'
import type { ImportData } from './import-validation'
import { validateImportData } from './import-validation'

/** Type-safe table↔key pairs — eliminates implicit positional coupling (DC2) */
const TABLE_KEY_PAIRS: { table: Table; key: keyof ImportData }[] = [
  { table: db.todos, key: 'todos' },
  { table: db.projects, key: 'projects' },
  { table: db.canvases, key: 'canvases' },
  { table: db.listInsets, key: 'listInsets' },
  { table: db.people, key: 'people' },
  { table: db.settings, key: 'settings' },
  { table: db.tags, key: 'tags' },
  { table: db.todoTags, key: 'todoTags' },
  { table: db.todoPeople, key: 'todoPeople' },
  { table: db.todoOrgs, key: 'todoOrgs' },
  { table: db.personOrgs, key: 'personOrgs' },
  { table: db.orgs, key: 'orgs' },
  { table: db.savedViews, key: 'savedViews' },
  { table: db.stickyNotes, key: 'stickyNotes' },
  { table: db.taskboardEntries, key: 'taskboardEntries' },
]

/** Clear all data tables and bulk-add from validated import data. Must be called inside a transaction or will create its own. */
export async function restoreFromImportData(v: ImportData): Promise<void> {
  const tables = TABLE_KEY_PAIRS.map(p => p.table)
  await db.transaction('rw', tables, async () => {
    for (const { table } of TABLE_KEY_PAIRS) await table.clear()

    for (const { table, key } of TABLE_KEY_PAIRS) {
      const rows = v[key]
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (rows?.length) await (table as any).bulkAdd(rows)
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
