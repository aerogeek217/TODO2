import type { PersistedTodoItem } from '../../models'
import { daysUntil } from '../../utils/effective-date'
import type { StatsContext } from './stats-context'

/** The Recently completed section. */
export interface RecentlyCompleted {
  /** Newest completion first; ties by `sortOrder`, then id. */
  ids: number[]
}

/**
 * Tasks completed in the last `days` days: today and the `days − 1` before
 * it (7 = the trend's way of counting a week), by local day. Reads
 * `completedAt`, or `modifiedAt` for a completed row without one.
 */
export function computeRecentlyCompleted(
  tasks: readonly PersistedTodoItem[],
  ctx: Pick<StatsContext, 'today'>,
  days: number,
): RecentlyCompleted {
  const done: Array<{ task: PersistedTodoItem; at: number }> = []
  for (const t of tasks) {
    if (!t.isCompleted) continue
    const when = t.completedAt ?? t.modifiedAt
    const at = new Date(when).getTime()
    if (!Number.isFinite(at)) continue
    if ((daysUntil(when, ctx.today) ?? 0) > -days) done.push({ task: t, at })
  }
  done.sort((a, b) => b.at - a.at || a.task.sortOrder - b.task.sortOrder || a.task.id - b.task.id)
  return { ids: done.map((d) => d.task.id) }
}
