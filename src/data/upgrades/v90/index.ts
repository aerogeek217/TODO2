import type { DataRow, DataSet } from '../../schema-upgrades'
import { layoutTabsOf, type TabStep } from './layout-tabs'

/**
 * v90 — the Pivot removed, and every Number lives in a Numbers widget
 * (kind `numbers`, `config: { items }`). In every layout, first
 *
 * - each `pivot` tab goes: a cell whose active tab went shows the tab
 *   before it (else the one after); a cell left without tabs closes by the
 *   absorb rule, and the grid lines nothing uses then go
 *   (`./layout-tabs`). No list, setting or task is touched.
 *
 * Then
 *
 * - a cell whose tabs are all Numbers (`number`; one or more) becomes one
 *   Numbers widget holding them in their order, and its active tab is that
 *   widget;
 * - in a cell mixing Numbers with other kinds, each Number becomes a Numbers
 *   widget of one in its place (the cell's active tab follows it).
 *
 * Each Number keeps its id, its config and its icon as its item's; a tab
 * name a Number stored apart from its config's (no build wrote one) is its
 * name when its config has none. A new widget's id is new to its layout
 * (`n-` + the first item's id, numbered while taken). This part keeps the
 * tracks, their `fitPx` and their collapse: the rows stay fit rows.
 *
 * Follows the transform contract (`schema-upgrades`): pure, idempotent (a
 * layout with neither a Pivot nor a Number tab comes back as the same
 * object), tolerant of missing tables and malformed rows (a cell or tab
 * that isn't an object, a Number without an id: left for the layout
 * repair, which drops what is still wrong); a table it leaves alone comes
 * back as the same array.
 */

type Obj = Record<string, unknown>

const isRecord = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)

/** A Number tab this step converts: an object of kind `number` with a text id. */
function isNumberTab(tab: unknown): tab is Obj & { id: string } {
  return isRecord(tab) && tab.kind === 'number' && typeof tab.id === 'string'
}

/** Every id a layout row uses (tracks, cells, tabs, items), as far as it reads. */
function idsOf(row: DataRow): Set<string> {
  const ids = new Set<string>()
  const add = (v: unknown) => { if (isRecord(v) && typeof v.id === 'string') ids.add(v.id) }
  const grid = row.grid
  if (isRecord(grid)) for (const axis of [grid.columns, grid.rows]) if (Array.isArray(axis)) axis.forEach(add)
  for (const cell of Array.isArray(row.cells) ? row.cells as unknown[] : []) {
    add(cell)
    for (const tab of isRecord(cell) && Array.isArray(cell.tabs) ? cell.tabs as unknown[] : []) {
      add(tab)
      if (isRecord(tab) && isRecord(tab.config) && tab.kind === 'numbers' && Array.isArray(tab.config.items)) tab.config.items.forEach(add)
    }
  }
  return ids
}

/** A Number tab as an item: its config, its id and its icon (a stored tab name its name when its config has none). */
function itemOf(tab: Obj & { id: string }): Obj {
  const config = isRecord(tab.config) ? tab.config : {}
  const name = typeof config.name === 'string' ? config.name : typeof tab.name === 'string' ? tab.name : config.name
  return { ...config, ...(name !== undefined ? { name } : {}), id: tab.id, ...(tab.icon !== undefined ? { icon: tab.icon } : {}) }
}

/** A layout row with its Number tabs made Numbers widgets (the same object when it has none). */
function layoutOf(row: DataRow): DataRow {
  if (!Array.isArray(row.cells)) return row
  const cells = row.cells as unknown[]
  if (!cells.some((cell) => isRecord(cell) && Array.isArray(cell.tabs) && (cell.tabs as unknown[]).some(isNumberTab))) return row
  const taken = idsOf(row)
  const widgetOf = (numbers: Array<Obj & { id: string }>): Obj => {
    // Within the longest id a layout keeps (100), its number suffix included.
    const base = `n-${(numbers[0]?.id ?? 'numbers').slice(0, 90)}`
    let id = base
    for (let n = 2; taken.has(id); n++) id = `${base}-${n}`
    taken.add(id)
    return { id, kind: 'numbers', config: { items: numbers.map(itemOf) } }
  }
  const next = cells.map((cell) => {
    if (!isRecord(cell) || !Array.isArray(cell.tabs)) return cell
    const tabs = cell.tabs as unknown[]
    if (!tabs.some(isNumberTab)) return cell
    if (tabs.every(isNumberTab)) {
      const widget = widgetOf(tabs)
      return { ...cell, tabs: [widget], activeTabId: widget.id }
    }
    let activeTabId = cell.activeTabId
    const out = tabs.map((tab) => {
      if (!isNumberTab(tab)) return tab
      const widget = widgetOf([tab])
      if (activeTabId === tab.id) activeTabId = widget.id
      return widget
    })
    return { ...cell, tabs: out, ...(activeTabId !== undefined ? { activeTabId } : {}) }
  })
  return { ...row, cells: next }
}

/** A Pivot tab goes. */
const dropPivot: TabStep = (tab) => (tab.kind === 'pivot' ? null : tab)

export function upgradeV90(data: DataSet): DataSet {
  const layouts = data.layouts
  if (!Array.isArray(layouts)) return data
  const next = layouts.map((row) => (isRecord(row) ? layoutOf(layoutTabsOf(row, dropPivot)) : row))
  if (next.every((row, i) => row === layouts[i])) return data
  return { ...data, layouts: next }
}
