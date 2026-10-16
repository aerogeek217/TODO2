import { ALL_DATA_TABLES, CURRENT_DB_VERSION, db } from './database'
import type { SettingRow } from './database'
import { prepareImportText } from './import-pipeline'
import { SCHEMA_VERSION_KEY } from './file-version'
import type {
  TodoItem, Person, TodoPerson, Status, Note,
  Tag, TodoTag, TodoEvent, ListOrder,
} from '../models'
import type { ListDefinition } from '../models/list-definition'
import type { WorkspaceLayout } from '../models/workspace-layout'

/**
 * Shape of `buildExportData`'s return — every data table by name plus
 * `__schemaVersion`. The interface is the contract for consumers that read
 * named fields (e.g. `buildMarkdownExport`); the runtime body iterates
 * `ALL_DATA_TABLES` so adding a new table to that array auto-flows through
 * export.
 */
export interface ExportData {
  [SCHEMA_VERSION_KEY]: number
  todos: TodoItem[]
  people: Person[]
  settings: SettingRow[]
  todoPeople: TodoPerson[]
  statuses: Status[]
  listDefinitions: ListDefinition[]
  notes: Note[]
  tags: Tag[]
  todoTags: TodoTag[]
  todoEvents: TodoEvent[]
  layouts: WorkspaceLayout[]
  listOrders: ListOrder[]
}

/**
 * Reads all database tables and returns a plain object suitable for
 * JSON serialization (export, file-storage save, or backup snapshot).
 *
 * The returned object is stamped with `__schemaVersion = CURRENT_DB_VERSION` so
 * the import path can detect older files without reaching for field-shape
 * heuristics. See `data/file-version.ts:detectUnsupportedImport`.
 *
 * Iterates `ALL_DATA_TABLES` from `data/database.ts` so the export covers every
 * data table — round-trips through `parseAndRestore` without silent loss.
 *
 * All reads run inside one read-only Dexie transaction over `ALL_DATA_TABLES`,
 * so the export is a consistent snapshot (a concurrent write can't land
 * between two table reads and leave e.g. a join row without its todo).
 */
export async function buildExportData(): Promise<ExportData> {
  const entries = await db.transaction('r', [...ALL_DATA_TABLES], () =>
    Promise.all(
      ALL_DATA_TABLES.map(async (table) => [table.name, await table.toArray()] as const),
    ),
  )
  return {
    [SCHEMA_VERSION_KEY]: CURRENT_DB_VERSION,
    ...Object.fromEntries(entries),
  } as ExportData
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
