/**
 * Workspace layouts: three levels — a row of **columns**, each a vertical
 * stack of **rows**, each row one or more **cells** side by side, each cell a
 * strip of widget tabs — plus at most one full-width band above the columns
 * and one below (`top` / `bottom`), each one fixed-height row of cells
 * spanning the workspace. No deeper: a cell in a row never splits again.
 *
 * Every tab carries its own settings, split in two by how they are saved:
 *
 * - `config` — **layout config**: part of the saved layout. Changing it (like
 *   adding, moving or closing anything) makes the working copy differ from
 *   the saved layout, i.e. "unsaved changes".
 * - `viewState` — **view state**: written straight onto the stored layout
 *   (last write wins) and never counts as an unsaved change. Same for a cell's
 *   `activeTabId`, a row's (and a band's) `collapsed`, and for the sizes (a
 *   column's, row's or cell's `weight`, a band's `height`).
 *
 * A layout stores structure only; what a widget shows (list definitions,
 * tasks, the note) lives in its own tables.
 */

import {
  DEFAULT_LOOK_AHEAD,
  DEFAULT_NUMBER_METRIC,
  DEFAULT_RECENT_DAYS,
  DEFAULT_STALE_DAYS,
  DEFAULT_TREND_RANGE,
  NUMBER_METRIC_LABELS,
  type FollowupTabConfig,
  type NumberTabConfig,
  type PeopleTabConfig,
  type RecentTabConfig,
  type StaleTabConfig,
  type TagPicksTabConfig,
  type TagsTabConfig,
  type TrendTabConfig,
} from './glance-widgets'

/**
 * Widget kinds a tab can hold. The ids are stored in layouts: `lens` is the
 * list widget (its old name; renaming it would need a migration). The glance
 * kinds (D25 N) are the retired Dashboard's pieces as widgets of their own
 * (v77 made every Dashboard tab these): `number` (one count), one per section
 * (`followup` … `eisenhowerSummary`), and the morning brief's parts (D25 L):
 * `changes` (What changed), `today` (the Focus tasks and suggestions) and
 * `pulse` (Project pulse).
 */
export type WidgetKind =
  | 'lens' | 'calendar' | 'notes' | 'eisenhower' | 'neglect'
  | GlanceWidgetKind

/** The glance widget kinds (D25 N): a Number, the old Dashboard's sections and the brief's parts, each a widget. */
export type GlanceWidgetKind =
  | 'number' | 'followup' | 'next7' | 'trend' | 'status' | 'people' | 'tags' | 'stale' | 'recent' | 'eisenhowerSummary'
  | 'changes' | 'today' | 'pulse'

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
export type NumberTab = TabOf<'number', NumberTabConfig, NoTabSettings>
export type FollowupTab = TabOf<'followup', FollowupTabConfig, TaskRowsViewState>
export type Next7Tab = TabOf<'next7', NoTabSettings, NoTabSettings>
export type TrendTab = TabOf<'trend', TrendTabConfig, NoTabSettings>
export type StatusTab = TabOf<'status', NoTabSettings, NoTabSettings>
export type PeopleTab = TabOf<'people', PeopleTabConfig, NoTabSettings>
export type TagsTab = TabOf<'tags', TagsTabConfig, NoTabSettings>
export type StaleTab = TabOf<'stale', StaleTabConfig, TaskRowsViewState>
export type RecentTab = TabOf<'recent', RecentTabConfig, TaskRowsViewState>
export type EisenhowerSummaryTab = TabOf<'eisenhowerSummary', NoTabSettings, NoTabSettings>
export type ChangesTab = TabOf<'changes', TagPicksTabConfig, NoTabSettings>
export type TodayTab = TabOf<'today', NoTabSettings, TaskRowsViewState>
export type PulseTab = TabOf<'pulse', TagPicksTabConfig, NoTabSettings>

/** A glance widget's tab (D25 N). */
export type GlanceTab =
  | NumberTab | FollowupTab | Next7Tab | TrendTab | StatusTab | PeopleTab | TagsTab | StaleTab | RecentTab | EisenhowerSummaryTab
  | ChangesTab | TodayTab | PulseTab

export type LayoutTab = LensTab | CalendarTab | NotesTab | EisenhowerTab | NeglectTab | GlanceTab

export type TabOfKind<K extends WidgetKind> = Extract<LayoutTab, { kind: K }>
export type TabConfigOf<K extends WidgetKind> = TabOfKind<K>['config']
export type TabViewStateOf<K extends WidgetKind> = NonNullable<TabOfKind<K>['viewState']>

export interface LayoutCell {
  /** Unique within the layout. */
  id: string
  /** Share of its row's width among the row's cells (any positive number). */
  weight: number
  /**
   * Tabs in strip order. Empty only for a cell just made by "split" that has
   * no widget yet; closing or moving away a cell's last tab removes the cell.
   */
  tabs: LayoutTab[]
  /** View state. Absent (or stale) = the first tab. */
  activeTabId?: string
  /**
   * Layout config: whether the cell shows its tab strip — `true` always,
   * `false` never (headless: the strip slides in on hover or focus);
   * absent = by its widget.
   */
  stripShown?: boolean
}

/**
 * A row of a column: its cells side by side. A row whose last cell goes is
 * removed; collapsing it folds every cell of it to its header.
 */
export interface LayoutRow {
  /** Unique within the layout. */
  id: string
  /** Share of the column's height among its rows (any positive number). */
  weight: number
  /** View state. A collapsed row shows only its cells' headers. */
  collapsed?: boolean
  /** Never empty — a row whose last cell goes is removed. */
  cells: LayoutCell[]
}

export interface LayoutColumn {
  /** Unique within the layout. */
  id: string
  /** Share of the workspace width among the columns (any positive number). */
  weight: number
  /** Never empty — a column whose last row goes is removed. */
  rows: LayoutRow[]
}

/** Which band: the one above the columns or the one below. */
export type BandEdge = 'top' | 'bottom'

export const BAND_EDGES: readonly BandEdge[] = ['top', 'bottom']

/** A new band's height, px (header included). */
export const BAND_DEFAULT_HEIGHT = 160

/**
 * A full-width band above or below the columns: one fixed-height row of
 * cells spanning the workspace. It never holds another row; a band whose
 * last cell goes is removed (the layout's key is then absent).
 */
export interface LayoutBand {
  /** Unique within the layout (columns, rows, cells, tabs and bands share the id space). */
  id: string
  /**
   * Height in px (header included) when expanded: any positive number. It
   * stays the same when the window resizes; it is clamped to the room when
   * drawn, and the stored value is kept.
   */
  height: number
  /** View state. A collapsed band shows only its cells' headers. */
  collapsed?: boolean
  /** Its cells, side by side; never empty. */
  cells: LayoutCell[]
}

/** A row of cells: a column's row, or a band (one row). */
export type LayoutCellRow = LayoutRow | LayoutBand

/**
 * The parts of a layout that Save writes and an edit can leave unsaved: its
 * columns and bands. (The lens is not a layout's: the top bar picks one for
 * every layout — `activeLensId`, a settings row.)
 */
export interface LayoutBody {
  columns: LayoutColumn[]
  top?: LayoutBand
  bottom?: LayoutBand
}

/** A layout's body (`columns` and the bands it has; absent bands stay absent). */
export function layoutBodyOf(layout: LayoutBody): LayoutBody {
  return {
    columns: layout.columns,
    ...(layout.top ? { top: layout.top } : {}),
    ...(layout.bottom ? { bottom: layout.bottom } : {}),
  }
}

/** `layout` with its body replaced by `body` (a band `body` lacks goes). */
export function withLayoutBody<L extends LayoutBody>(layout: L, body: LayoutBody): L {
  const next = { ...layout, columns: body.columns }
  for (const edge of BAND_EDGES) {
    const band = body[edge]
    if (band) next[edge] = band
    else delete next[edge]
  }
  return next
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
  columns: LayoutColumn[]
  /** The band above the columns; absent = none. */
  top?: LayoutBand
  /** The band below the columns; absent = none. */
  bottom?: LayoutBand
  createdAt: Date
  /** Last time the layout was saved. View-state writes don't touch it. */
  modifiedAt: Date
  /** Last time the layout was opened; picks the next layout after a delete. */
  lastUsedAt?: Date
  /**
   * View state (a phone): the page the phone workspace last showed — a
   * column's or a band's id; absent, or an id the layout no longer has,
   * = the first page.
   */
  activeColumnId?: string
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

/** Default weight of a new column / row / cell. */
export const DEFAULT_WEIGHT = 1

/** Default calendar date types: both. */
export const DEFAULT_CALENDAR_DATE_TYPES: CalendarDateTypes = { due: true, followup: true }

/** Optional per-kind starting values for a new tab. */
export interface TabSeed {
  /** The list a new list tab shows. */
  listDefinitionId?: number
  /** The tags a new Neglect map colours by (the workspace store passes the `Project: …` tags). */
  neglectTagIds?: readonly number[]
  /** The tags a new What changed or Project pulse reads (the workspace store passes the `Project: …` tags). */
  tagIds?: readonly number[]
}

/** The add-widget menus' groups: the task widgets, and the numbers and charts. */
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
   * A glance widget (a Number, a section, What changed): a cell holding one
   * tab of it is headless unless its `stripShown` says otherwise — its tab
   * strip slides in on hover or focus (`utils/workspace-rows`) — and a row of
   * only glance cells may shrink to `GLANCE_ROW_MIN_PX`.
   */
  glance: boolean
  /**
   * Its content sets its height (a Number): a row whose every cell holds one
   * tab of such a kind fits its content instead of taking a share of the
   * column (`utils/workspace-rows.isFitRow`).
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
  calendar: {
    label: 'Calendar',
    showsList: false,
    group: 'tasks',
    glance: false,
    fitHeight: false,
    newTab: (id) => ({ id, kind: 'calendar', config: { dateTypes: { ...DEFAULT_CALENDAR_DATE_TYPES } } }),
  },
  notes: { label: 'Notes', showsList: false, group: 'tasks', glance: false, fitHeight: false, newTab: (id) => ({ id, kind: 'notes', config: {} }) },
  eisenhower: {
    label: 'Eisenhower',
    showsList: false,
    group: 'tasks',
    glance: false,
    fitHeight: false,
    newTab: (id) => ({ id, kind: 'eisenhower', config: {} }),
  },
  neglect: {
    label: 'Neglect map',
    showsList: false,
    group: 'tasks',
    glance: false,
    fitHeight: false,
    newTab: (id, seed) => ({ id, kind: 'neglect', config: defaultNeglectConfig(seed.neglectTagIds) }),
  },
  number: glanceSpec('Number', (id) => ({ id, kind: 'number', config: { metric: DEFAULT_NUMBER_METRIC } }), true),
  followup: glanceSpec('Needs follow-up', (id) => ({ id, kind: 'followup', config: { lookAhead: DEFAULT_LOOK_AHEAD } })),
  next7: glanceSpec('Next 7 days', (id) => ({ id, kind: 'next7', config: {} })),
  trend: glanceSpec('Created vs completed', (id) => ({ id, kind: 'trend', config: { range: DEFAULT_TREND_RANGE } })),
  status: glanceSpec('Status', (id) => ({ id, kind: 'status', config: {} })),
  people: glanceSpec('People', (id) => ({ id, kind: 'people', config: { showUnassigned: true } })),
  tags: glanceSpec('Tags', (id) => ({ id, kind: 'tags', config: { showUntagged: true } })),
  stale: glanceSpec('Stale tasks', (id) => ({ id, kind: 'stale', config: { staleDays: DEFAULT_STALE_DAYS } })),
  recent: glanceSpec('Recently completed', (id) => ({ id, kind: 'recent', config: { recentDays: DEFAULT_RECENT_DAYS } })),
  eisenhowerSummary: glanceSpec('Eisenhower summary', (id) => ({ id, kind: 'eisenhowerSummary', config: {} })),
  changes: glanceSpec('What changed', (id, seed) => ({ id, kind: 'changes', config: { tagIds: [...(seed.tagIds ?? [])] } })),
  today: glanceSpec('Today', (id) => ({ id, kind: 'today', config: {} })),
  pulse: glanceSpec('Project pulse', (id, seed) => ({ id, kind: 'pulse', config: { tagIds: [...(seed.tagIds ?? [])] } })),
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
 * A non-list tab's title: a Number's is its metric (`Overdue`), every
 * other kind's its kind's name.
 */
export function kindTabTitle(tab: LayoutTab): string {
  if (tab.kind === 'number') return NUMBER_METRIC_LABELS[tab.config.metric] ?? widgetKindLabel(tab.kind)
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
