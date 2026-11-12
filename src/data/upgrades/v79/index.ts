import type { DataSet, SchemaUpgrade } from '../../schema-upgrades'
import { upgradeLayoutsV79 } from './layouts'
import { upgradeLeftoversV79 } from './leftovers'

/**
 * v79 — the final shapes (widget feedback 2026-11-11, decision 6): what
 * builds after v78 read at load time — the removed kinds' tabs, the
 * Eisenhower's hidden list and settings rows, the Review widget's saved
 * kind and pick, a Breakdown's `badges`, a Number's config lens switch, the
 * Strips zoom — written into the data, so the read-time shims could go. Its
 * parts, run in order over the whole dataset:
 *
 * 1. `layouts` — every layout row (each tab in its final shape; the removed
 *    kinds' tabs dropped and their emptied cells closed).
 * 2. `leftovers` — the Eisenhower's hidden list and its order rows, its
 *    settings rows, and the Default list zoom row.
 *
 * Each part follows the transform contract (`schema-upgrades`): pure,
 * idempotent, tolerant of missing tables and malformed rows. Nothing that
 * stamps a task (`modifiedAt`), the history log or `historyLogSince` is
 * touched.
 */
const PARTS: readonly SchemaUpgrade[] = [
  upgradeLayoutsV79,
  upgradeLeftoversV79,
]

export function upgradeV79(data: DataSet): DataSet {
  return PARTS.reduce((current, part) => part(current), data)
}
