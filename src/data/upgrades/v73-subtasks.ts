import type { DataSet } from '../schema-upgrades'

/**
 * v73 — a version marker; no stored data changes.
 *
 * v73 adds the `subtasks` table (a task's checklist, cr28). A v72 build
 * knows no such table: on an import, or the sync file's load, every task's
 * subtasks would vanish and the loss be written back to the sync file or a
 * backup. Stamping v73 makes every older build refuse such a file (and the
 * IndexedDB) as too new instead.
 *
 * Every v72 dataset is a valid v73 dataset (no subtasks yet), so the
 * transform returns its input; the Dexie side creates the empty table.
 */
export function upgradeV73(data: DataSet): DataSet {
  return data
}
