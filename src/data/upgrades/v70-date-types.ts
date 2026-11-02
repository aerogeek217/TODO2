import type { DataSet } from '../schema-upgrades'

/**
 * v70 — a version marker; no stored data changes.
 *
 * v70 data may hold values older builds don't know: a stored predicate's
 * Last followed up and Completed date clauses (`dates.lastFollowup`,
 * `dates.completed` — in a list's filter, a lens, an Eisenhower pane's
 * filter, the check-in filter) and a list's or the new-list setting's
 * `lastFollowup` / `completed` sort. A v69 build reading one would drop the
 * clause silently (it rebuilds predicates from their known date types), so
 * a list or a lens would show more tasks than it should, and could write
 * that back to the sync file or a backup. Stamping v70 makes every older
 * build refuse such a file (and the IndexedDB) as too new instead.
 *
 * Every v69 row is a valid v70 row (absent = no such clause), so the
 * transform returns its input.
 */
export function upgradeV70(data: DataSet): DataSet {
  return data
}
