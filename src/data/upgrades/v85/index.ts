import type { DataSet } from '../../schema-upgrades'

/**
 * v85 — a version marker; no stored data changes.
 *
 * v85 data may hold an optional field older builds don't know: a task's Do
 * day (`TodoItem.doDate`, the day the user plans to do it — the Planner's).
 * A v84 build reading one would drop it silently (import validation
 * rebuilds each task from its known keys), and could write that loss back
 * to the sync file or a backup. Stamping v85 makes every older build refuse
 * such a file (and the IndexedDB) as too new instead.
 *
 * Every v84 row is a valid v85 row (absent = no Do day; the field is not
 * indexed), so the transform returns its input.
 */
export function upgradeV85(data: DataSet): DataSet {
  return data
}
