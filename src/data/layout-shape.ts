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
  DEFAULT_CALENDAR_DATE_TYPES,
  DEFAULT_WEIGHT,
} from '../models/workspace-layout'
import { normalizeDashboardConfig } from '../models/dashboard-config'
import { isRecord } from '../utils/is-record'

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
  if (!isRecord(config)) return `${path}.config`
  const view = tab.viewState
  if (view !== undefined && !isRecord(view)) return `${path}.viewState`
  switch (tab.kind) {
    case 'lens':
      if (config.listDefinitionId !== undefined && !isFiniteNum(config.listDefinitionId)) return `${path}.config.listDefinitionId`
      return true
    case 'calendar': {
      const types = config.dateTypes
      if (!isRecord(types) || typeof types.due !== 'boolean' || typeof types.followup !== 'boolean' || (!types.due && !types.followup)) {
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
      for (let t = 0; t < cell.tabs.length; t++) {
        const tab: unknown = cell.tabs[t]
        const tp = `${kp}.tabs[${t}]`
        if (!isRecord(tab)) return tp
        if (!isId(tab.id) || !fresh(tab.id)) return `${tp}.id`
        if (!isWidgetKind(tab.kind)) return `${tp}.kind`
        const settings = checkTabSettings(tab, tp)
        if (settings !== true) return settings
      }
    }
  }
  return true
}

/** A part `pickLayoutColumns` dropped or reset, counted. */
type LayoutFix = 'columns' | 'column' | 'cell' | 'tab' | 'size' | 'settings'

const FIX_WORDS: Record<LayoutFix, readonly [one: string, many: string]> = {
  columns: ['columns reset', 'columns reset'],
  column: ['column dropped', 'columns dropped'],
  cell: ['cell dropped', 'cells dropped'],
  tab: ['tab dropped', 'tabs dropped'],
  size: ['size reset', 'sizes reset'],
  settings: ['tab or cell settings reset', 'tab or cell settings reset'],
}

export interface PickedLayoutColumns {
  columns: LayoutColumn[]
  /**
   * The parts `checkLayoutColumns` rejects that were dropped or reset, in
   * words (`2 tabs dropped`, …); empty for columns that pass it.
   */
  fixes: string[]
}

/**
 * Rebuilds a layout body with only the model's keys. For columns that pass
 * `checkLayoutColumns` (all import ever picks) nothing is dropped but a stale
 * `activeTabId` (= first tab), unknown dashboard ids / options, duplicate
 * collapsed quadrants, and an out-of-range calendar offset (clamped).
 *
 * Anything else becomes a valid body, its bad parts reported in `fixes`, so
 * the audit can repair a stored layout instead of deleting it: a column /
 * cell / tab that isn't an object, has a bad or repeated id, or (tab) an
 * unknown kind is dropped, as is a column left without cells; a bad size
 * becomes 1; bad tab settings fall back to the kind's defaults; a bad
 * `activeTabId` / `collapsed` is dropped.
 */
export function pickLayoutColumns(raw: unknown): PickedLayoutColumns {
  const counts = new Map<LayoutFix, number>()
  const fix = (what: LayoutFix) => { counts.set(what, (counts.get(what) ?? 0) + 1) }
  const seen = new Set<string>()
  const fresh = (id: unknown): id is string => {
    if (!isId(id) || seen.has(id)) return false
    seen.add(id)
    return true
  }
  const weightOf = (v: unknown): number => {
    if (isWeight(v)) return v
    fix('size')
    return DEFAULT_WEIGHT
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
    switch (tab.kind) {
      case 'lens': {
        const lensConfig: LensTabConfig = {}
        if (isFiniteNum(config.listDefinitionId)) lensConfig.listDefinitionId = config.listDefinitionId
        else if (config.listDefinitionId !== undefined) fix('settings')
        return { id, kind: 'lens', config: lensConfig }
      }
      case 'calendar': {
        const types = config.dateTypes
        const typesOk = isRecord(types) && typeof types.due === 'boolean' && typeof types.followup === 'boolean' && (types.due || types.followup)
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
        const eisenhower: LayoutTab = { id, kind: 'eisenhower', config: {} }
        // Known quadrants, once each, in display order.
        const quadrants = collapsed ? EISENHOWER_QUADRANTS.filter((q) => collapsed.has(q)) : []
        if (quadrants.length > 0) eisenhower.viewState = { collapsed: quadrants }
        return eisenhower
      }
      case 'dashboard':
        // Unknown ids / options inside are dropped, missing parts defaulted.
        for (const key of ['tiles', 'listTiles', 'sections'] as const) {
          if (config[key] !== undefined && !Array.isArray(config[key])) fix('settings')
        }
        return { id, kind: 'dashboard', config: normalizeDashboardConfig(config) }
      default:
        return { id, kind: 'notes', config: {} }
    }
  }

  const pickCell = (cell: unknown): LayoutCell | null => {
    if (!isRecord(cell) || !fresh(cell.id) || !Array.isArray(cell.tabs)) {
      fix('cell')
      return null
    }
    const id = cell.id
    const weight = weightOf(cell.weight)
    const tabs: LayoutTab[] = []
    for (const tab of cell.tabs as unknown[]) {
      const picked = pickTab(tab)
      if (picked) tabs.push(picked)
    }
    const out: LayoutCell = { id, weight, tabs }
    if (typeof cell.activeTabId === 'string' && tabs.some((t) => t.id === cell.activeTabId)) out.activeTabId = cell.activeTabId
    else if (cell.activeTabId !== undefined && !isId(cell.activeTabId)) fix('settings')
    if (cell.collapsed === true) out.collapsed = true
    else if (cell.collapsed !== undefined && typeof cell.collapsed !== 'boolean') fix('settings')
    return out
  }

  const columns: LayoutColumn[] = []
  if (Array.isArray(raw)) {
    for (const col of raw as unknown[]) {
      if (!isRecord(col) || !fresh(col.id) || !Array.isArray(col.cells)) {
        fix('column')
        continue
      }
      const id = col.id
      const weight = weightOf(col.weight)
      const cells: LayoutCell[] = []
      for (const cell of col.cells as unknown[]) {
        const picked = pickCell(cell)
        if (picked) cells.push(picked)
      }
      if (cells.length === 0) {
        fix('column')
        continue
      }
      columns.push({ id, weight, cells })
    }
  } else {
    fix('columns')
  }

  const fixes = [...counts].map(([what, n]) => {
    const [one, many] = FIX_WORDS[what]
    return n === 1 ? one : `${n} ${many}`
  })
  return { columns, fixes }
}
