import type { NeglectColourBy } from '../models/workspace-layout'
import type { TodoItem } from '../models/todo-item'
import { daysUntil } from './effective-date'
import { daysSinceModified } from './stale'
import { isDueNear, type UrgentDueWithinDays } from './urgency'

/**
 * The Neglect map (D25 board H): every open task placed by how long it has
 * gone untouched (x: days since `modifiedAt`) and how soon it needs you (y:
 * days until the earlier of its due date and its next follow-up; late is
 * up). Two lines cut the plot in four — Settings' Stale after (the filter
 * word `stale`) and the due-soon line (Settings' "Due date makes a task
 * urgent" range, the filter words `due soon` / `followup soon`):
 *
 * - **Slipping** (top right): due or to follow up soon or late, stale.
 * - **In hand** (top left): soon or late, touched recently.
 * - **Later** (bottom left): later, touched recently.
 * - **Drifting** (bottom right): later, stale.
 *
 * A task with neither date goes in the strip under the plot: **Forgotten**
 * when stale, else just no dates. A task whose only date is a planned day
 * is left off the map (the Planner holds it), as is a task with a status
 * the tab hides. With Stale after off (0) nothing is stale, so nothing is
 * Slipping, Drifting or Forgotten.
 */

/** Where a task lands on the map. */
export type NeglectZone = 'slipping' | 'inHand' | 'later' | 'drifting' | 'forgotten' | 'noDates'

/** Which date placed a task down the plot: its due date, its next follow-up, or neither (the strip). */
type NeglectDateBy = 'due' | 'followup' | null

/** The x axis ends here: a task untouched longer sits on the cap (`60+`). */
export const NEGLECT_X_CAP = 60
/** The top of the y axis: due this many days ago (a later due date sits on it). */
export const NEGLECT_Y_MIN = -14
/** The bottom of the y axis: due this many days ahead (a later due date sits on it). */
export const NEGLECT_Y_MAX = 30
/** How far an overlapping dot may be moved off its spot, in days (either axis). */
export const NEGLECT_JITTER = 0.45

/** Tags named this way are what a new map colours by. */
const PROJECT_TAG_PREFIX = 'Project:'

/** The task fields the map reads. */
export type NeglectFields = Pick<TodoItem, 'modifiedAt' | 'dueDate' | 'nextFollowupAt' | 'doDate' | 'isCompleted' | 'statusId'> & { id: number }

interface NeglectOptions {
  today: Date
  /** Settings' Stale after: untouched this many days or more is stale (`0`: off, nothing is). */
  staleAfterDays: number
  /** Settings' due-soon range (`urgentDueWithinDays`); `null` = only a late date is near. */
  dueSoonDays: UrgentDueWithinDays
  /** The tab's hidden statuses (`NeglectTabConfig.hiddenStatusIds`): a task with one is left off. */
  hiddenStatusIds?: readonly number[]
}

/** One task on the map. */
export interface NeglectPoint<T extends NeglectFields = NeglectFields> {
  todo: T
  /** Days since the task last changed (0 or more; not capped). */
  untouched: number
  /**
   * Days until the earlier of its due date and next follow-up (negative =
   * late; not clamped); `null` = neither (the strip).
   */
  dateIn: number | null
  /** Which date `dateIn` is (the due date on a tie). */
  dateBy: NeglectDateBy
  zone: NeglectZone
  /** Where it is drawn across: 0 – `NEGLECT_X_CAP`, jitter included. */
  x: number
  /**
   * Where it is drawn down: `NEGLECT_Y_MIN` – `NEGLECT_Y_MAX` on the plot;
   * for a task with neither date, its place in the strip, 0 (top) – 1.
   */
  y: number
}

export interface NeglectMap<T extends NeglectFields = NeglectFields> {
  /** Every open task placed, in the order given. */
  points: NeglectPoint<T>[]
  /** The Slipping tasks, latest first, then the longest untouched. */
  slipping: NeglectPoint<T>[]
  /** The Forgotten tasks, the longest untouched first. */
  forgotten: NeglectPoint<T>[]
  /** Tasks per zone. */
  counts: Record<NeglectZone, number>
}

/** Ids of the tags a new map colours by: those named `Project: …`, in the order given. */
export function projectTagIds(tags: ReadonlyArray<{ id?: number; name: string }>): number[] {
  return tags.flatMap((t) => (t.id != null && t.name.trim().startsWith(PROJECT_TAG_PREFIX) ? [t.id] : []))
}

/** Whether Stale after draws a line on the plot: on, and short of the 60-day cap. */
export function staleLineShown(staleAfterDays: number): boolean {
  return staleAfterDays > 0 && staleAfterDays < NEGLECT_X_CAP
}

/** The zone of a task untouched `untouched` days whose date is `dateIn` days away (`null` = neither date). */
export function neglectZone(untouched: number, dateIn: number | null, opts: Pick<NeglectOptions, 'staleAfterDays' | 'dueSoonDays'>): NeglectZone {
  const stale = opts.staleAfterDays > 0 && untouched >= opts.staleAfterDays
  if (dateIn == null) return stale ? 'forgotten' : 'noDates'
  if (isDueNear(dateIn, opts.dueSoonDays)) return stale ? 'slipping' : 'inHand'
  return stale ? 'drifting' : 'later'
}

/** The date that places `todo` down the plot: the earlier of due and next follow-up (the due date on a tie). */
function placingDate(todo: NeglectFields, today: Date): { dateIn: number | null; dateBy: NeglectDateBy } {
  const due = daysUntil(todo.dueDate, today)
  const followup = daysUntil(todo.nextFollowupAt, today)
  if (due == null && followup == null) return { dateIn: null, dateBy: null }
  if (followup == null || (due != null && due <= followup)) return { dateIn: due, dateBy: 'due' }
  return { dateIn: followup, dateBy: 'followup' }
}

/** A number in [-1, 1) fixed by `id` and `salt` (the same every time: no `Math.random`). */
export function neglectJitter(id: number, salt: number): number {
  let h = Math.imul(id ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(salt + 1, 0xc2b2ae35)
  h ^= h >>> 16
  h = Math.imul(h, 0x7feb352d)
  h ^= h >>> 15
  h = Math.imul(h, 0x846ca68b)
  h ^= h >>> 16
  return ((h >>> 0) / 0x100000000) * 2 - 1
}

/** Which way a dot on a line may move: to higher values, lower ones, either, or not at all. */
type NudgeSide = 'up' | 'down' | 'either' | 'none'

/**
 * `offset` (in [-1, 1)) as a move off `value`, scaled by `NEGLECT_JITTER`,
 * kept on the dot's side of a line it sits on (`side`).
 */
function nudge(value: number, offset: number, side: NudgeSide): number {
  const d = offset * NEGLECT_JITTER
  if (side === 'up') return value + Math.abs(d)
  if (side === 'down') return value - Math.abs(d)
  return side === 'none' ? value : value + d
}

/**
 * The side a dot at due-in `y` keeps: below today (a task due today is not
 * late) and the axis top, above the due-soon line (it is near) and the axis
 * bottom.
 */
function ySide(y: number, dueSoonDays: UrgentDueWithinDays): NudgeSide {
  const floor = y === NEGLECT_Y_MIN || y === 0
  const ceiling = y === NEGLECT_Y_MAX || y === dueSoonDays
  if (floor && ceiling) return 'none'
  return floor ? 'up' : ceiling ? 'down' : 'either'
}

const ZONES: readonly NeglectZone[] = ['slipping', 'inHand', 'later', 'drifting', 'forgotten', 'noDates']

/**
 * The map of `todos` (completed tasks, tasks whose only date is a planned
 * day and tasks with a hidden status left out). A dot sitting on another's spot (same capped x
 * and clamped y, or the same x in the strip) is moved a little, by its id —
 * never across a line it sits on (Stale after, the due-soon line, today) or
 * off the plot.
 */
export function buildNeglectMap<T extends NeglectFields>(todos: readonly T[], opts: NeglectOptions): NeglectMap<T> {
  const counts = Object.fromEntries(ZONES.map((z) => [z, 0])) as Record<NeglectZone, number>
  const points: NeglectPoint<T>[] = []
  const hidden = new Set(opts.hiddenStatusIds ?? [])
  for (const todo of todos) {
    if (todo.isCompleted) continue
    if (todo.statusId != null && hidden.has(todo.statusId)) continue
    const { dateIn, dateBy } = placingDate(todo, opts.today)
    // Only a planned day: the Planner holds it.
    if (dateIn == null && todo.doDate) continue
    const untouched = Math.max(0, daysSinceModified(todo, opts.today) ?? 0)
    const zone = neglectZone(untouched, dateIn, opts)
    counts[zone]++
    const x = Math.min(NEGLECT_X_CAP, untouched)
    const y = dateIn == null ? 0.5 : Math.max(NEGLECT_Y_MIN, Math.min(NEGLECT_Y_MAX, dateIn))
    points.push({ todo, untouched, dateIn, dateBy, zone, x, y })
  }

  // Dots on one spot: spread them by id.
  const spots = new Map<string, number>()
  const spotOf = (p: NeglectPoint<T>) => `${p.dateIn == null ? 'strip' : p.y}|${p.x}`
  for (const p of points) spots.set(spotOf(p), (spots.get(spotOf(p)) ?? 0) + 1)
  for (const p of points) {
    if ((spots.get(spotOf(p)) ?? 0) < 2) continue
    const id = p.todo.id
    const xSide: NudgeSide = p.x === 0 || p.x === opts.staleAfterDays ? 'up' : p.x === NEGLECT_X_CAP ? 'down' : 'either'
    p.x = Math.min(NEGLECT_X_CAP, Math.max(0, nudge(p.x, neglectJitter(id, 1), xSide)))
    if (p.dateIn == null) {
      // The strip: anywhere across its middle 80 %.
      p.y = 0.5 + neglectJitter(id, 2) * 0.4
    } else {
      p.y = Math.min(NEGLECT_Y_MAX, Math.max(NEGLECT_Y_MIN, nudge(p.y, neglectJitter(id, 2), ySide(p.y, opts.dueSoonDays))))
    }
  }

  const slipping = points
    .filter((p) => p.zone === 'slipping')
    .sort((a, b) => (a.dateIn ?? 0) - (b.dateIn ?? 0) || b.untouched - a.untouched || a.todo.id - b.todo.id)
  const forgotten = points
    .filter((p) => p.zone === 'forgotten')
    .sort((a, b) => b.untouched - a.untouched || a.todo.id - b.todo.id)
  return { points, slipping, forgotten, counts }
}

/**
 * What placed a task, in words: `4d late` / `due today` / `due in 3d` by its
 * due date, `follow-up 4d late` / `follow-up today` / `follow-up in 3d` by
 * its next follow-up, `no dates` in the strip.
 */
export function dateInText(dateIn: number | null, by: NeglectDateBy): string {
  if (dateIn == null || by == null) return 'no dates'
  if (by === 'followup') {
    if (dateIn < 0) return `follow-up ${-dateIn}d late`
    return dateIn === 0 ? 'follow-up today' : `follow-up in ${dateIn}d`
  }
  if (dateIn < 0) return `${-dateIn}d late`
  return dateIn === 0 ? 'due today' : `due in ${dateIn}d`
}

/** `26d untouched` (`touched today` for 0). */
export function untouchedText(untouched: number): string {
  return untouched === 0 ? 'touched today' : `${untouched}d untouched`
}

/**
 * A dot's colour: under `tags`, the colour of the first picked tag the task
 * has (in pick order); under `people`, its first person's; else (or when it
 * has none) `null` — the neutral dot.
 */
export function neglectDotColour(
  colourBy: NeglectColourBy,
  tags: ReadonlyArray<{ id?: number; color: string }> | undefined,
  people: ReadonlyArray<{ color?: string }> | undefined,
): string | null {
  if (colourBy.kind === 'tags') {
    for (const id of colourBy.tagIds) {
      const tag = tags?.find((t) => t.id === id)
      if (tag) return tag.color
    }
    return null
  }
  if (colourBy.kind === 'people') return people?.at(0)?.color ?? null
  return null
}
