import {
  tabListId,
  type LayoutBody,
  type LayoutCell,
  type LayoutTab,
} from '../models/workspace-layout'
import type { NumberItem } from '../models/glance-widgets'
import { layoutTabs } from './workspace-layout-queries'

/**
 * The lists a layout names (its list tabs', its Numbers' that follow one), counted, collected and
 * renamed — what a committed edit, Duplicate layout and Delete reconcile a layout's own lists by.
 * Each write returns the same object when nothing changes. (A Review
 * widget's list picks are temporary, never part of the layout: they name
 * none.)
 */

/**
 * How many tabs in `layout` show list `listDefinitionId` — its list tabs
 * (`tabListId`) —, not counting the tabs in `exceptTabIds` (e.g. the ones
 * about to be closed).
 */
export function countListTabs(
  layout: LayoutBody,
  listDefinitionId: number,
  exceptTabIds: ReadonlySet<string> = new Set(),
): number {
  let n = 0
  for (const tab of layoutTabs(layout)) {
    if (tabListId(tab) === listDefinitionId && !exceptTabIds.has(tab.id)) n++
  }
  return n
}

/** The list a Number follows (D26 P6, `show: 'list'`), else `undefined`. */
function followedListId(item: NumberItem): number | undefined {
  return item.show === 'list' ? item.list?.listDefinitionId : undefined
}

/**
 * The lists a tab names as the layout's own: a list tab's list, or the
 * lists a Numbers widget's Numbers follow.
 */
function namedListIds(tab: LayoutTab): number[] {
  if (tab.kind === 'lens') return tab.config.listDefinitionId != null ? [tab.config.listDefinitionId] : []
  if (tab.kind === 'numbers') return tab.config.items.flatMap((item) => followedListId(item) ?? [])
  return []
}

/**
 * The ids of the lists a layout itself names: its list tabs' lists and the
 * lists its Numbers follow.
 */
export function layoutListRefs(layout: LayoutBody): Set<number> {
  const ids = new Set<number>()
  for (const tab of layoutTabs(layout)) {
    for (const id of namedListIds(tab)) ids.add(id)
  }
  return ids
}

/**
 * `layout` with `fn` applied to every cell; the same object when no cell
 * changes.
 */
function mapLayoutCells<B extends LayoutBody>(layout: B, fn: (cell: LayoutCell) => LayoutCell): B {
  const cells = layout.cells.map(fn)
  return cells.every((c, i) => c === layout.cells[i]) ? layout : { ...layout, cells }
}

/**
 * The layout with the lists it names (`layoutListRefs`) renamed by `ids`
 * (old id → new id; ids it doesn't hold stay). The same object when
 * nothing changes.
 */
export function repointLayoutLists<B extends LayoutBody>(layout: B, ids: ReadonlyMap<number, number>): B {
  if (ids.size === 0) return layout
  const renamed = (from: number | undefined) => (from != null ? ids.get(from) : undefined)
  const itemOf = (item: NumberItem): NumberItem => {
    const to = renamed(followedListId(item))
    return to == null ? item : { ...item, list: { listDefinitionId: to } }
  }
  const tabOf = (tab: LayoutTab): LayoutTab => {
    if (tab.kind === 'lens') {
      const to = renamed(tab.config.listDefinitionId)
      return to == null ? tab : { ...tab, config: { ...tab.config, listDefinitionId: to } }
    }
    if (tab.kind === 'numbers') {
      const items = tab.config.items.map(itemOf)
      return items.every((item, i) => item === tab.config.items[i]) ? tab : { ...tab, config: { ...tab.config, items } }
    }
    return tab
  }
  return mapLayoutCells(layout, (cell) => {
    const tabs = cell.tabs.map(tabOf)
    return tabs.every((t, i) => t === cell.tabs[i]) ? cell : { ...cell, tabs }
  })
}
