import type { DataRow, DataSet } from '../schema-upgrades'
import { isRecord } from '../../utils/is-record'

/**
 * v54 — remove hide-by-status. Statuses lose `hideByDefault`; stored list
 * predicates lose `showHiddenStatuses`. Completed-task hiding
 * (`showCompleted`) is untouched.
 *
 * No replacement filter is written: a list that used to hide tasks in hidden
 * statuses (no status filter, `showHiddenStatuses: false`) now shows them —
 * users narrow lists with explicit status filters instead.
 */

function upgradeStatuses(rows: DataRow[] | undefined): DataRow[] | undefined {
  if (!Array.isArray(rows)) return rows
  let changed = false
  const out = rows.map((row) => {
    if (!isRecord(row) || !('hideByDefault' in row)) return row
    changed = true
    const next: DataRow = { ...row }
    delete next.hideByDefault
    return next
  })
  return changed ? out : rows
}

function upgradeListDefinitions(rows: DataRow[] | undefined): DataRow[] | undefined {
  if (!Array.isArray(rows)) return rows
  let changed = false
  const out = rows.map((row) => {
    if (!isRecord(row)) return row
    const membership = row.membership
    if (!isRecord(membership) || !isRecord(membership.predicate)) return row
    if (!('showHiddenStatuses' in membership.predicate)) return row
    changed = true
    const predicate: Record<string, unknown> = { ...membership.predicate }
    delete predicate.showHiddenStatuses
    return { ...row, membership: { ...membership, predicate } }
  })
  return changed ? out : rows
}

/**
 * v54 — strip `statuses[].hideByDefault` and
 * `listDefinitions[].membership.predicate.showHiddenStatuses`.
 *
 * Idempotent; tolerates missing tables (task archives carry statuses but no
 * list definitions).
 */
export function upgradeV54(data: DataSet): DataSet {
  const out: DataSet = { ...data }
  const statuses = upgradeStatuses(data.statuses)
  if (statuses !== undefined && statuses !== data.statuses) out.statuses = statuses
  const listDefinitions = upgradeListDefinitions(data.listDefinitions)
  if (listDefinitions !== undefined && listDefinitions !== data.listDefinitions) out.listDefinitions = listDefinitions
  return out
}
