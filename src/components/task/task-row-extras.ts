import { createContext, useContext, type ReactNode } from 'react'
import type { PersistedTodoItem } from '../../models'

/** What the surface around a row adds to it (`TaskRowExtrasContext`). */
export interface TaskRowExtras {
  /**
   * A tag after the title: right after its text on a desktop row and a
   * line, leading the details line of a Stacked row.
   */
  tag?: ReactNode
  /**
   * Buttons at the title's end, shown as the row's placeholders are — row
   * hover, focus within (a desktop row, Rows and Stacked).
   */
  actions?: ReactNode
  /**
   * Real dates drawn in their late look (bold over the faint band of their
   * type) whatever today is; the date's name and tooltip stay as they are.
   */
  late?: { due?: boolean; followup?: boolean }
  /**
   * Words added to the row's accessible description — what a mark the
   * surface draws on the row says (the Planner's corner flag: `planned`,
   * `planned for Wed`): on a desktop row's checkbox, on a line, and after the
   * phone row's own description.
   */
  description?: string
}

/**
 * What the surface around a row adds to the row itself, for the one task it
 * shows (`TaskRow`, `TaskLine` and the phone row read it): the Planner's
 * tag, hover buttons, late dates and its flag's words. Null — the default, so
 * everywhere else — : nothing, and a row draws exactly as it always has.
 */
export const TaskRowExtrasContext = createContext<((todo: PersistedTodoItem) => TaskRowExtras | null) | null>(null)

/** The extras of `todo`'s row; null outside a provider, and for the drag overlay's copy (`ghost`). */
export function useTaskRowExtras(todo: PersistedTodoItem, ghost = false): TaskRowExtras | null {
  const extras = useContext(TaskRowExtrasContext)
  return extras && !ghost ? extras(todo) : null
}
