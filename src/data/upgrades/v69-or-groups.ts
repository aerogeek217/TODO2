import type { DataSet } from '../schema-upgrades'

/**
 * v69 — a version marker; no stored data changes.
 *
 * v69 data may hold an optional field older builds don't know: a stored
 * predicate's or groups (`TodoPredicate.orGroups` — in a list's filter, a
 * lens, an Eisenhower pane's filter, the check-in filter). A v68 build
 * reading one would drop it silently (it rebuilds predicates from their
 * known keys), so a list would show more tasks than it should, and could
 * write that back to the sync file or a backup. Stamping v69 makes every
 * older build refuse such a file (and the IndexedDB) as too new instead.
 *
 * Every v68 row is a valid v69 row (absent = no or group), so the
 * transform returns its input.
 */
export function upgradeV69(data: DataSet): DataSet {
  return data
}
