import type { TodoPredicate } from '../models'
import type { GlanceGlyphName } from '../utils/glance-glyphs'

/**
 * What the task dialog shows (`ui-store.taskDialog`): a payload says what
 * to list and in words what was counted; `services/task-dialog` resolves
 * its source to rows when the dialog opens (a `screen` source also when the
 * screen filter changes, every source when the group · sort pick does). Every
 * source is shown sorted and grouped as the popup lists are
 * (`task-dialog.popupListView`).
 */

/** One heading of a grouped source: its tasks in display order. */
interface TaskDialogGroup {
  key: string
  label: string
  /** The group header's dot. */
  color?: string
  todoIds: readonly number[]
}

export type TaskDialogSource =
  /** These tasks (what a count counted), completed ones included. */
  | { kind: 'todos'; todoIds: readonly number[] }
  /**
   * These tasks under headings (a trend day: Completed / Created), kept until
   * the user picks a grouping; then its tasks are grouped by that.
   */
  | { kind: 'groups'; groups: readonly TaskDialogGroup[] }
  /** The tasks matching a predicate (a person's open tasks). */
  | { kind: 'predicate'; predicate: TodoPredicate }
  /**
   * The tasks the screen filter matches (open ones, completed too while its
   * Show completed is on). Resolved again whenever the screen filter
   * changes.
   */
  | { kind: 'screen' }

export interface TaskDialogPayload {
  title: string
  glyph: GlanceGlyphName
  /** What is counted, in words. */
  description: string
  source: TaskDialogSource
  /** A person's tasks: the person whose tasks they are (their actions under the title). */
  personId?: number
}
