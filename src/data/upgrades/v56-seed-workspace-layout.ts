import type { DataRow, DataSet } from '../schema-upgrades'

/**
 * v56 — workspace layouts. Seeds one layout, "Default", from what the canvas
 * shows today so nothing is lost, and points the `activeLayoutId` setting at
 * it. Frozen with this transform: the names, kinds, ids and defaults below
 * (later model changes must not alter what the upgrade writes).
 *
 * - Rails → columns, skipping empty ones: left rail → first column; top-rail
 *   then bottom-rail slots → the next column's cells, in order; right rail →
 *   the next column. Slot ids / tab ids are kept; a vertical rail's slot
 *   `flex` becomes the cell weight. Rail sizes, corners and collapsed rails
 *   are canvas chrome and are not carried over.
 * - Every floating widget (list insets, calendars, notes, taskboards, status
 *   widgets, on any canvas) → one single-tab cell in a final column, in
 *   reading order of their canvas position (top to bottom, then left to
 *   right). Collapsed widgets become collapsed cells.
 * - Tab settings: lens → `config.listDefinitionId` + `viewState.runtimeFilterValue`;
 *   calendar → `config.dateTypes` due only (calendars place tasks by due date
 *   today) + `viewState` week view at the old `weekOffset`. The old row /
 *   column `orientation` is dropped (the calendar lays itself out by width).
 *
 * Deterministic (Dexie upgrade == import of the same data, and a browser DB
 * equals its upgraded sync file): fixed ids, and `createdAt` / `modifiedAt`
 * from the first canvas's `createdAt`. Idempotent: does nothing when
 * `layouts` already has rows. A dataset without `settings` (a task archive)
 * is a partial dataset and gets no layout.
 */

/** Name of the seeded layout. */
const LAYOUT_NAME = 'Default'

/** Settings key the transform writes. */
const ACTIVE_LAYOUT_KEY = 'activeLayoutId'

/** Fallback timestamp when no canvas carries a usable `createdAt`. */
const FALLBACK_CREATED_AT = '2026-10-11T00:00:00.000Z'

const OFFSET_MAX = 104
const ID_MAX = 100

const KINDS: ReadonlySet<string> = new Set(['lens', 'calendar', 'notes', 'taskboard', 'status'])

type Obj = Record<string, unknown>

function isRecord(v: unknown): v is Obj {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

interface Tab {
  id: string
  kind: string
  config: Obj
  viewState?: Obj
}

interface Cell {
  id: string
  weight: number
  tabs: Tab[]
  activeTabId?: string
  collapsed?: boolean
}

interface Column {
  id: string
  weight: number
  cells: Cell[]
}

/** Hands out unique ids, keeping a wanted id when it is valid and still free. */
class IdPool {
  private readonly used = new Set<string>()

  take(wanted: unknown, fallback: string): string {
    // A taken id gets a `-2`, `-3`… suffix; a missing / invalid one the fallback.
    const base = typeof wanted === 'string' && wanted.length > 0 && wanted.length <= ID_MAX - 4 ? wanted : fallback
    let id = base
    for (let n = 2; this.used.has(id); n++) id = `${base}-${n}`
    this.used.add(id)
    return id
  }
}

function clampOffset(n: number): number {
  return Math.max(-OFFSET_MAX, Math.min(OFFSET_MAX, Math.trunc(n)))
}

function runtimePicks(v: unknown): number[] | undefined {
  if (!Array.isArray(v)) return undefined
  const ids = v.filter(isNum)
  return ids.length > 0 ? ids : undefined
}

function lensTab(id: string, listDefinitionId: unknown, picks: unknown): Tab {
  const tab: Tab = { id, kind: 'lens', config: isNum(listDefinitionId) ? { listDefinitionId } : {} }
  const runtimeFilterValue = runtimePicks(picks)
  if (runtimeFilterValue) tab.viewState = { runtimeFilterValue }
  return tab
}

function calendarTab(id: string, weekOffset: unknown): Tab {
  return {
    id,
    kind: 'calendar',
    config: { dateTypes: { due: true, followup: false } },
    viewState: { view: 'week', offset: isNum(weekOffset) ? clampOffset(weekOffset) : 0 },
  }
}

function plainTab(id: string, kind: string): Tab {
  return { id, kind, config: {} }
}

/** A rail slot as a cell; `null` when it has no usable tab. */
function slotToCell(slot: unknown, ids: IdPool, weighted: boolean): Cell | null {
  if (!isRecord(slot) || !Array.isArray(slot.tabs)) return null
  const tabs: Tab[] = []
  let activeTabId: string | undefined
  for (const raw of slot.tabs) {
    if (!isRecord(raw) || typeof raw.type !== 'string' || !KINDS.has(raw.type)) continue
    const id = ids.take(raw.id, 'tab')
    if (raw.id === slot.activeTabId && activeTabId === undefined) activeTabId = id
    if (raw.type === 'lens') tabs.push(lensTab(id, raw.listDefinitionId, raw.runtimeFilterValue))
    else if (raw.type === 'calendar') tabs.push(calendarTab(id, slot.weekOffset))
    else tabs.push(plainTab(id, raw.type))
  }
  if (tabs.length === 0) return null
  const weight = weighted && isNum(slot.flex) && slot.flex > 0 ? slot.flex : 1
  const cell: Cell = { id: ids.take(slot.id, 'cell'), weight, tabs }
  if (activeTabId !== undefined) cell.activeTabId = activeTabId
  return cell
}

function railCells(rail: unknown, ids: IdPool, weighted: boolean): Cell[] {
  if (!isRecord(rail) || !Array.isArray(rail.slots)) return []
  const cells: Cell[] = []
  for (const slot of rail.slots) {
    const cell = slotToCell(slot, ids, weighted)
    if (cell) cells.push(cell)
  }
  return cells
}

function parseRails(settings: DataRow[]): Obj | null {
  const row = settings.find((r) => isRecord(r) && r.key === 'canvasRails')
  if (!row || typeof row.value !== 'string') return null
  try {
    const parsed: unknown = JSON.parse(row.value)
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

interface Float {
  table: string
  row: Obj
  /** Position of the table in the float kind order (tie-break). */
  order: number
}

const FLOAT_TABLES = ['listInsets', 'floatingCalendars', 'floatingNotes', 'floatingTaskboards', 'floatingStatus'] as const

function floatToCell(f: Float, ids: IdPool): Cell {
  const ref = `${f.table}-${isNum(f.row.id) ? f.row.id : 'x'}`
  const tabId = ids.take(undefined, `tab-${ref}`)
  let tab: Tab
  let collapsed = false
  switch (f.table) {
    case 'listInsets':
      tab = lensTab(tabId, f.row.listDefinitionId, f.row.runtimeFilterValue)
      collapsed = f.row.isCollapsed === true
      break
    case 'floatingCalendars':
      tab = calendarTab(tabId, f.row.weekOffset)
      break
    case 'floatingNotes':
      tab = plainTab(tabId, 'notes')
      break
    case 'floatingTaskboards':
      tab = plainTab(tabId, 'taskboard')
      collapsed = f.row.collapsed === true
      break
    default:
      tab = plainTab(tabId, 'status')
      collapsed = f.row.collapsed === true
  }
  const cell: Cell = { id: ids.take(undefined, `cell-${ref}`), weight: 1, tabs: [tab], activeTabId: tab.id }
  if (collapsed) cell.collapsed = true
  return cell
}

function floatCells(data: DataSet, ids: IdPool): Cell[] {
  const floats: Float[] = []
  FLOAT_TABLES.forEach((table, order) => {
    for (const row of data[table] ?? []) if (isRecord(row)) floats.push({ table, row, order })
  })
  const num = (v: unknown) => (isNum(v) ? v : 0)
  floats.sort((a, b) =>
    num(a.row.y) - num(b.row.y)
    || num(a.row.x) - num(b.row.x)
    || a.order - b.order
    || num(a.row.id) - num(b.row.id))
  return floats.map((f) => floatToCell(f, ids))
}

function seedTimestamp(canvases: DataRow[] | undefined): Date {
  let first: Obj | undefined
  for (const c of canvases ?? []) {
    if (!isRecord(c)) continue
    if (!first || num0(c.id) < num0(first.id)) first = c
  }
  const raw = first?.createdAt
  const d = raw instanceof Date ? new Date(raw.getTime()) : typeof raw === 'string' ? new Date(raw) : null
  return d && !Number.isNaN(d.getTime()) ? d : new Date(FALLBACK_CREATED_AT)
}

function num0(v: unknown): number {
  return isNum(v) ? v : Number.POSITIVE_INFINITY
}

/** The Default layout's columns built from the dataset's rails and floats. */
export function seedLayoutColumns(data: DataSet): Column[] {
  const ids = new IdPool()
  const rails = parseRails(data.settings ?? [])
  // Rail-derived ids are taken first so they keep their names.
  const groups: Cell[][] = rails
    ? [
        railCells(rails.left, ids, true),
        [...railCells(rails.top, ids, false), ...railCells(rails.bottom, ids, false)],
        railCells(rails.right, ids, true),
      ]
    : []
  groups.push(floatCells(data, ids))
  const columns: Column[] = []
  for (const cells of groups) {
    if (cells.length === 0) continue
    columns.push({ id: ids.take(undefined, `col-${columns.length + 1}`), weight: 1, cells })
  }
  return columns
}

export function upgradeV56(data: DataSet): DataSet {
  const settings = data.settings
  if (!Array.isArray(settings)) return data
  if (Array.isArray(data.layouts) && data.layouts.length > 0) return data

  const at = seedTimestamp(data.canvases)
  const layout: DataRow = {
    id: 1,
    name: LAYOUT_NAME,
    columns: seedLayoutColumns(data),
    createdAt: at,
    modifiedAt: new Date(at.getTime()),
  }
  const nextSettings = settings.filter((r) => !(isRecord(r) && r.key === ACTIVE_LAYOUT_KEY))
  nextSettings.push({ key: ACTIVE_LAYOUT_KEY, value: '1' })
  return { ...data, layouts: [layout], settings: nextSettings }
}
