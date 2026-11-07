import type { NeglectColourBy } from '../models/workspace-layout'
import type { TodoItem } from '../models/todo-item'
import { daysUntil } from './effective-date'
import { daysSinceModified } from './stale'
import type { UrgentDueWithinDays } from './urgency'

/**
 * The Neglect map (D25 board H): every open task placed by how long it has
 * gone untouched (x: days since `modifiedAt`) and how soon it is due (y:
 * days until its due date; late is up). Two lines cut the plot in four —
 * the untouched threshold (the tab's `untouchedDays`) and the due-soon line
 * (Settings' "Due date makes a task urgent" range):
 *
 * - **Slipping** (top right): due soon or late, untouched for the threshold.
 * - **In hand** (top left): due soon or late, touched recently.
 * - **Planned** (bottom left): due later, touched recently.
 * - **Drifting** (bottom right): due later, untouched.
 *
 * A task without a due date goes in the strip under the plot: **Forgotten**
 * when untouched for the threshold, else just no due date.
 */

/** Where a task lands on the map. */
export type NeglectZone = 'slipping' | 'inHand' | 'planned' | 'drifting' | 'forgotten' | 'noDue'

/** The x axis ends here: a task untouched longer sits on the cap (`60+`). */
export const NEGLECT_X_CAP = 60
/** The top of the y axis: due this many days ago (a later due date sits on it). */
export const NEGLECT_Y_MIN = -14
/** The bottom of the y axis: due this many days ahead (a later due date sits on it). */
export const NEGLECT_Y_MAX = 30
/** How far an overlapping dot may be moved off its spot, in days (either axis). */
export const NEGLECT_JITTER = 0.45

/** Tags named this way are what a new map colours by. */
export const PROJECT_TAG_PREFIX = 'Project:'

/** The task fields the map reads. */
export type NeglectFields = Pick<TodoItem, 'modifiedAt' | 'dueDate' | 'isCompleted'> & { id: number }

export interface NeglectOptions {
  today: Date
  /** The tab's threshold: untouched this many days or more counts. */
  untouchedDays: number
  /** Settings' due-soon range (`urgentDueWithinDays`); `null` = only a late task is near. */
  dueSoonDays: UrgentDueWithinDays
}

/** One task on the map. */
export interface NeglectPoint<T extends NeglectFields = NeglectFields> {
  todo: T
  /** Days since the task last changed (0 or more; not capped). */
  untouched: number
  /** Days until the due date (negative = late; not clamped); `null` = no due date. */
  dueIn: number | null
  zone: NeglectZone
  /** Where it is drawn across: 0 – `NEGLECT_X_CAP`, jitter included. */
  x: number
  /**
   * Where it is drawn down: `NEGLECT_Y_MIN` – `NEGLECT_Y_MAX` on the plot;
   * for a task without a due date, its place in the strip, 0 (top) – 1.
   */
  y: number
}

export interface NeglectMap<T extends NeglectFields = NeglectFields> {
  /** Every open task, in the order given. */
  points: NeglectPoint<T>[]
  /** The Slipping tasks, latest first, then the longest untouched. */
  slipping: NeglectPoint<T>[]
  /** Tasks per zone. */
  counts: Record<NeglectZone, number>
}

/** Ids of the tags a new map colours by: those named `Project: …`, in the order given. */
export function projectTagIds(tags: ReadonlyArray<{ id?: number; name: string }>): number[] {
  return tags.flatMap((t) => (t.id != null && t.name.trim().startsWith(PROJECT_TAG_PREFIX) ? [t.id] : []))
}

/** Whether a task due in `dueIn` days is near: late, or within the due-soon range. */
export function isDueNear(dueIn: number, dueSoonDays: UrgentDueWithinDays): boolean {
  return dueIn < 0 || (dueSoonDays != null && dueIn <= dueSoonDays)
}

/** The zone of a task untouched `untouched` days and due in `dueIn` days (`null` = no due date). */
export function neglectZone(untouched: number, dueIn: number | null, opts: Pick<NeglectOptions, 'untouchedDays' | 'dueSoonDays'>): NeglectZone {
  const neglected = untouched >= opts.untouchedDays
  if (dueIn == null) return neglected ? 'forgotten' : 'noDue'
  if (isDueNear(dueIn, opts.dueSoonDays)) return neglected ? 'slipping' : 'inHand'
  return neglected ? 'drifting' : 'planned'
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

const ZONES: readonly NeglectZone[] = ['slipping', 'inHand', 'planned', 'drifting', 'forgotten', 'noDue']

/**
 * The map of `todos` (completed tasks left out). A dot sitting on another's
 * spot (same capped x and clamped y, or the same x in the strip) is moved a
 * little, by its id — never across a line it sits on (the threshold, the
 * due-soon line, today) or off the plot.
 */
export function buildNeglectMap<T extends NeglectFields>(todos: readonly T[], opts: NeglectOptions): NeglectMap<T> {
  const counts = Object.fromEntries(ZONES.map((z) => [z, 0])) as Record<NeglectZone, number>
  const points: NeglectPoint<T>[] = []
  for (const todo of todos) {
    if (todo.isCompleted) continue
    const untouched = Math.max(0, daysSinceModified(todo, opts.today) ?? 0)
    const dueIn = daysUntil(todo.dueDate, opts.today)
    const zone = neglectZone(untouched, dueIn, opts)
    counts[zone]++
    const x = Math.min(NEGLECT_X_CAP, untouched)
    const y = dueIn == null ? 0.5 : Math.max(NEGLECT_Y_MIN, Math.min(NEGLECT_Y_MAX, dueIn))
    points.push({ todo, untouched, dueIn, zone, x, y })
  }

  // Dots on one spot: spread them by id.
  const spots = new Map<string, number>()
  const spotOf = (p: NeglectPoint<T>) => `${p.dueIn == null ? 'strip' : p.y}|${p.x}`
  for (const p of points) spots.set(spotOf(p), (spots.get(spotOf(p)) ?? 0) + 1)
  for (const p of points) {
    if ((spots.get(spotOf(p)) ?? 0) < 2) continue
    const id = p.todo.id
    const xSide: NudgeSide = p.x === 0 || p.x === opts.untouchedDays ? 'up' : p.x === NEGLECT_X_CAP ? 'down' : 'either'
    p.x = Math.min(NEGLECT_X_CAP, Math.max(0, nudge(p.x, neglectJitter(id, 1), xSide)))
    if (p.dueIn == null) {
      // The strip: anywhere across its middle 80 %.
      p.y = 0.5 + neglectJitter(id, 2) * 0.4
    } else {
      p.y = Math.min(NEGLECT_Y_MAX, Math.max(NEGLECT_Y_MIN, nudge(p.y, neglectJitter(id, 2), ySide(p.y, opts.dueSoonDays))))
    }
  }

  const slipping = points
    .filter((p) => p.zone === 'slipping')
    .sort((a, b) => (a.dueIn ?? 0) - (b.dueIn ?? 0) || b.untouched - a.untouched || a.todo.id - b.todo.id)
  return { points, slipping, counts }
}

/** `4d late` / `due today` / `due in 3d` / `no due date`. */
export function dueInText(dueIn: number | null): string {
  if (dueIn == null) return 'no due date'
  if (dueIn < 0) return `${-dueIn}d late`
  return dueIn === 0 ? 'due today' : `due in ${dueIn}d`
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
