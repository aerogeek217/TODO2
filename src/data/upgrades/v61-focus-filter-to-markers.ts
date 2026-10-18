import type { DataRow, DataSet } from '../schema-upgrades'
import { isRecord } from '../../utils/is-record'

/**
 * v61 — the Focus filter folds into the Markers filter.
 *
 * Stored list predicates lose their three-way `focus` field (in focus / not
 * in focus / any) for `markers`, a set of markers a task must all have:
 *
 * - `focus: true` → `markers: { focus: true }` (added to any markers the
 *   predicate already has). The "Focus" list keeps listing the same tasks.
 * - `focus: false` ("not in focus") has no Markers equivalent and is
 *   dropped, so the list stops filtering on focus (it widens). Lists that
 *   lose it are reported (console warning).
 * - `focus: null` (no filter) is just removed.
 *
 * Only list definitions store predicates. Task flags (`focus`, and the new
 * optional `urgent` / `important`) need no rewrite.
 *
 * Idempotent (a predicate without `focus` is untouched); tolerates missing
 * tables and malformed rows (passed through).
 */

type Obj = Record<string, unknown>

function rewritePredicate(p: unknown): { predicate: unknown; droppedNotInFocus: boolean } {
  if (!isRecord(p) || !('focus' in p)) return { predicate: p, droppedNotInFocus: false }
  const next: Obj = { ...p }
  delete next.focus
  if (p.focus === true) {
    const markers = isRecord(p.markers) ? p.markers : {}
    next.markers = { ...markers, focus: true }
  }
  return { predicate: next, droppedNotInFocus: p.focus === false }
}

function upgradeListDefinitions(rows: DataRow[] | undefined): DataRow[] | undefined {
  if (!Array.isArray(rows)) return rows
  const notInFocusLists: string[] = []
  let changed = false
  const out = rows.map((row) => {
    if (!isRecord(row)) return row
    const membership = row.membership
    if (!isRecord(membership) || !('predicate' in membership)) return row
    const { predicate, droppedNotInFocus } = rewritePredicate(membership.predicate)
    if (droppedNotInFocus) notInFocusLists.push(typeof row.name === 'string' ? row.name : String(row.id))
    if (predicate === membership.predicate) return row
    changed = true
    return { ...row, membership: { ...membership, predicate } }
  })
  if (notInFocusLists.length > 0) {
    console.warn(`[upgrade v61] "Not in focus" filter dropped (no Markers equivalent) from: ${notInFocusLists.join(', ')}`)
  }
  return changed ? out : rows
}

/** v61 — list predicates: `focus` → `markers`. */
export function upgradeV61(data: DataSet): DataSet {
  const lists = upgradeListDefinitions(data.listDefinitions)
  if (lists === undefined || lists === data.listDefinitions) return data
  return { ...data, listDefinitions: lists }
}
