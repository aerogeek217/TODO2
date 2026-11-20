import type { DataSet } from '../../schema-upgrades'

/**
 * v86 — a version marker; no stored data changes.
 *
 * v86 data may hold an optional field older builds don't know: a task held
 * in the Planner's Unplanned tray (`TodoItem.unplanned`, only `true`
 * stored). A v85 build reading one would drop it silently (import
 * validation rebuilds each task from its known keys) — the task would go
 * back to the day its dates put it —, and could write that loss back to the
 * sync file or a backup. Stamping v86 makes every older build refuse such a
 * file (and the IndexedDB) as too new instead.
 *
 * Every v85 row is a valid v86 row (absent = not held; the field is not
 * indexed), so the transform returns its input.
 */
export function upgradeV86(data: DataSet): DataSet {
  return data
}
