import type { PersistedTodoItem } from '../../models'
import type { EisenhowerQuadrant } from '../../models/workspace-layout'
import { buildQuadrants } from '../../utils/eisenhower'
import { isUrgentByDate } from '../../utils/urgency'
import { openTasks, type StatsContext } from './stats-context'

/** One quadrant of the Eisenhower summary. */
export interface QuadrantStats {
  /** Its open tasks, in the Eisenhower widget's order (due date, undated last, `sortOrder`). */
  ids: number[]
  /** How many of them only their due date makes urgent. */
  byDate: number
}

export type EisenhowerSummary = Record<EisenhowerQuadrant, QuadrantStats>

/**
 * Open tasks by effective Urgent (flag, or due within the app-wide range) ×
 * Important — the Eisenhower widget's quadrants (`utils/eisenhower`).
 */
export function computeEisenhowerSummary(
  tasks: readonly PersistedTodoItem[],
  ctx: Pick<StatsContext, 'today' | 'urgentRange'>,
): EisenhowerSummary {
  const quadrants = buildQuadrants(openTasks(tasks), ctx.today, ctx.urgentRange)
  const stats = (q: EisenhowerQuadrant): QuadrantStats => ({
    ids: quadrants[q].map((t) => t.id),
    byDate: quadrants[q].filter((t) => t.urgent !== true && isUrgentByDate(t, ctx.today, ctx.urgentRange)).length,
  })
  return { do: stats('do'), schedule: stats('schedule'), delegate: stats('delegate'), drop: stats('drop') }
}
