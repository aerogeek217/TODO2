import type { DataSet } from '../../schema-upgrades'

/**
 * v87 — a version marker; no stored data changes.
 *
 * v87 data may hold what older builds don't know: a filter on the planned
 * date (a `planned` date clause — its `held`, the expression's `unplanned`,
 * included — in a list, a Number, a chart or the check-in filter) and a list
 * sorted or grouped by it. A v86 build reading one would drop the filter or
 * refuse the list as malformed, and could write that loss back to the sync
 * file or a backup. Stamping v87 makes every older build refuse such a file
 * (and the IndexedDB) as too new instead.
 *
 * Every v86 row is a valid v87 row, so the transform returns its input.
 */
export function upgradeV87(data: DataSet): DataSet {
  return data
}
