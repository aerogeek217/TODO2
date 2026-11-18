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

/** A block's squares, in rows of this many. */
const WALL_COLUMNS = 14
/** A block stops at this many rows, its last three squares giving way to `+N`. */
const WALL_ROWS_MAX = 6

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

/** The squares a block draws, and how many it leaves for its `+N`. */
export function wallSquaresShown<T>(list: WallList<T>): { squares: WallSquare<T>[]; more: number } {
  const cap = WALL_COLUMNS * WALL_ROWS_MAX
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
