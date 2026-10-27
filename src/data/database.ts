import Dexie, { type Table } from 'dexie'
import type { TodoItem, Person, TodoPerson, Backup, Status, Note, Tag, TodoTag, TodoEvent, ListOrder } from '../models'
import type { ListDefinition } from '../models/list-definition'
import type { WorkspaceLayout } from '../models/workspace-layout'
import { SETTING_KEYS } from './setting-keys'
import { DEFAULT_ENTITY_COLOR } from '../constants'
import { DATA_TABLE_NAMES, type DataTableName, type DataTableRows } from './tables'
import { applySchemaUpgradeInTx } from './schema-upgrades'

export interface SettingRow {
  key: string
  value: string
}

/**
 * Authoritative current Dexie schema version: the highest `this.version(N)`
 * the database declares below — a schema step raises this constant in the
 * same edit. Exports are stamped with it, and a database or file above it (a
 * newer build saved it) is refused (`services/migration-check`,
 * `DatabaseTooNewError`, `prepareImport`). A vitest asserts
 * `db.verno === CURRENT_DB_VERSION` after open, so a `this.version(N+1)`
 * without raising this constant fails the suite.
 */
export const CURRENT_DB_VERSION = 69

/**
 * Lowest database version this build reads. A browser database whose
 * on-disk version — or a file (export, backup, sync file, task archive) whose
 * `__schemaVersion` — is below this floor, or a file with no version marker,
 * is refused: nothing in it is read, nothing is written, and there is no way
 * to go on anyway (the upgrades for older shapes are gone). The refusal says
 * which build can still upgrade it (`BELOW_FLOOR_BUILD`).
 *
 * Files at or above the floor import through the permanent upgrade pipeline
 * (`data/schema-upgrades.ts` → `upgradeDataSet`), which runs the same
 * per-version transforms as the Dexie `.upgrade()` callbacks.
 *
 * Policy: PINNED as a literal. Never raise it automatically (and never derive
 * it from CURRENT_DB_VERSION) — raising it is a deliberate, user-approved
 * decision, because it stops older backups / sync files from importing.
 * Raising it also permits deleting the registry entries at or below the new
 * floor.
 *
 * Raised from 49 to 68 on 2026-10-23 (user-approved): the upgrades from v49
 * to v68 were removed with it.
 */
export const OLDEST_SUPPORTED_DB_VERSION = 68

/**
 * The build that still upgrades data below the floor (the last one before
 * the floor was raised; an earlier build would re-export it at its own, still
 * too old, version) — named in every below-floor refusal. Changes with the
 * floor.
 */
export const BELOW_FLOOR_BUILD = 'the last TODO2 build from before 2026-10-23'

/** What a build says when the browser's database was written by a newer one (schema `storedVersion`). */
export function tooNewDatabaseMessage(storedVersion: number, buildVersion: number = CURRENT_DB_VERSION): string {
  return `This browser’s TODO2 data was saved by a newer version of TODO2 (schema v${storedVersion}); this version supports up to v${buildVersion}. Nothing was read or changed. Reload the page to get the newer version.`
}

/**
 * What a build says when the browser's database is below the floor (schema
 * `storedVersion`; `null` when the browser can't tell — the open refused it).
 */
export function tooOldDatabaseMessage(storedVersion: number | null, floorVersion: number = OLDEST_SUPPORTED_DB_VERSION): string {
  const saved = storedVersion === null ? 'an older version of TODO2' : `an older version of TODO2 (schema v${storedVersion})`
  return `This browser’s TODO2 data was saved by ${saved}; this version reads v${floorVersion} and newer. Nothing was read or changed. To keep it, open it in ${BELOW_FLOOR_BUILD}, which upgrades it, then reload this version.`
}

/**
 * The browser's database was written by a newer build (its version is above
 * `CURRENT_DB_VERSION`): opening it fails with this, so nothing in it is
 * read or written here — Dexie would otherwise open it at its own version
 * and this build would read data it doesn't understand (and could write
 * that loss back).
 */
export class DatabaseTooNewError extends Error {
  readonly storedVersion: number

  constructor(storedVersion: number) {
    super(tooNewDatabaseMessage(storedVersion))
    this.name = 'DatabaseTooNewError'
    this.storedVersion = storedVersion
  }
}

/**
 * The browser's database is below the floor (`OLDEST_SUPPORTED_DB_VERSION`):
 * opening it fails with this from inside Dexie's upgrade, so the upgrade is
 * aborted and the database stays exactly as it was. `storedVersion` is
 * `null`: Dexie's upgrade doesn't say which version it found.
 */
export class DatabaseTooOldError extends Error {
  readonly storedVersion: number | null

  constructor(storedVersion: number | null) {
    super(tooOldDatabaseMessage(storedVersion))
    this.name = 'DatabaseTooOldError'
    this.storedVersion = storedVersion
  }
}

/** The error of class `type` behind `error` (Dexie wraps an open failure in the errors of later calls), if any. */
function findWrapped<T extends Error>(error: unknown, type: new (...args: never[]) => T): T | null {
  for (let e: unknown = error, depth = 0; e != null && depth < 5; depth++) {
    if (e instanceof type) return e
    e = (e as { inner?: unknown }).inner
  }
  return null
}

/** The `DatabaseTooNewError` behind `error`, if any. */
export function findDatabaseTooNew(error: unknown): DatabaseTooNewError | null {
  return findWrapped(error, DatabaseTooNewError)
}

/** The `DatabaseTooOldError` behind `error`, if any. */
export function findDatabaseTooOld(error: unknown): DatabaseTooOldError | null {
  return findWrapped(error, DatabaseTooOldError)
}

/**
 * The floor version's `.upgrade()`: Dexie runs a version's upgrade only for a
 * database older than that version, so for the floor's declaration that is
 * exactly a database below the floor. Throwing aborts the version-change
 * transaction — IndexedDB then undoes every store and index change of the
 * open, and the database keeps its old version and data.
 */
function refuseBelowFloor(): never {
  throw new DatabaseTooOldError(null)
}

/**
 * The store layout at the floor (v68): every table and index, as the
 * versions up to it left them. A later version's declaration lists only
 * what it changes.
 */
const FLOOR_STORES = {
  todos: '++id, isCompleted, dueDate, sortOrder, statusId, &uid',
  people: '++id, name',
  settings: 'key',
  todoPeople: '++id, todoId, personId',
  backups: '++id, createdAt, trigger',
  statuses: '++id, sortOrder',
  listDefinitions: '++id, sortOrder',
  notes: '++id, modifiedAt',
  tags: '++id, name',
  todoTags: '++id, todoId, tagId',
  todoEvents: '++id, todoId, type, timestamp',
  layouts: '++id',
  listOrders: '++id, listDefinitionId, todoId, &[listDefinitionId+todoId]',
} as const

export class Todo2Database extends Dexie {
  todos!: Table<TodoItem, number>
  people!: Table<Person, number>
  settings!: Table<SettingRow, string>
  todoPeople!: Table<TodoPerson, number>
  backups!: Table<Backup, number>
  statuses!: Table<Status, number>
  listDefinitions!: Table<ListDefinition, number>
  notes!: Table<Note, number>
  tags!: Table<Tag, number>
  todoTags!: Table<TodoTag, number>
  todoEvents!: Table<TodoEvent, number>
  layouts!: Table<WorkspaceLayout, number>
  listOrders!: Table<ListOrder, number>

  constructor() {
    super('todo2')

    // The floor (`OLDEST_SUPPORTED_DB_VERSION`), its whole store layout in
    // one declaration. Dexie (4.x) needs no declaration of the versions
    // before it: opening a database it diffs the stores it finds against the
    // declared ones, and runs only the upgrades of versions above the
    // database's own. So the floor's upgrade runs exactly for a database
    // below the floor — which it refuses (`refuseBelowFloor`), rolling the
    // open back with the database untouched.
    this.version(OLDEST_SUPPORTED_DB_VERSION).stores(FLOOR_STORES).upgrade(refuseBelowFloor)

    // v69: a version marker. No index or data change
    // (`upgrades/v69-or-groups.ts` returns its input); v69 data may hold a
    // stored filter's or groups, which an older build would drop silently,
    // so older builds refuse it.
    this.version(69).stores({}).upgrade((tx) => applySchemaUpgradeInTx(tx, 69))

    // The next schema step N goes here, after the last one:
    //
    //   this.version(N).stores({ /* only what N adds, changes or drops (null) */ })
    //     .upgrade((tx) => applySchemaUpgradeInTx(tx, N))
    //
    // with its transform registered in `SCHEMA_UPGRADES`
    // (`schema-upgrades.ts` says what else it needs) and
    // `CURRENT_DB_VERSION` raised to N — a test asserts `db.verno` equals it.

    // A database a newer build wrote is never read or written: Dexie opens
    // one at its own (higher) version, so the open fails here instead.
    // (`services/migration-check.checkTooNewDB` says so before the app
    // starts; this holds should anything open it without that check — though
    // only once Dexie has opened it, which may patch a store in first.)
    // Measured against the highest version declared (`verno`, which equals
    // `CURRENT_DB_VERSION` — a test asserts it).
    this.on('ready', (vipDb) => {
      const stored = Math.floor(vipDb.backendDB().version / 10)
      if (stored > vipDb.verno) throw new DatabaseTooNewError(stored)
    }, true)
  }
}

export const db = new Todo2Database()

/**
 * Seeds the built-in "Assigned" status when the settings pointer to it is
 * missing or dangling. Runs after every full restore.
 */
export async function ensureSeededStatuses(
  statusesTable: Table<Status, number>,
  settingsTable: Table<SettingRow, string>,
): Promise<{ assignedId: number }> {
  const assignedSetting = await settingsTable.get(SETTING_KEYS.seededAssignedStatusId)
  const seededAssignedId = assignedSetting ? Number(assignedSetting.value) : null
  const existingAssigned = seededAssignedId != null
    ? await statusesTable.get(seededAssignedId)
    : undefined

  let assignedId = existingAssigned?.id
  if (assignedId == null) {
    const all = await statusesTable.toArray()
    const maxSort = all.reduce((m, s) => Math.max(m, s.sortOrder), -1)
    const seedAssigned: Status = {
      name: 'Assigned', color: DEFAULT_ENTITY_COLOR, sortOrder: maxSort + 1,
      icon: 'person',
    }
    assignedId = (await statusesTable.add(seedAssigned)) as number
  }

  await settingsTable.put({ key: SETTING_KEYS.seededAssignedStatusId, value: String(assignedId) })

  return { assignedId }
}

/**
 * The data tables (the registry in `tables.ts`) by name, typed by row.
 * Assigning `db` here is the compile-time check that the Dexie class
 * declares every registry table with the registry's row type.
 */
export const DATA_TABLES: { readonly [K in DataTableName]: Table<DataTableRows[K], K extends 'settings' ? string : number> } = db

/** All data tables (excludes backups), in export order. Used for export, restore, and file-storage sync. */
export const ALL_DATA_TABLES: readonly Table[] = DATA_TABLE_NAMES.map((name) => DATA_TABLES[name] as Table)

