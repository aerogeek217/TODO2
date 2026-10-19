import type { DataSet } from '../schema-upgrades'

/**
 * v65 — a version marker; no stored data changes.
 *
 * v65 data may hold two optional fields older builds don't know: a list
 * predicate's "is not" switches (`TodoPredicate.negate`) and an Eisenhower
 * tab's list (`EisenhowerTabConfig.listDefinitionId`). A v64 build reading
 * them would drop both silently — "People is not Ann" would become "People is
 * Ann" — and could write that back to the sync file or a backup. Stamping
 * v65 makes every older build refuse such a file (and the IndexedDB) as too
 * new instead.
 *
 * Every v64 row is a valid v65 row (absent = every field "is"; an
 * Eisenhower tab on all tasks), so the transform returns its input.
 */
export function upgradeV65(data: DataSet): DataSet {
  return data
}
