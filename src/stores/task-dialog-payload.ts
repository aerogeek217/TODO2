import type { TodoPredicate } from '../models'
import type { DashGlyphName } from '../utils/dash-glyphs'

/**
 * What the task dialog shows (`ui-store.taskDialog`): a payload says what
 * to list and in words what was counted; `services/task-dialog` resolves
 * its source to rows when the dialog opens (a `screen` source also when the
 * screen filter changes).
 */

/** One heading of a grouped source: its tasks in display order. */
export interface TaskDialogGroup {
  key: string
  label: string
  /** The group header's dot. */
  color?: string
  todoIds: readonly number[]
}

export type TaskDialogSource =
  /** These tasks, in this order (what a count counted). */
  | { kind: 'todos'; todoIds: readonly number[] }
  /** These tasks under headings (a Next 7 days day: Due / Follow-up). */
  | { kind: 'groups'; groups: readonly TaskDialogGroup[] }
  /** The tasks matching a predicate, in `sortOrder` (a person's open tasks). */
  | { kind: 'predicate'; predicate: TodoPredicate }
  /**
   * A list's members under the screen filter (narrowing clauses AND,
   * as in a List widget), with the list's own sort and grouping.
   */
  | { kind: 'list'; listDefinitionId: number }
  /**
   * The tasks the screen filter matches (open ones, completed too while its
   * Show completed is on), sorted and grouped by Settings' new-list
   * defaults. Resolved again whenever the screen filter changes.
   */
  | { kind: 'screen' }

export interface TaskDialogPayload {
  title: string
  glyph: DashGlyphName
  /** What is counted, in words. */
  description: string
  source: TaskDialogSource
  /** The widget tab it was opened from: `Open as tab` adds the list's tab to that tab's cell. */
  fromTabId?: string
  /** A person's tasks: the footer offers `Email check-in` to that person. */
  personId?: number
}
