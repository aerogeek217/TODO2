import type { TodoItem, Person, TodoPerson, Status, Note, Tag, TodoTag, TodoEvent, ListOrder } from '../models'
import type { ListDefinition } from '../models/list-definition'
import type { WorkspaceLayout } from '../models/workspace-layout'
import type { SettingRow } from './database'

/**
 * The table registry: every data table (each table an export carries — all
 * but `backups`) and its row type. Export, restore, import validation, the
 * audit and file sync all walk this one list; the compiler makes each of
 * them cover every table:
 *
 * - `DATA_TABLES` in `database.ts` assigns the Dexie database to the
 *   registry's shape, so every table here must be a Dexie table of this row
 *   type;
 * - import validation keys its per-table rules (`IMPORT_TABLES`) by
 *   `DataTableName`, so a table without rules (or rules for a table not
 *   here) doesn't compile;
 * - `ImportData` / `ExportData` are mapped from it.
 *
 * Adding a table: add it here and to `DATA_TABLE_ORDER`, declare it on the
 * Dexie class, then follow the compile errors.
 */
export interface DataTableRows {
  todos: TodoItem
  people: Person
  settings: SettingRow
  todoPeople: TodoPerson
  statuses: Status
  listDefinitions: ListDefinition
  notes: Note
  tags: Tag
  todoTags: TodoTag
  todoEvents: TodoEvent
  layouts: WorkspaceLayout
  listOrders: ListOrder
}

export type DataTableName = keyof DataTableRows

/** Every data table's rows, by table name. */
export type DataTableArrays = { [K in DataTableName]: DataTableRows[K][] }

/**
 * Every table name once (a missing or unknown name doesn't compile), in the
 * order an export writes them and a restore adds them.
 */
const DATA_TABLE_ORDER: Record<DataTableName, true> = {
  todos: true,
  people: true,
  settings: true,
  todoPeople: true,
  statuses: true,
  listDefinitions: true,
  notes: true,
  tags: true,
  todoTags: true,
  todoEvents: true,
  layouts: true,
  listOrders: true,
}

/** The data table names, in export order. */
export const DATA_TABLE_NAMES: readonly DataTableName[] = Object.keys(DATA_TABLE_ORDER) as DataTableName[]
