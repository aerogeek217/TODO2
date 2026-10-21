import {
  BAND_DEFAULT_HEIGHT,
  BAND_EDGES,
  clampCalendarOffset,
  EISENHOWER_QUADRANTS,
  isEisenhowerQuadrant,
  isWidgetKind,
  pickDetailsWidth,
  type CalendarTabViewState,
  type LayoutBand,
  type LayoutBody,
  type TaskRowsViewState,
  type LayoutCell,
  type LayoutColumn,
  type LayoutTab,
  type LensTabConfig,
  type WidgetKind,
  DEFAULT_CALENDAR_DATE_TYPES,
  DEFAULT_WEIGHT,
} from '../models/workspace-layout'
import { normalizeDashboardConfig } from '../models/dashboard-config'
import { isRecord } from '../utils/is-record'

/**
 * Shape check + whitelist reconstruction for the nested part of a `layouts`
 * row: `WorkspaceLayout.columns` and the optional `top` / `bottom` bands.
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
 * Longest column / cell / tab id. The app's ids are short (`w-` + 8
 * characters; the v56 seed's are the old rail ids, deduplicated).
 */
const MAX_ID_LEN = 100

/**
 * The most columns, cells and tabs a layout keeps (each counted over the
 * whole layout, bands included), and list tiles a dashboard tab keeps. Far
 * past anything one builds by hand, so nothing the app makes is cut; a file
 * holding more (one a hand edit or a hostile file made, which would leave
 * the app unable to show the workspace on every launch) still loads — the
 * parts past the limit are dropped by `pickLayoutBody` and reported, never a
 * failed import (`checkLayoutBody` doesn't count them).
 */
export const LAYOUT_PART_LIMIT = 1000

type Obj = Record<string, unknown>

function isId(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= MAX_ID_LEN
}

function isWeight(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0
}

function isFiniteNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
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
      return true
    case 'calendar': {
      const types = config.dateTypes
      if (!isRecord(types) || typeof types.due !== 'boolean' || typeof types.followup !== 'boolean') {
        return `${path}.config.dateTypes`
      }
      if (view?.view !== undefined && view.view !== 'week' && view.view !== 'month') return `${path}.viewState.view`
      if (view?.offset !== undefined && !isFiniteNum(view.offset)) return `${path}.viewState.offset`
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

function checkColumns(columns: unknown, fresh: (id: string) => boolean): true | string {
  if (!Array.isArray(columns)) return 'columns'
  for (let c = 0; c < columns.length; c++) {
    const col: unknown = columns[c]
    const cp = `columns[${c}]`
    if (!isRecord(col)) return cp
    if (!isId(col.id) || !fresh(col.id)) return `${cp}.id`
    if (!isWeight(col.weight)) return `${cp}.weight`
    if (!Array.isArray(col.cells) || col.cells.length === 0) return `${cp}.cells`
    for (let k = 0; k < col.cells.length; k++) {
      const cell: unknown = col.cells[k]
      const kp = `${cp}.cells[${k}]`
      if (!isRecord(cell)) return kp
      if (!isId(cell.id) || !fresh(cell.id)) return `${kp}.id`
      if (!isWeight(cell.weight)) return `${kp}.weight`
      if (cell.activeTabId !== undefined && !isId(cell.activeTabId)) return `${kp}.activeTabId`
      if (cell.collapsed !== undefined && typeof cell.collapsed !== 'boolean') return `${kp}.collapsed`
      if (!Array.isArray(cell.tabs)) return `${kp}.tabs`
      const tabs = checkTabs(cell.tabs, kp, fresh)
      if (tabs !== true) return tabs
    }
  }
  return true
}

/** A band (absent is fine): an id, a positive height and at least one tab. */
function checkBand(band: unknown, path: string, fresh: (id: string) => boolean): true | string {
  if (band === undefined) return true
  if (!isRecord(band)) return path
  if (!isId(band.id) || !fresh(band.id)) return `${path}.id`
  if (!isWeight(band.height)) return `${path}.height`
  if (band.activeTabId !== undefined && !isId(band.activeTabId)) return `${path}.activeTabId`
  if (band.collapsed !== undefined && typeof band.collapsed !== 'boolean') return `${path}.collapsed`
  if (!Array.isArray(band.tabs) || band.tabs.length === 0) return `${path}.tabs`
  return checkTabs(band.tabs, path, fresh)
}

/**
 * `true` when a layout row's columns and bands are valid, else the path of
 * the first bad field (`columns[0].weight`, `top.tabs`, …). A band is
 * optional; one that is there needs an id, a positive height and at least one
 * tab. Ids are unique across the columns and both bands.
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
type LayoutFix = 'columns' | 'column' | 'cell' | 'band' | 'tab' | 'size' | 'settings' | 'eisenhower'
  | 'columnLimit' | 'cellLimit' | 'tabLimit' | 'listTileLimit'

const FIX_WORDS: Record<LayoutFix, readonly [one: string, many: string]> = {
  columns: ['columns reset', 'columns reset'],
  column: ['column dropped', 'columns dropped'],
  cell: ['cell dropped', 'cells dropped'],
  band: ['band dropped', 'bands dropped'],
  tab: ['tab dropped', 'tabs dropped'],
  size: ['size reset', 'sizes reset'],
  settings: ['tab or cell settings reset', 'tab or cell settings reset'],
  eisenhower: ['Eisenhower tab setting dropped', 'Eisenhower tab settings dropped'],
  columnLimit: ['column past the limit of 1,000 dropped', 'columns past the limit of 1,000 dropped'],
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
 * Past `LAYOUT_PART_LIMIT` columns, cells or tabs in the layout (or list
 * tiles in a dashboard tab), the rest are dropped and reported in `fixes`.
 *
 * Anything else becomes a valid body, its bad parts reported in `fixes`, so
 * the audit can repair a stored layout instead of deleting it: a column /
 * cell / band / tab that isn't an object, has a bad or repeated id, or (tab)
 * an unknown kind is dropped, as is a column left without cells and a band
 * left without tabs; a bad size becomes 1 (a band's height
 * `BAND_DEFAULT_HEIGHT`); bad tab settings fall back to the kind's
 * defaults; a bad `activeTabId` / `collapsed` is dropped.
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
        const lensView = rowsView()
        return lensView ? { id, kind: 'lens', config: lensConfig, viewState: lensView } : { id, kind: 'lens', config: lensConfig }
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
  /** A cell's or band's view state: a known `activeTabId` and `collapsed`. */
  const pickView = (raw: Obj, tabs: readonly LayoutTab[]): Pick<LayoutCell, 'activeTabId' | 'collapsed'> => {
    const out: Pick<LayoutCell, 'activeTabId' | 'collapsed'> = {}
    if (typeof raw.activeTabId === 'string' && tabs.some((t) => t.id === raw.activeTabId)) out.activeTabId = raw.activeTabId
    else if (raw.activeTabId !== undefined && !isId(raw.activeTabId)) fix('settings')
    if (raw.collapsed === true) out.collapsed = true
    else if (raw.collapsed !== undefined && typeof raw.collapsed !== 'boolean') fix('settings')
    return out
  }

  const pickCell = (cell: unknown): LayoutCell | null => {
    if (!isRecord(cell) || !fresh(cell.id) || !Array.isArray(cell.tabs)) {
      fix('cell')
      return null
    }
    const id = cell.id
    const weight = weightOf(cell.weight)
    const tabs = pickTabs(cell.tabs as unknown[])
    return { id, weight, tabs, ...pickView(cell, tabs) }
  }

  const pickBand = (band: unknown): LayoutBand | null => {
    if (!isRecord(band) || !fresh(band.id) || !Array.isArray(band.tabs)) {
      fix('band')
      return null
    }
    const id = band.id
    const height = weightOf(band.height, BAND_DEFAULT_HEIGHT)
    const tabs = pickTabs(band.tabs as unknown[])
    if (tabs.length === 0) {
      fix('band')
      return null
    }
    return { id, height, tabs, ...pickView(band, tabs) }
  }

  const columns: LayoutColumn[] = []
  if (Array.isArray(raw)) {
    for (const col of raw as unknown[]) {
      if (columnsKept >= LAYOUT_PART_LIMIT) {
        fix('columnLimit')
        continue
      }
      if (!isRecord(col) || !fresh(col.id) || !Array.isArray(col.cells)) {
        fix('column')
        continue
      }
      const id = col.id
      const weight = weightOf(col.weight)
      const cells: LayoutCell[] = []
      for (const cell of col.cells as unknown[]) {
        if (cellsKept >= LAYOUT_PART_LIMIT) {
          fix('cellLimit')
          continue
        }
        const picked = pickCell(cell)
        if (!picked) continue
        cells.push(picked)
        cellsKept++
      }
      if (cells.length === 0) {
        // Left without cells: by the cell limit, or by its own bad cells.
        fix(cellsKept >= LAYOUT_PART_LIMIT ? 'columnLimit' : 'column')
        continue
      }
      columns.push({ id, weight, cells })
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
