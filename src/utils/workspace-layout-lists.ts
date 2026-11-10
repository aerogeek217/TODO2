import {
  tabListId,
  type LayoutBody,
  type LayoutCell,
  type LayoutTab,
} from '../models/workspace-layout'
import { layoutTabs } from './workspace-layout-queries'

/**
 * The lists a layout names (its list tabs', its Numbers' that follow one, its Review widgets' list picks), counted, collected and
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
 * The list a tab names as the layout's own: a list tab's list, or the list
 * a Number follows (D26 P6, `show: 'list'`).
 */
function namedListId(tab: LayoutTab): number | undefined {
  if (tab.kind === 'lens') return tab.config.listDefinitionId
  if (tab.kind === 'number' && tab.config.show === 'list') return tab.config.list?.listDefinitionId
  // A Review widget reviewing one of the layout's lists (item 12).
  if (tab.kind === 'review' && tab.config.pick?.kind === 'list') return tab.config.pick.id
  return undefined
}

/**
 * The ids of the lists a layout itself names: its list tabs' lists and the
 * lists its Numbers follow (an Eisenhower tab's list is the Eisenhower's,
 * not the layout's).
 */
export function layoutListRefs(layout: LayoutBody): Set<number> {
  const ids = new Set<number>()
  for (const tab of layoutTabs(layout)) {
    const id = namedListId(tab)
    if (id != null) ids.add(id)
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
  const tabOf = (tab: LayoutTab): LayoutTab => {
    const from = namedListId(tab)
    const to = from != null ? ids.get(from) : undefined
    if (to == null) return tab
    if (tab.kind === 'lens') return { ...tab, config: { ...tab.config, listDefinitionId: to } }
    if (tab.kind === 'number') return { ...tab, config: { ...tab.config, list: { listDefinitionId: to } } }
    if (tab.kind === 'review') return { ...tab, config: { ...tab.config, pick: { kind: 'list', id: to } } }
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
    if (other?.kind === tab.kind && !note(namedListId(tab), namedListId(other))) return null
  }
  return changes
}
