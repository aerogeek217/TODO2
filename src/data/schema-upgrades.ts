import type { Transaction } from 'dexie'
import { upgradeV69 } from './upgrades/v69-or-groups'

/**
 * Permanent schema-upgrade pipeline.
 *
 * Every schema version `N` whose bump changes the *shape of stored data*
 * registers one pure transform here that converts a whole v(N-1) dataset into
 * a vN dataset. The same transform runs in two places:
 *
 *   1. **IndexedDB upgrade** — `this.version(N)...upgrade(tx => applySchemaUpgradeInTx(tx, N))`
 *      in `data/database.ts`, for the live database.
 *   2. **Import** — `upgradeDataSet(data, fileVersion, CURRENT_DB_VERSION)` from
 *      `data/import-pipeline.ts` `prepareImport`, for every export / backup /
 *      sync file whose `__schemaVersion` is ≥ `OLDEST_SUPPORTED_DB_VERSION`.
 *
 * so a file written by any build at or above the floor imports into any later
 * build. This is permanent infrastructure: entries are never removed while
 * their version is above the floor.
 *
 * ## Adding a schema step N
 *
 * 1. The transform: `data/upgrades/v<N>-<what>.ts` exporting `upgradeV<N>`
 *    (contract below), imported here and registered as an entry
 *    `[N, upgradeV<N>]` of `SCHEMA_UPGRADES`' `new Map(...)`.
 * 2. `data/database.ts`: `this.version(N).stores({ … }).upgrade((tx) =>
 *    applySchemaUpgradeInTx(tx, N))` after the floor's declaration (only the
 *    stores N adds, changes or drops), and `CURRENT_DB_VERSION = N`.
 * 3. `data/import-validation.ts`: the `check*` / `pick*` of every field the
 *    step adds, renames or removes.
 * 4. Tests: the transform's own (a v(N-1) dataset in, the vN one out —
 *    idempotent, tolerant of missing tables and malformed rows), the
 *    export → restore round trip, and a "v(N-1) reader refuses vN" test
 *    (a file, the browser database and kept drafts stamped N are refused by
 *    a build at N-1).
 * 5. The dev seed (`scripts/dev-seed.ts`): `DEV_SEED_SCHEMA_VERSION = N` and
 *    its rows in the vN shape (`dev-seed.test` pins it to `CURRENT_DB_VERSION`).
 *
 * ## Transform contract
 *
 * - **Whole-dataset, not per-row**: a transform may be cross-table (fold one
 *   table into another, or make rows of a new one from several).
 * - **Pure + immutable**: never mutate the input. Return a new array for every
 *   table you change; return the *same array reference* for tables you leave
 *   alone (the Dexie side only rewrites tables whose reference changed).
 * - **Tolerate missing tables**: partial datasets (e.g. a task archive with
 *   only `todos` + joins) flow through the same pipeline. Treat an absent
 *   table as empty and do not invent it unless the version genuinely creates
 *   it. Use `{ ...data, changed: next }` so untouched / absent tables pass
 *   through as they were.
 * - **Defensive about row shape**: on import the transform runs *before*
 *   validation (validators only know the current shape), so rows may be
 *   malformed. Skip / pass through rows you can't interpret; validation after
 *   the pipeline rejects what is still wrong.
 * - **Idempotent**: running a transform on data already in the vN shape must
 *   be a no-op (live DBs and files can be partially upgraded by older code).
 * - A table key that is present in the input but absent from the output is
 *   treated as emptied (the Dexie side clears it).
 * - **Dates in either form**: on import, Date fields are still the file's ISO
 *   strings (validation revives them after the pipeline); on the Dexie side
 *   they are `Date`s. Compare or copy them so both work.
 */

export type DataRow = Record<string, unknown>

/** Table name → plain row objects. A missing key means "table not present". */
export type DataSet = Record<string, DataRow[]>

export type SchemaUpgrade = (data: DataSet) => DataSet

/**
 * Registry of data transforms keyed by the target schema version. A version
 * with no entry is an identity step (index-only bumps, empty-table additions).
 *
 * Only versions above the floor (`OLDEST_SUPPORTED_DB_VERSION`) have entries:
 * v69, a version marker (`upgrades/v69-or-groups.ts`). Each transform lives
 * in `data/upgrades/v<N>-*.ts`.
 */
export const SCHEMA_UPGRADES: ReadonlyMap<number, SchemaUpgrade> = new Map<number, SchemaUpgrade>([
  [69, upgradeV69],
])

/**
 * Applies the registry transforms for `fromVersion + 1 … toVersion` in order.
 * Returns the input unchanged when `fromVersion >= toVersion`.
 *
 * Throws if a transform throws — callers surface that as an import error.
 */
export function upgradeDataSet(
  data: DataSet,
  fromVersion: number,
  toVersion: number,
  registry: ReadonlyMap<number, SchemaUpgrade> = SCHEMA_UPGRADES,
): DataSet {
  let current = data
  for (let v = fromVersion + 1; v <= toVersion; v++) {
    const step = registry.get(v)
    if (step) current = step(current)
  }
  return current
}

/** Dexie stores that never participate in data transforms. */
const NON_DATA_STORES: ReadonlySet<string> = new Set(['backups'])

/**
 * Runs the registry entry for `version` against the live database inside a
 * Dexie `.upgrade(tx)` callback: reads every data table visible to the
 * upgrade transaction into a `DataSet`, applies the transform, and writes
 * back (clear + bulkAdd, preserving primary keys) only the tables whose array
 * reference changed. The `backups` table is never read or written.
 *
 * Usage in `data/database.ts`:
 *
 *     this.version(N).stores({ ... }).upgrade((tx) => applySchemaUpgradeInTx(tx, N))
 *
 * ## Table drops / creates (verified in `src/test/data/schema-upgrades.test.ts`)
 *
 * Dexie (4.x) walks versions one step at a time: for version N it creates the
 * tables N adds, runs N's `.upgrade()` callback, and only then deletes the
 * tables N declares as `null`, before moving on to N+1. So:
 *
 * - **Transform and drop in the same version** — the convention.
 *   `this.version(N).stores({ orgs: null }).upgrade(...)` sees `orgs` (with
 *   its rows) in the DataSet. The transform must remove the `orgs` key from
 *   its output so the import path stops carrying the rows too; on the Dexie
 *   side the write-back then clears it, which is harmless (Dexie deletes the
 *   store right after the callback).
 * - Tables created by version N already exist — empty — when N's callback
 *   runs, so N's transform may populate them.
 * - Tables dropped by an earlier version are already gone at step N.
 *
 * `registry` is injectable for tests; production passes the default.
 */
export async function applySchemaUpgradeInTx(
  tx: Transaction,
  version: number,
  registry: ReadonlyMap<number, SchemaUpgrade> = SCHEMA_UPGRADES,
): Promise<void> {
  const step = registry.get(version)
  if (!step) return

  // `tx.idbtrans.objectStoreNames` (not `tx.storeNames`, which lists the
  // final schema's tables) is the store set as of *this* version step: tables
  // created by version N exist, tables dropped by version N still exist, and
  // tables dropped by earlier versions are already gone.
  const names = Array.from(tx.idbtrans.objectStoreNames).filter((n) => !NON_DATA_STORES.has(n))
  const input: DataSet = {}
  for (const name of names) {
    input[name] = (await tx.table(name).toArray()) as DataRow[]
  }

  const output = step(input)
  for (const name of Object.keys(output)) {
    if (!names.includes(name)) {
      throw new Error(`schema upgrade v${version} produced rows for unknown table "${name}"`)
    }
  }

  for (const name of names) {
    const before = input[name]
    const after = output[name]
    if (after === before) continue
    const table = tx.table(name)
    await table.clear()
    if (after && after.length > 0) await table.bulkAdd(after)
  }
}
