/**
 * Workspace layouts: a row of columns, each a vertical stack of cells, each
 * cell a strip of widget tabs. Two levels only — no recursive splits.
 *
 * Every tab carries its own settings, split in two by how they are saved:
 *
 * - `config` — **layout config**: part of the saved layout. Changing it (like
 *   adding, moving, closing or resizing anything) makes the working copy differ
 *   from the saved layout, i.e. "unsaved changes".
 * - `viewState` — **view state**: written straight onto the stored layout
 *   (last write wins) and never counts as an unsaved change. Same for a cell's
 *   `activeTabId` and `collapsed`.
 *
 * A layout stores structure only; what a widget shows (list definitions,
 * tasks, the note) lives in its own tables.
 */

/** Widget kinds a tab can hold. */
export type WidgetKind = 'lens' | 'calendar' | 'notes' | 'taskboard' | 'status'

export const WIDGET_KINDS: readonly WidgetKind[] = ['lens', 'calendar', 'notes', 'taskboard', 'status']

export function isWidgetKind(v: unknown): v is WidgetKind {
  return typeof v === 'string' && (WIDGET_KINDS as readonly string[]).includes(v)
}

export type CalendarView = 'week' | 'month'

/** Max absolute calendar offset (weeks in week view, months in month view). */
export const CALENDAR_OFFSET_MAX = 104

export function clampCalendarOffset(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.max(-CALENDAR_OFFSET_MAX, Math.min(CALENDAR_OFFSET_MAX, Math.trunc(n)))
}

/** Which task dates a calendar shows. At least one is `true`. */
export interface CalendarDateTypes {
  due: boolean
  followup: boolean
}

export interface LensTabConfig {
  /** The list definition shown; absent = not picked yet. */
  listDefinitionId?: number
}

export interface LensTabViewState {
  /** Picks for the list's runtime prompt (`ListDefinition.runtimeFilter`). */
  runtimeFilterValue?: number[]
}

export interface CalendarTabConfig {
  dateTypes: CalendarDateTypes
}

export interface CalendarTabViewState {
  view?: CalendarView
  /** Weeks (week view) or months (month view) from the current one. */
  offset?: number
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

export type LensTab = TabOf<'lens', LensTabConfig, LensTabViewState>
export type CalendarTab = TabOf<'calendar', CalendarTabConfig, CalendarTabViewState>
export type NotesTab = TabOf<'notes', NoTabSettings, NoTabSettings>
export type TaskboardTab = TabOf<'taskboard', NoTabSettings, NoTabSettings>
export type StatusTab = TabOf<'status', NoTabSettings, NoTabSettings>

export type LayoutTab = LensTab | CalendarTab | NotesTab | TaskboardTab | StatusTab

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

export interface WorkspaceLayout {
  id?: number
  name: string
  columns: LayoutColumn[]
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

/** Default weight of a new column / cell. */
export const DEFAULT_WEIGHT = 1

/** Default calendar date types: both. */
export const DEFAULT_CALENDAR_DATE_TYPES: CalendarDateTypes = { due: true, followup: true }

/** Optional per-kind starting values for a new tab. */
export interface TabSeed {
  listDefinitionId?: number
}

/** A new tab of `kind` with that kind's default config. */
export function createTab(kind: WidgetKind, id: string, seed: TabSeed = {}): LayoutTab {
  switch (kind) {
    case 'lens':
      return { id, kind, config: seed.listDefinitionId != null ? { listDefinitionId: seed.listDefinitionId } : {} }
    case 'calendar':
      return { id, kind, config: { dateTypes: { ...DEFAULT_CALENDAR_DATE_TYPES } } }
    case 'notes':
    case 'taskboard':
    case 'status':
      return { id, kind, config: {} }
  }
}

/** The cell's active tab: `activeTabId`, else the first tab; `undefined` for an empty cell. */
export function getActiveTab(cell: LayoutCell): LayoutTab | undefined {
  return cell.tabs.find((t) => t.id === cell.activeTabId) ?? cell.tabs[0]
}
