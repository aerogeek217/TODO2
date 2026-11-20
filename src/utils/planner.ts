import type { TodoItem } from '../models/todo-item'
import { PLANNER_ORDER_MAX } from '../models/workspace-layout'
import { addDays, dayKey, formatDateWith, startOfDay } from './date'

/**
 * The Planner's placement (widget kind `planner`): which tasks it holds,
 * the day each sits on and why, the groups and tiles of a seven-day window,
 * the hand order applied, and what a drop on a day would write. Pure: the
 * widget (`components/workspace/planner`) draws what these return.
 */

/** Days in the Planner's window (its strip's tiles). */
export const PLANNER_WINDOW_DAYS = 7

/** The most ticks a tile draws before `+N`. */
export const PLANNER_TILE_TICKS_MAX = 8

/** Why a task sits on its day: its Do day, its next follow-up or its due date. */
type PlannerReason = 'do' | 'followup' | 'due'

/** What the placement reads of a task. */
export type PlannerTask = Pick<TodoItem, 'uid' | 'isCompleted' | 'focus' | 'doDate' | 'dueDate' | 'nextFollowupAt' | 'sortOrder'>

/** Where a task sits. */
export interface PlannerPlacement {
  /** The day it shows on (local midnight): its date's day, or today for a date before today. */
  day: Date
  /** The date that put it there (local midnight), which may be before today. */
  date: Date
  reason: PlannerReason
}

/** The Planner's seven days. */
export interface PlannerWindow {
  /** Today (local midnight): the Today group's day whatever the offset. */
  today: Date
  /** The window's days, first to last. */
  days: readonly Date[]
  first: Date
  last: Date
}

/** A whole number of weeks, never before this week: the offset a window keeps. */
export function plannerOffset(offset: number): number {
  if (!Number.isFinite(offset) || offset <= 0) return 0
  return Math.floor(offset / PLANNER_WINDOW_DAYS) * PLANNER_WINDOW_DAYS
}

/** The seven days starting at `today` + `offset` days (a multiple of 7, 0 or more). */
export function plannerWindow(today: Date, offset = 0): PlannerWindow {
  const start = startOfDay(today)
  const first = addDays(start, plannerOffset(offset))
  const days = Array.from({ length: PLANNER_WINDOW_DAYS }, (_, i) => addDays(first, i))
  return { today: start, days, first, last: addDays(first, PLANNER_WINDOW_DAYS - 1) }
}

const dayTime = (d: Date): number => startOfDay(new Date(d)).getTime()

/**
 * Whether the Planner holds `task` for a window ending on `lastDay`: open,
 * and in Focus, or given a Do day, or due or due for a follow-up on or
 * before that day.
 */
export function inPlanner(task: PlannerTask, lastDay: Date): boolean {
  if (task.isCompleted) return false
  if (task.focus === true || task.doDate != null) return true
  const last = dayTime(lastDay)
  return (task.dueDate != null && dayTime(task.dueDate) <= last)
    || (task.nextFollowupAt != null && dayTime(task.nextFollowupAt) <= last)
}

/**
 * The day `task` sits on and why: its Do day when it has one; else the
 * earlier of its next follow-up and its due date when that is on or before
 * `lastDay` — the follow-up when it is the earlier or the same day, or
 * there is no due date —; else none (a Focus task with no day). A date
 * before `today` shows on today.
 */
export function plannerPlacement(task: PlannerTask, today: Date, lastDay: Date): PlannerPlacement | null {
  const todayTime = dayTime(today)
  const at = (date: Date, reason: PlannerReason): PlannerPlacement => {
    const day = startOfDay(new Date(date))
    return { day: day.getTime() < todayTime ? new Date(todayTime) : day, date: day, reason }
  }
  if (task.doDate != null) return at(task.doDate, 'do')
  const { dueDate: due, nextFollowupAt: followup } = task
  const byFollowup = followup != null && (due == null || dayTime(followup) <= dayTime(due))
  const date = byFollowup ? followup : due
  if (date == null || dayTime(date) > dayTime(lastDay)) return null
  return at(date, byFollowup ? 'followup' : 'due')
}

/** A group of the Planner: Today, a day ahead, or the Focus tasks with no day. */
export interface PlannerGroup<T> {
  /** `today`'s or the day's `dayKey`; `PLANNER_NO_DAY_KEY` for Focus, no day. */
  key: string
  kind: 'today' | 'day' | 'noday'
  /** Its day; null for Focus, no day. */
  day: Date | null
  /** Its tasks, in the hand order then the default one (`plannerOrder`). */
  tasks: T[]
}

/** The key of the Focus, no day group. */
export const PLANNER_NO_DAY_KEY = 'none'

/** A day's tile on the strip. */
export interface PlannerTile {
  day: Date
  /** The day's `dayKey`. */
  key: string
  isToday: boolean
  /** The tasks on the day. */
  count: number
  /** A tick per task by its reason, deadlines first: at most `PLANNER_TILE_TICKS_MAX`. */
  ticks: PlannerReason[]
  /** The tasks past the ticks drawn (`+N`). */
  more: number
}

/** What the Planner draws for a window. */
export interface PlannerView<T> {
  window: PlannerWindow
  /** Today: every task whose day is today or earlier — also while the window is shifted. */
  today: PlannerGroup<T>
  /**
   * The days ahead, one group per day — the empty ones too — from the
   * picked day (the window's first without one; never before tomorrow) to
   * the window's last.
   */
  days: PlannerGroup<T>[]
  /** The Focus tasks with no day. */
  noDay: PlannerGroup<T>
  /** The window's seven tiles; today's counts the Today group. */
  tiles: PlannerTile[]
  /** Every task of Today, the window's days and Focus, no day — whatever day is picked. */
  tasks: T[]
  /** Each of those tasks' placement, by `uid` (none for a Focus task with no day). */
  placements: ReadonlyMap<string, PlannerPlacement>
}

interface PlannerViewOptions {
  today: Date
  /** The window's offset in days (a multiple of 7; default 0). */
  offset?: number
  /** The day the days-ahead list starts at; outside the window, or today or earlier, it is ignored. */
  picked?: Date | null
  /** The hand order: task `uid`s. */
  order?: readonly string[]
}

/** The reasons in the order they sort and their ticks draw: deadlines, follow-ups, plans. */
const REASON_RANK: Record<PlannerReason, number> = { due: 0, followup: 1, do: 2 }

/**
 * `tasks` in the Planner's order: those `order` names first, as it lists
 * them, then the rest by reason (deadlines, follow-ups, plans), then by
 * date, then by `sortOrder`.
 */
export function plannerOrder<T extends PlannerTask>(
  tasks: readonly T[],
  placements: ReadonlyMap<string, PlannerPlacement>,
  order: readonly string[] = [],
): T[] {
  const rank = new Map<string, number>()
  order.forEach((uid, i) => { if (!rank.has(uid)) rank.set(uid, i) })
  return [...tasks].sort((a, b) => {
    const ra = rank.get(a.uid)
    const rb = rank.get(b.uid)
    if (ra != null || rb != null) return ra == null ? 1 : rb == null ? -1 : ra - rb
    const pa = placements.get(a.uid)
    const pb = placements.get(b.uid)
    return (pa ? REASON_RANK[pa.reason] : 3) - (pb ? REASON_RANK[pb.reason] : 3)
      || (pa?.date.getTime() ?? 0) - (pb?.date.getTime() ?? 0)
      || a.sortOrder - b.sortOrder
  })
}

/** A day's tile from the tasks on it. */
function tileOf(day: Date, isToday: boolean, reasons: readonly PlannerReason[]): PlannerTile {
  const sorted = [...reasons].sort((a, b) => REASON_RANK[a] - REASON_RANK[b])
  const ticks = sorted.slice(0, PLANNER_TILE_TICKS_MAX)
  return { day, key: dayKey(day), isToday, count: reasons.length, ticks, more: reasons.length - ticks.length }
}

/**
 * The Planner for `tasks` (those the screen filter shows; completed ones
 * and the ones it doesn't hold are left out): Today, the days ahead, Focus,
 * no day, and the window's tiles. While the window is shifted, Today stays
 * today's, the days ahead start at the window's first day, and a task whose
 * day lies between tomorrow and the window is in no group — the tiles are
 * the window's.
 */
export function plannerView<T extends PlannerTask>(tasks: readonly T[], options: PlannerViewOptions): PlannerView<T> {
  const window = plannerWindow(options.today, options.offset)
  const { today, first, last } = window
  const placements = new Map<string, PlannerPlacement>()
  const byDay = new Map<string, T[]>()
  const noDayTasks: T[] = []
  for (const task of tasks) {
    if (!inPlanner(task, last)) continue
    const placement = plannerPlacement(task, today, last)
    if (!placement) {
      noDayTasks.push(task)
      continue
    }
    placements.set(task.uid, placement)
    const key = dayKey(placement.day)
    const list = byDay.get(key)
    if (list) list.push(task)
    else byDay.set(key, [task])
  }
  const ordered = (list: readonly T[] | undefined): T[] => (list ? plannerOrder(list, placements, options.order) : [])
  const todayKey = dayKey(today)
  const todayGroup: PlannerGroup<T> = { key: todayKey, kind: 'today', day: today, tasks: ordered(byDay.get(todayKey)) }

  const tomorrow = addDays(today, 1)
  const picked = options.picked ? startOfDay(new Date(options.picked)) : null
  const pickedInWindow = picked != null && picked.getTime() >= first.getTime() && picked.getTime() <= last.getTime()
  const from = pickedInWindow ? picked : first
  const start = from.getTime() < tomorrow.getTime() ? tomorrow : from
  const days: PlannerGroup<T>[] = []
  for (const day of window.days) {
    if (day.getTime() < start.getTime()) continue
    const key = dayKey(day)
    days.push({ key, kind: 'day', day, tasks: ordered(byDay.get(key)) })
  }

  const tiles = window.days.map((day) => {
    const key = dayKey(day)
    const reasons = (byDay.get(key) ?? []).flatMap((t) => placements.get(t.uid)?.reason ?? [])
    return tileOf(day, key === todayKey, reasons)
  })

  const noDay: PlannerGroup<T> = { key: PLANNER_NO_DAY_KEY, kind: 'noday', day: null, tasks: ordered(noDayTasks) }
  const shown: T[] = [...todayGroup.tasks]
  for (const day of window.days) {
    const key = dayKey(day)
    if (key !== todayKey) shown.push(...ordered(byDay.get(key)))
  }
  shown.push(...noDay.tasks)
  // Only the shown tasks' placements: a day between tomorrow and a shifted window has no group.
  const shownUids = new Set(shown.map((t) => t.uid))
  for (const uid of [...placements.keys()]) if (!shownUids.has(uid)) placements.delete(uid)
  return { window, today: todayGroup, days, noDay, tiles, tasks: shown, placements }
}

/** Where a row is dropped: a day (a tile, a day's group, Today), or Focus, no day. */
export type PlannerTarget = { kind: 'day'; day: Date } | { kind: 'noday' }

/** A target's key: its day's `dayKey` — Today's group and today's tile share it —, or `PLANNER_NO_DAY_KEY`. */
export function plannerTargetKey(target: PlannerTarget): string {
  return target.kind === 'day' ? dayKey(target.day) : PLANNER_NO_DAY_KEY
}

/** What a drop writes. */
export type PlannerDrop =
  /** Move the task's next follow-up to the day (it sat on its day by it). */
  | { kind: 'followup'; date: Date }
  /** Set the task's Do day; `undefined` clears it. */
  | { kind: 'do'; date: Date | undefined }
  /** Not allowed there: a task on its day by a date can't go to Focus, no day; a completed task goes nowhere. */
  | { kind: 'refuse' }
  /** Nothing to do: it is there already. */
  | { kind: 'none' }

/**
 * What dropping `task` — placed at `placement` (`plannerPlacement`; null:
 * no day) — on `target` writes. A day: nothing on the day it is on; a task
 * there by its follow-up has the follow-up moved; any other gets the day as
 * its Do day. Focus, no day: a Do day is cleared; a task placed by its due
 * date or follow-up is refused. A completed task is refused everywhere (the
 * Planner holds open tasks). Never the due date.
 */
export function plannerDrop(
  task: Pick<PlannerTask, 'doDate' | 'isCompleted'>,
  placement: PlannerPlacement | null,
  target: PlannerTarget,
): PlannerDrop {
  if (task.isCompleted) return { kind: 'refuse' }
  if (target.kind === 'noday') {
    if (task.doDate != null) return { kind: 'do', date: undefined }
    return placement ? { kind: 'refuse' } : { kind: 'none' }
  }
  const date = startOfDay(new Date(target.day))
  if (placement && placement.day.getTime() === date.getTime()) return { kind: 'none' }
  return placement?.reason === 'followup' ? { kind: 'followup', date } : { kind: 'do', date }
}

/** Where in a group a dropped row lands. */
export interface PlannerDropPosition {
  /** The group's tasks as it shows them: their `uid`s. */
  rows: readonly string[]
  /** Before row `index` of `rows` without the dropped one (`rows.length` or more: at the group's end). */
  index: number
  /** Every task the Planner shows, in display order (`PlannerView.tasks`): what a hand order is written over. */
  shown: readonly string[]
}

/**
 * The hand order after `uid` lands at `position`: the whole displayed
 * sequence (`position.shown`: only the tasks the Planner shows, each once)
 * with `uid` before the row it was dropped before — after the group's last
 * row at its end; at the sequence's end in a group with no other row. At
 * most `max` `uid`s: past that, the group dropped into is kept whole and
 * the others are cut from the end.
 */
export function plannerReorder(uid: string, position: PlannerDropPosition, max: number = PLANNER_ORDER_MAX): string[] {
  const group = position.rows.filter((u) => u !== uid)
  const at = Math.max(0, Math.min(Math.trunc(position.index), group.length))
  const rest = [...new Set(position.shown)].filter((u) => u !== uid)
  const before = group[at]
  const after = group[at - 1]
  let place = rest.length
  if (before != null && rest.includes(before)) place = rest.indexOf(before)
  else if (after != null && rest.includes(after)) place = rest.indexOf(after) + 1
  const sequence = [...rest.slice(0, place), uid, ...rest.slice(place)]
  if (sequence.length <= max) return sequence
  const keep = new Set([uid, ...group])
  let room = Math.max(0, max - keep.size)
  return sequence.filter((u) => keep.has(u) || room-- > 0).slice(0, max)
}

/** What a drop does, all of it: the write, the hand order, and whether the row leaves its group. */
export interface PlannerDropPlan {
  /** The write (`plannerDrop`). */
  drop: PlannerDrop
  /** The hand order to store; absent: it stays as it is. */
  order?: string[]
  /** The write moves the row to another group (or out of the Planner): it shows there once the write lands. */
  moves: boolean
}

/**
 * What dropping `task` on `target` does in a Planner whose window is
 * `window`: the write `plannerDrop` decides for the task's placement there,
 * and — dropped into a group at `position` — the hand order with the row
 * where it was dropped (`plannerReorder`). A refused drop changes nothing;
 * one that writes nothing reorders only a task the group already shows, and
 * only when it lands somewhere else.
 */
export function plannerDropPlan(
  task: PlannerTask,
  window: Pick<PlannerWindow, 'today' | 'last'>,
  target: PlannerTarget,
  position: PlannerDropPosition | null = null,
): PlannerDropPlan {
  const drop = plannerDrop(task, plannerPlacement(task, window.today, window.last), target)
  const moves = drop.kind === 'followup' || drop.kind === 'do'
  if (!position || drop.kind === 'refuse') return { drop, moves }
  if (drop.kind === 'none' && !position.rows.includes(task.uid)) return { drop, moves }
  const order = plannerReorder(task.uid, position)
  if (drop.kind === 'none') {
    // Dropped where it is: nothing to store.
    const shown = [...new Set(position.shown)]
    if (order.length === shown.length && order.every((u, i) => u === shown[i])) return { drop, moves }
  }
  return { drop, order, moves }
}

/** What the lifted row's label says a drop will write, and in which color. */
export interface PlannerDropLabel {
  text: string
  /** The date the drop changes: the follow-up's color, or the Do day's (Focus). */
  tone: 'followup' | 'do'
}

/** A day in the drag's and the menu's words: `Today`, else `Wed, Nov 25`. */
export function plannerDayWords(day: Date, today: Date): string {
  return startOfDay(new Date(day)).getTime() === startOfDay(new Date(today)).getTime() ? 'Today' : plannerDayLabel(day)
}

/**
 * The label a drop that writes carries: `Follow-up · Wed, Nov 25`,
 * `Do · Wed, Nov 25`, `No day` (a Do day cleared); none for a drop that is
 * refused or writes nothing.
 */
export function plannerDropLabel(drop: PlannerDrop, today: Date): PlannerDropLabel | null {
  if (drop.kind === 'followup') return { text: `Follow-up · ${plannerDayWords(drop.date, today)}`, tone: 'followup' }
  if (drop.kind === 'do') return { text: drop.date ? `Do · ${plannerDayWords(drop.date, today)}` : 'No day', tone: 'do' }
  return null
}

/** A day in words: `Mon, Nov 23` (a group's header, a tile's name). */
export function plannerDayLabel(day: Date): string {
  return formatDateWith(day, { weekday: 'short', month: 'short', day: 'numeric' })
}

/** A tile's accessible name: `Mon, Nov 23: 3 tasks`. */
export function plannerTileLabel(tile: Pick<PlannerTile, 'day' | 'count' | 'isToday'>): string {
  const day = tile.isToday ? `Today, ${formatDateWith(tile.day, { month: 'short', day: 'numeric' })}` : plannerDayLabel(tile.day)
  return `${day}: ${tile.count === 0 ? 'no tasks' : `${tile.count} ${tile.count === 1 ? 'task' : 'tasks'}`}`
}

/** The window in words: `Nov 20 – 26`, `Nov 28 – Dec 4`, `Dec 28, 2026 – Jan 3, 2027`. */
export function plannerRangeLabel(window: Pick<PlannerWindow, 'first' | 'last'>): string {
  const { first, last } = window
  const md = (d: Date) => formatDateWith(d, { month: 'short', day: 'numeric' })
  if (first.getFullYear() !== last.getFullYear()) {
    const mdy = (d: Date) => formatDateWith(d, { month: 'short', day: 'numeric', year: 'numeric' })
    return `${mdy(first)} – ${mdy(last)}`
  }
  if (first.getMonth() !== last.getMonth()) return `${md(first)} – ${md(last)}`
  return `${md(first)} – ${last.getDate()}`
}
