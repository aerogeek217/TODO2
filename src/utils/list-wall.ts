/**
 * The List wall (task maps, 2026-11-18): every list tab of a layout as a
 * block of squares, one per open task the list shows, the trouble first.
 * A task's state is its Lines box's (`list-zoom.rowTone`): overdue, due
 * soon, follow-up late, on track, stale — the first that holds — its fill;
 * its priority a ring and Focus's glow, as on the task's checkbox.
 */

import type { MarkerSummary } from './markers'

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

/** A block's squares at least across (its name ellipsizes), and at most. */
const WALL_COLUMNS_MIN = 8
const WALL_COLUMNS_MAX = 40
/** Without a measured width: 14 across, the blocks wrapping. */
const WALL_COLUMNS_UNMEASURED = 14
/** A block's rows at least (a short cell), at most while its blocks wrap, and at most in one row of blocks. */
const WALL_ROWS_MIN = 2
const WALL_ROWS_MAX = 6
const WALL_ROWS_MAX_ONE_LINE = 12
/** A square's side and the gap between squares, px. */
const WALL_SQUARE_PX = 10
const WALL_SQUARE_GAP_PX = 2
/** The gap between blocks side by side, px. */
const WALL_BLOCK_GAP_PX = 18

/** A Lines box's state as the wall's: `none` is on track. */
export function wallTone(tone: 'late' | 'soon' | 'followup' | 'stale' | 'none'): WallTone {
  return tone === 'none' ? 'ontrack' : tone
}

interface WallSquare<T> {
  task: T
  tone: WallTone
  /** Its priority, drawn as a task's checkbox draws it (`PriorityRing`); absent without `markersOf`. */
  markers?: WallMarkers
}

/** A square's priority: `markerSummary`'s marks and name. */
export type WallMarkers = Pick<MarkerSummary, 'focus' | 'urgent' | 'important' | 'label'>

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

/** A list's block from its open tasks (`toneOf` each one's state, `markersOf` its priority). */
export function buildWallList<T>(
  list: { tabId: string; name: string; showing: boolean; waiting: boolean },
  tasks: readonly T[],
  toneOf: (task: T) => WallTone,
  markersOf?: (task: T) => WallMarkers,
): WallList<T> {
  const counts = Object.fromEntries(WALL_TONES.map((t) => [t, 0])) as Record<WallTone, number>
  const byTone = new Map<WallTone, WallSquare<T>[]>(WALL_TONES.map((t) => [t, []]))
  for (const task of tasks) {
    const tone = toneOf(task)
    counts[tone]++
    byTone.get(tone)!.push(markersOf ? { task, tone, markers: markersOf(task) } : { task, tone })
  }
  return { ...list, squares: WALL_TONES.flatMap((t) => byTone.get(t)!), counts }
}

/** How the wall lays out its blocks: `perRow` side by side (`null`: unmeasured, they wrap), each `columns` squares across and `rows` down at most. */
export interface WallShape {
  perRow: number | null
  columns: number
  rows: number
}

/** A block `columns` squares across, px. */
const blockWidth = (columns: number) => columns * (WALL_SQUARE_PX + WALL_SQUARE_GAP_PX) - WALL_SQUARE_GAP_PX

/**
 * The wall's shape for `count` lists in `width` px with room for `rowsFit`
 * rows of squares: as many blocks side by side as fit at 8 squares across
 * (all of them where they fit — a wide cell shows its lists in one row,
 * never wrapping into empty width), each block then sharing the width
 * evenly, its squares as many across as that width holds (40 at most). Down:
 * the rows the height has, two at least, six at most while the blocks
 * wrap — twelve in one row of blocks.
 */
export function wallShape(count: number, width: number, rowsFit: number): WallShape {
  const fit = Number.isFinite(rowsFit) ? Math.floor(rowsFit) : WALL_ROWS_MAX
  if (width <= 0 || count <= 0) {
    return { perRow: null, columns: WALL_COLUMNS_UNMEASURED, rows: Math.max(WALL_ROWS_MIN, Math.min(WALL_ROWS_MAX, fit)) }
  }
  const minWidth = blockWidth(WALL_COLUMNS_MIN)
  const perRow = Math.max(1, Math.min(count, Math.floor((width + WALL_BLOCK_GAP_PX) / (minWidth + WALL_BLOCK_GAP_PX))))
  const each = (width - (perRow - 1) * WALL_BLOCK_GAP_PX) / perRow
  const columns = Math.max(WALL_COLUMNS_MIN, Math.min(WALL_COLUMNS_MAX, Math.floor((each + WALL_SQUARE_GAP_PX) / (WALL_SQUARE_PX + WALL_SQUARE_GAP_PX))))
  const rowsMax = perRow >= count ? WALL_ROWS_MAX_ONE_LINE : WALL_ROWS_MAX
  return { perRow, columns, rows: Math.max(WALL_ROWS_MIN, Math.min(rowsMax, fit)) }
}

/** How many rows of squares a wall body `height` px tall leaves room for, under a block's name and words. */
export function wallRowsFit(height: number): number {
  // The wall's padding (8 + 12), a block's name (20) and words (15) with their gaps (4 + 4).
  return Math.floor((height - 63 + WALL_SQUARE_GAP_PX) / (WALL_SQUARE_PX + WALL_SQUARE_GAP_PX))
}

/** The squares a block draws in a wall of `shape`, and how many it leaves for its `+N`. */
export function wallSquaresShown<T>(list: WallList<T>, shape: Pick<WallShape, 'columns' | 'rows'> = { columns: WALL_COLUMNS_UNMEASURED, rows: WALL_ROWS_MAX }): { squares: WallSquare<T>[]; more: number } {
  const cap = shape.columns * shape.rows
  if (list.squares.length <= cap) return { squares: list.squares, more: 0 }
  const kept = cap - 3
  return { squares: list.squares.slice(0, kept), more: list.squares.length - kept }
}

/** `4 overdue · 3 follow-ups late` — else `2 due soon` — else `Nothing late`. */
export function wallListWords(counts: Record<WallTone, number>): { late: string; followup: string; calm: string } {
  const late = counts.late > 0 ? `${counts.late} overdue` : ''
  const followup = counts.followup > 0 ? `${counts.followup} follow-up${counts.followup === 1 ? '' : 's'} late` : ''
  const calm = late || followup ? '' : counts.soon > 0 ? `${counts.soon} due soon` : 'Nothing late'
  return { late, followup, calm }
}
