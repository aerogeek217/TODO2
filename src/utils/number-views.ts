import type { IconValue } from '../models/icon'
import { numberConfigOfItem, type NumberConfig, type NumberItem } from '../models/glance-widgets'
import type { LayoutBody, LayoutCell, LayoutTab, NumbersTab } from '../models/workspace-layout'
import type { IdGen } from './workspace-layout-ops'

/**
 * TEMPORARY — the Numbers widget's first step; the next one draws the
 * widget itself and deletes this file. Until then the app draws and edits a
 * Numbers widget as the strip of Number tabs it replaced: each Number is
 * **viewed** as a tab of its own — a Numbers widget of that one Number whose
 * id is the Number's (`isNumberView`) — so the strip, a Number's menu, its
 * editor, the popup and the drags work on it as they did.
 *
 * `numberViews` makes a layout's view (cached: the same layout, the same
 * view); `throughNumberViews` runs a layout edit on the view and folds the
 * result back into Numbers widgets (`fromNumberViews`), by the v90 rules: a
 * cell of only Numbers holds one widget, a Number among other kinds one of
 * its own. A widget keeps its id, name and icon while its first Number
 * stays in it.
 */

/** One Number as the Number components read it: the tab kind they were written for. */
export interface NumberTab {
  id: string
  kind: 'number'
  config: NumberConfig
  icon?: IconValue
}

/** A tab that is one Number's view: a Numbers widget of that one Number, under the Number's own id. */
export function isNumberView(tab: LayoutTab): boolean {
  return tab.kind === 'numbers' && tab.config.items.length === 1 && tab.config.items[0]?.id === tab.id
}

/** `isNumberView` narrowing the tab (only its true branch: a Numbers tab that is no view stays one). */
export const isNumberViewTab = (tab: LayoutTab): tab is NumbersTab => isNumberView(tab)

const numberTabs = new WeakMap<NumbersTab, NumberTab>()

/**
 * The Number a Numbers tab's first item is, as the Number components read it
 * — `preview` (its editor's draft) for its config when given. Without one,
 * the same tab gives the same object (its hooks' shared memos key on it).
 */
export function numberTabOf(tab: NumbersTab, preview?: NumberConfig): NumberTab | undefined {
  const known = preview ? undefined : numberTabs.get(tab)
  if (known) return known
  const item = tab.config.items[0]
  if (!item) return undefined
  const icon = tab.icon ?? item.icon
  const number: NumberTab = { id: item.id, kind: 'number', config: preview ?? numberConfigOfItem(item), ...(icon ? { icon } : {}) }
  if (!preview) numberTabs.set(tab, number)
  return number
}

/** A Number's view: its icon on the tab. */
function viewOf(item: NumberItem): NumbersTab {
  const { icon, ...rest } = item
  return { id: item.id, kind: 'numbers', config: { items: [rest] }, ...(icon ? { icon } : {}) }
}

const cellViews = new WeakMap<LayoutCell, LayoutCell>()
const bodyViews = new WeakMap<LayoutBody, LayoutBody>()

/** A cell with each Numbers widget's Numbers viewed as tabs of their own; the same cell when it has none. */
export function numberViewCell(cell: LayoutCell): LayoutCell {
  if (!cell.tabs.some((t) => t.kind === 'numbers' && !isNumberView(t))) return cell
  const known = cellViews.get(cell)
  if (known) return known
  const tabs = cell.tabs.flatMap((t) => (t.kind === 'numbers' && !isNumberView(t) ? t.config.items.map(viewOf) : [t]))
  const active = cell.tabs.find((t) => t.id === cell.activeTabId)
  const activeTabId = active?.kind === 'numbers' ? active.config.items[0]?.id : cell.activeTabId
  const view: LayoutCell = { ...cell, tabs, ...(activeTabId != null ? { activeTabId } : {}) }
  cellViews.set(cell, view)
  return view
}

/** `layout`'s view (`numberViewCell` for each cell); the same layout when it has no Numbers widget. */
export function numberViews<L extends LayoutBody>(layout: L): L
export function numberViews<L extends LayoutBody>(layout: L | null): L | null
export function numberViews<L extends LayoutBody>(layout: L | null): L | null {
  if (!layout) return layout
  const known = bodyViews.get(layout)
  if (known) return known as L
  const cells = layout.cells.map(numberViewCell)
  const view = cells.every((c, i) => c === layout.cells[i]) ? layout : { ...layout, cells }
  bodyViews.set(layout, view)
  return view
}

/** A Numbers tab's items as stored: a view's one Number takes the view's icon. */
function itemsOf(tab: NumbersTab): NumberItem[] {
  if (!isNumberView(tab)) return tab.config.items
  const first = tab.config.items[0]
  if (!first) return []
  const { icon: _icon, ...item } = first
  void _icon
  return [tab.icon ? { ...item, icon: tab.icon } : item]
}

/**
 * A view folded back into Numbers widgets: in each cell of only Numbers, one
 * widget of them all, in order; elsewhere, each Number a widget of its own
 * (a widget already whole stays as it is). A widget takes the id, name and
 * icon its first Number's widget had in `before` while no other cell took
 * them first, else a new id (`genId`); the cell's active tab follows its
 * Number to its widget.
 */
function fromNumberViews<L extends LayoutBody>(view: L, before: LayoutBody, genId: IdGen): L {
  const owners = new Map<string, NumbersTab>()
  for (const cell of before.cells) {
    for (const tab of cell.tabs) if (tab.kind === 'numbers') for (const item of tab.config.items) owners.set(item.id, tab)
  }
  const used = new Set<string>()
  const widget = (tabs: NumbersTab[]): NumbersTab => {
    const first = tabs[0]
    if (tabs.length === 1 && first && !isNumberView(first) && !used.has(first.id)) {
      used.add(first.id)
      return first
    }
    const owner = first && isNumberView(first) ? owners.get(first.id) : first
    const id = owner && !used.has(owner.id) ? owner.id : genId()
    used.add(id)
    const label = owner && owner.id === id ? { ...(owner.name ? { name: owner.name } : {}), ...(owner.icon ? { icon: owner.icon } : {}) } : {}
    return { id, kind: 'numbers', config: { items: tabs.flatMap(itemsOf) }, ...label }
  }
  const cellOf = (cell: LayoutCell): LayoutCell => {
    if (!cell.tabs.some(isNumberView)) return cell
    const numbers = cell.tabs.filter((t): t is NumbersTab => t.kind === 'numbers')
    const tabs = numbers.length === cell.tabs.length ? [widget(numbers)] : cell.tabs.map((t) => (t.kind === 'numbers' ? widget([t]) : t))
    // The active tab's widget: the one now holding its (first) Number.
    const active = cell.tabs.find((t) => t.id === cell.activeTabId)
    const activeNumber = active?.kind === 'numbers' ? active.config.items[0]?.id : undefined
    const holder = tabs.find((t) => t.kind === 'numbers' && t.config.items.some((item) => item.id === activeNumber))
    const activeTabId = holder?.id ?? cell.activeTabId
    return { ...cell, tabs, ...(activeTabId != null ? { activeTabId } : {}) }
  }
  const cells = view.cells.map(cellOf)
  return cells.every((c, i) => c === view.cells[i]) ? view : { ...view, cells }
}

/** `fn` run on `layout`'s view, its result folded back (`fromNumberViews`); `layout` itself when `fn` changes nothing. */
export function throughNumberViews<L extends LayoutBody>(layout: L, fn: (view: L) => L, genId: IdGen): L {
  const view = numberViews(layout)
  const out = fn(view)
  return out === view ? layout : fromNumberViews(out, layout, genId)
}
