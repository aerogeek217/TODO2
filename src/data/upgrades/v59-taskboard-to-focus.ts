import type { DataRow, DataSet } from '../schema-upgrades'

/**
 * v59 — the taskboard becomes Focus.
 *
 * - Every task on a taskboard gets `focus: true`. All `taskboards` rows are
 *   read (a startup race could leave more than one "singleton"): rows in id
 *   order, each row's entries by `sortOrder`, deduped by task (first seen
 *   wins). Entries whose task no longer exists are skipped.
 * - A full dataset (one with `settings`) gets a "Focus" list: predicate
 *   `focus = true`, manual sort, no grouping. It is created even when no task
 *   was on a taskboard, so the list is there to find. Its manual order
 *   (`listOrders`) is seeded from the taskboard order: ranks 1, 2, 3, …
 * - Taskboard widgets become widgets of the Focus list: workspace layout tabs
 *   (`kind: 'taskboard'` → a list tab), canvas rail tabs (`type: 'taskboard'`
 *   → a lens tab), and floating taskboards (→ list insets at the same place
 *   and size).
 * - The `taskboards` and `floatingTaskboards` tables are dropped.
 *
 * Frozen with this transform: the list's name and predicate below. Ids are
 * assigned after the current maximum of each table (deterministic, so a
 * browser DB and its upgraded sync file agree).
 *
 * Idempotent: data without either taskboard table is already in the v59
 * shape and is returned unchanged. A partial dataset (a task archive, no
 * `settings`) only gets its `focus` flags.
 */

/** Name of the list the transform creates. */
export const V59_FOCUS_LIST_NAME = 'Focus'

/** Tables v59 drops. */
export const V59_DROPPED_TABLES = ['taskboards', 'floatingTaskboards'] as const

type Obj = Record<string, unknown>

function isRecord(v: unknown): v is Obj {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

function maxId(rows: readonly unknown[] | undefined): number {
  let max = 0
  for (const row of rows ?? []) if (isRecord(row) && isNum(row.id) && row.id > max) max = row.id
  return max
}

/** The Focus list's predicate (a complete `TodoPredicate`, frozen). */
function focusPredicate(): Obj {
  return {
    showCompleted: false,
    personIds: null,
    projectIds: null,
    statusIds: null,
    searchText: '',
    dateField: 'deadline',
    dateRangeStart: null,
    dateRangeEnd: null,
    dateRangeIncludeNoDate: false,
    hasDeadline: null,
    hasFollowup: null,
    focus: true,
    tags: null,
  }
}

/** Task ids on any taskboard, in board order (see the module comment). */
function boardOrder(boards: readonly unknown[] | undefined, existing: ReadonlySet<number>): number[] {
  const rows = (boards ?? []).filter(isRecord)
  const sortedRows = rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const ia = isNum(a.row.id) ? a.row.id : Infinity
      const ib = isNum(b.row.id) ? b.row.id : Infinity
      return ia - ib || a.index - b.index
    })
  const seen = new Set<number>()
  const order: number[] = []
  for (const { row } of sortedRows) {
    if (!Array.isArray(row.entries)) continue
    const entries = row.entries
      .filter((e): e is Obj => isRecord(e) && isNum(e.todoId))
      .map((e, index) => ({ todoId: e.todoId as number, sortOrder: isNum(e.sortOrder) ? e.sortOrder : Infinity, index }))
      .sort((a, b) => a.sortOrder - b.sortOrder || a.index - b.index)
    for (const e of entries) {
      if (seen.has(e.todoId) || !existing.has(e.todoId)) continue
      seen.add(e.todoId)
      order.push(e.todoId)
    }
  }
  return order
}

function markFocus(todos: DataRow[] | undefined, ids: ReadonlySet<number>): DataRow[] | undefined {
  if (!Array.isArray(todos) || ids.size === 0) return todos
  let changed = false
  const out = todos.map((row) => {
    if (!isRecord(row) || !isNum(row.id) || !ids.has(row.id) || row.focus === true) return row
    changed = true
    return { ...row, focus: true }
  })
  return changed ? out : todos
}

/** Maps `fn` over `items`; the same array when no item changed. */
function mapSame<T>(items: readonly T[], fn: (item: T) => T): readonly T[] {
  let changed = false
  const out = items.map((item) => {
    const next = fn(item)
    if (next !== item) changed = true
    return next
  })
  return changed ? out : items
}

function upgradeLayout(row: DataRow, focusListId: number): DataRow {
  if (!isRecord(row) || !Array.isArray(row.columns)) return row
  const toList = (tab: unknown): unknown =>
    isRecord(tab) && tab.kind === 'taskboard'
      ? { id: tab.id, kind: 'lens', config: { listDefinitionId: focusListId } }
      : tab
  const columns = mapSame<unknown>(row.columns, (col) => {
    if (!isRecord(col) || !Array.isArray(col.cells)) return col
    const cells = mapSame<unknown>(col.cells, (cell) => {
      if (!isRecord(cell) || !Array.isArray(cell.tabs)) return cell
      const tabs = mapSame<unknown>(cell.tabs, toList)
      return tabs === cell.tabs ? cell : { ...cell, tabs }
    })
    return cells === col.cells ? col : { ...col, cells }
  })
  return columns === row.columns ? row : { ...row, columns }
}

const RAIL_SIDES = ['left', 'right', 'top', 'bottom'] as const

/**
 * A serialized `canvasRails` value with taskboard tabs turned into lens tabs
 * of the Focus list (same tab id, so a slot's `activeTabId` still points at
 * it). The input string when nothing changed or it can't be parsed.
 */
function upgradeRails(value: string, focusListId: number): string {
  let parsed: unknown
  try { parsed = JSON.parse(value) } catch { return value }
  if (!isRecord(parsed)) return value
  const toLens = (tab: unknown): unknown =>
    isRecord(tab) && tab.type === 'taskboard' ? { id: tab.id, type: 'lens', listDefinitionId: focusListId } : tab
  let changed = false
  const next: Obj = { ...parsed }
  for (const side of RAIL_SIDES) {
    const rail = parsed[side]
    if (!isRecord(rail) || !Array.isArray(rail.slots)) continue
    const slots = mapSame<unknown>(rail.slots, (slot) => {
      if (!isRecord(slot) || !Array.isArray(slot.tabs)) return slot
      const tabs = mapSame<unknown>(slot.tabs, toLens)
      return tabs === slot.tabs ? slot : { ...slot, tabs }
    })
    if (slots === rail.slots) continue
    changed = true
    next[side] = { ...rail, slots }
  }
  return changed ? JSON.stringify(next) : value
}

function upgradeSettings(rows: DataRow[] | undefined, focusListId: number): DataRow[] | undefined {
  if (!Array.isArray(rows)) return rows
  return mapSame(rows, (row) => {
    if (!isRecord(row) || row.key !== 'canvasRails' || typeof row.value !== 'string') return row
    const value = upgradeRails(row.value, focusListId)
    return value === row.value ? row : { ...row, value }
  }) as DataRow[]
}

/** Floating taskboards → list insets of the Focus list. */
function floatsToInsets(floats: readonly unknown[] | undefined, insets: DataRow[] | undefined, focusListId: number): DataRow[] | undefined {
  const rows = (floats ?? []).filter(isRecord).filter((f) =>
    isNum(f.canvasId) && isNum(f.x) && isNum(f.y) && isNum(f.width) && isNum(f.height))
  if (rows.length === 0) return insets
  let nextId = maxId(insets) + 1
  const added = rows.map((f): DataRow => ({
    id: nextId++,
    listDefinitionId: focusListId,
    canvasId: f.canvasId,
    x: f.x,
    y: f.y,
    width: f.width,
    height: f.height,
    isCollapsed: f.collapsed === true,
  }))
  return [...(insets ?? []), ...added]
}

/** v59 — taskboard entries → `focus` + a manually ordered "Focus" list; drop the taskboard tables. */
export function upgradeV59(data: DataSet): DataSet {
  if (!V59_DROPPED_TABLES.some((t) => t in data)) return data

  const out: DataSet = { ...data }
  for (const table of V59_DROPPED_TABLES) delete out[table]

  const existing = new Set<number>()
  for (const row of data.todos ?? []) if (isRecord(row) && isNum(row.id)) existing.add(row.id)
  const order = boardOrder(data.taskboards, existing)

  const todos = markFocus(data.todos, new Set(order))
  if (todos !== data.todos && todos !== undefined) out.todos = todos

  if (!('settings' in data)) return out

  const defs = Array.isArray(data.listDefinitions) ? data.listDefinitions : []
  const focusListId = maxId(defs) + 1
  let maxSort = -1
  for (const d of defs) if (isRecord(d) && isNum(d.sortOrder) && d.sortOrder > maxSort) maxSort = d.sortOrder
  out.listDefinitions = [...defs, {
    id: focusListId,
    name: V59_FOCUS_LIST_NAME,
    sortOrder: maxSort + 1,
    pinnedToDashboard: true,
    membership: { kind: 'custom', predicate: focusPredicate() },
    sort: 'manual',
    grouping: 'none',
  }]

  if (order.length > 0) {
    const orders = Array.isArray(data.listOrders) ? data.listOrders : []
    let nextId = maxId(orders) + 1
    out.listOrders = [...orders, ...order.map((todoId, i): DataRow => ({ id: nextId++, listDefinitionId: focusListId, todoId, rank: i + 1 }))]
  }

  if (Array.isArray(data.layouts)) {
    const layouts = mapSame(data.layouts, (row) => upgradeLayout(row, focusListId)) as DataRow[]
    if (layouts !== data.layouts) out.layouts = layouts
  }

  const settings = upgradeSettings(data.settings, focusListId)
  if (settings !== undefined && settings !== data.settings) out.settings = settings

  const insets = floatsToInsets(data.floatingTaskboards, data.listInsets, focusListId)
  if (insets !== undefined && insets !== data.listInsets) out.listInsets = insets

  return out
}
