/**
 * Workspace layouts: a row of columns, each a vertical stack of cells, each
 * cell a strip of widget tabs — plus at most one full-width band above the
 * columns and one below (`top` / `bottom`), each a cell spanning the
 * workspace. Two levels only — no recursive splits, no other rows.
 *
 * Every tab carries its own settings, split in two by how they are saved:
 *
 * - `config` — **layout config**: part of the saved layout. Changing it (like
 *   adding, moving, closing or resizing anything) makes the working copy differ
 *   from the saved layout, i.e. "unsaved changes".
 * - `viewState` — **view state**: written straight onto the stored layout
 *   (last write wins) and never counts as an unsaved change. Same for a cell's
 *   (and a band's) `activeTabId` and `collapsed`.
 *
 * A layout stores structure only; what a widget shows (list definitions,
 * tasks, the note) lives in its own tables.
 */

import { defaultDashboardConfig, type DashboardTabConfig } from './dashboard-config'

/**
 * Widget kinds a tab can hold. The ids are stored in layouts: `lens` is the
 * list widget (its old name; renaming it would need a migration).
 */
export type WidgetKind = 'lens' | 'calendar' | 'notes' | 'eisenhower' | 'dashboard'

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

interface TabOf<K extends WidgetKind, C, V> {
  /** Unique within the layout. */
  id: string
  kind: K
  config: C
  viewState?: V
}

/** A list tab's view state: the rows' details width (its prompt picks are temporary, not saved). */
export type LensTab = TabOf<'lens', LensTabConfig, TaskRowsViewState>
export type CalendarTab = TabOf<'calendar', CalendarTabConfig, CalendarTabViewState>
export type NotesTab = TabOf<'notes', NoTabSettings, NoTabSettings>
export type EisenhowerTab = TabOf<'eisenhower', EisenhowerTabConfig, EisenhowerTabViewState>
export type DashboardTab = TabOf<'dashboard', DashboardTabConfig, TaskRowsViewState>

export type LayoutTab = LensTab | CalendarTab | NotesTab | EisenhowerTab | DashboardTab

export type TabOfKind<K extends WidgetKind> = Extract<LayoutTab, { kind: K }>
export type TabConfigOf<K extends WidgetKind> = TabOfKind<K>['config']
export type TabViewStateOf<K extends WidgetKind> = NonNullable<TabOfKind<K>['viewState']>

export interface LayoutCell {
  /** Unique within the layout. */
  id: string
  /** Share of the column's height among its cells (any positive number). */
  weight: number
  /**
   * Tabs in strip order. Empty only for a cell just made by "split" that has
   * no widget yet; closing or moving away a cell's last tab removes the cell.
   */
  tabs: LayoutTab[]
  /** View state. Absent (or stale) = the first tab. */
  activeTabId?: string
  /** View state. Collapsed cells show only their header. */
  collapsed?: boolean
}

export interface LayoutColumn {
  /** Unique within the layout. */
  id: string
  /** Share of the workspace width among the columns (any positive number). */
  weight: number
  /** Never empty — a column whose last cell goes is removed. */
  cells: LayoutCell[]
}

/** Which band: the one above the columns or the one below. */
export type BandEdge = 'top' | 'bottom'

export const BAND_EDGES: readonly BandEdge[] = ['top', 'bottom']

/** A new band's height, px (header included). */
export const BAND_DEFAULT_HEIGHT = 160

/**
 * A full-width band above or below the columns: a cell that spans the
 * workspace. It never splits and never holds more than one panel; a band
 * whose last tab goes is removed (the layout's key is then absent).
 */
export interface LayoutBand {
  /** Unique within the layout (columns, cells, tabs and bands share the id space). */
  id: string
  /**
   * Height in px (header included) when expanded: any positive number. It
   * stays the same when the window resizes; it is clamped to the room when
   * drawn, and the stored value is kept.
   */
  height: number
  /** Tabs in strip order; never empty. */
  tabs: LayoutTab[]
  /** View state. Absent (or stale) = the first tab. */
  activeTabId?: string
  /** View state. A collapsed band shows only its header. */
  collapsed?: boolean
}

/** A panel: a cell or a band — what holds a tab strip. */
export type LayoutPanel = LayoutCell | LayoutBand

/** The parts of a layout the workspace draws: its columns and bands. */
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
}

export type PersistedWorkspaceLayout = WorkspaceLayout & { id: number }

/** Name of the layout created when none exists. */
export const DEFAULT_LAYOUT_NAME = 'Default'

export const LAYOUT_NAME_MAX = 200

/** Name of a new layout (the layout picker's New layout). */
export const NEW_LAYOUT_NAME = 'Untitled layout'

/**
 * The id of a new layout while it isn't stored yet (stored ids start at 1);
 * saving it gives it a real id.
 */
export const UNSAVED_LAYOUT_ID = 0

/** Default weight of a new column / cell. */
export const DEFAULT_WEIGHT = 1

/** Default calendar date types: both. */
export const DEFAULT_CALENDAR_DATE_TYPES: CalendarDateTypes = { due: true, followup: true }

/** Optional per-kind starting values for a new tab. */
export interface TabSeed {
  /** The list a new list tab shows. */
  listDefinitionId?: number
}

/** What the app knows about one widget kind. */
export interface WidgetKindSpec<K extends WidgetKind> {
  /** Its name in menus, the add-widget tiles and tab titles. */
  label: string
  /** A new tab of this kind shows a saved list, picked before the tab is added. */
  showsList: boolean
  /** A new tab of this kind, with its default config. */
  newTab: (id: string, seed: TabSeed) => TabOfKind<K>
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
    newTab: (id, seed) => ({ id, kind: 'lens', config: seed.listDefinitionId != null ? { listDefinitionId: seed.listDefinitionId } : {} }),
  },
  calendar: {
    label: 'Calendar',
    showsList: false,
    newTab: (id) => ({ id, kind: 'calendar', config: { dateTypes: { ...DEFAULT_CALENDAR_DATE_TYPES } } }),
  },
  notes: { label: 'Notes', showsList: false, newTab: (id) => ({ id, kind: 'notes', config: {} }) },
  eisenhower: {
    label: 'Eisenhower',
    showsList: false,
    newTab: (id) => ({ id, kind: 'eisenhower', config: {} }),
  },
  dashboard: { label: 'Dashboard', showsList: false, newTab: (id) => ({ id, kind: 'dashboard', config: defaultDashboardConfig() }) },
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

/** A cell's (or band's) active tab: `activeTabId`, else the first tab; `undefined` for an empty cell. */
export function getActiveTab(cell: Pick<LayoutCell, 'tabs' | 'activeTabId'>): LayoutTab | undefined {
  return cell.tabs.find((t) => t.id === cell.activeTabId) ?? cell.tabs[0]
}
