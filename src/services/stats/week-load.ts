import type { PersistedTodoItem, StatusUpdate, TodoEvent, TodoEventType } from '../../models'
import { addDays, weekStartOf } from '../../utils/calendar-grid'
import { startOfDay } from '../../utils/date'
import { daysUntil, type WeekStart } from '../../utils/effective-date'
import { computeNextDueDate } from '../../utils/recurrence'
import { WEEK_LOAD_PAST_WEEKS } from '../../utils/trend-window'
import { eventsByTask, taskFieldReplayAt, type DatedEvent, type TaskFields } from './task-history'

/**
 * The week load: how the dates that put tasks on each day — due, follow-up,
 * planned — fared, week by week, against the usual week. Pure: the hook
 * (`hooks/use-week-load`) hands it every task (the screen filter is never
 * applied), their events, their status updates, the first day of the week,
 * the two log stamps and now.
 *
 * **Where a date lands.** A task's Planner day at a moment is its planned
 * day if it has one, else the earlier of its due date and next follow-up
 * (the due date's on a tie) — `utils/planner.plannerNaturalDay`'s rule
 * without its clamps. Its kind is the date that put it there. A task lands
 * on day D when, open, its Planner day was D at D's start or became D
 * during D; once per day, under the kind that put it there first. The
 * fields come from the one replay (`task-history.taskFieldReplayAt`), read
 * at D's start and after each change during D.
 *
 * **What became of it.** Done when, by D's end, the task was completed
 * (a repeating task's advance counts: a `deadline` event to exactly the
 * date its rule advances to that day), or — follow-up and planned — followed
 * up (a `followedUp` event), or — planned only — had a status update dated
 * from the day it was planned for D (or D itself) through D. Otherwise,
 * scanning the changes after the landing: a done signal later → **late**;
 * the Planner day leaving D → **removed** when the date that put it there
 * was cleared, else **moved**; nothing → **late** (still on D). Today, what
 * isn't done, moved or removed is still **ahead**; days to come count the
 * tasks' current dates, all ahead.
 *
 * **Before the logs reach back.** A day before `planLogSince`'s day places
 * tasks without their planned day, one before `historyLogSince`'s without
 * their follow-up; such a week carries a note naming the stamp.
 *
 * **The usual week.** The median number of completions per week over the
 * `WEEK_LOAD_PAST_WEEKS` full weeks before this one, and each weekday's
 * share of those weeks' completions.
 */

/** The kinds of date, in the order a day's boxes stack. */
export type WeekLoadKind = 'due' | 'followup' | 'planned'
const WEEK_LOAD_KINDS: readonly WeekLoadKind[] = ['due', 'followup', 'planned']

/** Weeks after this one the week load shows. */
const WEEK_LOAD_FUTURE_WEEKS = 6

/** What became of one day's landings of one kind. `late` + `moved` + `removed` slipped; `ahead` is still to come. */
export interface WeekLoadCounts {
  done: number
  late: number
  moved: number
  removed: number
  ahead: number
}

interface WeekLoadDay {
  /** The day (local midnight). */
  date: Date
  /** Gone by, today (done so far, the rest ahead) or to come (all ahead). */
  when: 'past' | 'today' | 'future'
  kinds: Record<WeekLoadKind, WeekLoadCounts>
}

interface WeekLoadTotals {
  /** Every landing of the week. */
  load: number
  done: number
  /** `late` + `moved` + `removed`. */
  slipped: number
  ahead: number
  late: number
  moved: number
  removed: number
}

/** A week reaching back before a log began: `planned` — before `planLogSince`; `followup` — before `historyLogSince`. */
interface WeekLoadNote {
  log: 'planned' | 'followup'
  /** When that log began (now, while not stamped). */
  since: Date
}

interface WeekLoadWeek {
  /** The week's first day (`weekStartsOn`). */
  start: Date
  /** Weeks from this one: -8 … 6, 0 = this week. */
  offset: number
  /** Its 7 days, from `start`. */
  days: readonly WeekLoadDay[]
  totals: WeekLoadTotals
  /** `slipped / (done + slipped)` as a whole percentage; `null` when nothing has closed. */
  slipPct: number | null
  notes: readonly WeekLoadNote[]
}

interface UsualWeek {
  /** The median completions per week over the full weeks read (may be a half). */
  perWeek: number
  /** Each day of the week's share of those completions, indexed as a week's `days` (from `weekStartsOn`); sums to 1 (even shares when there were none). */
  weekdayShares: readonly number[]
}

export interface WeekLoad {
  /** From `WEEK_LOAD_PAST_WEEKS` weeks back to `WEEK_LOAD_FUTURE_WEEKS` ahead, oldest first, this week included. */
  weeks: readonly WeekLoadWeek[]
  usual: UsualWeek
}

interface WeekLoadInput {
  /** Every task (never screen-filtered). */
  tasks: readonly PersistedTodoItem[]
  /** Their events of `WEEK_LOAD_EVENT_TYPES` from `trend-window.weekLoadEventsStart` on (more is fine). */
  events: readonly TodoEvent[]
  /** Status updates by task (`status-update-store.byTodo`). */
  statusUpdates: ReadonlyMap<number, readonly Pick<StatusUpdate, 'date'>[]>
  weekStartsOn: WeekStart
  planLogSince: Date | null
  historyLogSince: Date | null
  now: Date
}

/** The event types the week load replays. */
const WEEK_LOAD_EVENT_TYPES: readonly TodoEventType[] = ['created', 'completed', 'reopened', 'deadline', 'followup', 'followedUp', 'planned']

type Outcome = keyof WeekLoadCounts

interface Placed {
  day: number
  kind: WeekLoadKind
}

/** Which dates place a task on a day: the planned day only once its log began, the follow-up likewise. */
interface PlaceMode {
  planned: boolean
  followup: boolean
}

const ALL_DATES: PlaceMode = { planned: true, followup: true }

type PlacedFields = Pick<TaskFields, 'dueDate' | 'nextFollowupAt' | 'doDate'>

/** The task's Planner day (in days from `origin`) and the kind that put it there; null when nothing does. */
function plannerDayOf(f: PlacedFields, mode: PlaceMode, origin: Date): Placed | null {
  const planned = mode.planned ? daysUntil(f.doDate, origin) : null
  if (planned != null) return { day: planned, kind: 'planned' }
  const due = daysUntil(f.dueDate, origin)
  const followup = mode.followup ? daysUntil(f.nextFollowupAt, origin) : null
  if (due != null && (followup == null || due <= followup)) return { day: due, kind: 'due' }
  return followup != null ? { day: followup, kind: 'followup' } : null
}

function kindDate(f: PlacedFields, kind: WeekLoadKind): Date | null {
  if (kind === 'planned') return f.doDate
  return kind === 'due' ? f.dueDate : f.nextFollowupAt
}

function dateOf(v: string | number | null): Date | null {
  if (typeof v !== 'string') return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

function emptyCounts(): WeekLoadCounts {
  return { done: 0, late: 0, moved: 0, removed: 0, ahead: 0 }
}

/** A repeating task's advance: a `deadline` event to exactly the day its rule advances the old date to on the event's day. */
function isRepeatAdvance(task: PersistedTodoItem, e: DatedEvent): boolean {
  if (e.type !== 'deadline' || !task.recurrenceRule) return false
  const from = dateOf(e.fromValue)
  const to = dateOf(e.toValue)
  if (!from || !to || to.getTime() <= from.getTime()) return false
  const next = computeNextDueDate(from, task.recurrenceRule, startOfDay(new Date(e.time)))
  return daysUntil(to, next) === 0
}

/** One task's history, read for the week load. */
interface TaskTimeline {
  fieldsAt: (time: number) => TaskFields | null
  /** Every moment something changed, oldest first (event times, and an unlogged completion's). */
  times: readonly number[]
  /** Completions, a repeating task's advances included. */
  completions: readonly number[]
  followedUps: readonly number[]
  /** `planned` events: when, and the day (from `origin`) they planned. */
  plans: readonly { time: number; day: number | null }[]
  /** Status updates' days (from `origin`). */
  statusDays: readonly number[]
}

function timelineOf(
  task: PersistedTodoItem,
  events: readonly DatedEvent[],
  statusUpdates: readonly Pick<StatusUpdate, 'date'>[] | undefined,
  fieldsAt: (time: number) => TaskFields | null,
  origin: Date,
): TaskTimeline {
  const completions: number[] = []
  const followedUps: number[] = []
  const plans: { time: number; day: number | null }[] = []
  for (const e of events) {
    if (e.type === 'completed' || isRepeatAdvance(task, e)) completions.push(e.time)
    else if (e.type === 'followedUp' && e.toValue != null) followedUps.push(e.time)
    else if (e.type === 'planned') plans.push({ time: e.time, day: daysUntil(dateOf(e.toValue), origin) })
  }
  const times = new Set(events.map((e) => e.time))
  // Completed now with no completion logged after its last state event (an import, a gap): its own time.
  const lastState = events.filter((e) => e.type === 'created' || e.type === 'completed' || e.type === 'reopened').at(-1)
  if (task.isCompleted && lastState?.type !== 'completed') {
    const at = new Date(task.completedAt ?? task.modifiedAt).getTime()
    if (!Number.isNaN(at)) {
      completions.push(at)
      times.add(at)
    }
  }
  return {
    fieldsAt,
    times: [...times].sort((a, b) => a - b),
    completions,
    followedUps,
    plans,
    statusDays: (statusUpdates ?? []).flatMap((u) => {
      const day = daysUntil(u.date, origin)
      return day == null ? [] : [day]
    }),
  }
}

/** What became of a landing on day `d` (see the module comment). `today` is `d === todayIndex`. */
function outcomeOf(
  t: TaskTimeline,
  landing: { time: number; kind: WeekLoadKind },
  d: number,
  dayEnd: number,
  mode: PlaceMode,
  origin: Date,
  today: boolean,
): Outcome {
  const { kind } = landing
  const signals = kind === 'due' ? t.completions : [...t.completions, ...t.followedUps]
  let from = landing.time
  if (kind === 'planned') {
    // From when the task was planned for this day, if the log says.
    const set = t.plans.filter((p) => p.day === d && p.time <= landing.time).at(-1)
    if (set) from = Math.min(from, set.time)
  }
  if (signals.some((s) => s >= from && s < dayEnd)) return 'done'
  if (kind === 'planned') {
    const fromDay = daysUntil(new Date(from), origin) ?? d
    if (t.statusDays.some((s) => s >= fromDay && s <= d)) return 'done'
  }
  let current = kind
  for (const time of t.times) {
    if (time <= landing.time) continue
    if (signals.includes(time)) return today ? 'ahead' : 'late'
    const f = t.fieldsAt(time)
    if (!f || f.state === 'done') return today ? 'ahead' : 'late'
    const placed = plannerDayOf(f, mode, origin)
    if (placed?.day === d) {
      current = placed.kind
      continue
    }
    return kindDate(f, current) == null ? 'removed' : 'moved'
  }
  return today ? 'ahead' : 'late'
}

/** The median of `values` (the mean of the middle two for an even count); 0 for none. */
function median(values: readonly number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? (sorted[mid] ?? 0) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
}

/** The week load (see the module comment). */
export function computeWeekLoad(input: WeekLoadInput): WeekLoad {
  const { tasks, now } = input
  const today = startOfDay(now)
  const origin = addDays(weekStartOf(today, input.weekStartsOn), -7 * WEEK_LOAD_PAST_WEEKS)
  const weekCount = WEEK_LOAD_PAST_WEEKS + 1 + WEEK_LOAD_FUTURE_WEEKS
  const dayCount = weekCount * 7
  const todayIndex = daysUntil(today, origin) ?? 0
  const planSince = input.planLogSince ?? now
  const historySince = input.historyLogSince ?? now
  const planDay = daysUntil(planSince, origin) ?? 0
  const historyDay = daysUntil(historySince, origin) ?? 0

  const counts: Record<WeekLoadKind, WeekLoadCounts>[] = Array.from({ length: dayCount }, () => ({
    due: emptyCounts(), followup: emptyCounts(), planned: emptyCounts(),
  }))
  const add = (day: number, kind: WeekLoadKind, outcome: Outcome) => {
    const c = counts[day]
    if (c) c[kind][outcome] += 1
  }
  const dayStarts = Array.from({ length: dayCount + 1 }, (_, i) => addDays(origin, i).getTime())
  const completionDays: number[] = []

  const byTask = eventsByTask(input.events, new Set(tasks.map((t) => t.id)), WEEK_LOAD_EVENT_TYPES, origin)
  const noAssignments = { personIds: [], tagIds: [] }
  for (const task of tasks) {
    const events = byTask.get(task.id)
    const t = timelineOf(task, events?.all ?? [], input.statusUpdates.get(task.id), taskFieldReplayAt(task, events, noAssignments), origin)
    for (const c of t.completions) {
      const day = daysUntil(new Date(c), origin)
      if (day != null) completionDays.push(day)
    }
    // Days gone by and today: replayed.
    for (let d = 0; d <= todayIndex && d < dayCount; d++) {
      const dayStart = dayStarts[d] ?? 0
      const dayEnd = dayStarts[d + 1] ?? 0
      const mode: PlaceMode = { planned: d >= planDay, followup: d >= historyDay }
      let landing: { time: number; kind: WeekLoadKind } | null = null
      const atStart = t.fieldsAt(dayStart - 1)
      const startPlaced = atStart?.state === 'open' ? plannerDayOf(atStart, mode, origin) : null
      if (startPlaced?.day === d) landing = { time: dayStart, kind: startPlaced.kind }
      for (const time of t.times) {
        if (landing) break
        if (time < dayStart) continue
        if (time >= dayEnd) break
        const f = t.fieldsAt(time)
        const placed = f?.state === 'open' ? plannerDayOf(f, mode, origin) : null
        if (placed?.day === d) landing = { time, kind: placed.kind }
      }
      if (landing) add(d, landing.kind, outcomeOf(t, landing, d, dayEnd, mode, origin, d === todayIndex))
    }
    // Days to come: the task's dates now.
    if (!task.isCompleted) {
      const placed = plannerDayOf({ dueDate: task.dueDate ?? null, nextFollowupAt: task.nextFollowupAt ?? null, doDate: task.doDate ?? null }, ALL_DATES, origin)
      if (placed && placed.day > todayIndex) add(placed.day, placed.kind, 'ahead')
    }
  }

  const weeks: WeekLoadWeek[] = []
  for (let w = 0; w < weekCount; w++) {
    const days: WeekLoadDay[] = []
    const totals: WeekLoadTotals = { load: 0, done: 0, slipped: 0, ahead: 0, late: 0, moved: 0, removed: 0 }
    let beforePlans = false
    let beforeHistory = false
    for (let i = 0; i < 7; i++) {
      const d = w * 7 + i
      const kinds = counts[d] ?? { due: emptyCounts(), followup: emptyCounts(), planned: emptyCounts() }
      for (const kind of WEEK_LOAD_KINDS) {
        const c = kinds[kind]
        totals.done += c.done
        totals.late += c.late
        totals.moved += c.moved
        totals.removed += c.removed
        totals.ahead += c.ahead
      }
      if (d <= todayIndex) {
        if (d < planDay) beforePlans = true
        if (d < historyDay) beforeHistory = true
      }
      days.push({ date: addDays(origin, d), when: d < todayIndex ? 'past' : d === todayIndex ? 'today' : 'future', kinds })
    }
    totals.slipped = totals.late + totals.moved + totals.removed
    totals.load = totals.done + totals.slipped + totals.ahead
    const closed = totals.done + totals.slipped
    const notes: WeekLoadNote[] = []
    if (beforePlans) notes.push({ log: 'planned', since: planSince })
    if (beforeHistory) notes.push({ log: 'followup', since: historySince })
    weeks.push({
      start: addDays(origin, w * 7),
      offset: w - WEEK_LOAD_PAST_WEEKS,
      days,
      totals,
      slipPct: closed > 0 ? Math.round((100 * totals.slipped) / closed) : null,
      notes,
    })
  }

  // The usual week: the full weeks before this one.
  const perWeek = Array.from({ length: WEEK_LOAD_PAST_WEEKS }, () => 0)
  const perWeekday = Array.from({ length: 7 }, () => 0)
  for (const day of completionDays) {
    if (day < 0 || day >= WEEK_LOAD_PAST_WEEKS * 7) continue
    const week = Math.floor(day / 7)
    perWeek[week] = (perWeek[week] ?? 0) + 1
    perWeekday[day % 7] = (perWeekday[day % 7] ?? 0) + 1
  }
  const total = perWeekday.reduce((a, b) => a + b, 0)
  return {
    weeks,
    usual: {
      perWeek: median(perWeek),
      weekdayShares: perWeekday.map((n) => (total > 0 ? n / total : 1 / 7)),
    },
  }
}
