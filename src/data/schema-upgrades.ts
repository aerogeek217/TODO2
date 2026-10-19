import type { Transaction } from 'dexie'
import { upgradeV50 } from './upgrades/v50-revive-dates'
import { upgradeV51 } from './upgrades/v51-uid-completed-at'
import { upgradeV52 } from './upgrades/v52-drop-date-stat-widgets'
import { upgradeV53 } from './upgrades/v53-remove-scheduled-date'
import { upgradeV54 } from './upgrades/v54-remove-hidden-statuses'
import { upgradeV55 } from './upgrades/v55-merge-orgs-into-people'
import { upgradeV56 } from './upgrades/v56-seed-workspace-layout'
import { upgradeV57 } from './upgrades/v57-drop-list-favorites'
import { upgradeV59 } from './upgrades/v59-taskboard-to-focus'
import { upgradeV60 } from './upgrades/v60-projects-to-tags'
import { upgradeV61 } from './upgrades/v61-focus-filter-to-markers'
import { upgradeV62 } from './upgrades/v62-retire-status-widget'
import { upgradeV63 } from './upgrades/v63-app-background-and-list-pin'
import { upgradeV64 } from './upgrades/v64-date-filters-and-caps'
import { upgradeV65 } from './upgrades/v65-is-not-and-eisenhower-list'

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
 * their version is ≥ the floor.
 *
 * ## Transform contract
 *
 * - **Whole-dataset, not per-row**: later transforms are cross-table (orgs →
 *   people, taskboard → focus + list order).
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
 */

export type DataRow = Record<string, unknown>

/** Table name → plain row objects. A missing key means "table not present". */
export type DataSet = Record<string, DataRow[]>

export type SchemaUpgrade = (data: DataSet) => DataSet

/**
 * Registry of data transforms keyed by the target schema version. A version
 * with no entry is an identity step (index-only bumps, empty-table additions).
 *
 * v49 is the floor; its own Dexie upgrade (fuzzy `setAt` backfill) predates
 * this pipeline, so the first entry is v50. Each transform lives in
 * `data/upgrades/v<N>-*.ts`.
 */
export const SCHEMA_UPGRADES: ReadonlyMap<number, SchemaUpgrade> = new Map<number, SchemaUpgrade>([
  [50, upgradeV50],
  [51, upgradeV51],
  [52, upgradeV52],
  [53, upgradeV53],
  [54, upgradeV54],
  [55, upgradeV55],
  [56, upgradeV56],
  [57, upgradeV57],
  [59, upgradeV59],
  [60, upgradeV60],
  [61, upgradeV61],
  [62, upgradeV62],
  [63, upgradeV63],
  [64, upgradeV64],
  [65, upgradeV65],
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
