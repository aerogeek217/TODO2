import type { PersistedTodoItem } from '../../models'
import { weekStartOf } from '../../utils/calendar-grid'
import { daysUntil } from '../../utils/effective-date'
import type { StatsContext } from './stats-context'

/** The Number widget's Closed this week. */
export interface ClosedThisWeek {
  /** Newest completion first; ties by `sortOrder`, then id. */
  ids: number[]
  /** The week's first day (`weekStartsOn`), local midnight. */
  weekStart: Date
}

/** When a completed task was completed: `completedAt`, or `modifiedAt` for a row without one. */
export function completionOf(task: Pick<PersistedTodoItem, 'completedAt' | 'modifiedAt'>): Date {
  return new Date(task.completedAt ?? task.modifiedAt)
}

/**
 * Tasks completed this week: from the week's first day (Settings' week
 * start) through today, by local day — as Recently completed reads a
 * completion (`completionOf`).
 */
export function computeClosedThisWeek(
  tasks: readonly PersistedTodoItem[],
  ctx: Pick<StatsContext, 'today' | 'weekStartsOn'>,
): ClosedThisWeek {
  const weekStart = weekStartOf(ctx.today, ctx.weekStartsOn)
  const done: Array<{ task: PersistedTodoItem; at: number }> = []
  for (const t of tasks) {
    if (!t.isCompleted) continue
    const when = completionOf(t)
    const at = when.getTime()
    if (!Number.isFinite(at)) continue
    const fromStart = daysUntil(when, weekStart) ?? -1
    const fromToday = daysUntil(when, ctx.today) ?? 1
    if (fromStart >= 0 && fromToday <= 0) done.push({ task: t, at })
  }
  done.sort((a, b) => b.at - a.at || a.task.sortOrder - b.task.sortOrder || a.task.id - b.task.id)
  return { ids: done.map((d) => d.task.id), weekStart }
}
