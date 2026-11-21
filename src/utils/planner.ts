import type { TaskPlan, TaskPlanChange, TodoItem } from '../models/todo-item'
import { PLANNER_ORDER_MAX } from '../models/workspace-layout'
import { addDays, dayKey, formatDateWith, MS_PER_DAY, startOfDay } from './date'

/**
 * The Planner's rules (widget kind `planner`), all pure: the widget
 * (`components/workspace/planner`) draws what these return and
 * `services/planner-drop` writes what they decide.
 *
 * The Planner is a scratch pad: **a drag only ever changes the plan, never
 * a task's real dates.** A task's **plan state** is one of none, a planned
 * day (`doDate`) or held in Unplanned (`unplanned`) — `TaskPlan`.
 *
 * Here: which tasks the Planner holds and where each sits
 * (`plannerPlacement`: a day, the Delayed tray, the Unplanned tray), the
 * real dates a plan falls after and their fixes (`PlannerConflict`), the
 * groups and tiles of a seven-day window (`plannerView`), a tile's marks
 * (`plannerTileMarks`) and a row's tag (`plannerRowTag`), the hand order
 * (`plannerOrder`, `plannerReorder`), what a drop writes (`plannerDrop` —
 * the only place the drop rule lives; Snooze, Unplan and Move to day › go
 * through it), and what Unplan all Delayed and Reset plan change.
 */

/** Days in the Planner's window (its strip's tiles). */
export const PLANNER_WINDOW_DAYS = 7

/** The most marks a tile draws before `+N`. */
export const PLANNER_TILE_TICKS_MAX = 8

/** A real date of a task the Planner reads: its due date or its next follow-up. */
export type PlannerDateKind = 'due' | 'followup'

/** What the placement reads of a task. */
export type PlannerTask = Pick<TodoItem, 'uid' | 'isCompleted' | 'focus' | 'doDate' | 'unplanned' | 'dueDate' | 'nextFollowupAt' | 'sortOrder'>

/** The Planner's seven days. */
export interface PlannerWindow {
  /** Today (local midnight): the Today group's day whatever the offset. */
  today: Date
  /** The window's days, first to last. */
  days: readonly Date[]
  first: Date
  last: Date
}

/** What a placement is read against: today and the window's last day. */
export type PlannerSpan = Pick<PlannerWindow, 'today' | 'last'>

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

const dayOf = (d: Date): Date => startOfDay(new Date(d))
const dayTime = (d: Date): number => dayOf(d).getTime()
/** Whole calendar days from `from`'s day to `to`'s (a 23- or 25-hour day counts as one). */
const daysBetween = (from: Date, to: Date): number => Math.round((dayTime(to) - dayTime(from)) / MS_PER_DAY)

// ── Where a task sits ───────────────────────────────────────────────────

/** The day a task's own dates put it on. */
export interface PlannerNaturalDay {
  /** The day it shows on (local midnight): the date's day, or today for a date before today. */
  day: Date
  /** The date itself (local midnight), which may be before today. */
  date: Date
  /** Which date: the due date, also when the follow-up is on the same day. */
  reason: PlannerDateKind
}

/**
 * A task's **natural day**: the earlier of its next follow-up and its due
 * date, when that is on or before `last` — the same day counts as the due
 * date's; a date before `today` shows on today. None for a task with
 * neither, or whose earlier date lies past the window.
 */
export function plannerNaturalDay(task: Pick<PlannerTask, 'dueDate' | 'nextFollowupAt'>, span: PlannerSpan): PlannerNaturalDay | null {
  const { dueDate: due, nextFollowupAt: followup } = task
  const byDue = due != null && (followup == null || dayTime(due) <= dayTime(followup))
  const picked = byDue ? due : followup
  if (picked == null || dayTime(picked) > dayTime(span.last)) return null
  const date = dayOf(picked)
  const today = dayOf(span.today)
  return { day: date.getTime() < today.getTime() ? today : date, date, reason: byDue ? 'due' : 'followup' }
}

/**
 * A task's **planned day**: its `doDate`'s day — unless that is the very day
 * of its earliest real date (the earlier of its next follow-up and its due
 * date, wherever it lies: no window bounds it). Such a plan is **redundant**
 * — the task's own date puts it on that day anyway — and reads as no plan:
 * the row is not placed, and once the day has passed it is simply overdue
 * in Today, never in Delayed. Read here, not at the write, so it holds
 * whichever came last: the plan, or an edit of the date onto its day.
 */
export function plannerPlannedDay(task: Pick<PlannerTask, 'doDate' | 'dueDate' | 'nextFollowupAt'>): Date | null {
  if (task.doDate == null) return null
  const planned = dayOf(task.doDate)
  const { dueDate: due, nextFollowupAt: followup } = task
  const own = due != null && (followup == null || dayTime(due) <= dayTime(followup)) ? due : followup
  return own != null && dayTime(own) === planned.getTime() ? null : planned
}

/** A fix for a plan that falls after a real date. */
export type PlannerFix =
  /** Move that date to the planned day: a real edit of the task (stamped, undoable, in its history). */
  | { kind: 'move-date'; date: PlannerDateKind; to: Date }
  /** Plan the task for that date's day instead (the drop rule: on its natural day the plan is cleared). */
  | { kind: 'plan'; day: Date }

/** A real date the task's planned day falls after. */
export interface PlannerConflict {
  /** Which date. */
  date: PlannerDateKind
  /** That date's day (local midnight). */
  on: Date
  /** Whole days from that day to the planned day: 1 or more. */
  days: number
  /**
   * The fixes on offer: move that date to the planned day — always —, then
   * plan for that date's day — only when it is today or later.
   */
  fixes: PlannerFix[]
}

/** Where a task sits in the Planner, and what its rows and tags are drawn from. */
export interface PlannerPlacement {
  /** A day of the window (today included), the Delayed tray, or the Unplanned tray. */
  where: 'day' | 'delayed' | 'unplanned'
  /** The day it sits on (local midnight); null in a tray. */
  day: Date | null
  /**
   * Why it is there: its planned day (`plan` — on that day, or in Delayed
   * once the day has passed), held in Unplanned (`held`), its due date or
   * follow-up (`due` / `followup`: its natural day — also for a task
   * **planned later**, for a day past the window: it shows on its natural
   * day meanwhile, `planned` set and `placed`), or in Focus with no plan
   * and no natural day (`focus`, in Unplanned).
   */
  reason: 'plan' | 'held' | PlannerDateKind | 'focus'
  /** It has a plan state: a planned day or held in Unplanned (the row's placed mark). */
  placed: boolean
  /** Its planned day (`doDate`, local midnight): a Delayed row's is the day it was planned for. Null without one. */
  planned: Date | null
  /** Its natural day, wherever it sits: the day a held row came off, the day a drop there clears the plan. Null with none. */
  natural: PlannerNaturalDay | null
  /** The real dates its planned day falls after, the due date first; only for a row on its planned day. */
  conflicts: PlannerConflict[]
}

/** The real dates a plan for `planned` falls after, with their fixes. */
export function plannerConflicts(task: Pick<PlannerTask, 'dueDate' | 'nextFollowupAt'>, planned: Date, today: Date): PlannerConflict[] {
  const to = dayOf(planned)
  const kinds: Array<[PlannerDateKind, Date | undefined]> = [['due', task.dueDate], ['followup', task.nextFollowupAt]]
  return kinds.flatMap(([date, value]): PlannerConflict[] => {
    if (value == null) return []
    const on = dayOf(value)
    const days = daysBetween(on, to)
    if (days <= 0) return []
    const fixes: PlannerFix[] = [{ kind: 'move-date', date, to }]
    if (on.getTime() >= dayTime(today)) fixes.push({ kind: 'plan', day: on })
    return [{ date, on, days, fixes }]
  })
}

/**
 * Whether the Planner holds `task` for a window ending on `last`: open, and
 * in Focus, or planned for a day, or held in Unplanned, or with a natural
 * day (due or due for a follow-up on or before that day).
 */
export function inPlanner(task: PlannerTask, span: PlannerSpan): boolean {
  if (task.isCompleted) return false
  return task.focus === true || plannerPlannedDay(task) != null || task.unplanned === true || plannerNaturalDay(task, span) != null
}

/**
 * Where `task` sits for the window ending on `span.last`; null when the
 * Planner doesn't show it there (completed, or neither in Focus nor
 * planned nor dated, or planned for a day past the window with no real
 * date inside it).
 *
 * - held (`unplanned`) → the **Unplanned** tray;
 * - a planned day (`plannerPlannedDay`: its `doDate`, unless redundant)
 *   before today → the **Delayed** tray — nothing joins Today on its own —,
 *   on or before the window's last day → that day; later (**planned
 *   later**) → its natural day when it has one — a real date on or before
 *   the window's last day still shows the task: a placed row there, its
 *   plan's conflicts with that date and their fixes on it — else not shown
 *   in this window;
 * - no plan → its natural day (`plannerNaturalDay`);
 * - no plan and no natural day: a Focus task → **Unplanned**.
 */
export function plannerPlacement(task: PlannerTask, span: PlannerSpan): PlannerPlacement | null {
  if (task.isCompleted) return null
  const natural = plannerNaturalDay(task, span)
  const today = dayOf(span.today)
  if (task.unplanned === true && task.doDate == null) {
    return { where: 'unplanned', day: null, reason: 'held', placed: true, planned: null, natural, conflicts: [] }
  }
  const planned = plannerPlannedDay(task)
  if (planned) {
    if (planned.getTime() < today.getTime()) {
      return { where: 'delayed', day: null, reason: 'plan', placed: true, planned, natural, conflicts: [] }
    }
    const conflicts = plannerConflicts(task, planned, today)
    if (planned.getTime() > dayTime(span.last)) {
      // Planned later: no day of the window is its planned day, but a real date in it (or overdue) still shows it.
      return natural ? { where: 'day', day: natural.day, reason: natural.reason, placed: true, planned, natural, conflicts } : null
    }
    return { where: 'day', day: planned, reason: 'plan', placed: true, planned, natural, conflicts }
  }
  if (natural) return { where: 'day', day: natural.day, reason: natural.reason, placed: false, planned: null, natural, conflicts: [] }
  if (task.focus === true) return { where: 'unplanned', day: null, reason: 'focus', placed: false, planned: null, natural: null, conflicts: [] }
  return null
}

/** Whether a row is **planned later**: it sits on its natural day while its planned day lies past the window. */
export function plannerPlannedLater(placement: Pick<PlannerPlacement, 'where' | 'reason' | 'planned'> | null | undefined): boolean {
  return placement != null && placement.where === 'day' && placement.reason !== 'plan' && placement.planned != null
}

/**
 * Whether a Planner whose window ends on `span.last` shows `task` in one
 * of its groups: it has a placement there (`plannerPlacement`), and — while
 * the window is shifted — its day is today or a day of the window, not one
 * between tomorrow and the window (`plannerView` has no group for those).
 */
export function plannerShows(task: PlannerTask, span: PlannerSpan): boolean {
  const placement = plannerPlacement(task, span)
  if (!placement) return false
  if (placement.where !== 'day' || !placement.day) return true
  const at = placement.day.getTime()
  return at === dayTime(span.today) || at >= addDays(dayOf(span.last), 1 - PLANNER_WINDOW_DAYS).getTime()
}

/**
 * Whether the `move-date` fix `fix` makes `task`'s plan redundant: with that
 * date moved, the task's own dates put it on its planned day (its natural
 * day is the planned one, or its earliest date is that very day, wherever
 * the window ends) — the fix then clears the plan with the date's move, and
 * the row is no longer placed. With another, earlier date still putting it
 * elsewhere, the plan stays.
 */
export function plannerFixClearsPlan(
  task: Pick<PlannerTask, 'doDate' | 'dueDate' | 'nextFollowupAt'>,
  fix: Extract<PlannerFix, { kind: 'move-date' }>,
  span: PlannerSpan,
): boolean {
  if (task.doDate == null) return false
  const to = dayOf(fix.to)
  const moved = fix.date === 'due' ? { ...task, dueDate: to } : { ...task, nextFollowupAt: to }
  if (plannerPlannedDay(moved) == null) return true
  const natural = plannerNaturalDay(moved, span)
  return natural != null && natural.day.getTime() === dayTime(task.doDate)
}

/** `2 days after due`, `1 day after follow-up`: a conflict in the tag's words. */
export function plannerConflictLabel(conflict: Pick<PlannerConflict, 'date' | 'days'>): string {
  return `${conflict.days} ${conflict.days === 1 ? 'day' : 'days'} after ${conflict.date === 'due' ? 'due' : 'follow-up'}`
}

/** A fix in its menu's words: `Move due date to Wed, Nov 25`, `Move follow-up to Today`, `Plan for Mon, Nov 23`. */
export function plannerFixLabel(fix: PlannerFix, today: Date): string {
  if (fix.kind === 'plan') return `Plan for ${plannerDayWords(fix.day, today)}`
  return `Move ${fix.date === 'due' ? 'due date' : 'follow-up'} to ${plannerDayWords(fix.to, today)}`
}

// ── The view: groups, trays, tiles ──────────────────────────────────────

/** A group of the Planner: Today, a day ahead, or one of the two trays. */
export interface PlannerGroup<T> {
  /** `today`'s or the day's `dayKey`; `PLANNER_DELAYED_KEY` / `PLANNER_UNPLANNED_KEY` for a tray. */
  key: string
  kind: 'today' | 'day' | 'delayed' | 'unplanned'
  /** Its day; null for a tray. */
  day: Date | null
  /** Its tasks, in the hand order then the default one (`plannerOrder`). */
  tasks: T[]
}

/** The key of the Delayed tray: the tasks planned for a day that has passed. */
export const PLANNER_DELAYED_KEY = 'delayed'

/** The key of the Unplanned tray: the tasks held there, and the Focus tasks with no plan and no natural day. */
export const PLANNER_UNPLANNED_KEY = 'unplanned'

/** A day's tile on the strip. */
export interface PlannerTile {
  day: Date
  /** The day's `dayKey`. */
  key: string
  isToday: boolean
  /** The rows sitting on the day. */
  count: number
  /**
   * The real dates falling on the day — due dates, then follow-ups; one
   * mark each, so a task due and due for a follow-up that day gives two —
   * of every task the Planner holds, wherever it is planned. A date before
   * today counts on today's tile.
   */
  dates: PlannerDateKind[]
  /** The plans on the day: the tasks whose planned day (`doDate`) it is. */
  plans: number
}

/** The marks a tile draws: its real dates, then its plans, then how many it leaves out. */
interface PlannerTileMarks {
  /** A solid tick per real date drawn: due dates, then follow-ups. */
  dates: PlannerDateKind[]
  /** The hollow ticks drawn: plans. */
  plans: number
  /** The marks past `PLANNER_TILE_TICKS_MAX` (`+N`). */
  more: number
}

/**
 * A tile's marks: a solid tick for each real date falling on the day
 * (`dates`), then a hollow one for each plan on it (`plans`) — at most
 * `PLANNER_TILE_TICKS_MAX` in all, the real dates first, then `+N`.
 */
export function plannerTileMarks(tile: Pick<PlannerTile, 'dates' | 'plans'>): PlannerTileMarks {
  const dates = tile.dates.slice(0, PLANNER_TILE_TICKS_MAX)
  const plans = Math.min(tile.plans, PLANNER_TILE_TICKS_MAX - dates.length)
  return { dates, plans, more: tile.dates.length + tile.plans - dates.length - plans }
}

/** What the Planner draws for a window. */
export interface PlannerView<T> {
  window: PlannerWindow
  /** Today: the tasks planned for today and those whose natural day is today (a late date among them) — also while the window is shifted. */
  today: PlannerGroup<T>
  /**
   * The days ahead, one group per day — the empty ones too — from the
   * window's first day (never before tomorrow) to its last.
   */
  days: PlannerGroup<T>[]
  /** The Delayed tray: the tasks whose planned day has passed. */
  delayed: PlannerGroup<T>
  /** The Unplanned tray: the tasks held there, and the Focus tasks with no plan and no natural day. */
  unplanned: PlannerGroup<T>
  /** The window's seven tiles. */
  tiles: PlannerTile[]
  /** Every task of Today, the window's days, Delayed and Unplanned, in that order. */
  tasks: T[]
  /** Each of those tasks' placement, by `uid`. */
  placements: ReadonlyMap<string, PlannerPlacement>
}

interface PlannerViewOptions {
  today: Date
  /** The window's offset in days (a multiple of 7; default 0). */
  offset?: number
  /** The hand order: task `uid`s. */
  order?: readonly string[]
}

/** The reasons in the order they sort and their ticks draw: deadlines, follow-ups, plans, then the rest. */
const REASON_RANK: Record<PlannerPlacement['reason'], number> = { due: 0, followup: 1, plan: 2, held: 3, focus: 4 }

/** The date a row sorts by among its reason's: its planned day, else its natural date. */
const sortTime = (p: PlannerPlacement | undefined): number => (p?.planned ?? p?.natural?.date)?.getTime() ?? 0

/**
 * `tasks` in the Planner's order: those `order` names first, as it lists
 * them, then the rest by reason (deadlines, follow-ups, plans, held, Focus),
 * then by date, then by `sortOrder`.
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
    return (pa ? REASON_RANK[pa.reason] : 5) - (pb ? REASON_RANK[pb.reason] : 5)
      || sortTime(pa) - sortTime(pb)
      || a.sortOrder - b.sortOrder
  })
}

const DATE_RANK: Record<PlannerDateKind, number> = { due: 0, followup: 1 }

/**
 * The Planner for `tasks` (those the screen filter shows; completed ones
 * and the ones it doesn't hold are left out): Today, the days ahead, the
 * Delayed and Unplanned trays, and the window's tiles. While the window is
 * shifted, Today stays today's, the days ahead start at the window's first
 * day, and a task whose day lies between tomorrow and the window is in no
 * group — the tiles are the window's.
 */
export function plannerView<T extends PlannerTask>(tasks: readonly T[], options: PlannerViewOptions): PlannerView<T> {
  const window = plannerWindow(options.today, options.offset)
  const { today } = window
  const todayKey = dayKey(today)
  const windowKeys = new Set(window.days.map(dayKey))
  const placements = new Map<string, PlannerPlacement>()
  const byDay = new Map<string, T[]>()
  const delayedTasks: T[] = []
  const unplannedTasks: T[] = []
  /** Each window day's real dates and plans, by `dayKey`. */
  const dates = new Map<string, PlannerDateKind[]>()
  const plans = new Map<string, number>()
  for (const task of tasks) {
    if (task.isCompleted) continue
    // The tiles' marks: every real date and plan on a window day, wherever the task sits.
    for (const [kind, value] of [['due', task.dueDate], ['followup', task.nextFollowupAt]] as const) {
      if (value == null) continue
      const key = dayKey(dayTime(value) < today.getTime() ? today : dayOf(value))
      if (!windowKeys.has(key)) continue
      const list = dates.get(key)
      if (list) list.push(kind)
      else dates.set(key, [kind])
    }
    const plannedDay = plannerPlannedDay(task)
    if (plannedDay) {
      const key = dayKey(plannedDay)
      if (windowKeys.has(key)) plans.set(key, (plans.get(key) ?? 0) + 1)
    }

    const placement = plannerPlacement(task, window)
    if (!placement) continue
    if (placement.where === 'delayed') delayedTasks.push(task)
    else if (placement.where === 'unplanned') unplannedTasks.push(task)
    else if (placement.day) {
      const key = dayKey(placement.day)
      // A day between tomorrow and a shifted window has no group.
      if (key !== todayKey && !windowKeys.has(key)) continue
      const list = byDay.get(key)
      if (list) list.push(task)
      else byDay.set(key, [task])
    }
    placements.set(task.uid, placement)
  }
  const ordered = (list: readonly T[] | undefined): T[] => (list ? plannerOrder(list, placements, options.order) : [])
  const todayGroup: PlannerGroup<T> = { key: todayKey, kind: 'today', day: today, tasks: ordered(byDay.get(todayKey)) }

  const days: PlannerGroup<T>[] = []
  for (const day of window.days) {
    if (day.getTime() <= today.getTime()) continue
    const key = dayKey(day)
    days.push({ key, kind: 'day', day, tasks: ordered(byDay.get(key)) })
  }

  const tiles = window.days.map((day): PlannerTile => {
    const key = dayKey(day)
    return {
      day,
      key,
      isToday: key === todayKey,
      count: (byDay.get(key) ?? []).length,
      dates: [...(dates.get(key) ?? [])].sort((a, b) => DATE_RANK[a] - DATE_RANK[b]),
      plans: plans.get(key) ?? 0,
    }
  })

  const delayed: PlannerGroup<T> = { key: PLANNER_DELAYED_KEY, kind: 'delayed', day: null, tasks: ordered(delayedTasks) }
  const unplanned: PlannerGroup<T> = { key: PLANNER_UNPLANNED_KEY, kind: 'unplanned', day: null, tasks: ordered(unplannedTasks) }
  const shown: T[] = [...todayGroup.tasks]
  for (const day of window.days) {
    const key = dayKey(day)
    if (key !== todayKey) shown.push(...ordered(byDay.get(key)))
  }
  shown.push(...delayed.tasks, ...unplanned.tasks)
  return { window, today: todayGroup, days, delayed, unplanned, tiles, tasks: shown, placements }
}

// ── A row's tag and late dates ──────────────────────────────────────────

/** The tag a Planner row carries after its title. */
export type PlannerRowTag =
  /** A Delayed row: the day it was planned for. */
  | { kind: 'planned'; day: Date }
  /** A row held in Unplanned that has a natural day: the day it came off. */
  | { kind: 'natural'; day: Date }
  /** A row planned past a real date: that conflict (the due date's when both are passed), and every fix on offer. */
  | { kind: 'conflict'; conflict: PlannerConflict; fixes: PlannerFix[] }
  /** A row planned later — for a day past the window, shown on its natural day meanwhile: the planned day, and the fixes of the dates that plan passes. */
  | { kind: 'later'; day: Date; fixes: PlannerFix[] }

/**
 * The tag of a row placed as `placement` says, or null: a Delayed row's
 * planned day; a held row's natural day; a row planned past a real date,
 * the conflict — the due date's first — with the fixes of every date it
 * passes (the same Plan for day once); a row planned later, its planned
 * day with those fixes.
 */
export function plannerRowTag(placement: PlannerPlacement | null | undefined): PlannerRowTag | null {
  if (!placement) return null
  if (placement.where === 'delayed') return placement.planned ? { kind: 'planned', day: placement.planned } : null
  if (placement.where === 'unplanned') {
    return placement.reason === 'held' && placement.natural ? { kind: 'natural', day: placement.natural.day } : null
  }
  const seen = new Set<string>()
  const fixes = placement.conflicts.flatMap((c) => c.fixes).filter((fix) => {
    const key = fix.kind === 'plan' ? `plan|${dayTime(fix.day)}` : `move|${fix.date}|${dayTime(fix.to)}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  if (plannerPlannedLater(placement) && placement.planned) return { kind: 'later', day: placement.planned, fixes }
  const conflict = placement.conflicts[0]
  return conflict ? { kind: 'conflict', conflict, fixes } : null
}

/** The real dates of a row its plan falls after: each is drawn in its late look, whatever today is. */
export function plannerLateDates(placement: PlannerPlacement | null | undefined): { due: boolean; followup: boolean } | null {
  if (!placement || placement.conflicts.length === 0) return null
  return {
    due: placement.conflicts.some((c) => c.date === 'due'),
    followup: placement.conflicts.some((c) => c.date === 'followup'),
  }
}

/**
 * A day in a tag's words: `Today`, within six days of today its weekday
 * (`Wed`), else `Nov 12`.
 */
export function plannerTagDay(day: Date, today: Date): string {
  const days = daysBetween(today, day)
  if (days === 0) return 'Today'
  return formatDateWith(day, Math.abs(days) <= 6 ? { weekday: 'short' } : { month: 'short', day: 'numeric' })
}

/**
 * A placed row's plan state in words — the corner flag's text equivalent,
 * for the row's accessible description: `planned` (on its planned day),
 * `planned for Wed` (a Delayed row; `planned for Fri, Nov 27` a row planned
 * later), `set aside` (held in Unplanned). Null for a row that isn't placed.
 */
export function plannerRowStateWords(placement: PlannerPlacement | null | undefined, today: Date): string | null {
  if (!placement?.placed) return null
  if (placement.where === 'unplanned') return 'set aside'
  if (placement.where === 'delayed') return placement.planned ? `planned for ${plannerTagDay(placement.planned, today)}` : 'planned'
  return plannerPlannedLater(placement) && placement.planned ? `planned for ${plannerDayLabel(placement.planned)}` : 'planned'
}

/** A tag's text: the day in words (`Wed`), the conflict's (`1 day after due`), or a later plan's day (`planned Fri, Nov 27`). */
export function plannerRowTagLabel(tag: PlannerRowTag, today: Date): string {
  if (tag.kind === 'later') return `planned ${plannerDayLabel(tag.day)}`
  return tag.kind === 'conflict' ? plannerConflictLabel(tag.conflict) : plannerTagDay(tag.day, today)
}

/**
 * What a tag says in full (its tooltip): `Planned for Wed, Nov 18`, `Its own
 * date puts it on Mon, Nov 23`, `Planned 1 day after its due date`, `Planned
 * for Fri, Nov 27, after the days shown`.
 */
export function plannerRowTagHint(tag: PlannerRowTag, today: Date): string {
  if (tag.kind === 'planned') return `Planned for ${plannerDayLabel(tag.day)}`
  if (tag.kind === 'later') return `Planned for ${plannerDayLabel(tag.day)}, after the days shown`
  if (tag.kind === 'natural') return `Its own date puts it on ${plannerDayWords(tag.day, today)}`
  const { days, date } = tag.conflict
  return `Planned ${days} ${days === 1 ? 'day' : 'days'} after its ${date === 'due' ? 'due date' : 'follow-up'}`
}

// ── Drops: the one decision ─────────────────────────────────────────────

/** Where a row is dropped: a day (a tile, a day's group, Today), the Unplanned tray, or the Delayed tray. */
export type PlannerTarget = { kind: 'day'; day: Date } | { kind: 'unplanned' } | { kind: 'delayed' }

/** A target's key: its day's `dayKey` — Today's group and today's tile share it —, or its tray's key. */
export function plannerTargetKey(target: PlannerTarget): string {
  if (target.kind === 'day') return dayKey(target.day)
  return target.kind === 'delayed' ? PLANNER_DELAYED_KEY : PLANNER_UNPLANNED_KEY
}

/** What a drop does to a task's plan — never to a real date. */
export type PlannerDrop =
  /** Plan it for the day: `doDate` set, `unplanned` cleared. */
  | { kind: 'plan'; day: Date }
  /** Dropped on its natural day (`day`): its plan state is cleared, and its own date puts it there. */
  | { kind: 'own'; day: Date }
  /**
   * Dropped on Unplanned: held there (`hold`) — a task with a natural day to
   * be kept off, and one that would otherwise leave the Planner (no such
   * date and not in Focus) —, else (a Focus task with no such date) its plan
   * is just cleared: Focus keeps it in Unplanned.
   */
  | { kind: 'unplan'; hold: boolean }
  /** Not allowed there: Delayed takes no drop, a completed task goes nowhere, a task the Planner doesn't hold has no plan to lose. */
  | { kind: 'refuse' }
  /** Nothing to write: it is there already (order only). */
  | { kind: 'none' }

/**
 * **The drop rule** — what dropping `task` on `target` does, in a Planner
 * whose window is `span`:
 *
 * - a completed task is refused everywhere (the Planner holds open tasks);
 * - on a day `T` (a tile, a day's group, Today = today): `T` its natural
 *   day → whatever plan state it has is cleared (`own` — a redundant plan
 *   for that very day too; with none to clear, nothing); otherwise, where
 *   it sits already → nothing (the order only), else it is planned for `T`
 *   (`plan`). A day before today is refused;
 * - on **Unplanned**: a task with a natural day is held (`unplan`,
 *   `hold`); a planned one without: in Focus it just loses its plan (Focus
 *   keeps it there), else it is held too — **Unplan never takes a task out
 *   of the Planner**. A task with no plan, no natural day and not in Focus
 *   is refused (the Planner doesn't hold it: nothing to unplan);
 * - **Delayed** takes no drop.
 *
 * Never a due date or a follow-up.
 */
export function plannerDrop(task: PlannerTask, span: PlannerSpan, target: PlannerTarget): PlannerDrop {
  if (task.isCompleted) return { kind: 'refuse' }
  const at = plannerPlacement(task, span)
  if (target.kind === 'delayed') return at?.where === 'delayed' ? { kind: 'none' } : { kind: 'refuse' }
  const natural = plannerNaturalDay(task, span)
  if (target.kind === 'unplanned') {
    if (at?.where === 'unplanned') return { kind: 'none' }
    if (natural) return { kind: 'unplan', hold: true }
    return task.doDate != null ? { kind: 'unplan', hold: task.focus !== true } : { kind: 'refuse' }
  }
  const day = dayOf(target.day)
  if (day.getTime() < dayTime(span.today)) return { kind: 'refuse' }
  // Its own day first: a plan state it still holds there (a redundant one) is cleared; with none it is there already.
  if (natural && natural.day.getTime() === day.getTime()) {
    return task.doDate != null || task.unplanned === true ? { kind: 'own', day } : { kind: 'none' }
  }
  if (at?.where === 'day' && at.day?.getTime() === day.getTime()) return { kind: 'none' }
  return { kind: 'plan', day }
}

/** The plan state a drop writes (`todo-store.setPlans`); `undefined` for one that writes nothing. */
export function plannerDropWrite(drop: PlannerDrop): TaskPlan | undefined {
  if (drop.kind === 'plan') return { day: drop.day }
  if (drop.kind === 'own') return null
  if (drop.kind === 'unplan') return drop.hold ? 'unplanned' : null
  return undefined
}

/**
 * The day **Snooze** plans a task for: the day after the day it sits on —
 * after its planned day, for a row planned later —, never earlier than
 * tomorrow; a row in Delayed (or not shown) goes to tomorrow. (A row in
 * Unplanned offers no Snooze — its button is Today — so only the rule's
 * callers outside the row see it go to tomorrow too.)
 */
export function plannerSnoozeDay(placement: Pick<PlannerPlacement, 'where' | 'day' | 'reason' | 'planned'> | null, today: Date): Date {
  const tomorrow = addDays(dayOf(today), 1)
  if (placement?.where !== 'day' || !placement.day) return tomorrow
  const from = plannerPlannedLater(placement) && placement.planned ? placement.planned : placement.day
  const next = addDays(dayOf(from), 1)
  return next.getTime() < tomorrow.getTime() ? tomorrow : next
}

/** **Snooze**: the drop rule on `plannerSnoozeDay` — so a task landing on its natural day loses its plan. */
export function plannerSnooze(task: PlannerTask, span: PlannerSpan): PlannerDrop {
  return plannerDrop(task, span, { kind: 'day', day: plannerSnoozeDay(plannerPlacement(task, span), span.today) })
}

/** **Unplan**: the drop rule on the Unplanned tray, for one task — it stays in the Planner, in Unplanned. */
export function plannerUnplan(task: PlannerTask, span: PlannerSpan): PlannerDrop {
  return plannerDrop(task, span, { kind: 'unplanned' })
}

/** A task the Planner's bulk actions write: its id beside what the rules read. */
type PlannerRow = PlannerTask & { id: number }

/**
 * **Unplan all Delayed**: each Delayed task's Unplan (`plannerUnplan` —
 * held, or a Focus task with no natural day its plan cleared), as the plan
 * changes of one write.
 */
export function plannerUnplanDelayed<T extends PlannerRow>(view: Pick<PlannerView<T>, 'window' | 'delayed'>): TaskPlanChange[] {
  return view.delayed.tasks.flatMap((task): TaskPlanChange[] => {
    const plan = plannerDropWrite(plannerUnplan(task, view.window))
    return plan === undefined ? [] : [{ id: task.id, plan }]
  })
}

/** What Reset plan clears: this week, today only, or the Delayed tray. */
export type PlannerResetScope = 'week' | 'today' | 'delayed'

/**
 * The tasks **Reset plan** clears the plan state of:
 *
 * - `week` — every task with a plan state that the Planner shows or holds:
 *   planned for a day it shows (Today and the window's days), in Delayed,
 *   or held in Unplanned — the days shown, so "this week" only while the
 *   window starts today (`plannerResetWeekLabel`);
 * - `today` — the tasks planned for today;
 * - `delayed` — the tasks in Delayed.
 */
export function plannerResetTasks<T extends PlannerTask>(view: PlannerView<T>, scope: PlannerResetScope): T[] {
  if (scope === 'delayed') return view.delayed.tasks
  if (scope === 'today') return view.today.tasks.filter((t) => view.placements.get(t.uid)?.reason === 'plan')
  return view.tasks.filter((t) => view.placements.get(t.uid)?.placed === true)
}

/**
 * The week scope's name: `This week` only while the window starts today;
 * shifted, it is the days shown that are reset, so their range in words
 * (`Nov 27 – Dec 3`).
 */
export function plannerResetWeekLabel(window: Pick<PlannerWindow, 'today' | 'first' | 'last'>): string {
  return dayTime(window.first) === dayTime(window.today) ? 'This week' : plannerRangeLabel(window)
}

/** How many tasks each Reset plan scope would clear. */
export function plannerResetCounts<T extends PlannerTask>(view: PlannerView<T>): Record<PlannerResetScope, number> {
  return {
    week: plannerResetTasks(view, 'week').length,
    today: plannerResetTasks(view, 'today').length,
    delayed: plannerResetTasks(view, 'delayed').length,
  }
}

// ── The hand order ──────────────────────────────────────────────────────

/** Where in a group a dropped row lands. */
export interface PlannerDropPosition {
  /** The group's tasks as it shows them: their `uid`s. */
  rows: readonly string[]
  /** Before row `index` of `rows` without the dropped one (`rows.length` or more: at the group's end). */
  index: number
  /** Every task the Planner shows now, in display order (`PlannerView.tasks`): the rows a place is read against. */
  shown: readonly string[]
}

/** The hand order a drop is merged into. */
interface PlannerStoredOrder {
  /** The stored order (`PlannerTabViewState.order`): `uid`s, the tasks the Planner doesn't show now among them. */
  order?: readonly string[]
  /**
   * Whether a task still exists (not deleted, not purged). Only a `uid` it
   * says is gone leaves the order; without it every stored `uid` stays.
   */
  exists?: (uid: string) => boolean
  /** The most `uid`s kept (default `PLANNER_ORDER_MAX`). */
  max?: number
}

/** The landing place among a group's rows without the dropped one. */
function landingIndex(position: PlannerDropPosition, uid: string): number {
  const others = position.rows.filter((u) => u !== uid).length
  return Math.max(0, Math.min(Math.trunc(position.index), others))
}

/**
 * The hand order after `uid` lands at `position`: the new arrangement
 * **merged into the stored order** (`stored.order`), so a task the Planner
 * doesn't show just now — hidden by the screen filter, on a day outside a
 * shifted window, completed — keeps its place. The trays' rows (Delayed,
 * Unplanned) are in the one sequence like any group's.
 *
 * - Every stored `uid` but the moved one keeps its position relative to
 *   every other; only one of a task that no longer exists (`stored.exists`)
 *   goes.
 * - Every task shown takes a place (the order is written over what is on
 *   screen): one the order didn't hold goes right after the row shown
 *   before it — so each group reads as it does now.
 * - The moved row goes right after the row above its landing place, at a
 *   group's top right before the row below it — its visible neighbours —,
 *   and at the end in a group with no other row.
 *
 * At most `stored.max` `uid`s: over it, the tasks not shown go first, the
 * earliest in the sequence first; were the shown ones alone still too many,
 * the group dropped into is kept whole and the others are cut from the end.
 */
export function plannerReorder(uid: string, position: PlannerDropPosition, stored: PlannerStoredOrder = {}): string[] {
  const { exists, max = PLANNER_ORDER_MAX } = stored
  const shown = [...new Set(position.shown)].filter((u) => u !== uid)
  const visible = new Set(shown)
  const sequence = [...new Set(stored.order ?? [])].filter((u) => u !== uid && (visible.has(u) || !exists || exists(u)))
  const listed = new Set(sequence)

  // The shown tasks the order didn't hold: each right after the row shown before it.
  let above: string | null = null
  for (const u of shown) {
    if (!listed.has(u)) {
      sequence.splice(above == null ? 0 : sequence.indexOf(above) + 1, 0, u)
      listed.add(u)
    }
    above = u
  }

  // The moved row, by its visible neighbours.
  const group = position.rows.filter((u) => u !== uid)
  const at = landingIndex(position, uid)
  const before = group[at - 1]
  const after = group[at]
  let place = sequence.length
  if (before != null && listed.has(before)) place = sequence.indexOf(before) + 1
  else if (after != null && listed.has(after)) place = sequence.indexOf(after)
  sequence.splice(place, 0, uid)
  if (sequence.length <= max) return sequence

  // Over the cap: the tasks not shown first, the earliest first.
  let over = sequence.length - max
  const kept = sequence.filter((u) => u === uid || visible.has(u) || over-- <= 0)
  if (kept.length <= max) return kept
  const keep = new Set([uid, ...group])
  let room = Math.max(0, max - keep.size)
  return kept.filter((u) => keep.has(u) || room-- > 0).slice(0, max)
}

/** What a move does, all of it: the plan write, the hand order, and whether the row leaves its group. */
export interface PlannerMovePlan {
  /** What it does to the task's plan (`plannerDrop`). */
  drop: PlannerDrop
  /** The hand order to store; absent: it stays as it is. */
  order?: string[]
  /** The write moves the row to another group (or out of the Planner): it shows there once the write lands. */
  moves: boolean
  /**
   * The write takes the task **out of view**: planned for this day, which
   * the Planner shows in no group (past the window, with no real date
   * inside it; or between tomorrow and a shifted window) — the write then
   * says so (`services/planner-drop`: the snackbar names the day, with Undo).
   */
  hidden?: Date
}

/**
 * What dropping `task` on `target` does in a Planner whose window is
 * `span`: what `plannerDrop` decides, and — dropped into a group at
 * `position` — the hand order with the row where it was dropped, merged
 * into the one stored (`plannerReorder`). A refused drop changes nothing;
 * one that writes nothing reorders only a task the group already shows,
 * and only when it lands somewhere else. A plan for a day the Planner then
 * shows the task on nowhere is `hidden` (`plannerShows`).
 */
export function plannerMovePlan(
  task: PlannerTask,
  span: PlannerSpan,
  target: PlannerTarget,
  position: PlannerDropPosition | null = null,
  stored: PlannerStoredOrder = {},
): PlannerMovePlan {
  const drop = plannerDrop(task, span, target)
  const moves = plannerDropWrite(drop) !== undefined
  const hidden = drop.kind === 'plan' && !plannerShows({ ...task, doDate: drop.day, unplanned: undefined }, span) ? drop.day : undefined
  if (!position || drop.kind === 'refuse') return { drop, moves, hidden }
  if (drop.kind === 'none') {
    const from = position.rows.indexOf(task.uid)
    // Not a row of the group, or dropped where it is: nothing to store.
    if (from === -1 || from === landingIndex(position, task.uid)) return { drop, moves }
  }
  return { drop, order: plannerReorder(task.uid, position, stored), moves, hidden }
}

/** A day in the drag's and the menu's words: `Today`, else `Wed, Nov 25`. */
export function plannerDayWords(day: Date, today: Date): string {
  return startOfDay(new Date(day)).getTime() === startOfDay(new Date(today)).getTime() ? 'Today' : plannerDayLabel(day)
}

/**
 * The label a drop that writes carries: `Plan · Wed, Nov 25` (planned for
 * the day), `Its date · Wed, Nov 25` (its plan cleared on its own date's
 * day), `Unplan` (to the Unplanned tray); none for a drop that is refused
 * or writes nothing.
 */
export function plannerDropLabel(drop: PlannerDrop, today: Date): string | null {
  if (drop.kind === 'plan') return `Plan · ${plannerDayWords(drop.day, today)}`
  if (drop.kind === 'own') return `Its date · ${plannerDayWords(drop.day, today)}`
  if (drop.kind === 'unplan') return 'Unplan'
  return null
}

/** A day in words: `Mon, Nov 23` (a group's header, a tile's name). */
export function plannerDayLabel(day: Date): string {
  return formatDateWith(day, { weekday: 'short', month: 'short', day: 'numeric' })
}

/**
 * A tile's accessible name: its day, the rows on it, then what its marks
 * say — the real dates falling on it and the plans for it: `Mon, Nov 23: 2
 * tasks, 1 due, 1 planned`, `Sun, Nov 22: no tasks, 2 follow-ups`, `Today,
 * Nov 20: no tasks`.
 */
export function plannerTileLabel(tile: Pick<PlannerTile, 'day' | 'count' | 'isToday'> & Partial<Pick<PlannerTile, 'dates' | 'plans'>>): string {
  const day = tile.isToday ? `Today, ${formatDateWith(tile.day, { month: 'short', day: 'numeric' })}` : plannerDayLabel(tile.day)
  const due = (tile.dates ?? []).filter((d) => d === 'due').length
  const followups = (tile.dates ?? []).length - due
  const marks = [
    due > 0 ? `${due} due` : null,
    followups > 0 ? `${followups} ${followups === 1 ? 'follow-up' : 'follow-ups'}` : null,
    (tile.plans ?? 0) > 0 ? `${tile.plans} planned` : null,
  ].filter((part) => part != null)
  return [`${day}: ${tile.count === 0 ? 'no tasks' : `${tile.count} ${tile.count === 1 ? 'task' : 'tasks'}`}`, ...marks].join(', ')
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
