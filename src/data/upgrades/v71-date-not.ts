import type { DataSet } from '../schema-upgrades'

/**
 * v71 — a version marker; no stored data changes.
 *
 * v71 data may hold a value older builds don't know: a stored predicate's
 * "is not" date range (`dates.<type>.not` — in a list's filter, a lens, an
 * Eisenhower pane's filter, the check-in filter). A v70 build reading one
 * would rebuild the range without `not` (it reads a range from its known
 * keys), so the filter would silently keep the **opposite** tasks — a lens
 * hiding the tasks followed up lately would show only those — and could
 * write that back to the sync file or a backup. Stamping v71 makes every
 * older build refuse such a file (and the IndexedDB) as too new instead.
 *
 * Every v70 row is a valid v71 row (absent = "is"), so the transform
 * returns its input.
 */
export function upgradeV71(data: DataSet): DataSet {
  return data
}
