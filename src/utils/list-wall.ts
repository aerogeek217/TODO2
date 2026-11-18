/**
 * The List wall (task maps, 2026-11-18): every list tab of a layout as a
 * block of squares, one per open task the list shows, the trouble first.
 * A task's state is its Lines box's (`list-zoom.rowTone`): overdue, due
 * soon, follow-up late, on track, stale — the first that holds.
 */

export type WallTone = 'late' | 'soon' | 'followup' | 'ontrack' | 'stale'

/** The states in the wall's order: the trouble first. */
export const WALL_TONES: readonly WallTone[] = ['late', 'soon', 'followup', 'ontrack', 'stale']

export const WALL_TONE_NAMES: Record<WallTone, string> = {
  late: 'Overdue',
  soon: 'Due soon',
  followup: 'Follow-up late',
  ontrack: 'On track',
  stale: 'Stale',
}

/** A block's squares, in rows of this many where there is height for six rows. */
const WALL_COLUMNS = 14
/** A block's rows at most, and at least (a short cell). */
const WALL_ROWS_MAX = 6
const WALL_ROWS_MIN = 2
/** A short cell's blocks widen up to this many columns, so a block keeps its squares. */
const WALL_COLUMNS_MAX = 28
/** A square's side and the gap between squares, px. */
const WALL_SQUARE_PX = 10
const WALL_SQUARE_GAP_PX = 2

/** A Lines box's state as the wall's: `none` is on track. */
export function wallTone(tone: 'late' | 'soon' | 'followup' | 'stale' | 'none'): WallTone {
  return tone === 'none' ? 'ontrack' : tone
}

interface WallSquare<T> {
  task: T
  tone: WallTone
}

export interface WallList<T> {
  tabId: string
  name: string
  /** Its cell is showing this tab. */
  showing: boolean
  /** The list waits on its prompt: nothing to show yet. */
  waiting: boolean
  /** Every open task it shows, the trouble first (in the list's order within a state). */
  squares: WallSquare<T>[]
  counts: Record<WallTone, number>
}

/** A list's block from its open tasks (`toneOf` each one's state). */
export function buildWallList<T>(
  list: { tabId: string; name: string; showing: boolean; waiting: boolean },
  tasks: readonly T[],
  toneOf: (task: T) => WallTone,
): WallList<T> {
  const counts = Object.fromEntries(WALL_TONES.map((t) => [t, 0])) as Record<WallTone, number>
  const byTone = new Map<WallTone, WallSquare<T>[]>(WALL_TONES.map((t) => [t, []]))
  for (const task of tasks) {
    const tone = toneOf(task)
    counts[tone]++
    byTone.get(tone)!.push({ task, tone })
  }
  return { ...list, squares: WALL_TONES.flatMap((t) => byTone.get(t)!), counts }
}

/**
 * A block's grid of `count` squares with room for `rowsFit` rows (the
 * wall's height): 14 columns while six rows fit; in a shorter wall fewer
 * rows (two at least), the block widening up to 28 columns so it keeps as
 * many squares as six rows of 14 hold — a wide, short cell (a strip above
 * a row of tabs) shows its lists side by side.
 */
export function wallGridShape(count: number, rowsFit: number): { columns: number; rows: number } {
  const rows = Math.max(WALL_ROWS_MIN, Math.min(WALL_ROWS_MAX, Math.floor(rowsFit)))
  const wanted = Math.min(count, WALL_COLUMNS * WALL_ROWS_MAX)
  const columns = Math.max(WALL_COLUMNS, Math.min(WALL_COLUMNS_MAX, Math.ceil(wanted / rows)))
  return { columns, rows }
}

/** How many rows of squares a wall body `height` px tall leaves room for, under a block's name and words. */
export function wallRowsFit(height: number): number {
  // The wall's padding (8 + 12), a block's name (20) and words (15) with their gaps (4 + 4).
  return Math.floor((height - 63 + WALL_SQUARE_GAP_PX) / (WALL_SQUARE_PX + WALL_SQUARE_GAP_PX))
}

/** The squares a block draws in its grid (`wallGridShape`), and how many it leaves for its `+N`. */
export function wallSquaresShown<T>(list: WallList<T>, rowsFit = WALL_ROWS_MAX): { squares: WallSquare<T>[]; more: number; columns: number } {
  const { columns, rows } = wallGridShape(list.squares.length, rowsFit)
  const cap = columns * rows
  if (list.squares.length <= cap) return { squares: list.squares, more: 0, columns }
  const kept = cap - 3
  return { squares: list.squares.slice(0, kept), more: list.squares.length - kept, columns }
}

/** `4 overdue · 3 follow-ups late` — else `2 due soon` — else `Nothing late`. */
export function wallListWords(counts: Record<WallTone, number>): { late: string; followup: string; calm: string } {
  const late = counts.late > 0 ? `${counts.late} overdue` : ''
  const followup = counts.followup > 0 ? `${counts.followup} follow-up${counts.followup === 1 ? '' : 's'} late` : ''
  const calm = late || followup ? '' : counts.soon > 0 ? `${counts.soon} due soon` : 'Nothing late'
  return { late, followup, calm }
}
