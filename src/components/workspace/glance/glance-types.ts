import type { TaskDialogPayload } from '../../../stores/task-dialog-payload'
import type { ListRowSelectMods } from '../list/ListWidgetRow'
import type { ValueStore } from '../../../utils/value-store'
import type { LeavingRows } from '../../../hooks/use-leaving-rows'

/**
 * The tasks a glance widget's number stands for — what clicking it opens in the
 * task dialog: the counted tasks, by id in dialog order or under headings.
 */
export type GlanceDrill = TaskDialogPayload

/** Opens the tasks behind a number; absent = numbers aren't clickable. */
export type OnGlanceDrill = (drill: GlanceDrill) => void

/** What the task-row sections (Needs follow-up, Stale) share. */
export interface GlanceRowKit {
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
  /** Just-completed rows lingering before they fold (D19; desktop). */
  leaving: LeavingRows | undefined
}
