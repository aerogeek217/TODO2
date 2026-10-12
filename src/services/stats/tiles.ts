import type { MarkerSet, PersistedTodoItem } from '../../models'
import { daysUntil } from '../../utils/effective-date'
import { matchesHotLine } from '../../utils/hot'
import { isEffectivelyUrgent } from '../../utils/urgency'
import { idsByDate, NEXT_DAYS, openTasks, type StatsContext } from './stats-context'

/**
 * The dashboard's built-in tiles. Every tile counts open tasks only; its
 * `ids` are the tasks it counts, in dialog order (by due date, or by next
 * follow-up for follow-up tiles; overdue first, undated last, ties by
 * `sortOrder`). A tile's count is `ids.length`.
 */
export interface TileStats {
  /** Every open task. (The `+N in the last …` line comes from the trend.) */
  open: { ids: number[] }
  /**
   * Hot tasks (Settings' Hot rule). `lines` follows the rule's lines: each
   * hot task is counted under the first line it matches, so the line counts
   * add up to the tile (`3 urgent + important · 1 Focus`).
   */
  hot: { ids: number[]; lines: Array<{ line: MarkerSet; ids: number[] }> }
  /** Effective urgent: `flagged` + `byDate` (urgent only by its due date). */
  urgent: { ids: number[]; flagged: number; byDate: number }
  /** Due before today; the oldest due day and how many days late it is. */
  overdue: { ids: number[]; oldest: Date | null; oldestDaysLate: number }
  /**
   * Next follow-up today or earlier (`late` + `today`); `upcoming` = follow-ups
   * on the rest of the next 7 days (tomorrow … today + 6), not in the count.
   */
  followupDue: { ids: number[]; late: number; today: number; upcoming: number }
  /** In Focus; `dueToday` of them due today. */
  focus: { ids: number[]; dueToday: number }
  /** Due today; `upcoming` = due tomorrow … today + 6, not in the count. */
  dueToday: { ids: number[]; upcoming: number }
  /** Due today … today + 6. */
  dueNext7: { ids: number[] }
  /** Open tasks without a next follow-up date. */
  noFollowup: { ids: number[] }
}

/** A built-in tile's id. */
export type TileId = keyof TileStats

/** Every tile's stats over `tasks` (completed tasks are skipped). */
export function computeTiles(tasks: readonly PersistedTodoItem[], ctx: StatsContext): TileStats {
  const { today, urgentRange, hotRule } = ctx
  const open = openTasks(tasks)

  const hot: PersistedTodoItem[] = []
  const hotLines = hotRule.map((line) => ({ line, tasks: [] as PersistedTodoItem[] }))
  const urgent: PersistedTodoItem[] = []
  let flagged = 0
  const overdue: PersistedTodoItem[] = []
  const followupDue: PersistedTodoItem[] = []
  let followupLate = 0
  let followupUpcoming = 0
  const focus: PersistedTodoItem[] = []
  let focusDueToday = 0
  const dueToday: PersistedTodoItem[] = []
  const dueNext7: PersistedTodoItem[] = []
  const noFollowup: PersistedTodoItem[] = []

  for (const t of open) {
    const firstLine = hotLines.find((l) => matchesHotLine(t, l.line, today, urgentRange))
    if (firstLine) {
      hot.push(t)
      firstLine.tasks.push(t)
    }

    if (isEffectivelyUrgent(t, today, urgentRange)) {
      urgent.push(t)
      if (t.urgent === true) flagged++
    }

    const due = daysUntil(t.dueDate, today)
    if (due != null) {
      if (due < 0) overdue.push(t)
      if (due === 0) dueToday.push(t)
      if (due >= 0 && due < NEXT_DAYS) dueNext7.push(t)
    }

    const fu = daysUntil(t.nextFollowupAt, today)
    if (fu == null) {
      noFollowup.push(t)
    } else if (fu <= 0) {
      followupDue.push(t)
      if (fu < 0) followupLate++
    } else if (fu < NEXT_DAYS) {
      followupUpcoming++
    }

    if (t.focus === true) {
      focus.push(t)
      if (due === 0) focusDueToday++
    }
  }

  const overdueIds = idsByDate(overdue, 'deadline')
  const oldestTask = overdue.find((t) => t.id === overdueIds[0])
  const oldest = oldestTask?.dueDate ?? null

  return {
    open: { ids: idsByDate(open, 'deadline') },
    hot: {
      ids: idsByDate(hot, 'deadline'),
      lines: hotLines.map((l) => ({ line: l.line, ids: idsByDate(l.tasks, 'deadline') })),
    },
    urgent: {
      ids: idsByDate(urgent, 'deadline'),
      flagged,
      byDate: urgent.length - flagged,
    },
    overdue: {
      ids: overdueIds,
      oldest,
      oldestDaysLate: oldest ? -(daysUntil(oldest, today) ?? 0) : 0,
    },
    followupDue: {
      ids: idsByDate(followupDue, 'followup'),
      late: followupLate,
      today: followupDue.length - followupLate,
      upcoming: followupUpcoming,
    },
    focus: { ids: idsByDate(focus, 'deadline'), dueToday: focusDueToday },
    dueToday: { ids: idsByDate(dueToday, 'deadline'), upcoming: dueNext7.length - dueToday.length },
    dueNext7: { ids: idsByDate(dueNext7, 'deadline') },
    noFollowup: { ids: idsByDate(noFollowup, 'deadline') },
  }
}
