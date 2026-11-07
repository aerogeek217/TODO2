import {
  BAND_DEFAULT_HEIGHT,
  BAND_EDGES,
  clampCalendarOffset,
  EISENHOWER_QUADRANTS,
  isEisenhowerQuadrant,
  readListZoom,
  isWidgetKind,
  pickDetailsWidth,
  type CalendarTabViewState,
  type LayoutBand,
  type LayoutBody,
  type TaskRowsViewState,
  type LayoutCell,
  type LayoutColumn,
  type LayoutRow,
  type LayoutTab,
  type LensTabConfig,
  type ListTabViewState,
  type WidgetKind,
  DEFAULT_CALENDAR_DATE_TYPES,
  DEFAULT_WEIGHT,
  DEFAULT_NEGLECT_UNTOUCHED_DAYS,
  isNeglectUntouchedDays,
  type NeglectColourBy,
  type NeglectTabConfig,
} from '../models/workspace-layout'
import { normalizeDashboardConfig } from '../models/dashboard-config'
import { isRecord } from '../utils/is-record'

/**
 * Shape check + whitelist reconstruction for the nested part of a `layouts`
 * row: `WorkspaceLayout.columns` (columns → rows → cells → tabs) and the
 * optional `top` / `bottom` bands (each a row of cells).
 * Used by import validation (`checkLayout` / `pickLayout` in
 * `import-validation.ts`), so a layout from a file only reaches Dexie with
 * known kinds, known keys and unique ids.
 */


/** A layout row's body as stored (unchecked). */
export interface RawLayoutBody {
  columns?: unknown
  top?: unknown
  bottom?: unknown
}

/**
 * Longest column / row / cell / band / tab id. The app's ids are short (`w-` + 8
 * characters; the v56 seed's are the old rail ids, deduplicated).
 */
const MAX_ID_LEN = 100

/**
 * The most columns, rows, cells and tabs a layout keeps (each counted over the
 * whole layout, bands included), and list tiles a dashboard tab keeps. Far
 * past anything one builds by hand, so nothing the app makes is cut; a file
 * holding more (one a hand edit or a hostile file made, which would leave
 * the app unable to show the workspace on every launch) still loads — the
 * parts past the limit are dropped by `pickLayoutBody` and reported, never a
 * failed import (`checkLayoutBody` doesn't count them).
 */
export const LAYOUT_PART_LIMIT = 1000

type Obj = Record<string, unknown>

/** A layout part's id (a column, band, cell or tab) as stored. */
export function isId(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= MAX_ID_LEN
}

function isWeight(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0
}

function isFiniteNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

/** A Neglect map's `colourBy` as stored: a known kind; tags with a list of ids. */
function isNeglectColourBy(v: unknown): boolean {
  if (!isRecord(v)) return false
  if (v.kind === 'people' || v.kind === 'none') return true
  return v.kind === 'tags' && Array.isArray(v.tagIds) && v.tagIds.every(isFiniteNum)
}

/**
 * A Neglect map tab's config with only the model's keys: a bad `colourBy`
 * becomes `none` (a tag list keeps its ids that are numbers), a bad
 * threshold becomes the default; a repeated tag is kept once. `fixed` says
 * whether anything but a repeat or a stray key was dropped or reset.
 */
export function pickNeglectConfig(config: Obj): { config: NeglectTabConfig; fixed: boolean } {
  let fixed = !isNeglectColourBy(config.colourBy)
  let colourBy: NeglectColourBy = { kind: 'none' }
  const raw = config.colourBy
  if (isRecord(raw)) {
    if (raw.kind === 'tags' && Array.isArray(raw.tagIds)) {
      colourBy = { kind: 'tags', tagIds: [...new Set((raw.tagIds as unknown[]).filter(isFiniteNum))] }
    } else if (raw.kind === 'people') {
      colourBy = { kind: 'people' }
    }
  }
  let untouchedDays = DEFAULT_NEGLECT_UNTOUCHED_DAYS
  if (isNeglectUntouchedDays(config.untouchedDays)) untouchedDays = config.untouchedDays
  else fixed = true
  return { config: { colourBy, untouchedDays }, fixed }
}

/** A tab's config / view state for its kind (a case per kind: a new kind doesn't compile without one). */
function checkTabSettings(tab: Obj, kind: WidgetKind, path: string): true | string {
  const config = tab.config
  if (!isRecord(config)) return `${path}.config`
  const view = tab.viewState
  if (view !== undefined && !isRecord(view)) return `${path}.viewState`
  // Tabs showing task rows: the details width, a number in range.
  if ((kind === 'lens' || kind === 'eisenhower' || kind === 'dashboard')
    && view?.detailsWidth !== undefined && pickDetailsWidth(view.detailsWidth) === undefined) {
    return `${path}.viewState.detailsWidth`
  }
  switch (kind) {
    case 'lens':
      if (config.listDefinitionId !== undefined && !isFiniteNum(config.listDefinitionId)) return `${path}.config.listDefinitionId`
      if (view?.zoom !== undefined && readListZoom(view.zoom) === undefined) return `${path}.viewState.zoom`
      return true
    case 'calendar': {
      const types = config.dateTypes
      if (!isRecord(types) || typeof types.due !== 'boolean' || typeof types.followup !== 'boolean') {
        return `${path}.config.dateTypes`
      }
      if (view?.view !== undefined && view.view !== 'week' && view.view !== 'month') return `${path}.viewState.view`
      if (view?.offset !== undefined && !isFiniteNum(view.offset)) return `${path}.viewState.offset`
      if (view?.titles !== undefined && typeof view.titles !== 'boolean') return `${path}.viewState.titles`
      return true
    }
    case 'eisenhower': {
      // No config of its own (its panes and source are settings): any key is dropped by the pick.
      const collapsed = view?.collapsed
      if (collapsed !== undefined && (!Array.isArray(collapsed) || !collapsed.every(isEisenhowerQuadrant))) {
        return `${path}.viewState.collapsed`
      }
      return true
    }
    case 'dashboard':
      // Unknown ids / options inside are dropped by the pick, not rejected.
      for (const key of ['tiles', 'listTiles', 'sections'] as const) {
        if (config[key] !== undefined && !Array.isArray(config[key])) return `${path}.config.${key}`
      }
      return true
    case 'neglect':
      if (!isNeglectColourBy(config.colourBy)) return `${path}.config.colourBy`
      if (!isNeglectUntouchedDays(config.untouchedDays)) return `${path}.config.untouchedDays`
      return true
    case 'notes':
      return true
  }
}

/** A tracker of the ids seen so far: `fresh(id)` is false for an id seen before. */
function idTracker(): (id: string) => boolean {
  const seen = new Set<string>()
  return (id) => {
    if (seen.has(id)) return false
    seen.add(id)
    return true
  }
}

/** `true` when every tab of a strip is valid, else the path of the first bad field. */
function checkTabs(tabs: readonly unknown[], path: string, fresh: (id: string) => boolean): true | string {
  for (let t = 0; t < tabs.length; t++) {
    const tab: unknown = tabs[t]
    const tp = `${path}.tabs[${t}]`
    if (!isRecord(tab)) return tp
    if (!isId(tab.id) || !fresh(tab.id)) return `${tp}.id`
    if (!isWidgetKind(tab.kind)) return `${tp}.kind`
    const settings = checkTabSettings(tab, tab.kind, tp)
    if (settings !== true) return settings
  }
  return true
}

/** `true` when a cell is valid, else the path of its first bad field. */
function checkCell(cell: unknown, path: string, fresh: (id: string) => boolean): true | string {
  if (!isRecord(cell)) return path
  if (!isId(cell.id) || !fresh(cell.id)) return `${path}.id`
  if (!isWeight(cell.weight)) return `${path}.weight`
  if (cell.activeTabId !== undefined && !isId(cell.activeTabId)) return `${path}.activeTabId`
  if (cell.stripShown !== undefined && typeof cell.stripShown !== 'boolean') return `${path}.stripShown`
  if (!Array.isArray(cell.tabs)) return `${path}.tabs`
  return checkTabs(cell.tabs, path, fresh)
}

/** `true` when every cell of a row (or band) is valid and there is at least one, else the path of the first bad field. */
function checkCells(cells: unknown, path: string, fresh: (id: string) => boolean): true | string {
  if (!Array.isArray(cells) || cells.length === 0) return `${path}.cells`
  for (let k = 0; k < cells.length; k++) {
    const res = checkCell(cells[k], `${path}.cells[${k}]`, fresh)
    if (res !== true) return res
  }
  return true
}

function checkColumns(columns: unknown, fresh: (id: string) => boolean): true | string {
  if (!Array.isArray(columns)) return 'columns'
  for (let c = 0; c < columns.length; c++) {
    const col: unknown = columns[c]
    const cp = `columns[${c}]`
    if (!isRecord(col)) return cp
    if (!isId(col.id) || !fresh(col.id)) return `${cp}.id`
    if (!isWeight(col.weight)) return `${cp}.weight`
    if (!Array.isArray(col.rows) || col.rows.length === 0) return `${cp}.rows`
    for (let r = 0; r < col.rows.length; r++) {
      const row: unknown = col.rows[r]
      const rp = `${cp}.rows[${r}]`
      if (!isRecord(row)) return rp
      if (!isId(row.id) || !fresh(row.id)) return `${rp}.id`
      if (!isWeight(row.weight)) return `${rp}.weight`
      if (row.collapsed !== undefined && typeof row.collapsed !== 'boolean') return `${rp}.collapsed`
      const cells = checkCells(row.cells, rp, fresh)
      if (cells !== true) return cells
    }
  }
  return true
}

/** A band (absent is fine): an id, a positive height and at least one cell. */
function checkBand(band: unknown, path: string, fresh: (id: string) => boolean): true | string {
  if (band === undefined) return true
  if (!isRecord(band)) return path
  if (!isId(band.id) || !fresh(band.id)) return `${path}.id`
  if (!isWeight(band.height)) return `${path}.height`
  if (band.collapsed !== undefined && typeof band.collapsed !== 'boolean') return `${path}.collapsed`
  return checkCells(band.cells, path, fresh)
}

/**
 * `true` when a layout row's columns and bands are valid, else the path of
 * the first bad field (`columns[0].weight`, `top.cells`, …). A column needs
 * at least one row, a row and a band at least one cell. A band is optional;
 * one that is there needs an id and a positive height. Ids are unique across
 * the columns, rows, cells, tabs and both bands.
 */
export function checkLayoutBody(body: RawLayoutBody): true | string {
  const fresh = idTracker()
  const columns = checkColumns(body.columns, fresh)
  if (columns !== true) return columns
  for (const edge of BAND_EDGES) {
    const band = checkBand(body[edge], edge, fresh)
    if (band !== true) return band
  }
  return true
}

/** A part `pickLayoutBody` dropped or reset, counted. */
type LayoutFix = 'columns' | 'column' | 'row' | 'cell' | 'band' | 'tab' | 'size' | 'settings' | 'eisenhower'
  | 'columnLimit' | 'rowLimit' | 'cellLimit' | 'tabLimit' | 'listTileLimit'

const FIX_WORDS: Record<LayoutFix, readonly [one: string, many: string]> = {
  columns: ['columns reset', 'columns reset'],
  column: ['column dropped', 'columns dropped'],
  row: ['row dropped', 'rows dropped'],
  cell: ['cell dropped', 'cells dropped'],
  band: ['band dropped', 'bands dropped'],
  tab: ['tab dropped', 'tabs dropped'],
  size: ['size reset', 'sizes reset'],
  settings: ['tab or cell settings reset', 'tab or cell settings reset'],
  eisenhower: ['Eisenhower tab setting dropped', 'Eisenhower tab settings dropped'],
  columnLimit: ['column past the limit of 1,000 dropped', 'columns past the limit of 1,000 dropped'],
  rowLimit: ['row past the limit of 1,000 dropped', 'rows past the limit of 1,000 dropped'],
  cellLimit: ['cell past the limit of 1,000 dropped', 'cells past the limit of 1,000 dropped'],
  tabLimit: ['tab past the limit of 1,000 dropped', 'tabs past the limit of 1,000 dropped'],
  listTileLimit: ['list tile past the limit of 1,000 dropped', 'list tiles past the limit of 1,000 dropped'],
}

export interface PickedLayoutBody extends LayoutBody {
  /**
   * The parts `checkLayoutBody` rejects that were dropped or reset, and the
   * parts past `LAYOUT_PART_LIMIT`, in words (`2 tabs dropped`, `band
   * dropped`, …); otherwise empty for a body that passes it.
   */
  fixes: string[]
}

/**
 * Rebuilds a layout body (columns + bands) with only the model's keys. For a
 * body that passes `checkLayoutBody` (all import ever picks) nothing is
 * dropped but a stale `activeTabId` (= first tab), unknown dashboard ids /
 * options, duplicate collapsed quadrants, an out-of-range calendar offset
 * (clamped), and any key of an Eisenhower tab's config (it has none —
 * reported in `fixes`); a details width is rounded.
 *
 * Past `LAYOUT_PART_LIMIT` columns, rows, cells or tabs in the layout (or list
 * tiles in a dashboard tab), the rest are dropped and reported in `fixes`.
 *
 * Anything else becomes a valid body, its bad parts reported in `fixes`, so
 * the audit can repair a stored layout instead of deleting it: a column /
 * row / cell / band / tab that isn't an object, has a bad or repeated id
 * (ids are unique across every level), or (tab) an unknown kind is dropped,
 * as is a column left without rows, and a row or a band left without cells; a
 * bad size becomes 1 (a band's height `BAND_DEFAULT_HEIGHT`); bad tab
 * settings fall back to the kind's defaults; a bad `activeTabId` /
 * `collapsed` / `stripShown` is dropped.
 */
export function pickLayoutBody(body: RawLayoutBody): PickedLayoutBody {
  const raw = body.columns
  const counts = new Map<LayoutFix, number>()
  const fix = (what: LayoutFix) => { counts.set(what, (counts.get(what) ?? 0) + 1) }
  const seen = new Set<string>()
  const fresh = (id: unknown): id is string => {
    if (!isId(id) || seen.has(id)) return false
    seen.add(id)
    return true
  }
  // Parts kept so far, over the whole layout (`LAYOUT_PART_LIMIT`).
  let columnsKept = 0
  let rowsKept = 0
  let cellsKept = 0
  let tabsKept = 0
  const weightOf = (v: unknown, fallback = DEFAULT_WEIGHT): number => {
    if (isWeight(v)) return v
    fix('size')
    return fallback
  }

  const pickTab = (tab: unknown): LayoutTab | null => {
    if (!isRecord(tab) || !fresh(tab.id) || !isWidgetKind(tab.kind)) {
      fix('tab')
      return null
    }
    const id = tab.id
    let config: Obj = {}
    if (isRecord(tab.config)) config = tab.config
    else fix('settings')
    let view: Obj | undefined
    if (isRecord(tab.viewState)) view = tab.viewState
    else if (tab.viewState !== undefined) fix('settings')
    /** The task rows' view state (`detailsWidth`), or none; a bad width is dropped. */
    const rowsView = (): TaskRowsViewState | undefined => {
      const width = pickDetailsWidth(view?.detailsWidth)
      if (width === undefined && view?.detailsWidth !== undefined) fix('settings')
      return width === undefined ? undefined : { detailsWidth: width }
    }
    switch (tab.kind) {
      case 'lens': {
        const lensConfig: LensTabConfig = {}
        if (isFiniteNum(config.listDefinitionId)) lensConfig.listDefinitionId = config.listDefinitionId
        else if (config.listDefinitionId !== undefined) fix('settings')
        // The zoom: one of the levels (the removed `strips` read as `lines`, view state, no
        // repair), else dropped (the tab opens at the Settings default).
        const lensView: ListTabViewState = { ...rowsView() }
        const zoom = readListZoom(view?.zoom)
        if (zoom) lensView.zoom = zoom
        else if (view?.zoom !== undefined) fix('settings')
        return Object.keys(lensView).length > 0
          ? { id, kind: 'lens', config: lensConfig, viewState: lensView }
          : { id, kind: 'lens', config: lensConfig }
      }
      case 'calendar': {
        const types = config.dateTypes
        const typesOk = isRecord(types) && typeof types.due === 'boolean' && typeof types.followup === 'boolean'
        if (!typesOk) fix('settings')
        const dateTypes = typesOk
          ? { due: types.due === true, followup: types.followup === true }
          : { ...DEFAULT_CALENDAR_DATE_TYPES }
        const calendar: LayoutTab = { id, kind: 'calendar', config: { dateTypes } }
        if (view) {
          const viewState: CalendarTabViewState = {}
          if (view.view === 'week' || view.view === 'month') viewState.view = view.view
          else if (view.view !== undefined) fix('settings')
          if (isFiniteNum(view.offset)) viewState.offset = clampCalendarOffset(view.offset)
          else if (view.offset !== undefined) fix('settings')
          if (typeof view.titles === 'boolean') viewState.titles = view.titles
          else if (view.titles !== undefined) fix('settings')
          if (Object.keys(viewState).length > 0) calendar.viewState = viewState
        }
        return calendar
      }
      case 'eisenhower': {
        const raw = view?.collapsed
        if (raw !== undefined && (!Array.isArray(raw) || !raw.every(isEisenhowerQuadrant))) fix('settings')
        const collapsed = Array.isArray(raw) ? new Set<unknown>(raw) : null
        // Its panes and source are app-wide settings: a key here (none in v66
        // data) is dropped.
        for (let i = 0; i < Object.keys(config).length; i++) fix('eisenhower')
        const eisenhower: LayoutTab = { id, kind: 'eisenhower', config: {} }
        // Known quadrants, once each, in display order.
        const quadrants = collapsed ? EISENHOWER_QUADRANTS.filter((q) => collapsed.has(q)) : []
        const eisenhowerView = { ...rowsView(), ...(quadrants.length > 0 ? { collapsed: quadrants } : {}) }
        if (Object.keys(eisenhowerView).length > 0) eisenhower.viewState = eisenhowerView
        return eisenhower
      }
      case 'dashboard': {
        // Unknown ids / options inside are dropped, missing parts defaulted.
        for (const key of ['tiles', 'listTiles', 'sections'] as const) {
          if (config[key] !== undefined && !Array.isArray(config[key])) fix('settings')
        }
        const dashboardView = rowsView()
        const dashboardConfig = normalizeDashboardConfig(config)
        const extraTiles = dashboardConfig.listTiles.length - LAYOUT_PART_LIMIT
        for (let i = 0; i < extraTiles; i++) fix('listTileLimit')
        if (extraTiles > 0) dashboardConfig.listTiles = dashboardConfig.listTiles.slice(0, LAYOUT_PART_LIMIT)
        const dashboard: LayoutTab = { id, kind: 'dashboard', config: dashboardConfig }
        if (dashboardView) dashboard.viewState = dashboardView
        return dashboard
      }
      case 'neglect': {
        // No view state of its own: any is dropped.
        const neglect = pickNeglectConfig(config)
        if (neglect.fixed) fix('settings')
        return { id, kind: 'neglect', config: neglect.config }
      }
      case 'notes':
        return { id, kind: 'notes', config: {} }
    }
  }

  const pickTabs = (raw: unknown[]): LayoutTab[] => {
    const tabs: LayoutTab[] = []
    for (const tab of raw) {
      if (tabsKept >= LAYOUT_PART_LIMIT) {
        fix('tabLimit')
        continue
      }
      const picked = pickTab(tab)
      if (!picked) continue
      tabs.push(picked)
      tabsKept++
    }
    return tabs
  }
  /** A cell's view state and config: a known `activeTabId`, a boolean `stripShown`. */
  const pickCellView = (raw: Obj, tabs: readonly LayoutTab[]): Pick<LayoutCell, 'activeTabId' | 'stripShown'> => {
    const out: Pick<LayoutCell, 'activeTabId' | 'stripShown'> = {}
    if (typeof raw.activeTabId === 'string' && tabs.some((t) => t.id === raw.activeTabId)) out.activeTabId = raw.activeTabId
    else if (raw.activeTabId !== undefined && !isId(raw.activeTabId)) fix('settings')
    if (typeof raw.stripShown === 'boolean') out.stripShown = raw.stripShown
    else if (raw.stripShown !== undefined) fix('settings')
    return out
  }
  /** A row's or band's `collapsed`: kept only when `true`. */
  const pickCollapsed = (raw: Obj): { collapsed?: true } => {
    if (raw.collapsed === true) return { collapsed: true }
    if (raw.collapsed !== undefined && typeof raw.collapsed !== 'boolean') fix('settings')
    return {}
  }

  const pickCell = (cell: unknown): LayoutCell | null => {
    if (!isRecord(cell) || !fresh(cell.id) || !Array.isArray(cell.tabs)) {
      fix('cell')
      return null
    }
    const id = cell.id
    const weight = weightOf(cell.weight)
    const tabs = pickTabs(cell.tabs as unknown[])
    return { id, weight, tabs, ...pickCellView(cell, tabs) }
  }

  /** The cells of a row or band that are kept (`LAYOUT_PART_LIMIT` over the layout). */
  const pickCells = (raw: unknown[]): LayoutCell[] => {
    const cells: LayoutCell[] = []
    for (const cell of raw) {
      if (cellsKept >= LAYOUT_PART_LIMIT) {
        fix('cellLimit')
        continue
      }
      const picked = pickCell(cell)
      if (!picked) continue
      cells.push(picked)
      cellsKept++
    }
    return cells
  }

  const pickRow = (row: unknown): LayoutRow | null => {
    if (!isRecord(row) || !fresh(row.id) || !Array.isArray(row.cells)) {
      fix('row')
      return null
    }
    const id = row.id
    const weight = weightOf(row.weight)
    const cells = pickCells(row.cells as unknown[])
    if (cells.length === 0) {
      // Left without cells: by the cell limit, or by its own bad cells.
      fix(cellsKept >= LAYOUT_PART_LIMIT ? 'rowLimit' : 'row')
      return null
    }
    return { id, weight, ...pickCollapsed(row), cells }
  }

  const pickBand = (band: unknown): LayoutBand | null => {
    if (!isRecord(band) || !fresh(band.id) || !Array.isArray(band.cells)) {
      fix('band')
      return null
    }
    const id = band.id
    const height = weightOf(band.height, BAND_DEFAULT_HEIGHT)
    const cells = pickCells(band.cells as unknown[])
    if (cells.length === 0) {
      fix('band')
      return null
    }
    return { id, height, ...pickCollapsed(band), cells }
  }

  const columns: LayoutColumn[] = []
  if (Array.isArray(raw)) {
    for (const col of raw as unknown[]) {
      if (columnsKept >= LAYOUT_PART_LIMIT) {
        fix('columnLimit')
        continue
      }
      if (!isRecord(col) || !fresh(col.id) || !Array.isArray(col.rows)) {
        fix('column')
        continue
      }
      const id = col.id
      const weight = weightOf(col.weight)
      const rows: LayoutRow[] = []
      for (const row of col.rows as unknown[]) {
        if (rowsKept >= LAYOUT_PART_LIMIT) {
          fix('rowLimit')
          continue
        }
        const picked = pickRow(row)
        if (!picked) continue
        rows.push(picked)
        rowsKept++
      }
      if (rows.length === 0) {
        // Left without rows: by a limit, or by its own bad rows.
        fix(rowsKept >= LAYOUT_PART_LIMIT || cellsKept >= LAYOUT_PART_LIMIT ? 'columnLimit' : 'column')
        continue
      }
      columns.push({ id, weight, rows })
      columnsKept++
    }
  } else {
    fix('columns')
  }

  const out: PickedLayoutBody = { columns, fixes: [] }
  for (const edge of BAND_EDGES) {
    if (body[edge] === undefined) continue
    const band = pickBand(body[edge])
    if (band) out[edge] = band
  }

  out.fixes = [...counts].map(([what, n]) => {
    const [one, many] = FIX_WORDS[what]
    return n === 1 ? one : `${n} ${many}`
  })
  return out
}
