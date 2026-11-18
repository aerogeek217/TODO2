import type { TodoItem } from '../models/todo-item'
import { daysUntil } from './effective-date'
import { neglectJitter } from './neglect-map'
import { daysSinceModified } from './stale'

/**
 * The Pressure radar (task maps R1, 2026-11-18): every open task in one of
 * four quarters by **what presses on it**, nearer the middle the sooner it
 * needs you (`needsIn`, days from today; 0 or less = now).
 *
 * - **Waiting** — its status is one of the tab's Waiting statuses: needs you
 *   at its next follow-up, or without one `WAITING_CHASE_DAYS` after its last
 *   follow-up (else after it was created).
 * - else **Due date** / **Follow-up** — whichever of its due date and next
 *   follow-up comes first (a tie goes to the due date).
 * - else **Untouched** — no date at all: needs you once stale (Settings'
 *   `staleAfterDays`; off reads as `UNTOUCHED_FALLBACK_DAYS`).
 */

export type RadarQuarter = 'due' | 'followup' | 'waiting' | 'untouched'

/** The quarters clockwise from the top: Due date top right, Follow-up bottom right, Waiting bottom left, Untouched top left. */
export const RADAR_QUARTERS: readonly RadarQuarter[] = ['due', 'followup', 'waiting', 'untouched']

/** A Waiting task without a next follow-up needs chasing this many days after its last one. */
const WAITING_CHASE_DAYS = 7

/** An untouched task needs you after this many days when Settings' stale threshold is off. */
const UNTOUCHED_FALLBACK_DAYS = 30

/** The rings, as a share of the radius: the NOW disk's edge, 7 days, 21 days. */
export const RADAR_RINGS = { now: 0.356, week: 0.656, threeWeeks: 0.889 } as const

/** The task fields the radar reads. */
type RadarFields = Pick<TodoItem, 'isCompleted' | 'dueDate' | 'nextFollowupAt' | 'lastFollowupAt' | 'createdAt' | 'modifiedAt' | 'statusId'> & { id: number }

interface RadarOptions {
  today: Date
  /** The tab's Waiting statuses. */
  waitingStatusIds: ReadonlySet<number>
  /** Settings' `staleAfterDays` (0 = off). */
  staleAfterDays: number
}

export interface RadarPoint<T extends RadarFields = RadarFields> {
  todo: T
  quarter: RadarQuarter
  /** Days until it needs you (0 or less = now; not clamped). */
  needsIn: number
  /** Distance from the middle, 0 – 1 of the radius. */
  r: number
  /** Angle in degrees, clockwise from 3 o'clock (screen coordinates: −90 is up). */
  angle: number
}

export interface PressureRadar<T extends RadarFields = RadarFields> {
  /** Every open task, in the order given. */
  points: RadarPoint<T>[]
  /** Per quarter: how many it holds, and how many need you now. */
  counts: Record<RadarQuarter, { total: number; now: number }>
  /** The tasks that need you now, the latest first. */
  now: RadarPoint<T>[]
}

/** The quarter and `needsIn` of an open task. */
function radarPressure(todo: RadarFields, opts: RadarOptions): { quarter: RadarQuarter; needsIn: number } {
  const followupIn = daysUntil(todo.nextFollowupAt, opts.today)
  if (todo.statusId != null && opts.waitingStatusIds.has(todo.statusId)) {
    if (followupIn != null) return { quarter: 'waiting', needsIn: followupIn }
    const since = daysUntil(todo.lastFollowupAt ?? todo.createdAt, opts.today) ?? 0
    return { quarter: 'waiting', needsIn: since + WAITING_CHASE_DAYS }
  }
  const dueIn = daysUntil(todo.dueDate, opts.today)
  if (dueIn != null && (followupIn == null || dueIn <= followupIn)) return { quarter: 'due', needsIn: dueIn }
  if (followupIn != null) return { quarter: 'followup', needsIn: followupIn }
  const stale = opts.staleAfterDays > 0 ? opts.staleAfterDays : UNTOUCHED_FALLBACK_DAYS
  const untouched = Math.max(0, daysSinceModified(todo, opts.today) ?? 0)
  return { quarter: 'untouched', needsIn: stale - untouched }
}

/**
 * Distance from the middle for `needsIn`, a share of the radius: now (0 or
 * less) inside the NOW disk, the later the nearer the middle (capped at 30
 * days late); 1 – 7 days out to the 7-day ring; 8 – 21 to the 21-day ring;
 * later on the rim (capped at 60).
 */
function radarRadius(needsIn: number): number {
  const px = needsIn <= 0 ? 8 + 52 * (1 - Math.min(-needsIn, 30) / 30)
    : needsIn <= 7 ? 72 + (40 * (needsIn - 1)) / 6
      : needsIn <= 21 ? 124 + (30 * (needsIn - 8)) / 13
        : 165 + (Math.min(needsIn - 22, 38) / 38) * 9
  return px / 180
}

/** Where a quarter starts, in degrees (clockwise from 3 o'clock). */
const QUARTER_START: Record<RadarQuarter, number> = { due: -90, followup: 0, waiting: 90, untouched: 180 }

/** The radar of `todos` (completed tasks left out); each dot's place inside its quarter is fixed by its id. */
export function buildPressureRadar<T extends RadarFields>(todos: readonly T[], opts: RadarOptions): PressureRadar<T> {
  const counts = Object.fromEntries(RADAR_QUARTERS.map((q) => [q, { total: 0, now: 0 }])) as PressureRadar<T>['counts']
  const points: RadarPoint<T>[] = []
  for (const todo of todos) {
    if (todo.isCompleted) continue
    const { quarter, needsIn } = radarPressure(todo, opts)
    counts[quarter].total++
    if (needsIn <= 0) counts[quarter].now++
    // Inside the quarter, clear of its edges by 7°; a little in or out by id so equal days don't stack.
    const spread = (neglectJitter(todo.id, 3) + 1) / 2
    const angle = QUARTER_START[quarter] + 7 + spread * 76
    const r = Math.max(0.03, Math.min(0.98, radarRadius(needsIn) + neglectJitter(todo.id, 4) * 0.012))
    points.push({ todo, quarter, needsIn, r, angle })
  }
  const now = points.filter((p) => p.needsIn <= 0).sort((a, b) => a.needsIn - b.needsIn || a.todo.id - b.todo.id)
  return { points, counts, now }
}

/** A quarter's tasks, the soonest first. */
export function quarterTasks<T extends RadarFields>(radar: PressureRadar<T>, quarter: RadarQuarter): RadarPoint<T>[] {
  return radar.points.filter((p) => p.quarter === quarter).sort((a, b) => a.needsIn - b.needsIn || a.todo.id - b.todo.id)
}

/** `4 days late` / `today` / `in 3 days`: when a task needs you. */
function needsInText(needsIn: number): string {
  if (needsIn < 0) return needsIn === -1 ? '1 day late' : `${-needsIn} days late`
  if (needsIn === 0) return 'today'
  return needsIn === 1 ? 'in 1 day' : `in ${needsIn} days`
}

/** The quarters' names. */
export const RADAR_QUARTER_NAMES: Record<RadarQuarter, string> = {
  due: 'Due date',
  followup: 'Follow-up',
  waiting: 'Waiting',
  untouched: 'Untouched',
}

/** What a dot's tooltip says under the title: `3 days overdue`, `follow-up today`, `waiting · chase in 2 days`, `untouched 34 days · stale`. */
export function radarPointText(quarter: RadarQuarter, needsIn: number, staleAfterDays: number): string {
  const days = (n: number) => (n === 1 ? '1 day' : `${n} days`)
  switch (quarter) {
    case 'due':
      return needsIn < 0 ? `${days(-needsIn)} overdue` : needsIn === 0 ? 'due today' : `due in ${days(needsIn)}`
    case 'followup':
      return needsIn < 0 ? `follow-up ${days(-needsIn)} late` : needsIn === 0 ? 'follow-up today' : `follow-up in ${days(needsIn)}`
    case 'waiting':
      return `waiting · chase ${needsInText(needsIn)}`
    case 'untouched': {
      const stale = staleAfterDays > 0 ? staleAfterDays : UNTOUCHED_FALLBACK_DAYS
      const untouched = stale - needsIn
      return untouched <= 0 ? 'touched today' : `untouched ${days(untouched)}${needsIn <= 0 ? ' · stale' : ''}`
    }
  }
}
