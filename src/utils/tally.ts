import type { TodoItem } from '../models'
import { addDays, startOfDay } from './date'

/**
 * The top bar's tally of tasks finished today (flair P3, board 12b): one
 * scratched mark per task completed today, in groups of five — four strokes
 * and a slash through them. Pure: the count, which marks fit, their shapes.
 */

/** Marks per group: four strokes, then the slash. */
const TALLY_GROUP_SIZE = 5
/** From one group's left to the next's, px. */
export const TALLY_GROUP_PITCH_PX = 27
/** A whole group's drawn width (its slash's reach), px. */
export const TALLY_GROUP_WIDTH_PX = 22
/** From one stroke to the next, px. */
const STROKE_PITCH_PX = 4.9
/** The marks' height, px (the SVG's). */
export const TALLY_HEIGHT_PX = 18

/**
 * How many tasks were completed today (`today`: any moment of the local
 * day): completed, with a `completedAt` on that day. Undo, reopen or a
 * delete takes a task out; a recurring task's completion only moves its due
 * date, so it never counts.
 */
export function doneToday(todos: ReadonlyArray<Pick<TodoItem, 'isCompleted' | 'completedAt'>>, today: Date): number {
  const from = startOfDay(today).getTime()
  const to = addDays(startOfDay(today), 1).getTime()
  let n = 0
  for (const t of todos) {
    if (!t.isCompleted || t.completedAt == null) continue
    const ms = new Date(t.completedAt).getTime()
    if (ms >= from && ms < to) n++
  }
  return n
}

/** What the tally draws in a gap: the newest whole groups that fit, then the open group's strokes. */
interface TallyLayout {
  /** The index (0-based, of all today's marks) of the first mark drawn. */
  first: number
  /** Whole groups drawn. */
  groups: number
  /** Strokes of the open group (0–4), drawn after the groups. */
  remainder: number
  /** The drawn width, px (0: nothing drawn). */
  width: number
}

const NOTHING: TallyLayout = { first: 0, groups: 0, remainder: 0, width: 0 }

/** `n` strokes side by side, px. */
function strokesWidth(n: number): number {
  return n > 0 ? 4 + STROKE_PITCH_PX * (n - 1) : 0
}

/** `groups` whole groups then `remainder` strokes, px. */
function drawnWidth(groups: number, remainder: number): number {
  if (remainder > 0) return groups * TALLY_GROUP_PITCH_PX + strokesWidth(remainder)
  return groups > 0 ? (groups - 1) * TALLY_GROUP_PITCH_PX + TALLY_GROUP_WIDTH_PX : 0
}

/**
 * The marks for `count` in a gap `room` px wide: the open group's strokes
 * always, after as many of the newest whole groups as fit (older ones are
 * left out; the tooltip keeps the whole count). Room for less than one
 * whole group: nothing.
 */
export function tallyLayout(count: number, room: number): TallyLayout {
  if (count <= 0 || room < TALLY_GROUP_WIDTH_PX) return NOTHING
  const whole = Math.floor(count / TALLY_GROUP_SIZE)
  const remainder = count % TALLY_GROUP_SIZE
  let groups = whole
  while (groups > 0 && drawnWidth(groups, remainder) > room) groups--
  return { first: (whole - groups) * TALLY_GROUP_SIZE, groups, remainder, width: drawnWidth(groups, remainder) }
}

/** Hand-wobbled strokes and slashes (board 12b), two of each, group-local px. */
const STROKES: ReadonlyArray<readonly string[]> = [
  ['M3.2 2.8l-.5 4.1 .4 3.9 -.3 4.3', 'M8.1 2.2l.3 5 -.5 3.7 .2 4.5', 'M12.9 3.1l.4 3.9 -.3 4.5 .4 3.5', 'M17.8 2.5l-.4 4.5 .5 4.1 -.2 4'],
  ['M3.1 2.6l.4 4.3 -.4 4.1 .3 4', 'M8.2 3l-.4 4.6 .5 3.6 -.3 4.2', 'M13 2.3l.3 4.8 -.5 4 .4 4.2', 'M17.9 2.9l-.3 4.2 .4 4.4 -.3 3.7'],
]
const SLASHES: readonly string[] = ['M.9 12.8l6.2-2.5 6.3-3.3 7.3-3.1', 'M.9 12.4l6-2.3 6.5-3.5 7.2-2.9']

/** One drawn mark: its index among today's marks, its path, and its group's x. */
interface TallyMark {
  index: number
  path: string
  x: number
}

/**
 * The marks a layout draws, left to right. Each mark's shape is picked by
 * its own index, so a mark never changes shape when older groups leave.
 */
export function tallyMarks(layout: TallyLayout): TallyMark[] {
  const marks: TallyMark[] = []
  const last = layout.first + layout.groups * TALLY_GROUP_SIZE + layout.remainder
  for (let index = layout.first; index < last; index++) {
    const group = Math.floor(index / TALLY_GROUP_SIZE)
    const place = index % TALLY_GROUP_SIZE
    const variant = group % 2
    const path = place < 4 ? STROKES[variant]?.[place] : SLASHES[variant]
    const x = Math.floor((index - layout.first) / TALLY_GROUP_SIZE) * TALLY_GROUP_PITCH_PX
    if (path) marks.push({ index, path, x })
  }
  return marks
}

/** The tally's words: its tooltip and accessible name. */
export function tallyLabel(count: number): string {
  return `${count} done today`
}
