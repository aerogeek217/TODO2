import type { PersistedTodoItem } from '../../models'
import { DEFAULT_NEGLECT_UNTOUCHED_DAYS } from '../../models/workspace-layout'
import { daysUntil } from '../../utils/effective-date'
import { buildNeglectMap } from '../../utils/neglect-map'
import { idsByDate, openTasks, type StatsContext } from './stats-context'

/**
 * Today (D25 L): the open Focus tasks — the user's picks for the day —
 * and a few suggestions to pick from: the tasks due today, then the Neglect
 * map's Slipping corner (due soon or late and untouched for the map's
 * default threshold), none already in Focus.
 */

/** Suggestions shown, at most. */
export const TODAY_SUGGESTIONS = 5

/** Why a task is suggested. */
export type TodayReason = 'dueToday' | 'slipping'

export interface TodaySuggestion {
  id: number
  reason: TodayReason
}

export interface TodayPicks {
  /** The open Focus tasks, by due date (the Focus Number's order). */
  focusIds: number[]
  /** Up to `TODAY_SUGGESTIONS`: due today (by due date), then Slipping (latest first). */
  suggestions: TodaySuggestion[]
}

/** The open Focus tasks of `tasks`, by due date. */
export function openFocusIds(tasks: readonly PersistedTodoItem[]): number[] {
  return idsByDate(openTasks(tasks).filter((t) => t.focus === true), 'deadline')
}

/** Today's picks and suggestions over `tasks` (usually the screen-filtered ones). Pure. */
export function computeTodayPicks(
  tasks: readonly PersistedTodoItem[],
  ctx: Pick<StatsContext, 'today' | 'urgentRange'>,
): TodayPicks {
  const open = openTasks(tasks).filter((t) => t.focus !== true)
  const suggestions: TodaySuggestion[] = []
  const taken = new Set<number>()
  const add = (id: number, reason: TodayReason) => {
    if (taken.has(id) || suggestions.length >= TODAY_SUGGESTIONS) return
    taken.add(id)
    suggestions.push({ id, reason })
  }
  for (const id of idsByDate(open.filter((t) => daysUntil(t.dueDate, ctx.today) === 0), 'deadline')) add(id, 'dueToday')
  const map = buildNeglectMap(open, { today: ctx.today, untouchedDays: DEFAULT_NEGLECT_UNTOUCHED_DAYS, dueSoonDays: ctx.urgentRange })
  for (const p of map.slipping) add(p.todo.id, 'slipping')
  return { focusIds: openFocusIds(tasks), suggestions }
}
