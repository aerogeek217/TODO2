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
 *   `activeTabId`, a row track's `collapsed`, and for the sizes (a track's
 *   `weight` or `px`).
 *
 * A layout stores structure only; what a widget shows (list definitions,
 * tasks, the note) lives in its own tables.
 */

import { emptyPredicate } from './filter-predicate'
import {
  DEFAULT_TREND_RANGE,
  newNumberConfig,
  type NumberConfig,
  type PeopleTabConfig,
  type TagPicksTabConfig,
  type TagsTabConfig,
  type TrendTabConfig,
} from './glance-widgets'

/**
 * Widget kinds a tab can hold. The ids are stored in layouts: `lens` is the
 * list widget (its old name; renaming it would need a migration). The glance
 * kinds (D25 N) are the retired Dashboard's pieces as widgets of their own
 * (v77 made every Dashboard tab these): `number` (one count), the charts
 * (`trend`, `status`, `people`, `tags`) and `pulse` (Project pulse). v78
 * (D26 P4) retired Needs follow-up, Next 7 days, Stale tasks, Recently
 * completed, What changed and Today, and made the Eisenhower summary the
 * Eisenhower's small face.
 */
export type WidgetKind =
  | 'lens' | 'calendar' | 'notes' | 'eisenhower' | 'neglect'
  | GlanceWidgetKind

/** The glance widget kinds (D25 N): a Number, the charts and Project pulse, each a widget. */
export type GlanceWidgetKind = 'number' | 'trend' | 'status' | 'people' | 'tags' | 'pulse'

export type CalendarView = 'week' | 'month'

/** Max absolute calendar offset (weeks in week view, months in month view). */
export const CALENDAR_OFFSET_MAX = 104

export function clampCalendarOffset(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.max(-CALENDAR_OFFSET_MAX, Math.min(CALENDAR_OFFSET_MAX, Math.trunc(n)))
}

/** Which task dates a calendar shows (both off = an empty calendar that takes no drops). */
export interface CalendarDateTypes {
  due: boolean
  followup: boolean
}

/** One task date a calendar can show: the due date or the next follow-up. */
export type CalendarDateType = keyof CalendarDateTypes

/** `types` with `type` switched on / off (the last one may go off too). */
export function toggleCalendarDateType(types: CalendarDateTypes, type: CalendarDateType): CalendarDateTypes {
  return { ...types, [type]: !types[type] }
}

export interface LensTabConfig {
  /** The list definition shown; absent = not picked yet. */
  listDefinitionId?: number
}

export interface CalendarTabConfig {
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

/**
 * The four Eisenhower quadrants, by (urgent, important): Do (both),
 * Schedule (important only), Delegate (urgent only), Drop (neither).
 */
export type EisenhowerQuadrant = 'do' | 'schedule' | 'delegate' | 'drop'

/** Quadrants in display order (also the stacked layout's order). */
export const EISENHOWER_QUADRANTS: readonly EisenhowerQuadrant[] = ['do', 'schedule', 'delegate', 'drop']

export function isEisenhowerQuadrant(v: unknown): v is EisenhowerQuadrant {
  return typeof v === 'string' && (EISENHOWER_QUADRANTS as readonly string[]).includes(v)
}

/** The largest stored task-row details width, px (`TaskRowsViewState.detailsWidth`). */
export const DETAILS_WIDTH_MAX = 4000

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

/**
 * A stored zoom as a level: a level, or `strips` — a level once, a bar per
 * task, removed — as `lines`, the nearest; `undefined` for anything else.
 */
export function readListZoom(v: unknown): ListZoom | undefined {
  if (isListZoom(v)) return v
  return v === 'strips' ? 'lines' : undefined
}

/** A list tab's view state: the rows' details width and its zoom. */
export interface ListTabViewState extends TaskRowsViewState {
  /**
   * The tab's zoom (D25 C + I1), saved at once like the details width;
   * absent = Settings › Appearance › Default list zoom.
   */
  zoom?: ListZoom
}

/**
 * An Eisenhower tab has no settings of its own: its panes and its source are
 * app-wide settings (`models/eisenhower-settings`).
 */
export type EisenhowerTabConfig = NoTabSettings

export interface EisenhowerTabViewState extends TaskRowsViewState {
  /** Sections collapsed in the stacked (narrow) layout. */
  collapsed?: EisenhowerQuadrant[]
}

/** Config / view state of a kind that has none. */
export type NoTabSettings = Record<string, never>

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
export const NEGLECT_UNTOUCHED_MAX = 59

/** A threshold the tab keeps: a whole number of days, 1 – `NEGLECT_UNTOUCHED_MAX`. */
export function isNeglectUntouchedDays(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= NEGLECT_UNTOUCHED_MAX
}

/** A new Neglect map's config: colour by `tagIds` (the `Project: …` tags, which the caller picks), 14 days. */
export function defaultNeglectConfig(tagIds: readonly number[] = []): NeglectTabConfig {
  return { colourBy: { kind: 'tags', tagIds: [...tagIds] }, untouchedDays: DEFAULT_NEGLECT_UNTOUCHED_DAYS }
}

interface TabOf<K extends WidgetKind, C, V> {
  /** Unique within the layout. */
  id: string
  kind: K
  config: C
  viewState?: V
}

/** A list tab's view state: the rows' details width and its zoom (its prompt picks are temporary, not saved). */
export type LensTab = TabOf<'lens', LensTabConfig, ListTabViewState>
export type CalendarTab = TabOf<'calendar', CalendarTabConfig, CalendarTabViewState>
export type NotesTab = TabOf<'notes', NoTabSettings, NoTabSettings>
export type EisenhowerTab = TabOf<'eisenhower', EisenhowerTabConfig, EisenhowerTabViewState>
export type NeglectTab = TabOf<'neglect', NeglectTabConfig, NoTabSettings>
export type NumberTab = TabOf<'number', NumberConfig, NoTabSettings>
export type TrendTab = TabOf<'trend', TrendTabConfig, NoTabSettings>
export type StatusTab = TabOf<'status', NoTabSettings, NoTabSettings>
export type PeopleTab = TabOf<'people', PeopleTabConfig, NoTabSettings>
export type TagsTab = TabOf<'tags', TagsTabConfig, NoTabSettings>
export type PulseTab = TabOf<'pulse', TagPicksTabConfig, NoTabSettings>

/** A glance widget's tab (D25 N). */
export type GlanceTab = NumberTab | TrendTab | StatusTab | PeopleTab | TagsTab | PulseTab

export type LayoutTab = LensTab | CalendarTab | NotesTab | EisenhowerTab | NeglectTab | GlanceTab

export type TabOfKind<K extends WidgetKind> = Extract<LayoutTab, { kind: K }>
export type TabConfigOf<K extends WidgetKind> = TabOfKind<K>['config']
export type TabViewStateOf<K extends WidgetKind> = NonNullable<TabOfKind<K>['viewState']>

/**
 * A grid track: a column (its share of the width) or a row (its share of
 * the height) of the layout's table. A track with `px` keeps that size in
 * pixels (a former band's height); any other is weighted by `weight`. A
 * row track also fits its content when the cells lying only in it all hold
 * one Number each — derived (`utils/workspace-rows.isFitTrack`), never
 * stored; its weight then counts again once it stops fitting.
 */
export interface GridTrack {
  /** Unique within the layout (tracks, cells and tabs share the id space). */
  id: string
  /** Its share of the axis among the weighted tracks (any positive number); absent on a `px` track. */
  weight?: number
  /** A fixed size in px (header included); the track is then not weighted. */
  px?: number
  /**
   * View state, row tracks only: collapsed — the cells lying only in it
   * show their headers, and a cell spanning through it gets shorter.
   */
  collapsed?: boolean
}

/** The layout's grid: its column tracks left to right and its row tracks top to bottom. */
export interface LayoutGrid {
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
 * An empty layout has no tracks and no cells. (The lens is not a layout's:
 * the top bar picks one for every layout — `activeLensId`, a settings row.)
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
   * the Edit layout dialog and saved at once, as the name is.
   */
  hue?: string
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

/**
 * The id of a new layout while it isn't stored yet (stored ids start at 1):
 * only an unsaved new layout an older build kept in the browser opens this
 * way (New layout stores the layout at once); saving it gives it a real id.
 */
export const UNSAVED_LAYOUT_ID = 0

/** Default weight of a new track (v78 scales each axis's weights to sum to 1000). */
export const DEFAULT_WEIGHT = 1000

/** Default calendar date types: both. */
export const DEFAULT_CALENDAR_DATE_TYPES: CalendarDateTypes = { due: true, followup: true }

/** Optional per-kind starting values for a new tab. */
export interface TabSeed {
  /** The list a new list tab shows. */
  listDefinitionId?: number
  /** The tags a new Neglect map colours by (the workspace store passes the `Project: …` tags). */
  neglectTagIds?: readonly number[]
  /** The tags a new Project pulse reads (the workspace store passes the `Project: …` tags). */
  tagIds?: readonly number[]
}

/**
 * The add-widget menus' groups: the task widgets (List, Notes), and the
 * numbers and charts (every other kind — the Calendar, the Eisenhower and
 * the Neglect map among them, D26; the grouping is the menus' only).
 */
export type WidgetKindGroup = 'tasks' | 'glance'

/** The groups in menu order, with their headings. */
export const WIDGET_KIND_GROUPS: ReadonlyArray<{ group: WidgetKindGroup; label: string }> = [
  { group: 'tasks', label: 'Tasks' },
  { group: 'glance', label: 'Numbers & charts' },
]

/** What the app knows about one widget kind. */
export interface WidgetKindSpec<K extends WidgetKind> {
  /** Its name in menus, the add-widget tiles and tab titles. */
  label: string
  /** A new tab of this kind shows a list (one of the layout's), picked before the tab is added. */
  showsList: boolean
  /** Its group in the add-widget menus. */
  group: WidgetKindGroup
  /**
   * A glance widget (a Number, a section, Project pulse): a cell holding one
   * tab of it is headless — its tab strip slides in on hover or focus
   * (`utils/workspace-rows`) — and a track of only glance cells may shrink
   * to `GLANCE_ROW_MIN_PX`.
   */
  glance: boolean
  /**
   * Its content sets its height (a Number): a row track whose cells lying
   * only in it each hold one tab of such a kind fits its content instead of
   * taking a share of the height (`utils/workspace-rows.isFitTrack`).
   */
  fitHeight: boolean
  /** A new tab of this kind, with its default config. */
  newTab: (id: string, seed: TabSeed) => TabOfKind<K>
}

/** A glance kind's spec: in the Numbers & charts group, headless when alone in its cell. */
function glanceSpec<K extends GlanceWidgetKind>(label: string, newTab: (id: string, seed: TabSeed) => TabOfKind<K>, fitHeight = false): WidgetKindSpec<K> {
  return { label, showsList: false, group: 'glance', glance: true, fitHeight, newTab }
}

/**
 * The widget kinds, in menu order: the one table every kind list, label and
 * new-tab default derives from (`WIDGET_KINDS`, `isWidgetKind` — which the
 * layout import check uses —, `createTab`, the menus).
 */
export const WIDGET_KIND_SPECS: { readonly [K in WidgetKind]: WidgetKindSpec<K> } = {
  lens: {
    label: 'List',
    showsList: true,
    group: 'tasks',
    glance: false,
    fitHeight: false,
    newTab: (id, seed) => ({ id, kind: 'lens', config: seed.listDefinitionId != null ? { listDefinitionId: seed.listDefinitionId } : {} }),
  },
  notes: { label: 'Notes', showsList: false, group: 'tasks', glance: false, fitHeight: false, newTab: (id) => ({ id, kind: 'notes', config: {} }) },
  number: glanceSpec('Number', (id) => ({ id, kind: 'number', config: newNumberConfig(emptyPredicate()) }), true),
  trend: glanceSpec('Created vs completed', (id) => ({ id, kind: 'trend', config: { range: DEFAULT_TREND_RANGE } })),
  status: glanceSpec('Status', (id) => ({ id, kind: 'status', config: {} })),
  people: glanceSpec('People', (id) => ({ id, kind: 'people', config: { showUnassigned: true } })),
  tags: glanceSpec('Tags', (id) => ({ id, kind: 'tags', config: { showUntagged: true } })),
  pulse: glanceSpec('Project pulse', (id, seed) => ({ id, kind: 'pulse', config: { tagIds: [...(seed.tagIds ?? [])] } })),
  // Calendar, Eisenhower and Neglect map: in Numbers & charts (D26), but whole widgets, not glance ones.
  calendar: {
    label: 'Calendar',
    showsList: false,
    group: 'glance',
    glance: false,
    fitHeight: false,
    newTab: (id) => ({ id, kind: 'calendar', config: { dateTypes: { ...DEFAULT_CALENDAR_DATE_TYPES } } }),
  },
  eisenhower: {
    label: 'Eisenhower',
    showsList: false,
    group: 'glance',
    glance: false,
    fitHeight: false,
    newTab: (id) => ({ id, kind: 'eisenhower', config: {} }),
  },
  neglect: {
    label: 'Neglect map',
    showsList: false,
    group: 'glance',
    glance: false,
    fitHeight: false,
    newTab: (id, seed) => ({ id, kind: 'neglect', config: defaultNeglectConfig(seed.neglectTagIds) }),
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

/**
 * A non-list tab's title: a Number's is its name (`Late on Atlas`; a blank
 * one reads `Number`), every other kind's its kind's name.
 */
export function kindTabTitle(tab: LayoutTab): string {
  if (tab.kind === 'number') return tab.config.name.trim() || widgetKindLabel(tab.kind)
  return widgetKindLabel(tab.kind)
}

/** A new tab of `kind` with that kind's default config. */
export function createTab<K extends WidgetKind>(kind: K, id: string, seed: TabSeed = {}): TabOfKind<K> {
  return WIDGET_KIND_SPECS[kind].newTab(id, seed)
}

/**
 * The list a tab shows — a list tab's own list; an Eisenhower tab shows
 * the Eisenhower's own list, `eisenhowerListId` (`null` until it is
 * loaded) —, else `undefined`. A tab with a list counts as a widget showing
 * that list (its unsaved edits, the last-widget prompt).
 */
export function tabListId(tab: LayoutTab, eisenhowerListId: number | null): number | undefined {
  if (tab.kind === 'lens') return tab.config.listDefinitionId
  return tab.kind === 'eisenhower' ? (eisenhowerListId ?? undefined) : undefined
}

/** A cell's active tab: `activeTabId`, else the first tab; `undefined` for an empty cell. */
export function getActiveTab(cell: Pick<LayoutCell, 'tabs' | 'activeTabId'>): LayoutTab | undefined {
  return cell.tabs.find((t) => t.id === cell.activeTabId) ?? cell.tabs[0]
}
