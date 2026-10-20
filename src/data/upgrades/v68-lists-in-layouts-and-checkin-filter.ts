import type { DataRow, DataSet } from '../schema-upgrades'
import { isRecord } from '../../utils/is-record'
import { isId, maxId } from './helpers'

/**
 * v68 — every list belongs to a layout; the check-in's Which tasks becomes a
 * filter.
 *
 * v68 also adds settings that need no transform: the new-list sort, sort
 * direction and grouping (`newListSort` / `newListSortDirection` /
 * `newListGroup`) and the purge prompt's interval and last showing
 * (`purgePromptIntervalDays` / `purgePromptLastAt`). An older build would
 * misread v68 data (no saved lists left to list, an unknown check-in
 * setting), so it refuses v68 data as too new.
 *
 * (a) **Lists in layouts** — only for a dataset with both `listDefinitions`
 * and `settings` (a whole database: never a kept draft or a task archive);
 * no `layouts` table reads as no layouts. The Eisenhower's own
 * list (`owner: { eisenhower: true }`) is left as it is. Layouts are taken
 * in their order (`sortOrder`, then id), and a layout's lists in the order
 * its tabs name them (top band, the columns' cells, bottom band; a list
 * tab's list, a dashboard tab's list tiles):
 *
 * - A list without an owner — or owned by a layout that doesn't exist, or
 *   by an owner that doesn't read — becomes the list of the first layout
 *   that names it (its owner set, nothing else changed — so a kept draft of
 *   it still applies).
 * - Every other layout that names a list gets its own **copy**: a new id,
 *   the same definition, owned by that layout, last in the list order, with
 *   the list's manual order (`listOrders`) copied; that layout's tabs and
 *   tiles name the copy.
 * - The lists no layout names (and that no existing layout owns — or whose
 *   layout doesn't show it while the check-in scope named it, which at v67
 *   kept it from going at that layout's Save) go into a
 *   new layout **Lists from upgrade** — last in the layout order, one
 *   column, one cell, one list tab per list in the list order (`sortOrder`,
 *   then id), the first active — which owns them. None → no such layout.
 *
 * (b) **The check-in filter** — only for a dataset with `settings`. The
 * `checkinTaskScope` row goes; unless a `checkinTaskFilter` row is there
 * already, it becomes that filter (JSON of a list predicate):
 *
 * - `all` (or a value that doesn't read) → no row (no filter);
 * - `hot` → Priority Hot;
 * - `due-soon` ("Overdue + next 2 weeks": due, or following up, on or
 *   before today + 14 days) → a due-date range open at the start and ending
 *   14 days from today. The date filters can't say "due *or* follow-up"
 *   (every date clause must pass), so a task only following up in the next
 *   two weeks no longer counts;
 * - `list:<id>` → that list's filter, without its people filter (a check-in
 *   is the person's) and with completed tasks off; a list that doesn't
 *   exist → no filter.
 *
 * New ids come after every id of the table and every list / layout id
 * anything in the dataset names (so no stale reference starts naming the
 * new row); dates of the new layout are the latest layout date there is
 * (a fixed date without one) — deterministic, so a browser database and its
 * upgraded sync file agree.
 *
 * Idempotent (v68 data has every list in a layout naming only its own, and
 * no check-in scope, so nothing changes); tolerates missing tables and rows
 * whose shape it can't walk (passed through for validation to judge).
 * Returns the input itself when nothing changes.
 */

type Obj = Record<string, unknown>

const UPGRADE_LAYOUT_NAME = 'Lists from upgrade'
const SCOPE_KEY = 'checkinTaskScope'
const FILTER_KEY = 'checkinTaskFilter'
const SOURCE_KEY = 'eisenhowerSource'
const DUE_SOON_DAYS = 14
const LIST_VALUE = /^list:([1-9]\d{0,14})$/
/** The new layout's dates when the dataset has no layout date that reads. */
const FALLBACK_AT = '2026-10-20T00:00:00.000Z'

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

function settingValue(settings: readonly DataRow[] | undefined, key: string): unknown {
  const row = settings?.find((r) => isRecord(r) && r.key === key)
  return row?.value
}

function isEisenhowerList(row: unknown): boolean {
  return isRecord(row) && isRecord(row.owner) && row.owner.eisenhower === true
}

/** The layout id a list's owner names, or `undefined`. */
function ownerLayoutOf(row: Obj): number | undefined {
  return isRecord(row.owner) && isId(row.owner.layoutId) ? row.owner.layoutId : undefined
}

/** The tab arrays of a layout row: top band, the columns' cells, bottom band. */
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

/** The list ids a layout row names, in tab order, each once. */
function listRefsOf(row: Obj): number[] {
  const ids: number[] = []
  const add = (id: unknown) => {
    if (isId(id) && !ids.includes(id)) ids.push(id)
  }
  for (const tabs of tabListsOf(row)) {
    for (const tab of tabs) {
      if (!isRecord(tab) || !isRecord(tab.config)) continue
      if (tab.kind === 'lens') add(tab.config.listDefinitionId)
      if (tab.kind === 'dashboard' && Array.isArray(tab.config.listTiles)) for (const id of tab.config.listTiles) add(id)
    }
  }
  return ids
}

/** A tab with the lists it names renamed by `ids` (the same tab when none). */
function repointTab(tab: unknown, ids: ReadonlyMap<number, number>): unknown {
  if (!isRecord(tab) || !isRecord(tab.config)) return tab
  if (tab.kind === 'lens' && isId(tab.config.listDefinitionId)) {
    const to = ids.get(tab.config.listDefinitionId)
    return to === undefined ? tab : { ...tab, config: { ...tab.config, listDefinitionId: to } }
  }
  if (tab.kind === 'dashboard' && Array.isArray(tab.config.listTiles)) {
    const tiles: unknown[] = tab.config.listTiles
    if (!tiles.some((id) => isId(id) && ids.has(id))) return tab
    return { ...tab, config: { ...tab.config, listTiles: tiles.map((id) => (isId(id) ? ids.get(id) ?? id : id)) } }
  }
  return tab
}

/** A layout row with the lists its tabs name renamed by `ids`. */
function repointLayout(row: Obj, ids: ReadonlyMap<number, number>): Obj {
  const panel = (p: unknown): unknown => (isRecord(p) && Array.isArray(p.tabs) ? { ...p, tabs: p.tabs.map((t) => repointTab(t, ids)) } : p)
  const out: Obj = { ...row }
  if (row.top !== undefined) out.top = panel(row.top)
  if (row.bottom !== undefined) out.bottom = panel(row.bottom)
  if (Array.isArray(row.columns)) {
    out.columns = row.columns.map((col) => (isRecord(col) && Array.isArray(col.cells) ? { ...col, cells: col.cells.map(panel) } : col))
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

/** Hands out new ids after `top`, never one of `taken`. */
function idPool(top: number, taken: Set<number>): () => number {
  let last = top
  return () => {
    const id = idAfter(last, taken)
    taken.add(id)
    if (id > last) last = id
    return id
  }
}

/** The time of a stored date (a `Date` or a date text); `NaN` when it doesn't read. */
function timeOf(v: unknown): number {
  return v instanceof Date ? v.getTime() : typeof v === 'string' ? Date.parse(v) : NaN
}

/** The latest date the layouts hold (created or modified), else the fixed fallback. */
function newLayoutDate(layouts: readonly DataRow[]): Date {
  let latest = NaN
  for (const row of layouts) {
    if (!isRecord(row)) continue
    for (const t of [timeOf(row.createdAt), timeOf(row.modifiedAt)]) if (!Number.isNaN(t) && !(t <= latest)) latest = t
  }
  return new Date(Number.isNaN(latest) ? Date.parse(FALLBACK_AT) : latest)
}

/**
 * (a) The dataset with every list in a layout (`scopeListId`: the list the
 * check-in scope named); the input when nothing changes (or it isn't a
 * whole database).
 */
function withListsInLayouts(data: DataSet, scopeListId: number | undefined): DataSet {
  const lists = data.listDefinitions
  if (!Array.isArray(lists) || !Array.isArray(data.settings)) return data
  const layouts = Array.isArray(data.layouts) ? data.layouts : []

  const ordered = layouts
    .map((row, i) => ({ row, i }))
    .filter((e): e is { row: Obj & { id: number }; i: number } => isRecord(e.row) && isId(e.row.id))
    .sort((a, b) => (isOrder(a.row.sortOrder) ? a.row.sortOrder : Infinity) - (isOrder(b.row.sortOrder) ? b.row.sortOrder : Infinity)
      || a.row.id - b.row.id || a.i - b.i)
  const layoutIds = new Set(ordered.map((e) => e.row.id))
  const listById = new Map<number, Obj>()
  for (const row of lists) if (isRecord(row) && isId(row.id) && !listById.has(row.id)) listById.set(row.id, row)
  /** The lists a layout may own: every list but the Eisenhower's. */
  const movable = (id: number) => {
    const row = listById.get(id)
    return row !== undefined && !isEisenhowerList(row)
  }

  const refsOf = new Map<number, number[]>()
  for (const { row } of ordered) refsOf.set(row.id, listRefsOf(row).filter(movable))
  // Each list's layout: the existing layout that owns it — unless that layout
  // doesn't show it and only the check-in scope did (no longer a list
  // reference: it would go at that layout's next Save) —, else the first
  // layout that names it.
  const ownerOf = new Map<number, number>()
  for (const [id, row] of listById) {
    const layoutId = ownerLayoutOf(row)
    if (isEisenhowerList(row) || layoutId === undefined || !layoutIds.has(layoutId)) continue
    if (id === scopeListId && !(refsOf.get(layoutId) ?? []).includes(id)) continue
    ownerOf.set(id, layoutId)
  }
  for (const { row } of ordered) for (const id of refsOf.get(row.id) ?? []) if (!ownerOf.has(id)) ownerOf.set(id, row.id)
  // The lists whose stored owner isn't just that layout (none, a layout that is gone, extra keys).
  const ownerChanges = new Map<number, number>()
  for (const [id, layoutId] of ownerOf) {
    const owner = listById.get(id)?.owner
    if (!(isRecord(owner) && Object.keys(owner).length === 1 && owner.layoutId === layoutId)) ownerChanges.set(id, layoutId)
  }
  // A copy for every other layout naming a list.
  const copiesFor: Array<{ layoutId: number; from: number }> = []
  for (const { row } of ordered) for (const id of refsOf.get(row.id) ?? []) if (ownerOf.get(id) !== row.id) copiesFor.push({ layoutId: row.id, from: id })
  // The lists no layout has: into the new layout.
  const unused = [...listById.entries()]
    .filter(([id, row]) => !isEisenhowerList(row) && !ownerOf.has(id))
    .map(([id, row]) => ({ id, row }))
  if (ownerChanges.size === 0 && copiesFor.length === 0 && unused.length === 0) return data

  // New list ids: after every list id the dataset holds or names.
  const orders = Array.isArray(data.listOrders) ? data.listOrders : undefined
  const named = new Set<number>(listById.keys())
  for (const refs of refsOf.values()) for (const id of refs) named.add(id)
  for (const { row } of ordered) for (const id of listRefsOf(row)) named.add(id)
  for (const id of [listIdOfValue(settingValue(data.settings, SOURCE_KEY)), scopeListId]) if (id !== undefined) named.add(id)
  for (const r of orders ?? []) if (isRecord(r) && isId(r.listDefinitionId)) named.add(r.listDefinitionId)
  let listTop = maxId(lists)
  for (const id of named) if (id > listTop) listTop = id
  const newListId = idPool(listTop, named)
  let lastOrder = -1
  for (const r of lists) if (isRecord(r) && isOrder(r.sortOrder) && r.sortOrder > lastOrder) lastOrder = r.sortOrder
  let nextOrder = Math.floor(lastOrder) + 1

  // The new layout's id: after every layout id the dataset holds or names.
  const layoutTaken = new Set<number>(layoutIds)
  let layoutTop = maxId(layouts)
  for (const row of listById.values()) {
    const layoutId = ownerLayoutOf(row)
    if (layoutId !== undefined) {
      layoutTaken.add(layoutId)
      if (layoutId > layoutTop) layoutTop = layoutId
    }
  }
  const active = Number(settingValue(data.settings, 'activeLayoutId'))
  if (isId(active)) {
    layoutTaken.add(active)
    if (active > layoutTop) layoutTop = active
  }
  const upgradeLayoutId = unused.length > 0 ? idAfter(layoutTop, layoutTaken) : undefined

  const unusedRows = new Set<unknown>(unused.map((u) => u.row))
  const outLists: DataRow[] = lists.map((row) => {
    if (!isRecord(row) || !isId(row.id) || listById.get(row.id) !== row) return row
    const layoutId = ownerChanges.get(row.id) ?? (unusedRows.has(row) ? upgradeLayoutId : undefined)
    return layoutId === undefined ? row : { ...row, owner: { layoutId } }
  })
  const repoints = new Map<number, Map<number, number>>()
  const copiedRanks: Array<{ from: number; to: number }> = []
  for (const { layoutId, from } of copiesFor) {
    const source = listById.get(from)
    if (!source) continue
    const id = newListId()
    outLists.push({ ...source, id, sortOrder: nextOrder++, owner: { layoutId } })
    const map = repoints.get(layoutId) ?? new Map<number, number>()
    map.set(from, id)
    repoints.set(layoutId, map)
    copiedRanks.push({ from, to: id })
  }

  let outLayouts: DataRow[] = repoints.size === 0 ? layouts : layouts.map((row) => {
    if (!isRecord(row) || !isId(row.id)) return row
    const map = repoints.get(row.id)
    return map ? repointLayout(row, map) : row
  })
  if (upgradeLayoutId !== undefined) {
    let lastLayoutOrder = -1
    for (const r of layouts) if (isRecord(r) && isOrder(r.sortOrder) && r.sortOrder > lastLayoutOrder) lastLayoutOrder = r.sortOrder
    const byListOrder = [...unused].sort((a, b) =>
      (isOrder(a.row.sortOrder) ? a.row.sortOrder : Infinity) - (isOrder(b.row.sortOrder) ? b.row.sortOrder : Infinity) || a.id - b.id)
    const tabs = byListOrder.map(({ id }, i) => ({ id: `tab-${i + 1}`, kind: 'lens', config: { listDefinitionId: id } }))
    const at = newLayoutDate(layouts)
    outLayouts = [...outLayouts, {
      id: upgradeLayoutId,
      name: UPGRADE_LAYOUT_NAME,
      sortOrder: Math.floor(lastLayoutOrder) + 1,
      columns: [{ id: 'col-1', weight: 1, cells: [{ id: 'cell-1', weight: 1, tabs, activeTabId: tabs[0]?.id }] }],
      createdAt: at,
      modifiedAt: new Date(at.getTime()),
    }]
  }

  const out: DataSet = { ...data, listDefinitions: outLists }
  if (outLayouts !== layouts) out.layouts = outLayouts
  if (orders && copiedRanks.length > 0) {
    const rankTaken = new Set<number>()
    for (const r of orders) if (isRecord(r) && isId(r.id)) rankTaken.add(r.id)
    const newRankId = idPool(maxId(orders), rankTaken)
    const added: DataRow[] = []
    for (const { from, to } of copiedRanks) {
      for (const r of orders) if (isRecord(r) && r.listDefinitionId === from) added.push({ ...r, id: newRankId(), listDefinitionId: to })
    }
    if (added.length > 0) out.listOrders = [...orders, ...added]
  }
  return out
}

/** The check-in filter a stored list scope becomes: its list's filter without people, completed off; `undefined` for none. */
function filterOfList(lists: readonly DataRow[] | undefined, listId: number): Obj | undefined {
  const row = lists?.find((r) => isRecord(r) && r.id === listId)
  const predicate = isRecord(row) && isRecord(row.membership) && isRecord(row.membership.predicate) ? row.membership.predicate : undefined
  if (!predicate) return undefined
  const out: Obj = { ...predicate, showCompleted: false, personIds: null }
  if (isRecord(predicate.negate)) {
    const negate: Obj = { ...predicate.negate }
    delete negate.personIds
    if (Object.keys(negate).length > 0) out.negate = negate
    else delete out.negate
  }
  return out
}

/** (b) The dataset with the check-in scope turned into the check-in filter; the input when it has no scope (or no settings). */
function withCheckinFilter(data: DataSet): DataSet {
  const settings = data.settings
  if (!Array.isArray(settings)) return data
  const at = settings.findIndex((r) => isRecord(r) && r.key === SCOPE_KEY)
  if (at < 0) return data
  const scope = settingValue(settings, SCOPE_KEY)
  const rest = settings.filter((r) => !(isRecord(r) && r.key === SCOPE_KEY))
  if (rest.some((r) => isRecord(r) && r.key === FILTER_KEY)) return { ...data, settings: rest }
  let filter: Obj | undefined
  if (scope === 'hot') filter = { ...emptyFilter(), markers: 'hot' }
  else if (scope === 'due-soon') {
    filter = { ...emptyFilter(), dates: { deadline: { match: 'range', start: null, end: { kind: 'offset', days: DUE_SOON_DAYS } } } }
  } else {
    const listId = listIdOfValue(scope)
    if (listId !== undefined) filter = filterOfList(data.listDefinitions, listId)
  }
  return { ...data, settings: filter ? [...rest, { key: FILTER_KEY, value: JSON.stringify(filter) }] : rest }
}

/** v68 — every list in a layout; the check-in filter. */
export function upgradeV68(data: DataSet): DataSet {
  const scopeListId = listIdOfValue(settingValue(data.settings, SCOPE_KEY))
  // The check-in scope reads the lists as they were (a list's filter, before any copy).
  return withListsInLayouts(withCheckinFilter(data), scopeListId)
}
