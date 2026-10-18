import type { PersistedTodoItem } from '../../models'
import { addDays } from '../../utils/calendar-grid'
import { daysUntil } from '../../utils/effective-date'
import { idsByDate, NEXT_DAYS, openTasks, type StatsContext } from './stats-context'

/** One column of the Next 7 days chart: open tasks due / to follow up then. */
export interface NextDaysColumn {
  /** The day (local midnight); `null` for the Late column. */
  date: Date | null
  /** Due that day (Late: due before today), by due date then `sortOrder`. */
  dueIds: number[]
  /** Next follow-up that day (Late: before today), by follow-up date then `sortOrder`. */
  followupIds: number[]
}

/**
 * The Next 7 days chart: a Late column, then today and the six days after
 * it. A task can appear in both rows of a column (due and follow-up) and in
 * two columns (due one day, follow-up another).
 */
export function computeNextSevenDays(
  tasks: readonly PersistedTodoItem[],
  ctx: Pick<StatsContext, 'today'>,
): NextDaysColumn[] {
  // Index 0 = Late, 1 = today, … 7 = today + 6.
  const due: PersistedTodoItem[][] = Array.from({ length: NEXT_DAYS + 1 }, () => [])
  const followup: PersistedTodoItem[][] = Array.from({ length: NEXT_DAYS + 1 }, () => [])
  const column = (days: number | null): number | null => {
    if (days == null || days >= NEXT_DAYS) return null
    return days < 0 ? 0 : days + 1
  }
  for (const t of openTasks(tasks)) {
    const d = column(daysUntil(t.dueDate, ctx.today))
    if (d != null) due[d]?.push(t)
    const f = column(daysUntil(t.nextFollowupAt, ctx.today))
    if (f != null) followup[f]?.push(t)
  }
  return due.map((dueTasks, i) => ({
    date: i === 0 ? null : addDays(ctx.today, i - 1),
    dueIds: idsByDate(dueTasks, 'deadline'),
    followupIds: idsByDate(followup[i] ?? [], 'followup'),
  }))
}
