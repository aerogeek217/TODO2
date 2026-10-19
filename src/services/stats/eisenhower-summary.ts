import type { PersistedTodoItem } from '../../models'
import type { PersistedListDefinition } from '../../models/list-definition'
import type { EisenhowerQuadrant } from '../../models/workspace-layout'
import { classifyPanes, type PaneContext } from '../../utils/eisenhower'
import type { EisenhowerPane } from '../../utils/eisenhower-panes'
import type { FilterCriteria } from '../../utils/filter-criteria'
import type { TodoNameLookups } from '../../utils/filter'
import { createPredicateEvaluator, createScreenComposedEvaluator, type FilterSettings } from '../../utils/filter-match'
import { isUrgentByDate } from '../../utils/urgency'
import { matchesMembership } from '../build-list'
import { openTasks } from './stats-context'

/** One pane of the Eisenhower summary. */
export interface QuadrantStats {
  /** Its open tasks, in the Eisenhower widget's order (due date, undated last, `sortOrder`). */
  ids: number[]
  /** How many of them only their due date makes urgent. */
  byDate: number
}

/** The summary by pane position. */
export type EisenhowerSummary = Record<EisenhowerQuadrant, QuadrantStats>

/**
 * Open tasks by Eisenhower pane — the first pane whose filter each matches
 * (`classifyPanes`, the widget's rule; the default panes are the quadrants
 * of effective Urgent × Important). Tasks in no pane aren't counted.
 */
export function computeEisenhowerSummary(
  tasks: readonly PersistedTodoItem[],
  panes: readonly EisenhowerPane[],
  ctx: PaneContext,
): EisenhowerSummary {
  const { byPane } = classifyPanes(openTasks(tasks), panes, ctx)
  const range = ctx.settings.urgentRange
  const stats = (q: EisenhowerQuadrant): QuadrantStats => ({
    ids: byPane[q].map((t) => t.id),
    byDate: byPane[q].filter((t) => t.urgent !== true && isUrgentByDate(t, ctx.today, range)).length,
  })
  return { do: stats('do'), schedule: stats('schedule'), delegate: stats('delegate'), drop: stats('drop') }
}

export interface EisenhowerSourceOptions {
  /** The screen filter as the dashboard applies it (`statsFilter`). */
  screen: FilterCriteria
  /** Assignments + status names (tag clauses need `assignedTagsMap` loaded). */
  lookups: TodoNameLookups
  today: Date
  settings: FilterSettings
}

/**
 * The tasks the Eisenhower considers, as the dashboard counts them: `shown`
 * passes the screen filter too, `total` doesn't (the `of N`). The
 * Eisenhower's own list (`definition`: its unsaved draft, if any): its
 * members — the list's own filter, its prompt ignored —, through the same
 * evaluators a list widget uses (`createScreenComposedEvaluator`); before
 * it is loaded, every task (`shownAll`: the dashboard's screen-filtered
 * tasks).
 */
export function eisenhowerSourceTasks(
  todos: readonly PersistedTodoItem[],
  shownAll: readonly PersistedTodoItem[],
  definition: PersistedListDefinition | undefined,
  opts: EisenhowerSourceOptions,
): { shown: PersistedTodoItem[]; total: PersistedTodoItem[] } {
  if (!definition) return { shown: [...shownAll], total: [...todos] }
  const listOnly = createPredicateEvaluator(opts.lookups, opts.today, opts.settings)
  const composed = createScreenComposedEvaluator(opts.screen, opts.lookups, opts.today, opts.settings)
  const total: PersistedTodoItem[] = []
  const shown: PersistedTodoItem[] = []
  for (const t of todos) {
    if (!matchesMembership(definition.membership, t, listOnly)) continue
    total.push(t)
    if (matchesMembership(definition.membership, t, composed)) shown.push(t)
  }
  return { shown, total }
}
