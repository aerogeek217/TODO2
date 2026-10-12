import type { PersistedTodoItem } from '../../models'
import { daysUntil } from '../../utils/effective-date'
import { idsByDate, NEXT_DAYS, openTasks, type StatsContext } from './stats-context'

/** The look-ahead choices of the Needs follow-up section. */
export const FOLLOWUP_LOOK_AHEAD_CHOICES = [3, 7, 14] as const
export type FollowupLookAhead = (typeof FOLLOWUP_LOOK_AHEAD_CHOICES)[number]

/**
 * Open tasks by next follow-up day, ids by follow-up date then `sortOrder`.
 * `upcoming` holds the rest of the look-ahead window after today: the window
 * is `lookAhead` days starting today (7 = today … today + 6, like the Next 7
 * days chart), so `upcoming` = tomorrow … today + lookAhead − 1.
 */
export interface FollowupGroups {
  late: number[]
  today: number[]
  upcoming: number[]
}

export function computeFollowupGroups(
  tasks: readonly PersistedTodoItem[],
  ctx: Pick<StatsContext, 'today'>,
  lookAhead: number = NEXT_DAYS,
): FollowupGroups {
  const late: PersistedTodoItem[] = []
  const today: PersistedTodoItem[] = []
  const upcoming: PersistedTodoItem[] = []
  for (const t of openTasks(tasks)) {
    const days = daysUntil(t.nextFollowupAt, ctx.today)
    if (days == null) continue
    if (days < 0) late.push(t)
    else if (days === 0) today.push(t)
    else if (days < lookAhead) upcoming.push(t)
  }
  return {
    late: idsByDate(late, 'followup'),
    today: idsByDate(today, 'followup'),
    upcoming: idsByDate(upcoming, 'followup'),
  }
}
