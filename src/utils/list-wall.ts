/**
 * A List board tile's squares: one per open task the list shows, the
 * trouble first. A task's state is its Lines box's (`list-zoom.rowTone`):
 * overdue, due soon, follow-up late, on track, stale — the first that
 * holds — its fill; its priority a ring and Focus's glow, as on the task's
 * checkbox.
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

/** The squares a tile draws in `rows` rows of `columns`, and how many it leaves for its `+N` (the last three squares' place). */
export function wallSquaresShown<T>(list: WallList<T>, shape: { columns: number; rows: number }): { squares: WallSquare<T>[]; more: number } {
  const cap = shape.columns * shape.rows
  if (list.squares.length <= cap) return { squares: list.squares, more: 0 }
  const kept = Math.max(0, cap - 3)
  return { squares: list.squares.slice(0, kept), more: list.squares.length - kept }
}

/** A list's open tasks by state in words (`1 overdue · 3 on track`; `No open tasks`; `Waits on its prompt`). */
export function wallCountsText(list: Pick<WallList<unknown>, 'counts' | 'waiting'>): string {
  if (list.waiting) return 'Waits on its prompt'
  return WALL_TONES.filter((t) => list.counts[t] > 0).map((t) => `${list.counts[t]} ${WALL_TONE_NAMES[t].toLowerCase()}`).join(' · ') || 'No open tasks'
}
