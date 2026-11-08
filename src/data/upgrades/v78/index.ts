import type { DataSet, SchemaUpgrade } from '../../schema-upgrades'
import { upgradeLayoutTable } from './layout-table'

/**
 * v78 — Dashboard building (D26). One schema step holds every part of it,
 * each a transform of its own, run in order over the whole dataset:
 *
 * 1. `layout-table` (P1) — a layout's columns → rows → cells and bands
 *    become a table: grid tracks and cells covering rectangles of them.
 * 2. `widget-set` (P4) — the Eisenhower summary becomes an Eisenhower tab;
 *    the removed kinds go.
 * 3. `numbers` (P5) — a Number's metric becomes the filter that counts the
 *    same tasks.
 * 4. `breakdown` (P8) — People, Tags and Status become Breakdowns.
 *
 * Later parts read the table the first one makes. Each part follows the
 * transform contract (`schema-upgrades`): pure, idempotent, tolerant of
 * missing tables and malformed rows.
 */
const PARTS: readonly SchemaUpgrade[] = [
  upgradeLayoutTable,
  // P4: upgradeWidgetSet (`./widget-set`)
  // P5: upgradeNumbers (`./numbers`)
  // P8: upgradeBreakdown (`./breakdown`)
]

export function upgradeV78(data: DataSet): DataSet {
  return PARTS.reduce((current, part) => part(current), data)
}
