import {
  clampCalendarOffset,
  EISENHOWER_QUADRANTS,
  isEisenhowerQuadrant,
  isWidgetKind,
  type CalendarTabViewState,
  type LayoutCell,
  type LayoutColumn,
  type LayoutTab,
  type LensTabConfig,
} from '../models/workspace-layout'
import { normalizeDashboardConfig } from '../models/dashboard-config'

/**
 * Shape check + whitelist reconstruction for `WorkspaceLayout.columns`, the
 * nested part of a `layouts` row. Used by import validation (`checkLayout` /
 * `pickLayout` in `import-validation.ts`), so a layout from a file only
 * reaches Dexie with known kinds, known keys and unique ids.
 */

/**
 * Longest column / cell / tab id. The app's ids are short (`w-` + 8
 * characters; the v56 seed's are the old rail ids, deduplicated). There is
 * no limit on the number of columns, cells or tabs: nothing in the
 * workspace limits them, so a cap here would make a layout the app can
 * build fail to import. The file-size cap bounds them.
 */
const MAX_ID_LEN = 100

type Obj = Record<string, unknown>

function isObj(v: unknown): v is Obj {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

function isId(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= MAX_ID_LEN
}

function isWeight(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0
}

function isFiniteNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

function checkTabSettings(tab: Obj, path: string): true | string {
  const config = tab.config
  if (!isObj(config)) return `${path}.config`
  const view = tab.viewState
  if (view !== undefined && !isObj(view)) return `${path}.viewState`
  switch (tab.kind) {
    case 'lens':
      if (config.listDefinitionId !== undefined && !isFiniteNum(config.listDefinitionId)) return `${path}.config.listDefinitionId`
      return true
    case 'calendar': {
      const types = config.dateTypes
      if (!isObj(types) || typeof types.due !== 'boolean' || typeof types.followup !== 'boolean' || (!types.due && !types.followup)) {
        return `${path}.config.dateTypes`
      }
      if (view?.view !== undefined && view.view !== 'week' && view.view !== 'month') return `${path}.viewState.view`
      if (view?.offset !== undefined && !isFiniteNum(view.offset)) return `${path}.viewState.offset`
      return true
    }
    case 'eisenhower': {
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
    default:
      return true
  }
}

/**
 * `true` when `columns` is a valid layout body, else the path of the first
 * bad field (e.g. `columns[0].cells[1].tabs[0].kind`). Ids must be unique
 * across columns, cells and tabs. A cell may have no tabs; a column must have
 * a cell.
 */
export function checkLayoutColumns(columns: unknown): true | string {
  if (!Array.isArray(columns)) return 'columns'
  const seen = new Set<string>()
  const fresh = (id: string): boolean => {
    if (seen.has(id)) return false
    seen.add(id)
    return true
  }
  for (let c = 0; c < columns.length; c++) {
    const col: unknown = columns[c]
    const cp = `columns[${c}]`
    if (!isObj(col)) return cp
    if (!isId(col.id) || !fresh(col.id)) return `${cp}.id`
    if (!isWeight(col.weight)) return `${cp}.weight`
    if (!Array.isArray(col.cells) || col.cells.length === 0) return `${cp}.cells`
    for (let k = 0; k < col.cells.length; k++) {
      const cell: unknown = col.cells[k]
      const kp = `${cp}.cells[${k}]`
      if (!isObj(cell)) return kp
      if (!isId(cell.id) || !fresh(cell.id)) return `${kp}.id`
      if (!isWeight(cell.weight)) return `${kp}.weight`
      if (cell.activeTabId !== undefined && !isId(cell.activeTabId)) return `${kp}.activeTabId`
      if (cell.collapsed !== undefined && typeof cell.collapsed !== 'boolean') return `${kp}.collapsed`
      if (!Array.isArray(cell.tabs)) return `${kp}.tabs`
      for (let t = 0; t < cell.tabs.length; t++) {
        const tab: unknown = cell.tabs[t]
        const tp = `${kp}.tabs[${t}]`
        if (!isObj(tab)) return tp
        if (!isId(tab.id) || !fresh(tab.id)) return `${tp}.id`
        if (!isWidgetKind(tab.kind)) return `${tp}.kind`
        const settings = checkTabSettings(tab, tp)
        if (settings !== true) return settings
      }
    }
  }
  return true
}

function pickTab(raw: Obj): LayoutTab {
  const id = raw.id as string
  const config = raw.config as Obj
  const view = isObj(raw.viewState) ? raw.viewState : undefined
  switch (raw.kind) {
    case 'lens': {
      const lensConfig: LensTabConfig = {}
      if (isFiniteNum(config.listDefinitionId)) lensConfig.listDefinitionId = config.listDefinitionId
      return { id, kind: 'lens', config: lensConfig }
    }
    case 'calendar': {
      const types = config.dateTypes as Obj
      const tab: LayoutTab = { id, kind: 'calendar', config: { dateTypes: { due: types.due === true, followup: types.followup === true } } }
      if (view) {
        const viewState: CalendarTabViewState = {}
        if (view.view === 'week' || view.view === 'month') viewState.view = view.view
        if (isFiniteNum(view.offset)) viewState.offset = clampCalendarOffset(view.offset)
        if (Object.keys(viewState).length > 0) tab.viewState = viewState
      }
      return tab
    }
    case 'eisenhower': {
      const raw = view?.collapsed
      const collapsed = Array.isArray(raw) ? new Set<unknown>(raw) : null
      const tab: LayoutTab = { id, kind: 'eisenhower', config: {} }
      // Known quadrants, once each, in display order.
      if (collapsed && collapsed.size > 0) tab.viewState = { collapsed: EISENHOWER_QUADRANTS.filter((q) => collapsed.has(q)) }
      return tab
    }
    case 'dashboard':
      return { id, kind: 'dashboard', config: normalizeDashboardConfig(config) }
    default:
      // 'notes' — the only kind left (`checkLayoutColumns` vetted it).
      return { id, kind: 'notes', config: {} }
  }
}

function pickCell(raw: Obj): LayoutCell {
  const tabs = (raw.tabs as Obj[]).map(pickTab)
  const cell: LayoutCell = { id: raw.id as string, weight: raw.weight as number, tabs }
  if (typeof raw.activeTabId === 'string' && tabs.some((t) => t.id === raw.activeTabId)) cell.activeTabId = raw.activeTabId
  if (raw.collapsed === true) cell.collapsed = true
  return cell
}

/**
 * Rebuilds columns that passed `checkLayoutColumns` with only the model's
 * keys. A stale `activeTabId` is dropped (= first tab).
 */
export function pickLayoutColumns(columns: unknown): LayoutColumn[] {
  return (columns as Obj[]).map((col) => ({
    id: col.id as string,
    weight: col.weight as number,
    cells: (col.cells as Obj[]).map(pickCell),
  }))
}
