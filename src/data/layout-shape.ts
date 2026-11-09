import {
  clampCalendarOffset,
  EISENHOWER_QUADRANTS,
  isEisenhowerQuadrant,
  readListZoom,
  isWidgetKind,
  pickDetailsWidth,
  type CalendarTabViewState,
  type CellArea,
  type GridTrack,
  type LayoutBody,
  type TaskRowsViewState,
  type LayoutCell,
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
  // G3: the widgets' lens switch.
  LENS_SWITCH_KINDS,
  type CalendarTab,
  type EisenhowerTab,
  type LensSwitchTab,
  type LensViewState,
} from '../models/workspace-layout'
import {
  GLANCE_CONFIG_FIELDS,
  numberConfigProblem,
  pickNumberConfig,
  pickTrendConfig,
  type NumberConfig,
  type PickedConfig,
} from '../models/glance-widgets'
import {
  breakdownColumnFilters,
  breakdownConfigProblem,
  breakdownViewProblem,
  pickBreakdownConfig,
  pickBreakdownView,
  pickPivotConfig,
  pickTagMapConfig,
  pivotConfigProblem,
  tagMapConfigProblem,
} from '../models/chart-widgets'
// G5: Project pulse's config and its rules.
import { pickPulseConfig, pulseConfigProblem, pulseRulePredicates } from '../models/pulse-config'
import type { TodoPredicate } from '../models/filter-predicate'
import { emptyPredicate } from '../models/filter-predicate'
import { isRecord } from '../utils/is-record'
import { checkPredicateShape, pickPredicate } from './predicate-shape'
import { isCellEdge, normalizeGrid, validateTiling } from '../utils/workspace-grid'
import { closeCell } from '../utils/workspace-layout-ops'

/**
 * Shape check + whitelist reconstruction for the nested part of a `layouts`
 * row: its table — `WorkspaceLayout.grid` (column and row tracks) and
 * `cells` (each an area of tracks and a strip of tabs).
 * Used by import validation (`checkLayout` / `pickLayout` in
 * `import-validation.ts`), so a layout from a file only reaches Dexie with
 * known kinds, known keys, unique ids and cells that tile the grid.
 */


/** A layout row's body as stored (unchecked). */
export interface RawLayoutBody {
  grid?: unknown
  cells?: unknown
}

/**
 * Longest track / cell / tab id. The app's ids are short (`w-` + 8
 * characters; the v56 seed's are the old rail ids, deduplicated).
 */
const MAX_ID_LEN = 100

/**
 * The most column tracks, row tracks, cells and tabs a layout keeps (each
 * counted over the whole layout). Far
 * past anything one builds by hand, so nothing the app makes is cut; a file
 * holding more (one a hand edit or a hostile file made, which would leave
 * the app unable to show the workspace on every launch) still loads — the
 * parts past the limit are dropped by `pickLayoutBody` and reported, never a
 * failed import (`checkLayoutBody` doesn't count them).
 */
export const LAYOUT_PART_LIMIT = 1000

type Obj = Record<string, unknown>

/** A layout part's id (a track, cell or tab) as stored. */
export function isId(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= MAX_ID_LEN
}

/**
 * The largest weight (and fixed track size, in px) a layout part keeps: far past
 * anything the dividers make (they keep a pair's sum), and small enough that
 * no sum of a layout's parts reaches `Infinity` — two weights near
 * `Number.MAX_VALUE` summed to it, every share became 0 and no divider could
 * resize them back (cr33 S4). A larger one is a bad size (repaired).
 */
export const LAYOUT_SIZE_MAX = 1_000_000

function isWeight(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= LAYOUT_SIZE_MAX
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

/** The kinds whose tabs show task rows: they keep a details width (`TaskRowsViewState`). */
const ROWS_KINDS: ReadonlySet<WidgetKind> = new Set<WidgetKind>(['lens', 'eisenhower'])

/** A tab's config / view state for its kind (a case per kind: a new kind doesn't compile without one). */
function checkTabSettings(tab: Obj, kind: WidgetKind, path: string): true | string {
  const config = tab.config
  if (!isRecord(config)) return `${path}.config`
  const view = tab.viewState
  if (view !== undefined && !isRecord(view)) return `${path}.viewState`
  // A widget's lens switch (G3): a boolean.
  if ((LENS_SWITCH_KINDS as readonly string[]).includes(kind) && view?.ignoreLens !== undefined && typeof view.ignoreLens !== 'boolean') {
    return `${path}.viewState.ignoreLens`
  }
  // Tabs showing task rows: the details width, a number in range.
  if (ROWS_KINDS.has(kind)
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
    case 'neglect':
      if (!isNeglectColourBy(config.colourBy)) return `${path}.config.colourBy`
      if (!isNeglectUntouchedDays(config.untouchedDays)) return `${path}.config.untouchedDays`
      return true
    case 'number': {
      // Its fields (`numberConfigProblem`), then its filter: a stored
      // predicate with nothing its read (`pickPredicate`) would change.
      const bad = numberConfigProblem(config)
      if (bad) return `${path}.config.${bad}`
      // Its predicates: its filter, and its shape's (D26 P6).
      for (const [key, raw] of numberPredicates(config)) {
        const shape = checkPredicateShape(raw)
        if (shape !== true) return `${path}.config.${key}.${shape}`
        if (pickPredicate(raw).fixes.length > 0) return `${path}.config.${key}`
      }
      return true
    }
    case 'trend': {
      // One config field, a known value.
      const field = GLANCE_CONFIG_FIELDS[kind]
      return field.ok(config[field.key]) ? true : `${path}.config.${field.key}`
    }
    // G5: Project pulse — its tag picks and rules, then each rule's filter as a Number's.
    case 'pulse': {
      const bad = pulseConfigProblem(config)
      if (bad) return `${path}.config.${bad}`
      for (const [key, raw] of pulseRulePredicates(config)) {
        const shape = checkPredicateShape(raw)
        if (shape !== true) return `${path}.config.${key}.${shape}`
        if (pickPredicate(raw).fixes.length > 0) return `${path}.config.${key}`
      }
      return true
    }
    // D26 P8: the chart widgets — their fields, then their filter as a Number's.
    case 'breakdown': {
      const bad = breakdownConfigProblem(config)
      if (bad) return `${path}.config.${bad}`
      const badView = view ? breakdownViewProblem(view) : null
      if (badView) return `${path}.viewState.${badView}`
      // Its count columns' filters (board BC), each as a Number's.
      for (const [key, raw] of breakdownColumnFilters(config)) {
        const shape = checkPredicateShape(raw)
        if (shape !== true) return `${path}.config.${key}.${shape}`
        if (pickPredicate(raw).fixes.length > 0) return `${path}.config.${key}`
      }
      return checkChartFilter(config.filter, path)
    }
    case 'pivot': {
      const bad = pivotConfigProblem(config)
      return bad ? `${path}.config.${bad}` : checkChartFilter(config.filter, path)
    }
    case 'tagMap': {
      const bad = tagMapConfigProblem(config)
      return bad ? `${path}.config.${bad}` : checkChartFilter(config.filter, path)
    }
    case 'notes':
      return true
  }
}

/** A chart's filter as stored: a predicate with nothing its read (`pickPredicate`) would change. */
function checkChartFilter(filter: unknown, path: string): true | string {
  const shape = checkPredicateShape(filter)
  if (shape !== true) return `${path}.config.filter.${shape}`
  return pickPredicate(filter).fixes.length === 0 ? true : `${path}.config.filter`
}

/** A chart's filter, repaired as a Number's (a missing one is no filter — every open task —, a fix). */
function chartFilterOf(config: Record<string, unknown>): PickedConfig<TodoPredicate> {
  if (!isRecord(config.filter)) return { config: emptyPredicate(), fixed: true }
  const filter = pickPredicate(config.filter)
  return { config: filter.predicate, fixed: filter.fixes.length > 0 }
}

/**
 * A Number's config, repaired (`pickNumberConfig`): its filter read as a
 * list's is (`pickPredicate`; a missing one is no filter — every open
 * task —, a fix like any other).
 */
function numberConfigOf(config: Record<string, unknown>): PickedConfig<NumberConfig> {
  return pickNumberConfig(config, readNumberPredicate(config.filter), readNumberPredicate)
}

/** A Number's stored predicate read as a list's (`pickPredicate`); a missing one is no filter, a fix. */
function readNumberPredicate(raw: unknown): PickedConfig<TodoPredicate> {
  if (!isRecord(raw)) return { config: emptyPredicate(), fixed: true }
  const filter = pickPredicate(raw)
  return { config: filter.predicate, fixed: filter.fixes.length > 0 }
}

/** A stored Number's predicates, by their path in its config: its filter, its share's `of`, its group items' filters (D26 P6). */
function numberPredicates(config: Record<string, unknown>): Array<[string, unknown]> {
  const out: Array<[string, unknown]> = [['filter', config.filter]]
  if (config.of !== undefined) out.push(['of', config.of])
  if (Array.isArray(config.items)) config.items.forEach((item: unknown, i) => out.push([`items.${i}.filter`, isRecord(item) ? item.filter : undefined]))
  return out
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

/**
 * Kinds removed while the schema stayed at v78 — the Status flow chart
 * (D26 P8, shipped in v78) —: a v78 file may hold one, and no upgrade
 * runs on it, so its tab passes the check (import, a restore and the sync
 * file take the file) and the repair drops it as an unknown kind (a fix:
 * `Fixed 1 layout`; a stored layout opens unsaved), its emptied cell
 * closing.
 */
const REMOVED_IN_V78: ReadonlySet<unknown> = new Set(['statusFlow'])

/** `true` when every tab of a strip is valid, else the path of the first bad field. */
function checkTabs(tabs: readonly unknown[], path: string, fresh: (id: string) => boolean): true | string {
  for (let t = 0; t < tabs.length; t++) {
    const tab: unknown = tabs[t]
    const tp = `${path}.tabs[${t}]`
    if (!isRecord(tab)) return tp
    if (!isId(tab.id) || !fresh(tab.id)) return `${tp}.id`
    if (REMOVED_IN_V78.has(tab.kind)) continue
    if (!isWidgetKind(tab.kind)) return `${tp}.kind`
    const settings = checkTabSettings(tab, tab.kind, tp)
    if (settings !== true) return settings
  }
  return true
}


/** A track as stored: an object with a fresh id, a size (a weight or px) and, on a row, a boolean `collapsed`. */
function checkTrack(track: unknown, path: string, rows: boolean, fresh: (id: string) => boolean): true | string {
  if (!isRecord(track)) return path
  if (!isId(track.id) || !fresh(track.id)) return `${path}.id`
  if (track.px !== undefined) {
    if (!isWeight(track.px) || track.weight !== undefined) return `${path}.px`
  } else if (!isWeight(track.weight)) {
    return `${path}.weight`
  }
  if (track.collapsed !== undefined && (!rows || typeof track.collapsed !== 'boolean')) return `${path}.collapsed`
  return true
}

/** A cell's area as stored: whole track indices, spans of at least one. */
function isAreaShape(v: unknown): v is CellArea {
  if (!isRecord(v)) return false
  const { col, row, colSpan, rowSpan } = v
  return [col, row, colSpan, rowSpan].every((n) => typeof n === 'number' && Number.isInteger(n))
    && (col as number) >= 0 && (row as number) >= 0 && (colSpan as number) >= 1 && (rowSpan as number) >= 1
}

/**
 * `true` when a layout row's table is valid, else the path of the first bad
 * field (`grid.columns[0].weight`, `cells[2].area`, …): every track an id
 * and a size (a weight, or `px`; only a row track may be `collapsed`),
 * every cell an id, an area and a strip of valid tabs (an empty strip is an
 * empty cell), ids unique across tracks, cells and tabs, the cells tiling
 * the grid exactly (`validateTiling`), and every inner line some cell's
 * edge. An empty layout has no tracks and no cells.
 */
export function checkLayoutBody(body: RawLayoutBody): true | string {
  const fresh = idTracker()
  const grid = body.grid
  if (!isRecord(grid) || !Array.isArray(grid.columns) || !Array.isArray(grid.rows)) return 'grid'
  for (const axis of ['columns', 'rows'] as const) {
    const tracks = grid[axis] as unknown[]
    for (let i = 0; i < tracks.length; i++) {
      const res = checkTrack(tracks[i], `grid.${axis}[${i}]`, axis === 'rows', fresh)
      if (res !== true) return res
    }
  }
  if (!Array.isArray(body.cells)) return 'cells'
  for (let k = 0; k < body.cells.length; k++) {
    const cell: unknown = body.cells[k]
    const cp = `cells[${k}]`
    if (!isRecord(cell)) return cp
    if (!isId(cell.id) || !fresh(cell.id)) return `${cp}.id`
    if (!isAreaShape(cell.area)) return `${cp}.area`
    if (cell.activeTabId !== undefined && !isId(cell.activeTabId)) return `${cp}.activeTabId`
    if (!Array.isArray(cell.tabs)) return `${cp}.tabs`
    const tabs = checkTabs(cell.tabs, cp, fresh)
    if (tabs !== true) return tabs
  }
  const table = { grid: grid as unknown as LayoutBody['grid'], cells: body.cells as LayoutCell[] }
  if (validateTiling(table) !== true) return 'cells'
  for (const axis of ['columns', 'rows'] as const) {
    for (let line = 1; line < table.grid[axis].length; line++) {
      if (!isCellEdge(table, axis, line)) return `grid.${axis}`
    }
  }
  return true
}

/** A part `pickLayoutBody` dropped or reset, counted. */
type LayoutFix = 'grid' | 'rebuilt' | 'lines' | 'track' | 'cell' | 'tab' | 'size' | 'settings' | 'eisenhower'
  | 'trackLimit' | 'cellLimit' | 'tabLimit'

const FIX_WORDS: Record<LayoutFix, readonly [one: string, many: string]> = {
  grid: ['grid reset', 'grid reset'],
  rebuilt: ['cells restacked in one column', 'cells restacked in one column'],
  lines: ['grid line merged', 'grid lines merged'],
  track: ['track dropped', 'tracks dropped'],
  cell: ['cell dropped', 'cells dropped'],
  tab: ['tab dropped', 'tabs dropped'],
  size: ['size reset', 'sizes reset'],
  settings: ['tab or cell settings reset', 'tab or cell settings reset'],
  eisenhower: ['Eisenhower tab setting dropped', 'Eisenhower tab settings dropped'],
  trackLimit: ['track past the limit of 1,000 dropped', 'tracks past the limit of 1,000 dropped'],
  cellLimit: ['cell past the limit of 1,000 dropped', 'cells past the limit of 1,000 dropped'],
  tabLimit: ['tab past the limit of 1,000 dropped', 'tabs past the limit of 1,000 dropped'],
}

export interface PickedLayoutBody extends LayoutBody {
  /**
   * The parts `checkLayoutBody` rejects that were dropped or reset, and the
   * parts past `LAYOUT_PART_LIMIT`, in words (`2 tabs dropped`, `grid lines
   * merged`, …); otherwise empty for a body that passes it.
   */
  fixes: string[]
}

/** A picked cell before its place is settled: its area as stored (when it reads as one) and whether the repair emptied it. */
interface PickedCell {
  cell: LayoutCell
  rawArea: CellArea | null
  /** It held tabs, and every one was dropped. */
  emptied: boolean
}

/**
 * Rebuilds a layout body (its table) with only the model's keys. For a body
 * that passes `checkLayoutBody` (all import ever picks) nothing is dropped
 * but a stale `activeTabId` (= first tab), duplicate collapsed quadrants, an
 * out-of-range calendar offset (clamped), and any key of an Eisenhower tab's
 * config (it has none — reported in `fixes`); a details width is rounded,
 * and the cells come in reading order. A tab of a retired kind — `dashboard`
 * (v77 converted every one), and `followup`, `next7`, `stale`, `recent`,
 * `changes`, `today` and `eisenhowerSummary` (v78 dropped or converted
 * every one) — is an unknown kind, dropped like one, and a cell it leaves
 * without tabs closes. A Status flow tab (`REMOVED_IN_V78`) passes the
 * check but is dropped the same way, reported in `fixes`.
 *
 * Past `LAYOUT_PART_LIMIT` tracks, cells or tabs in the layout, the rest are
 * dropped and reported in `fixes`.
 *
 * Anything else becomes a valid body, its bad parts reported in `fixes`, so
 * the audit can repair a stored layout instead of deleting it: a track /
 * cell / tab that isn't an object, has a bad or repeated id (ids are unique
 * across tracks, cells and tabs), or (tab) an unknown kind is dropped; a bad
 * size is reset (a weight to the axis's average); bad tab settings fall back
 * to the kind's defaults; a bad `activeTabId` / `collapsed` is dropped; a
 * cell whose every tab was dropped closes (`closeCell`: a neighbour takes
 * its space, or it stays empty); an inner line no cell's edge lies on goes
 * (`normalizeGrid`). When the cells don't tile the grid any more (a bad
 * area, a dropped track or cell), the grid is rebuilt: every cell kept, in
 * its old reading order, stacked in one column (`restacked`).
 */
export function pickLayoutBody(body: RawLayoutBody): PickedLayoutBody {
  const counts = new Map<LayoutFix, number>()
  const fix = (what: LayoutFix) => { counts.set(what, (counts.get(what) ?? 0) + 1) }
  const seen = new Set<string>()
  const fresh = (id: unknown): id is string => {
    if (!isId(id) || seen.has(id)) return false
    seen.add(id)
    return true
  }
  // Parts kept so far, over the whole layout (`LAYOUT_PART_LIMIT`).
  let tracksKept = 0
  let cellsKept = 0
  let tabsKept = 0
  // The grid as stored no longer holds: the cells are restacked.
  let rebuild = false

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
    /** A widget's lens switch (G3, view state): a boolean, else dropped (a fix). */
    const lensView = (): LensViewState => {
      const v = view?.ignoreLens
      if (typeof v === 'boolean') return { ignoreLens: v }
      if (v !== undefined) fix('settings')
      return {}
    }
    /** `tab` with the lens switch as its view state, when it has one (no view state otherwise). */
    const withLensView = <T extends LensSwitchTab>(tab: T): T => {
      const lens = lensView()
      return lens.ignoreLens === undefined ? tab : { ...tab, viewState: { ...tab.viewState, ...lens } }
    }
    /** A glance config as picked, a reset reported. */
    const glance = <C,>(picked: PickedConfig<C>): C => {
      if (picked.fixed) fix('settings')
      return picked.config
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
        const calendar: CalendarTab = { id, kind: 'calendar', config: { dateTypes } }
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
        return withLensView(calendar)
      }
      case 'eisenhower': {
        const raw = view?.collapsed
        if (raw !== undefined && (!Array.isArray(raw) || !raw.every(isEisenhowerQuadrant))) fix('settings')
        const collapsed = Array.isArray(raw) ? new Set<unknown>(raw) : null
        // Its panes and source are app-wide settings: a key here (none in v66
        // data) is dropped.
        for (let i = 0; i < Object.keys(config).length; i++) fix('eisenhower')
        const eisenhower: EisenhowerTab = { id, kind: 'eisenhower', config: {} }
        // Known quadrants, once each, in display order.
        const quadrants = collapsed ? EISENHOWER_QUADRANTS.filter((q) => collapsed.has(q)) : []
        const eisenhowerView = { ...rowsView(), ...(quadrants.length > 0 ? { collapsed: quadrants } : {}) }
        if (Object.keys(eisenhowerView).length > 0) eisenhower.viewState = eisenhowerView
        return withLensView(eisenhower)
      }
      case 'neglect': {
        // No view state of its own but the lens switch: any other is dropped.
        const neglect = pickNeglectConfig(config)
        if (neglect.fixed) fix('settings')
        return withLensView<LensSwitchTab>({ id, kind: 'neglect', config: neglect.config })
      }
      case 'notes':
        return { id, kind: 'notes', config: {} }
      // The glance kinds: a bad or missing setting is reset to its default;
      // no view state but the lens switch (Created vs completed has none).
      case 'number':
        return withLensView<LensSwitchTab>({ id, kind: 'number', config: glance(numberConfigOf(config)) })
      case 'trend':
        return { id, kind: 'trend', config: glance(pickTrendConfig(config)) }
      case 'pulse':
        return withLensView<LensSwitchTab>({ id, kind: 'pulse', config: glance(pickPulseConfig(config, readNumberPredicate)) })
      // D26 P8: the chart widgets.
      case 'breakdown': {
        const viewState = glance(pickBreakdownView(view))
        const breakdown: LayoutTab = { id, kind: 'breakdown', config: glance(pickBreakdownConfig(config, chartFilterOf(config), readNumberPredicate)) }
        if (viewState) breakdown.viewState = viewState
        return breakdown
      }
      case 'pivot':
        return withLensView<LensSwitchTab>({ id, kind: 'pivot', config: glance(pickPivotConfig(config, chartFilterOf(config))) })
      case 'tagMap':
        return withLensView<LensSwitchTab>({ id, kind: 'tagMap', config: glance(pickTagMapConfig(config, chartFilterOf(config))) })
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
  const pickTrack = (raw: unknown, rows: boolean): GridTrack | null => {
    if (!isRecord(raw) || !fresh(raw.id)) {
      fix('track')
      return null
    }
    const track: GridTrack = { id: raw.id }
    if (raw.px !== undefined && isWeight(raw.px)) {
      track.px = raw.px
      if (raw.weight !== undefined) fix('size')
    } else if (isWeight(raw.weight)) {
      track.weight = raw.weight
      if (raw.px !== undefined) fix('size')
    } else {
      // Reset below, to the axis's average weight.
      fix('size')
    }
    if (raw.collapsed === true && rows) track.collapsed = true
    else if (raw.collapsed !== undefined && (!rows || typeof raw.collapsed !== 'boolean')) fix('settings')
    return track
  }

  const pickTracks = (raw: unknown[], rows: boolean): GridTrack[] => {
    const tracks: GridTrack[] = []
    // Counted per axis: a layout keeps up to the limit of columns and of rows.
    tracksKept = 0
    for (const t of raw) {
      if (tracksKept >= LAYOUT_PART_LIMIT) {
        fix('trackLimit')
        rebuild = true
        continue
      }
      const picked = pickTrack(t, rows)
      if (!picked) {
        rebuild = true
        continue
      }
      tracks.push(picked)
      tracksKept++
    }
    // A track without a size takes the average of the axis's weights.
    const weights = tracks.flatMap((t) => (t.weight != null ? [t.weight] : []))
    const average = weights.length > 0 ? weights.reduce((a, b) => a + b, 0) / weights.length : DEFAULT_WEIGHT
    return tracks.map((t) => (t.weight == null && t.px == null ? { ...t, weight: average } : t))
  }

  const pickCell = (raw: unknown): PickedCell | null => {
    if (!isRecord(raw) || !fresh(raw.id) || !Array.isArray(raw.tabs)) {
      fix('cell')
      return null
    }
    const rawTabs = raw.tabs as unknown[]
    const tabs = pickTabs(rawTabs)
    const cell: LayoutCell = { id: raw.id, area: { col: 0, row: 0, colSpan: 1, rowSpan: 1 }, tabs }
    if (typeof raw.activeTabId === 'string' && tabs.some((t) => t.id === raw.activeTabId)) cell.activeTabId = raw.activeTabId
    else if (raw.activeTabId !== undefined && !isId(raw.activeTabId)) fix('settings')
    const area = raw.area
    const rawArea = isAreaShape(area) ? { col: area.col, row: area.row, colSpan: area.colSpan, rowSpan: area.rowSpan } : null
    return { cell, rawArea, emptied: rawTabs.length > 0 && tabs.length === 0 }
  }

  const grid = body.grid
  let columns: GridTrack[] = []
  let rows: GridTrack[] = []
  if (isRecord(grid) && Array.isArray(grid.columns) && Array.isArray(grid.rows)) {
    columns = pickTracks(grid.columns as unknown[], false)
    rows = pickTracks(grid.rows as unknown[], true)
  } else {
    fix('grid')
    rebuild = true
  }

  const picked: PickedCell[] = []
  if (Array.isArray(body.cells)) {
    for (const raw of body.cells as unknown[]) {
      if (cellsKept >= LAYOUT_PART_LIMIT) {
        fix('cellLimit')
        rebuild = true
        continue
      }
      const cell = pickCell(raw)
      if (!cell) {
        rebuild = true
        continue
      }
      picked.push(cell)
      cellsKept++
    }
  } else {
    fix('cell')
    rebuild = true
  }

  let table: LayoutBody = {
    grid: { columns, rows },
    cells: picked.map((p) => (p.rawArea ? { ...p.cell, area: p.rawArea } : p.cell)),
  }
  if (rebuild || picked.some((p) => !p.rawArea) || validateTiling(table) !== true) {
    table = restacked(picked, columns, rows)
    if (picked.length > 0) fix('rebuilt')
    else if (columns.length > 0 || rows.length > 0) fix('grid')
  }
  // A cell the repair emptied closes; a line no cell's edge lies on goes.
  for (const p of picked) if (p.emptied) table = closeCell(table, p.cell.id)
  const lines = table.grid.columns.length + table.grid.rows.length
  const normal = normalizeGrid(table)
  const merged = lines - (normal.grid.columns.length + normal.grid.rows.length)
  if (normal.cells.length > 0) for (let i = 0; i < merged; i++) fix('lines')

  return {
    grid: normal.grid,
    cells: normal.cells,
    fixes: [...counts].map(([what, n]) => {
      const [one, many] = FIX_WORDS[what]
      return n === 1 ? one : `${n} ${many}`
    }),
  }
}

/**
 * The table rebuilt from its cells: each, in its old reading order (by its
 * stored area while every cell has one, else in the order listed), a row of
 * one column — the column keeping the first stored column's id, each row
 * the stored row track at its place when there is one (its id, its px and
 * collapse kept), else a new one — every weighted row the default weight.
 * At most `LAYOUT_PART_LIMIT` cells, so the rows stay within the limit;
 * none for no cells.
 */
function restacked(picked: readonly PickedCell[], columns: readonly GridTrack[], rows: readonly GridTrack[]): LayoutBody {
  if (picked.length === 0) return { grid: { columns: [], rows: [] }, cells: [] }
  const byArea = picked.every((p) => p.rawArea != null)
  const order = picked
    .map((p, i) => ({ p, i }))
    .sort((a, b) => {
      const pa = a.p.rawArea
      const pb = b.p.rawArea
      if (byArea && pa && pb) return pa.row - pb.row || pa.col - pb.col || a.i - b.i
      return a.i - b.i
    })
    .map((x) => x.p)
    .slice(0, LAYOUT_PART_LIMIT)
  const taken = new Set<string>(order.flatMap((p) => [p.cell.id, ...p.cell.tabs.map((t) => t.id)]))
  const trackId = (stored: GridTrack | undefined, fallback: string): string => {
    if (stored && !taken.has(stored.id)) {
      taken.add(stored.id)
      return stored.id
    }
    let id = fallback
    for (let n = 2; taken.has(id); n++) id = `${fallback}-${n}`
    taken.add(id)
    return id
  }
  const column: GridTrack = { id: trackId(columns[0], 'grid-col'), weight: DEFAULT_WEIGHT }
  const rowTracks = order.map((_, i): GridTrack => {
    const stored = rows[i]
    const id = trackId(stored, `grid-row-${i + 1}`)
    const collapsed = stored?.collapsed === true ? { collapsed: true } : {}
    return stored?.px != null ? { id, px: stored.px, ...collapsed } : { id, weight: DEFAULT_WEIGHT, ...collapsed }
  })
  return {
    grid: { columns: [column], rows: rowTracks },
    cells: order.map((p, i) => ({ ...p.cell, area: { col: 0, row: i, colSpan: 1, rowSpan: 1 } })),
  }
}
