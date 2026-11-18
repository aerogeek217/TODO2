import type { DataSet } from '../../schema-upgrades'
import { layoutTabsOf, type TabStep } from '../layout-tabs'

/**
 * v83 — Project pulse and the Pressure radar removed (user, 2026-11-18):
 * in every layout, each `pulse` and `radar` tab goes. A cell whose active
 * tab went shows the tab before it (else the one after); a cell left
 * without tabs closes by the absorb rule, and the grid lines nothing uses
 * then go (`upgrades/layout-tabs`, the walk v78 and v79 share). Nothing
 * else moves: no list, setting or task is touched.
 *
 * Follows the transform contract (`schema-upgrades`): pure, idempotent (a
 * layout with neither kind comes back as the same object), tolerant of
 * missing tables and malformed rows (left for the layout repair); a table
 * it leaves alone comes back as the same array.
 */

/** The kinds removed: their tabs go. */
const REMOVED_KINDS: ReadonlySet<unknown> = new Set(['pulse', 'radar'])

const dropRemoved: TabStep = (tab) => (REMOVED_KINDS.has(tab.kind) ? null : tab)

export function upgradeV83(data: DataSet): DataSet {
  const layouts = data.layouts
  if (!layouts) return data
  const next = layouts.map((row) => layoutTabsOf(row, dropRemoved))
  if (next.every((row, i) => row === layouts[i])) return data
  return { ...data, layouts: next }
}
