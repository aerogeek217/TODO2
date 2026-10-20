import type { DataRow, DataSet } from '../schema-upgrades'
import { isRecord } from '../../utils/is-record'
import { isId, maxId } from './helpers'

/**
 * v67 — layouts get an order; the Eisenhower gets its own list.
 *
 * v67 also adds parts that need no transform: a list's `owner` (a list kept
 * with one layout only, or the Eisenhower's), its `showFilterLine: false`,
 * the `priority` grouping and the `newTaskFollowup` setting. An older build
 * would drop or misread them (a hidden list showing up in its list
 * choosers), so it refuses v67 data as too new.
 *
 * (a) **Layout order.** Every layout row without a numeric `sortOrder` gets
 * one: the rows are taken in the order the layout picker showed them — by
 * `createdAt` (a `Date` or a date text; one that doesn't read goes last),
 * then id, then input order — and numbered from 0 (after the highest order
 * already there, should a row have one).
 *
 * (b) **The Eisenhower's list** — only for a dataset with both a `settings`
 * and a `listDefinitions` table (never a kept draft or a task archive), and
 * only when no list is the Eisenhower's yet (`owner: { eisenhower: true }`):
 *
 * - The `eisenhowerSource` setting names a list that exists and that no list
 *   tab (in any layout's columns or bands), no dashboard list tile and no
 *   check-in scope (`checkinTaskScope`) uses → that list becomes the
 *   Eisenhower's in place (its owner set, nothing else changed — so a kept
 *   draft of it still applies).
 * - It names a list that something else uses → a copy of that list becomes
 *   the Eisenhower's: a new id, named `Eisenhower`, last in the list order,
 *   with the list's manual order (`listOrders`) copied; the setting names the
 *   copy and the original stays a saved list.
 * - Otherwise (all tasks: no setting, `all`, a deleted list or a value that
 *   doesn't read) → a new list named `Eisenhower` with no filter (Show
 *   completed off — the same tasks as all tasks under any screen filter),
 *   manual order, ungrouped; the setting names it.
 *
 * New ids come after every id of the table and every list id anything in
 * the dataset names (so no stale reference to a deleted list starts naming
 * the new one); deterministic, so a browser database and its upgraded sync
 * file agree.
 *
 * Idempotent (v67 data has an order on every layout and an Eisenhower list,
 * so nothing changes and the input is returned); tolerates missing tables
 * and rows whose shape it can't walk (passed through for validation to
 * judge). Returns the input itself when nothing changes.
 */

type Obj = Record<string, unknown>

const EISENHOWER_LIST_NAME = 'Eisenhower'
const SOURCE_KEY = 'eisenhowerSource'
const CHECKIN_SCOPE_KEY = 'checkinTaskScope'
const LIST_VALUE = /^list:([1-9]\d{0,14})$/

/** A filter that hides nothing but completed tasks (frozen with this transform). */
function emptyFilter(): Obj {
  return { showCompleted: false, personIds: null, statusIds: null, searchText: '', dates: {}, markers: null, tags: null }
}

function isOrder(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

/** The list id a `list:<id>` setting value names, or `undefined`. */
function listIdOfValue(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined
  const m = LIST_VALUE.exec(value)
  const n = m ? Number(m[1]) : NaN
  return Number.isSafeInteger(n) ? n : undefined
}

function settingValue(settings: readonly DataRow[], key: string): unknown {
  const row = settings.find((r) => isRecord(r) && r.key === key)
  return row?.value
}

/** A `createdAt` as a time; one that doesn't read sorts last. */
function timeOf(v: unknown): number {
  const t = v instanceof Date ? v.getTime() : typeof v === 'string' ? Date.parse(v) : NaN
  return Number.isNaN(t) ? Infinity : t
}

/** (a) Every layout row without an order gets one, in the picker's old order; the same array when none lacks one. */
function orderLayouts(rows: readonly DataRow[]): DataRow[] {
  const missing = rows.map((row, i) => ({ row, i })).filter(({ row }) => isRecord(row) && !isOrder(row.sortOrder))
  if (missing.length === 0) return rows as DataRow[]
  let next = 0
  for (const row of rows) if (isRecord(row) && isOrder(row.sortOrder)) next = Math.max(next, Math.floor(row.sortOrder) + 1)
  const idOf = (row: DataRow) => (isId(row.id) ? row.id : Infinity)
  missing.sort((a, b) => timeOf(a.row.createdAt) - timeOf(b.row.createdAt) || idOf(a.row) - idOf(b.row) || a.i - b.i)
  const orderAt = new Map(missing.map(({ i }, k) => [i, next + k]))
  return rows.map((row, i) => {
    const order = orderAt.get(i)
    return order === undefined ? row : { ...row, sortOrder: order }
  })
}

/** The tab lists of a layout row: top band, the columns' cells, bottom band. */
function tabListsOf(row: Obj): unknown[][] {
  const out: unknown[][] = []
  const band = (b: unknown) => {
    if (isRecord(b) && Array.isArray(b.tabs)) out.push(b.tabs)
  }
  band(row.top)
  if (Array.isArray(row.columns)) {
    for (const col of row.columns) {
      if (!isRecord(col) || !Array.isArray(col.cells)) continue
      for (const cell of col.cells) if (isRecord(cell) && Array.isArray(cell.tabs)) out.push(cell.tabs)
    }
  }
  band(row.bottom)
  return out
}

/** The list ids the layouts' list tabs and dashboard list tiles show, and the check-in scope's. */
function usedListIds(data: DataSet, settings: readonly DataRow[]): Set<number> {
  const used = new Set<number>()
  for (const row of data.layouts ?? []) {
    if (!isRecord(row)) continue
    for (const tabs of tabListsOf(row)) {
      for (const tab of tabs) {
        if (!isRecord(tab) || !isRecord(tab.config)) continue
        if (tab.kind === 'lens' && isId(tab.config.listDefinitionId)) used.add(tab.config.listDefinitionId)
        if (tab.kind === 'dashboard' && Array.isArray(tab.config.listTiles)) {
          for (const id of tab.config.listTiles) if (isId(id)) used.add(id)
        }
      }
    }
  }
  const scope = listIdOfValue(settingValue(settings, CHECKIN_SCOPE_KEY))
  if (scope !== undefined) used.add(scope)
  return used
}

/** `settings` with `eisenhowerSource` naming `listId` (the row replaced in place, else added). */
function withSource(settings: readonly DataRow[], listId: number): DataRow[] {
  const value = `list:${listId}`
  const at = settings.findIndex((r) => isRecord(r) && r.key === SOURCE_KEY)
  if (at < 0) return [...settings, { key: SOURCE_KEY, value }]
  return settings.map((r, i) => (i === at ? { key: SOURCE_KEY, value } : r))
}

function isEisenhowerList(row: unknown): boolean {
  return isRecord(row) && isRecord(row.owner) && row.owner.eisenhower === true
}

/** (b) The dataset with the Eisenhower's own list; the input when it has one already (or can't hold one). */
function withEisenhowerList(data: DataSet): DataSet {
  const lists = data.listDefinitions
  const settings = data.settings
  if (!Array.isArray(lists) || !Array.isArray(settings)) return data
  if (lists.some(isEisenhowerList)) return data

  const sourceId = listIdOfValue(settingValue(settings, SOURCE_KEY))
  const source = sourceId !== undefined ? lists.find((r) => isRecord(r) && r.id === sourceId) : undefined
  const used = usedListIds(data, settings)

  if (source && sourceId !== undefined && !used.has(sourceId)) {
    // Only the Eisenhower shows it: it becomes the Eisenhower's in place.
    return { ...data, listDefinitions: lists.map((r) => (r === source ? { ...r, owner: { eisenhower: true } } : r)) }
  }

  // A new id after every list id the dataset holds or names.
  const orders = Array.isArray(data.listOrders) ? data.listOrders : undefined
  const named = new Set<number>(used)
  for (const r of lists) if (isRecord(r) && isId(r.id)) named.add(r.id)
  if (sourceId !== undefined) named.add(sourceId)
  for (const r of orders ?? []) if (isRecord(r) && isId(r.listDefinitionId)) named.add(r.listDefinitionId)
  let top = maxId(lists)
  for (const id of named) if (id > top) top = id
  const id = idAfter(top, named)
  let lastOrder = -1
  for (const r of lists) if (isRecord(r) && isOrder(r.sortOrder) && r.sortOrder > lastOrder) lastOrder = r.sortOrder
  const sortOrder = Math.floor(lastOrder) + 1
  const owner = { eisenhower: true }

  const out: DataSet = { ...data, settings: withSource(settings, id) }
  if (source) {
    // Something else shows it too: a copy (with its manual order) becomes the Eisenhower's.
    out.listDefinitions = [...lists, { ...source, id, name: EISENHOWER_LIST_NAME, sortOrder, owner }]
    if (orders) {
      const ranks = orders.filter((r) => isRecord(r) && r.listDefinitionId === sourceId)
      if (ranks.length > 0) {
        const taken = new Set<number>()
        for (const r of orders) if (isRecord(r) && isId(r.id)) taken.add(r.id)
        let top = maxId(orders)
        out.listOrders = [...orders, ...ranks.map((r) => {
          const rowId = idAfter(top, taken)
          taken.add(rowId)
          if (rowId > top) top = rowId
          return { ...r, id: rowId, listDefinitionId: id }
        })]
      }
    }
  } else {
    // All tasks: a list with no filter.
    out.listDefinitions = [...lists, {
      id, name: EISENHOWER_LIST_NAME, sortOrder,
      membership: { kind: 'custom', predicate: emptyFilter() },
      sort: 'manual', grouping: 'none', owner,
    }]
  }
  return out
}

/**
 * A new id: one past `top` (the highest id there is) — or, when that is no
 * longer a safe whole number (a huge id stored earlier), the smallest
 * positive one `taken` doesn't hold.
 */
function idAfter(top: number, taken: ReadonlySet<number>): number {
  const next = Math.floor(top) + 1
  if (Number.isSafeInteger(next) && !taken.has(next)) return next
  let id = 1
  while (taken.has(id)) id++
  return id
}

/** v67 — an order for every layout; the Eisenhower's own list. */
export function upgradeV67(data: DataSet): DataSet {
  let out = data
  const layouts = data.layouts
  if (Array.isArray(layouts)) {
    const ordered = orderLayouts(layouts)
    if (ordered !== layouts) out = { ...out, layouts: ordered }
  }
  return withEisenhowerList(out)
}
