import type { TaskDialogPayload } from '../../../stores/task-dialog-payload'
import type { ListRowSelectMods } from '../list/ListWidgetRow'
import type { ValueStore } from '../../../utils/value-store'

/**
 * The tasks a dashboard number stands for — what clicking it opens in the
 * task dialog. Built-in counts name their tasks (ids in dialog order, or
 * under headings); a list tile names its list (the list's own sort and
 * grouping apply). The widget's host adds where it was opened from.
 */
export type DashboardDrill = Omit<TaskDialogPayload, 'fromTabId'>

/** Opens the tasks behind a number; absent = numbers aren't clickable. */
export type OnDashboardDrill = (drill: DashboardDrill) => void

/** What the task-row sections (Hot, Needs follow-up) share. */
export interface DashboardRowKit {
  tabId: string
  isMobile: boolean
  inScope: boolean
  selectedIds: ReadonlySet<number>
  cursorKey: string | null
  onSelect: (key: string, todoId: number, mods: ListRowSelectMods) => void
  onOpen: (todoId: number) => void
  /** The tab's task-row details width (one value for every section). */
  detailsWidth: number | undefined
  onDetailsWidthChange: (width: number | undefined) => void
  /** The width while a section's divider is dragged: every section follows it live. */
  liveDetailsWidth: ValueStore<number | null>
}
