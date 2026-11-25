/**
 * Workspace layouts: one level — a **table**. Grid lines run across and
 * down (`grid.columns` and `grid.rows`, each a list of tracks), and each
 * **cell** covers a rectangle of tracks (`area`) and holds a strip of widget
 * tabs. A full-height column is a cell spanning every row; a strip is a
 * cell spanning every column. Nothing nests. The cells tile the grid
 * exactly, and every grid line is the edge of some cell
 * (`utils/workspace-grid`: the queries, `normalizeGrid`, `validateTiling`).
 *
 * Every tab carries its own settings, split in two by how they are saved:
 *
 * - `config` — **layout config**: part of the saved layout. Changing it (like
 *   adding, moving, splitting or closing anything — any change of the
 *   tracks' ids or the cells' areas) makes the working copy differ from the
 *   saved layout, i.e. "unsaved changes".
 * - `viewState` — **view state**: written straight onto the stored layout
 *   (last write wins) and never counts as an unsaved change. Same for a cell's
 *   `activeTabId`, a track's `collapsed`, and for the sizes (a track's
 *   `weight` or `px`).
 *
 * A layout stores structure only; what a widget shows (list definitions,
 * tasks, the note) lives in its own tables.
 */

import { emptyPredicate, type TodoPredicate } from './filter-predicate'
import {
  DEFAULT_TREND_NAME,
  DEFAULT_TREND_RANGE,
  DEFAULT_TREND_SHOW,
  newNumberItem,
  trendName,
  type NumberItem,
  type TrendTabConfig,
} from './glance-widgets'
import {
  CHART_NAME_MAX,
  newBreakdownConfig,
  type BreakdownConfig,
  type BreakdownViewState,
} from './chart-widgets'
import type { ReviewSort } from './review'
import type { IconValue, LineIconKey } from './icon'

/**
 * Widget kinds a tab can hold. The ids are stored in layouts: `lens` is the
 * list widget (its old name; renaming it would need a migration). The glance
 * kinds (D25 N) are the retired Dashboard's pieces as widgets of their own
 * (v77 made every Dashboard tab these): `numbers` (one count or several,
 * side by side — v90 made each Number tab and each strip of them one), the charts
 * (`trend`, the Breakdown — D26 P8). v78
 * (D26 P4) retired Needs follow-up, Next 7 days, Stale tasks, Recently
 * completed, What changed and Today, and made the Eisenhower summary the
 * Eisenhower's small face; P8 made People, Tags and Status Breakdowns. The
 * Status flow chart (P8), the Tag map and the Eisenhower were removed after v78 shipped;
 * v79 dropped every saved one. `review` (item 12) is the Review widget.
 * `clusters` (Work clusters) is a task map, a whole widget like the
 * Neglect map. `planner` is the Planner: today and the week ahead, a task
 * on its planned day, else the day its follow-up or due date puts it.
 * `shortcuts` is the List board (its stored kind keeps the widget's first
 * name, as `lens` does): a tile per list — the lists picked, of any layout,
 * or every list tab of the open layout. v88 made every List wall
 * (`listwall`) a List board showing its layout's lists.
 */
export type WidgetKind =
  | 'lens' | 'calendar' | 'notes' | 'review' | 'planner' | 'shortcuts' | 'neglect' | 'clusters'
  | GlanceWidgetKind

/**
 * The glance widget kinds (D25 N): the Numbers and the charts, each a
 * widget. The Breakdown (D26 P8) is the chart widget: a filter, then what
 * it is split by, with a name and an editor.
 */
export type GlanceWidgetKind = 'numbers' | 'breakdown' | 'trend'

export type CalendarView = 'week' | 'month'

/** Max absolute calendar offset (weeks in week view, months in month view). */
const CALENDAR_OFFSET_MAX = 104

export function clampCalendarOffset(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.max(-CALENDAR_OFFSET_MAX, Math.min(CALENDAR_OFFSET_MAX, Math.trunc(n)))
}

/**
 * Which task dates a calendar shows (all off = an empty calendar that takes
 * no drops). `plan` is the planned day (`TodoItem.doDate`); a calendar
 * stored without it reads `plan: true` (`data/layout-shape`).
 */
export interface CalendarDateTypes {
  due: boolean
  followup: boolean
  plan: boolean
}

/** One task date a calendar can show: the due date, the next follow-up or the planned day. */
export type CalendarDateType = keyof CalendarDateTypes

/** The calendar date types in the toolbar's order. */
export const CALENDAR_DATE_TYPES: readonly CalendarDateType[] = ['due', 'followup', 'plan']

/** The date types `types` shows, in the toolbar's order. */
export function shownCalendarDateTypes(types: CalendarDateTypes): CalendarDateType[] {
  return CALENDAR_DATE_TYPES.filter((t) => types[t])
}

/** `types` with `type` switched on / off (the last one may go off too). */
export function toggleCalendarDateType(types: CalendarDateTypes, type: CalendarDateType): CalendarDateTypes {
  return { ...types, [type]: !types[type] }
}

export interface ListTabConfig {
  /** The list definition shown; absent = not picked yet. */
  listDefinitionId?: number
}

interface CalendarTabConfig {
  dateTypes: CalendarDateTypes
}

export interface CalendarTabViewState {
  view?: CalendarView
  /** Weeks (week view) or months (month view) from the current one. */
  offset?: number
  /**
   * The month shows a bar per entry (its title); absent / false = the heat
   * map (a day tinted by its count). The week shows bars either way.
   */
  titles?: boolean
}

/** The largest stored task-row details width, px (`TaskRowsViewState.detailsWidth`). */
const DETAILS_WIDTH_MAX = 4000

/**
 * A stored details width as it is kept: a finite number ≥ 0, rounded and
 * capped at `DETAILS_WIDTH_MAX` (a very wide list's divider can store more);
 * else none.
 */
export function pickDetailsWidth(v: unknown): number | undefined {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return undefined
  return Math.min(DETAILS_WIDTH_MAX, Math.round(v))
}

/** View state of a tab that shows task rows. */
export interface TaskRowsViewState {
  /**
   * Width of the rows' details columns (notes … status), px, set by the divider
   * between the title and the details; absent = the default split. Clamped
   * to the rows' room when drawn; the stored value is kept.
   */
  detailsWidth?: number
}

/**
 * How a list tab draws its tasks (D25 C + I1), most detail first:
 * `stacked` — the title on its own line (up to two), the details on a line
 * under it; `rows` — one row per task, its cells in columns (the default);
 * `lines` — 15px lines, a state tick and the title only.
 */
export type ListZoom = 'stacked' | 'rows' | 'lines'

/** The zoom levels, most detail first: zooming out steps right, zooming in steps left. */
export const LIST_ZOOMS: readonly ListZoom[] = ['stacked', 'rows', 'lines']

export function isListZoom(v: unknown): v is ListZoom {
  return typeof v === 'string' && (LIST_ZOOMS as readonly string[]).includes(v)
}

/** A list tab's view state: the rows' details width and its zoom. */
export interface ListTabViewState extends TaskRowsViewState {
  /**
   * The tab's zoom (D25 C + I1), saved at once like the details width;
   * absent = Settings › Appearance › Default list zoom.
   */
  zoom?: ListZoom
}

/** Config / view state of a kind that has none. */
type NoTabSettings = Record<string, never>

/**
 * A Review widget's settings: none (widget feedback 2A). What it reviews is
 * a filter typed into its field, temporary (`list-widget-store.reviewFilters`),
 * never saved. (Board BM's kind `by` and board BK's `pick`, which earlier
 * builds stored, were removed by schema v79.)
 */
type ReviewTabConfig = NoTabSettings

/**
 * A Review widget's view state (saved at once): the rail's sort (absent:
 * Priority, `DEFAULT_REVIEW_WIDGET_SORT`). Where it stands — the current
 * task, the – marks — lasts as long as its filter (`review-session`) and is
 * never saved.
 */
export interface ReviewTabViewState {
  sort?: ReviewSort
}

/**
 * A Planner's settings (layout config): `unplanned`, the filter an open task
 * with no day and no plan matches to join the Unplanned tray. Absent: Focus
 * (`plannerUnplannedFilter`), so a Planner that never set one holds what it
 * always did; an empty predicate: nothing joins, Unplanned stays empty. It
 * decides Unplanned only, never which days a task sits on.
 */
export interface PlannerTabConfig {
  unplanned?: TodoPredicate
}

/** The Unplanned filter a Planner reads: its own, else Focus (`/focus`). */
export function plannerUnplannedFilter(config: PlannerTabConfig): TodoPredicate {
  return config.unplanned ?? { ...emptyPredicate(), markers: [{ values: ['focus'] }] }
}

/**
 * A Planner's view state (saved at once, no undo step): its hand order —
 * task `uid`s, one sequence for the whole widget, each group listing its
 * tasks in that order and the rest after them (`utils/planner.plannerOrder`).
 * Its window is never saved (`stores/planner-store`). In a tall, narrow
 * cell (the portrait layout, board R1) the trays dock under the days:
 * `dockShare` is the dock's share of the height (absent: the default,
 * `PLANNER_DOCK_SHARE`), `dockFolded` folds it to one bar.
 */
export interface PlannerTabViewState {
  order?: string[]
  dockShare?: number
  dockFolded?: true
}

/** The trays dock's share of a portrait Planner's height when the tab stores none. */
export const PLANNER_DOCK_SHARE = 0.38

/** The least and most a stored `dockShare` may be (the widget keeps each side's minimum height on top of these). */
export const PLANNER_DOCK_SHARE_MIN = 0.1
export const PLANNER_DOCK_SHARE_MAX = 0.9

/** The most `uid`s a Planner's hand order keeps (the layout repair cuts a longer one). */
export const PLANNER_ORDER_MAX = 1000

/** Which lists a List board shows: the ones picked (`lists`), or every list tab of the open layout. */
export type ShortcutsSource = 'picked' | 'layout'

/** A List board's sources, in its menu's order. */
export const SHORTCUTS_SOURCES: readonly ShortcutsSource[] = ['picked', 'layout']

/** A stored List board source this build knows. */
export function isShortcutsSource(v: unknown): v is ShortcutsSource {
  return v === 'picked' || v === 'layout'
}

/**
 * A List board's settings (layout config): `source`, which lists it shows
 * (absent = `picked`), and `lists`, the ids of the lists picked, in order —
 * lists of any layout, kept while it shows the layout's. Never under the key
 * `listDefinitionId`, which names a layout's own list
 * (`layout-repository.storedListRefs`). A list deleted since is skipped
 * when drawn, not repaired away.
 */
export interface ShortcutsTabConfig {
  source?: ShortcutsSource
  lists?: number[]
}

/**
 * A Numbers widget's settings (layout config): its Numbers in order, at
 * least one. Each keeps its own id, config and icon (`NumberItem`); the
 * widget's own name and icon are the tab's.
 */
interface NumbersTabConfig {
  items: NumberItem[]
}

/** The most lists a List board keeps picked (the layout repair cuts a longer one). */
export const SHORTCUTS_LISTS_MAX = 200

const SHORTCUT_LIST_TAB_PREFIX = 'shortcut-list-'

/**
 * The tab id the widget popup shows a shortcut's list under: in no layout
 * (tab ids repeat across duplicated layouts), so its prompt picks are its
 * own; a tile's capsule and peek read the same picks.
 */
export function shortcutListTabId(listDefinitionId: number): string {
  return `${SHORTCUT_LIST_TAB_PREFIX}${listDefinitionId}`
}

/**
 * What colours a Neglect map's dots: the picked tags (a task with several
 * takes the first of the picks it has, in pick order), the task's first
 * person, or nothing (every dot neutral).
 */
export type NeglectColourBy =
  | { kind: 'tags'; tagIds: number[] }
  | { kind: 'people' }
  | { kind: 'none' }

/** A Neglect map tab's settings (layout config, saved with the layout). */
export interface NeglectTabConfig {
  colourBy: NeglectColourBy
  /** A task untouched (`modifiedAt`) this many days or more counts as neglected. */
  untouchedDays: number
}

/** Untouched after this many days, by default. */
export const DEFAULT_NEGLECT_UNTOUCHED_DAYS = 14

/** The thresholds the tab menu offers. */
export const NEGLECT_UNTOUCHED_CHOICES: readonly number[] = [7, 14, 21, 30, 45]

/** The largest threshold kept: below the map's 60-day cap, so its line stays on the plot. */
const NEGLECT_UNTOUCHED_MAX = 59

/** A threshold the tab keeps: a whole number of days, 1 – `NEGLECT_UNTOUCHED_MAX`. */
export function isNeglectUntouchedDays(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= NEGLECT_UNTOUCHED_MAX
}

/** A new Neglect map's config: colour by `tagIds` (the `Project: …` tags, which the caller picks), 14 days. */
function defaultNeglectConfig(tagIds: readonly number[] = []): NeglectTabConfig {
  return { colourBy: { kind: 'tags', tagIds: [...tagIds] }, untouchedDays: DEFAULT_NEGLECT_UNTOUCHED_DAYS }
}

interface TabOf<K extends WidgetKind, C, V> {
  /** Unique within the layout. */
  id: string
  kind: K
  config: C
  viewState?: V
  /**
   * Layout config (items 11, 14): the tab's own name, for a kind without a
   * name of its own (`tabOwnsName` false — Calendar, Notes, Review, the Planner, the List board,
   * the Numbers, the Neglect map, Work clusters); it replaces the kind's label wherever the
   * tab is named. Absent or blank = the kind's label. A kind with a name of
   * its own (a list's or a chart's) never reads it.
   */
  name?: string
  /**
   * Layout config: the tab's picked icon. Absent = never picked — the strip
   * shows its kind's icon (J1) and its top line none (J2); `{ kind: 'none' }`
   * = No icon, picked.
   */
  icon?: IconValue
}

/** A list tab's view state: the rows' details width and its zoom (its prompt picks are temporary, not saved). */
export type ListTab = TabOf<'lens', ListTabConfig, ListTabViewState>
export type CalendarTab = TabOf<'calendar', CalendarTabConfig, CalendarTabViewState>
type NotesTab = TabOf<'notes', NoTabSettings, NoTabSettings>
export type ReviewTab = TabOf<'review', ReviewTabConfig, ReviewTabViewState>
export type PlannerTab = TabOf<'planner', PlannerTabConfig, PlannerTabViewState>
export type ShortcutsTab = TabOf<'shortcuts', ShortcutsTabConfig, NoTabSettings>
export type NeglectTab = TabOf<'neglect', NeglectTabConfig, NoTabSettings>
export type ClustersTab = TabOf<'clusters', NoTabSettings, NoTabSettings>
export type NumbersTab = TabOf<'numbers', NumbersTabConfig, NoTabSettings>
export type TrendTab = TabOf<'trend', TrendTabConfig, NoTabSettings>
// ── D26 P8: the chart widget ──
export type BreakdownTab = TabOf<'breakdown', BreakdownConfig, BreakdownViewState>

/** A glance widget's tab (D25 N). */
export type GlanceTab = NumbersTab | TrendTab | BreakdownTab

export type LayoutTab = ListTab | CalendarTab | NotesTab | ReviewTab | PlannerTab | ShortcutsTab | NeglectTab | ClustersTab | GlanceTab

type TabOfKind<K extends WidgetKind> = Extract<LayoutTab, { kind: K }>
export type TabConfigOf<K extends WidgetKind> = TabOfKind<K>['config']
export type TabViewStateOf<K extends WidgetKind> = NonNullable<TabOfKind<K>['viewState']>

/**
 * A grid track: a column (its share of the width) or a row (its share of
 * the height) of the layout's table. A track with `px` keeps that size in
 * pixels (a former band's height); any other is weighted by `weight`. A
 * row track also fits its content when the cells lying only in it all hold
 * only Numbers widgets — derived (`utils/workspace-rows.isFitTrack`), never
 * stored; its weight then counts again once it stops fitting.
 */
export interface GridTrack {
  /** Unique within the layout (tracks, cells, tabs and a Numbers widget's items share the id space). */
  id: string
  /** Its share of the axis among the weighted tracks (any positive number); absent on a `px` track. */
  weight?: number
  /** A fixed size in px (header included); the track is then not weighted. */
  px?: number
  /**
   * View state, row tracks only: the height (px) a divider gave a
   * Numbers-only row (`workspace-rows.isFitTrack`). It applies only while
   * the row is one and has no `px`; otherwise it is ignored and the track
   * is weighted by its own `weight`, which it never replaces. Absent: the
   * row fits its content. A split's halves don't inherit it.
   */
  fitPx?: number
  /**
   * View state: collapsed. A row — the cells lying only in it show their
   * headers, and a cell spanning through it gets shorter. A column — it
   * draws as a strip naming the cells lying only in it, and a cell spanning
   * through it gets narrower.
   */
  collapsed?: boolean
}

/** The layout's grid: its column tracks left to right and its row tracks top to bottom. */
interface LayoutGrid {
  columns: GridTrack[]
  rows: GridTrack[]
}

/** Which axis of the grid: its columns (left to right) or its rows (top to bottom). */
export type GridAxis = 'columns' | 'rows'

/** The rectangle of tracks a cell covers, in track indices (`col` / `row` its first; each span ≥ 1). */
export interface CellArea {
  col: number
  row: number
  colSpan: number
  rowSpan: number
}

export interface LayoutCell {
  /** Unique within the layout. */
  id: string
  /** The tracks it covers. Layout structure. */
  area: CellArea
  /**
   * Tabs in strip order. Empty for an "empty cell": one a split just made,
   * or one that closed with no neighbour to take its space.
   */
  tabs: LayoutTab[]
  /** View state. Absent (or stale) = the first tab. */
  activeTabId?: string
}

/**
 * The parts of a layout that Save writes and an edit can leave unsaved: its
 * grid and its cells. The cells tile the grid exactly — no gap, no overlap —
 * and every grid line is the edge of at least one cell (`utils/workspace-grid`).
 * An empty layout has no tracks and no cells.
 */
export interface LayoutBody {
  grid: LayoutGrid
  cells: LayoutCell[]
}

/** The body of an empty layout: no tracks, no cells. */
export function emptyLayoutBody(): LayoutBody {
  return { grid: { columns: [], rows: [] }, cells: [] }
}

/** A layout's body (its `grid` and `cells`, nothing else). */
export function layoutBodyOf(layout: LayoutBody): LayoutBody {
  return { grid: layout.grid, cells: layout.cells }
}

/** `layout` with its body replaced by `body`. */
export function withLayoutBody<L extends LayoutBody>(layout: L, body: LayoutBody): L {
  return { ...layout, grid: body.grid, cells: body.cells }
}

export interface WorkspaceLayout {
  id?: number
  name: string
  /**
   * Position among the layouts (the picker's order, lowest first; ties by
   * creation). Written only when a layout is added (after the others) or
   * the layouts are reordered — never by a layout save.
   */
  sortOrder: number
  /** The table's tracks. */
  grid: LayoutGrid
  /** The cells tiling the grid. */
  cells: LayoutCell[]
  createdAt: Date
  /** Last time the layout was saved. View-state writes don't touch it. */
  modifiedAt: Date
  /** Last time the layout was opened; picks the next layout after a delete. */
  lastUsedAt?: Date
  /**
   * The layout's hue (D19): its active tab, its cell headers and the focus
   * ring inside it take it; absent = the app accent. A preset's name
   * (`HUE_NAMES`) or a hex colour (`utils/layout-hue.isLayoutHue`). Set in
   * the Name, icon and hue dialog and saved at once, as the name is.
   */
  hue?: string
  /**
   * The layout's icon (widget feedback 11, 15; J1): drawn before its name on
   * its tab, in the picker and on the phone. Absent = never picked: the
   * layout glyph (`models/icon.layoutIcon`); `{ kind: 'none' }` = No icon.
   * A line icon and a muted emoji take the hue on the open layout's tab; a
   * color emoji keeps its colors. Set in the Name, icon and hue dialog and saved
   * at once, as the name and the hue are.
   */
  icon?: IconValue
}

/** The six preset layout hues (D19), each a token pair (`--hue-<name>`, dark and light). */
export const HUE_NAMES = ['teal', 'violet', 'blue', 'green', 'amber', 'rose'] as const

export type HueName = (typeof HUE_NAMES)[number]

export function isHueName(v: unknown): v is HueName {
  return typeof v === 'string' && (HUE_NAMES as readonly string[]).includes(v)
}

export type PersistedWorkspaceLayout = WorkspaceLayout & { id: number }

/** Name of the layout created when none exists. */
export const DEFAULT_LAYOUT_NAME = 'Default'

export const LAYOUT_NAME_MAX = 200

/** Default weight of a new track (v78 scales each axis's weights to sum to 1000). */
export const DEFAULT_WEIGHT = 1000

/** Default calendar date types: all three. */
export const DEFAULT_CALENDAR_DATE_TYPES: CalendarDateTypes = { due: true, followup: true, plan: true }

/** Optional per-kind starting values for a new tab. */
export interface TabSeed {
  /** The list a new list tab shows. */
  listDefinitionId?: number
  /** The tags a new Neglect map colours by (the workspace store passes the `Project: …` tags). */
  neglectTagIds?: readonly number[]
  /** A new Breakdown's config over the default (an Add widget preset, D26 P8). */
  breakdown?: Partial<BreakdownConfig>
  /** The id of a new Numbers widget's one Number (the workspace store gives one new to the layout); absent: the tab's id + `-1`. */
  numberItemId?: string
}

/**
 * The add-widget menus' groups: **Tasks** (the widgets that show tasks to
 * work on — List, Calendar, Review, Planner, Notes, List board) and **Insights** (the
 * numbers and charts, and the Neglect map). The grouping is the menus' only:
 * nothing behavioural reads it — the glance minimums, fit rows and the
 * right-click rule read `glance` / `fitHeight`, which the Calendar and the
 * Neglect map don't have, whichever group they are in.
 */
type WidgetKindGroup = 'tasks' | 'insights'

/** The groups in menu order, with their headings. */
export const WIDGET_KIND_GROUPS: ReadonlyArray<{ group: WidgetKindGroup; label: string }> = [
  { group: 'tasks', label: 'Tasks' },
  { group: 'insights', label: 'Insights' },
]

/** What the app knows about one widget kind. */
interface WidgetKindSpec<K extends WidgetKind> {
  /** Its name in menus, the add-widget tiles and tab titles. */
  label: string
  /** Its entry in the menus that add or change a widget, when not `label` (`widgetKindAddLabel`). */
  addLabel?: string
  /** A new tab of this kind shows a list (one of the layout's), picked before the tab is added. */
  showsList: boolean
  /** Its group in the add-widget menus. */
  group: WidgetKindGroup
  /**
   * A glance widget (a Number, a chart): a track of only
   * glance cells may shrink to `GLANCE_ROW_MIN_PX`, a glance cell's width to
   * `GLANCE_CELL_MIN_WIDTH_PX` (`utils/workspace-rows`), and a right-click
   * anywhere on one alone in its cell opens the cell's ⋯ menu.
   */
  glance: boolean
  /**
   * Its content sets its height (the Numbers): a row track whose cells lying
   * only in it hold only tabs of such a kind fits its content instead of
   * taking a share of the height (`utils/workspace-rows.isFitTrack`).
   */
  fitHeight: boolean
  /** A new tab of this kind, with its default config. */
  newTab: (id: string, seed: TabSeed) => TabOfKind<K>
}

/** A glance kind's spec: in the Insights group. */
function glanceSpec<K extends GlanceWidgetKind>(label: string, newTab: (id: string, seed: TabSeed) => TabOfKind<K>, fitHeight = false): WidgetKindSpec<K> {
  return { label, showsList: false, group: 'insights', glance: true, fitHeight, newTab }
}

/** A new Numbers widget: one Number (`seed.numberItemId`, else the tab's id + `-1`) counting every open task. */
function newNumbersTab(id: string, seed: TabSeed): NumbersTab {
  return { id, kind: 'numbers', config: { items: [newNumberItem(seed.numberItemId ?? `${id}-1`, emptyPredicate())] } }
}

/**
 * The widget kinds, in menu order: the one table every kind list, label and
 * new-tab default derives from (`WIDGET_KINDS`, `isWidgetKind` — which the
 * layout import check uses —, `createTab`, the menus).
 */
export const WIDGET_KIND_SPECS: { readonly [K in WidgetKind]: WidgetKindSpec<K> } = {
  // Tasks.
  lens: {
    label: 'List',
    showsList: true,
    group: 'tasks',
    glance: false,
    fitHeight: false,
    newTab: (id, seed) => ({ id, kind: 'lens', config: seed.listDefinitionId != null ? { listDefinitionId: seed.listDefinitionId } : {} }),
  },
  calendar: {
    label: 'Calendar',
    showsList: false,
    group: 'tasks',
    glance: false,
    fitHeight: false,
    newTab: (id) => ({ id, kind: 'calendar', config: { dateTypes: { ...DEFAULT_CALENDAR_DATE_TYPES } } }),
  },
  // Item 12: a review in a cell, nothing to review yet (its field takes a filter).
  review: { label: 'Review', showsList: false, group: 'tasks', glance: false, fitHeight: false, newTab: (id) => ({ id, kind: 'review', config: {} }) },
  // The Planner (2026-11-20): its Unplanned filter (absent: Focus); its hand order is view state.
  planner: { label: 'Planner', showsList: false, group: 'tasks', glance: false, fitHeight: false, newTab: (id) => ({ id, kind: 'planner', config: {} }) },
  notes: { label: 'Notes', showsList: false, group: 'tasks', glance: false, fitHeight: false, newTab: (id) => ({ id, kind: 'notes', config: {} }) },
  // The List board: the lists picked, none yet.
  shortcuts: { label: 'List board', showsList: false, group: 'tasks', glance: false, fitHeight: false, newTab: (id) => ({ id, kind: 'shortcuts', config: {} }) },
  // Insights.
  // The Numbers: added as "Number", a widget of one Number (its + adds more).
  numbers: { ...glanceSpec('Numbers', newNumbersTab, true), addLabel: 'Number' },
  // D26 P8: the chart widget.
  breakdown: glanceSpec('Breakdown', (id, seed) => ({ id, kind: 'breakdown', config: newBreakdownConfig(emptyPredicate(), seed.breakdown) })),
  trend: glanceSpec('Created vs completed', (id) => ({ id, kind: 'trend', config: { range: DEFAULT_TREND_RANGE, name: DEFAULT_TREND_NAME, show: DEFAULT_TREND_SHOW } })),
  // In Insights, but a whole widget, not a glance one (no glance minimums).
  neglect: {
    label: 'Neglect map',
    showsList: false,
    group: 'insights',
    glance: false,
    fitHeight: false,
    newTab: (id, seed) => ({ id, kind: 'neglect', config: defaultNeglectConfig(seed.neglectTagIds) }),
  },
  // A task map: a whole widget, as the Neglect map.
  clusters: {
    label: 'Work clusters',
    showsList: false,
    group: 'insights',
    glance: false,
    fitHeight: false,
    newTab: (id) => ({ id, kind: 'clusters', config: {} }),
  },
}

/** Every widget kind, in menu order. */
export const WIDGET_KINDS = Object.keys(WIDGET_KIND_SPECS) as readonly WidgetKind[]

export function isWidgetKind(v: unknown): v is WidgetKind {
  return typeof v === 'string' && Object.hasOwn(WIDGET_KIND_SPECS, v)
}

/** The label of a tab whose kind this build doesn't know (stored data isn't typed). */
export const UNKNOWN_WIDGET_LABEL = 'Unknown widget'

/** A widget kind's name (`List`, `Calendar`, …; `UNKNOWN_WIDGET_LABEL` for a kind this build doesn't know). */
export function widgetKindLabel(kind: WidgetKind): string {
  return isWidgetKind(kind) ? WIDGET_KIND_SPECS[kind].label : UNKNOWN_WIDGET_LABEL
}

/** A widget kind's entry in the menus that add or change a widget (`Number` for the Numbers; else its label). */
export function widgetKindAddLabel(kind: WidgetKind): string {
  return (isWidgetKind(kind) ? WIDGET_KIND_SPECS[kind].addLabel : undefined) ?? widgetKindLabel(kind)
}

/** The kinds of `group`, in menu order. */
export function widgetKindsOf(group: WidgetKindGroup): WidgetKind[] {
  return WIDGET_KINDS.filter((k) => WIDGET_KIND_SPECS[k].group === group)
}

/** A glance widget kind (`WidgetKindSpec.glance`). */
export function isGlanceKind(kind: WidgetKind): kind is GlanceWidgetKind {
  return isWidgetKind(kind) && WIDGET_KIND_SPECS[kind].glance
}

/** A glance widget's tab. */
export function isGlanceTab(tab: LayoutTab): tab is GlanceTab {
  return isGlanceKind(tab.kind)
}

/** A Breakdown's tab (D26 P8). */
export function isBreakdownTab(tab: LayoutTab): tab is BreakdownTab {
  return tab.kind === 'breakdown'
}

/**
 * Whether a kind has a name of its own, which Name and icon… edits: a
 * list's (its list's name), a chart's and Created vs completed's
 * (`config.name`). Every other kind takes the tab's `name` — the Numbers
 * too (each Number's name is its item's).
 */
export function tabOwnsName(kind: WidgetKind): boolean {
  return kind === 'lens' || kind === 'breakdown' || kind === 'trend'
}

/** The longest tab name kept (as a layout's). */
export const TAB_NAME_MAX = 200

/**
 * The longest name Name and icon… keeps for a tab of `kind`: what the
 * stored shape of the name it writes allows — a chart's and Created vs
 * completed's `config.name` (`CHART_NAME_MAX`), any other kind's tab name
 * (`TAB_NAME_MAX`; a list tab's name is its list's, which has no limit of
 * its own). A Number's own name is its item's (`NUMBER_NAME_MAX`). A
 * longer name would store a layout row the import check refuses.
 */
export function tabNameMax(kind: WidgetKind): number {
  if (kind === 'breakdown' || kind === 'trend') return CHART_NAME_MAX
  return TAB_NAME_MAX
}

/** A Number's title: its name, `Number` while it is blank. */
export function numberTitle(item: Pick<NumberItem, 'name'>): string {
  return item.name.trim() || 'Number'
}

/**
 * A non-list tab's title: a Breakdown's is its name (`Late on Atlas`; a
 * blank one reads `Breakdown`), Created vs completed's its name
 * (`trendName`), a Numbers widget of one Number that Number's
 * (`numberTitle`), every other kind's its tab name (items 11, 14), else
 * its kind's name.
 */
export function kindTabTitle(tab: LayoutTab): string {
  if (isBreakdownTab(tab)) return tab.config.name.trim() || widgetKindLabel(tab.kind)
  if (tab.kind === 'trend') return trendName(tab.config)
  const only = tab.kind === 'numbers' && tab.config.items.length === 1 ? tab.config.items[0] : undefined
  if (only) return numberTitle(only)
  return tab.name?.trim() || widgetKindLabel(tab.kind)
}

/** Each kind's own glyph among the line icons: the icon a new tab of that kind is given (`createTab`). */
export const KIND_LINE_ICON: { readonly [K in WidgetKind]: LineIconKey } = {
  lens: 'list',
  calendar: 'calendar',
  notes: 'notes',
  review: 'review',
  planner: 'planner',
  shortcuts: 'shortcuts',
  numbers: 'number',
  trend: 'chart',
  breakdown: 'bars',
  neglect: 'scatter',
  clusters: 'clusters',
}

/** A kind's own glyph as an icon value: what a new tab of that kind is given. */
export function kindIcon(kind: WidgetKind): IconValue {
  return { kind: 'line', key: KIND_LINE_ICON[kind] }
}

/**
 * The icon a tab shows, wherever it shows one: the one stored on it, else
 * none. There is no default drawn in its place — a new tab is given its
 * kind's glyph (`createTab`), and a tab without one shows none everywhere.
 */
export function tabStripIcon(tab: Pick<LayoutTab, 'icon'>): IconValue {
  return tab.icon ?? NO_ICON
}

const NO_ICON: IconValue = { kind: 'none' }

/**
 * The icon a tab's top line leads with alone in its cell (J2): a picked one,
 * none for a tab never given one (as before icons) or given No icon.
 */
export function tabTopLineIcon(tab: Pick<LayoutTab, 'icon'>): IconValue | undefined {
  return tab.icon && tab.icon.kind !== 'none' ? tab.icon : undefined
}

/** A new tab of `kind` with that kind's default config, given its kind's glyph as its icon. */
export function createTab<K extends WidgetKind>(kind: K, id: string, seed: TabSeed = {}): TabOfKind<K> {
  return { ...WIDGET_KIND_SPECS[kind].newTab(id, seed), icon: kindIcon(kind) }
}

/**
 * The list a tab shows — a list tab's own list —, else `undefined`. A tab
 * with a list counts as a widget showing that list (its unsaved edits, the
 * last-widget prompt).
 */
export function tabListId(tab: LayoutTab): number | undefined {
  return tab.kind === 'lens' ? tab.config.listDefinitionId : undefined
}

/** A cell's active tab: `activeTabId`, else the first tab; `undefined` for an empty cell. */
export function getActiveTab(cell: Pick<LayoutCell, 'tabs' | 'activeTabId'>): LayoutTab | undefined {
  return cell.tabs.find((t) => t.id === cell.activeTabId) ?? cell.tabs[0]
}
