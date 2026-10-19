/**
 * The Eisenhower settings: one set of four panes and one source, app-wide —
 * every Eisenhower tab, on every layout, and the dashboard's Eisenhower
 * section use them. Stored in the `settings` table (`eisenhowerPanes`,
 * `eisenhowerSource`), not with a layout.
 */

import type { TodoPredicate } from './filter-predicate'
import type { EisenhowerQuadrant } from './workspace-layout'

/**
 * One pane's own settings. An absent field is that position's default (Do =
 * Urgent and Important, Schedule = Important not Urgent, Delegate = Urgent
 * not Important, Drop = neither).
 */
export interface EisenhowerPaneConfig {
  /** Its name (one plain line, not empty); absent = the position's default name. */
  name?: string
  /**
   * Which tasks it holds, in the list filter model. Its `showCompleted` is
   * ignored (stored `false`): the source decides whether completed tasks are
   * considered. Absent = the position's default filter.
   */
  filter?: TodoPredicate
}

/**
 * The panes that differ from their defaults, by position; `{}` = every pane
 * is its default. A task shows in the first pane (in position order) whose
 * filter it matches, or in none.
 */
export type EisenhowerPanes = Partial<Record<EisenhowerQuadrant, EisenhowerPaneConfig>>
