import type { DataSet } from '../schema-upgrades'

/**
 * v65 — a version marker; no stored data changes.
 *
 * v65 data may hold what older builds don't know: a list predicate's "is
 * not" switches (`TodoPredicate.negate`), Priority No markers (a `false` in
 * `TodoPredicate.markers` — a v64 build drops the whole Priority filter), an
 * Eisenhower tab's list (its `config.listDefinitionId`, until v66) and its
 * custom panes (its `config.panes`, until v66). A v64 build reading them would
 * drop them silently — "People is not Ann" would become "People is Ann" —
 * and could write that back to the sync file or a backup. Stamping v65 makes
 * every older build refuse such a file (and the IndexedDB) as too new
 * instead.
 *
 * Every v64 row is a valid v65 row (absent = every field "is", Priority
 * Yes-only; an Eisenhower tab on all tasks with the default panes), so the
 * transform returns its input.
 */
export function upgradeV65(data: DataSet): DataSet {
  return data
}
