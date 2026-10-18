import type { PersistedTodoItem } from '../../models'
import { daysUntil } from '../../utils/effective-date'
import { openTasks, type StatsContext } from './stats-context'

/** The Stale tasks section: open tasks nobody has changed for a while. */
export interface StaleTasks {
  /** Oldest change first; ties by `sortOrder`, then id. */
  ids: number[]
  /** Days since the oldest one changed (`null` when there are none). */
  oldestDays: number | null
}

/**
 * Open tasks last modified `days` or more days ago (by local day, so a task
 * changed on the morning or evening of that day counts alike). Reads
 * `modifiedAt`, which any edit moves — including a reorder or a bulk edit.
 */
export function computeStaleTasks(
  tasks: readonly PersistedTodoItem[],
  ctx: Pick<StatsContext, 'today'>,
  days: number,
): StaleTasks {
  const stale: Array<{ task: PersistedTodoItem; at: number; age: number }> = []
  for (const t of openTasks(tasks)) {
    const at = new Date(t.modifiedAt).getTime()
    if (!Number.isFinite(at)) continue
    const age = -(daysUntil(t.modifiedAt, ctx.today) ?? 0)
    if (age >= days) stale.push({ task: t, at, age })
  }
  stale.sort((a, b) => a.at - b.at || a.task.sortOrder - b.task.sortOrder || a.task.id - b.task.id)
  return { ids: stale.map((s) => s.task.id), oldestDays: stale[0]?.age ?? null }
}
