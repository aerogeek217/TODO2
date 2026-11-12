import type { DataRow, DataSet } from '../../schema-upgrades'
import { layoutTabsOf, type Obj } from '../layout-tabs'

/**
 * v78, part 2 (D26 P4) — the widget set: over the table `layout-table`
 * makes (part 1 runs first).
 *
 * - An **Eisenhower summary** tab (`eisenhowerSummary`) becomes an
 *   Eisenhower tab, `{ id, kind: 'eisenhower', config: {} }`, keeping its
 *   id (and its place): the summary is the Eisenhower's small face now.
 * - A tab of a **removed kind** — Needs follow-up (`followup`), Next 7 days
 *   (`next7`), Stale tasks (`stale`), Recently completed (`recent`), What
 *   changed (`changes`) and Today (`today`) — goes, its settings with it.
 * - A cell whose active tab went shows the tab before it (else the one
 *   after), as closing a tab does.
 * - A cell the removals leave **without tabs closes** as Close cell does
 *   (`upgrades/layout-tabs`: the absorb rule, a pinwheel's centre staying
 *   empty, then the lines no cell's edge lies on merged and the cells put in
 *   reading order).
 *
 * Over the `layouts` table, and kept layout drafts (through the pipeline:
 * each body read as a layout row). Holds its own copy of the kinds; the walk,
 * the close rule and the line merge are `upgrades/layout-tabs` (shared with
 * v79, which drops tabs the same way), frozen there. Defensive: a cell that
 * isn't an object or has no list of tabs, a tab that isn't an object, is left
 * as it is (for the layout repair); when the table doesn't read (no track
 * lists, a cell without a whole-number area), the tabs are still converted
 * and dropped but no cell closes — the repair closes what's left empty. A
 * layout holding none of these kinds is returned as it is (idempotent).
 */

/** The kinds v78 removes: their tabs go. */
const REMOVED_KINDS: ReadonlySet<string> = new Set(['followup', 'next7', 'stale', 'recent', 'changes', 'today'])
/** The kind that becomes the Eisenhower (its small face). */
const SUMMARY_KIND = 'eisenhowerSummary'

/** One tab as v78's widget set has it: the summary converted, a removed kind gone, any other kept as it is. */
function widgetSetTab(tab: Obj): Obj | null {
  if (tab.kind === SUMMARY_KIND) return { id: tab.id, kind: 'eisenhower', config: {} }
  if (typeof tab.kind === 'string' && REMOVED_KINDS.has(tab.kind)) return null
  return tab
}

/** A layout row (or a kept draft's body) with the v78 widget set; the row itself when nothing changes. */
export function layoutWidgetSetOf(row: DataRow): DataRow {
  return layoutTabsOf(row, widgetSetTab)
}

export function upgradeWidgetSet(data: DataSet): DataSet {
  const layouts = data.layouts
  if (!layouts) return data
  const next = layouts.map(layoutWidgetSetOf)
  if (next.every((row, i) => row === layouts[i])) return data
  return { ...data, layouts: next }
}
