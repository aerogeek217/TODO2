import {
  tabListId,
  type LayoutBand,
  type LayoutBody,
  type LayoutCell,
  type LayoutTab,
} from '../models/workspace-layout'
import { layoutTabs } from './workspace-layout-queries'

/**
 * The lists a layout names (its list tabs'), counted, collected and
 * renamed — what Save, Save as and Delete reconcile a layout's own lists by.
 * Each write returns the same object when nothing changes.
 */

/**
 * How many tabs in `layout` show list `listDefinitionId` — its list tabs,
 * and its Eisenhower tabs when it is the Eisenhower's own list
 * (`eisenhowerListId`; `tabListId`) —, not counting the tabs in
 * `exceptTabIds` (e.g. the ones about to be closed).
 */
export function countListTabs(
  layout: LayoutBody,
  listDefinitionId: number,
  eisenhowerListId: number | null,
  exceptTabIds: ReadonlySet<string> = new Set(),
): number {
  let n = 0
  for (const tab of layoutTabs(layout)) {
    if (tabListId(tab, eisenhowerListId) === listDefinitionId && !exceptTabIds.has(tab.id)) n++
  }
  return n
}

/**
 * The ids of the lists a layout itself names: its list tabs' lists (an
 * Eisenhower tab's list is the Eisenhower's, not the layout's).
 */
export function layoutListRefs(layout: LayoutBody): Set<number> {
  const ids = new Set<number>()
  for (const tab of layoutTabs(layout)) {
    if (tab.kind === 'lens' && tab.config.listDefinitionId != null) ids.add(tab.config.listDefinitionId)
  }
  return ids
}

/** `cells` with `fn` applied to each; `cells` itself when no cell changes. */
function mapCells(cells: readonly LayoutCell[], fn: (cell: LayoutCell) => LayoutCell): LayoutCell[] | null {
  const next = cells.map(fn)
  return next.every((c, i) => c === cells[i]) ? null : next
}

/**
 * `layout` with `fn` applied to every cell (in columns and bands); the same
 * object when no cell changes.
 */
function mapLayoutCells<B extends LayoutBody>(layout: B, fn: (cell: LayoutCell) => LayoutCell): B {
  let changed = false
  const columns = layout.columns.map((col) => {
    const rows = col.rows.map((row) => {
      const cells = mapCells(row.cells, fn)
      return cells ? { ...row, cells } : row
    })
    if (rows.every((r, i) => r === col.rows[i])) return col
    return { ...col, rows }
  })
  if (columns.some((c, i) => c !== layout.columns[i])) changed = true
  const bandOf = (band: LayoutBand | undefined): LayoutBand | undefined => {
    if (!band) return band
    const cells = mapCells(band.cells, fn)
    if (!cells) return band
    changed = true
    return { ...band, cells }
  }
  const top = bandOf(layout.top)
  const bottom = bandOf(layout.bottom)
  if (!changed) return layout
  return { ...layout, columns, ...(top ? { top } : {}), ...(bottom ? { bottom } : {}) }
}

/**
 * The layout with the lists it names (`layoutListRefs`) renamed by `ids`
 * (old id → new id; ids it doesn't hold stay). The same object when
 * nothing changes.
 */
export function repointLayoutLists<B extends LayoutBody>(layout: B, ids: ReadonlyMap<number, number>): B {
  if (ids.size === 0) return layout
  const tabOf = (tab: LayoutTab): LayoutTab => {
    if (tab.kind === 'lens') {
      const to = tab.config.listDefinitionId != null ? ids.get(tab.config.listDefinitionId) : undefined
      return to == null ? tab : { ...tab, config: { ...tab.config, listDefinitionId: to } }
    }
    return tab
  }
  return mapLayoutCells(layout, (cell) => {
    const tabs = cell.tabs.map(tabOf)
    return tabs.every((t, i) => t === cell.tabs[i]) ? cell : { ...cell, tabs }
  })
}

/**
 * The lists `after` shows where `before` showed other ones at the same tab
 * (matched by tab id): old id → new id, e.g. a layout given its own copies of the
 * lists it shared with another one. `null` when an old id would become two
 * different ones.
 */
export function listIdChanges(before: LayoutBody, after: LayoutBody): Map<number, number> | null {
  const afterTabs = new Map(layoutTabs(after).map((t) => [t.id, t]))
  const changes = new Map<number, number>()
  const note = (from: number | undefined, to: number | undefined): boolean => {
    if (from == null || to == null || from === to) return true
    const known = changes.get(from)
    if (known != null && known !== to) return false
    changes.set(from, to)
    return true
  }
  for (const tab of layoutTabs(before)) {
    const other = afterTabs.get(tab.id)
    if (tab.kind === 'lens' && other?.kind === 'lens') {
      if (!note(tab.config.listDefinitionId, other.config.listDefinitionId)) return null
    }
  }
  return changes
}
