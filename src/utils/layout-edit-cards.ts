import type { CellArea, GridAxis, LayoutBody, LayoutCell } from '../models/workspace-layout'
import { cellById, crossAxis, neighbours, readingOrder, sideAxis, spanOf, type Side } from './workspace-grid'
import { cellAreaFits } from './workspace-layout-ops'
import { isNumberStripCell } from './workspace-rows'

/**
 * The layout edit mode's cards and slots (E3), pure: what a card's ruler
 * name is, which cell an arrow key reaches, the area a stretch makes, and
 * what a tap does after another (tap a card, then a slot: it moves there).
 * The view (`components/workspace/edit-card*`) and the store's actions
 * build on these.
 */

/** A cell's ruler names, by axis (`layout-rulers.trackNames`: a major track's letter or number, a sliver's `null`). */
export interface RulerNames {
  columns: ReadonlyArray<string | null>
  rows: ReadonlyArray<string | null>
}

/** The first name over tracks `[from, to)`, else the nearest one before them, else after; `?` with none. */
function nameOver(names: ReadonlyArray<string | null>, from: number, to: number): string {
  for (let i = from; i < to; i++) {
    const n = names[i]
    if (n != null) return n
  }
  for (let i = from - 1; i >= 0; i--) {
    const n = names[i]
    if (n != null) return n
  }
  for (let i = to; i < names.length; i++) {
    const n = names[i]
    if (n != null) return n
  }
  return '?'
}

/**
 * A cell's ruler name (`B4`): its first column's letter and its first row's
 * number — a sliver it starts in skipped for the next major track it
 * covers. With no names measured, the tracks counted from 1 (`A1`).
 */
export function cellRulerName(cell: Pick<LayoutCell, 'area'>, names: RulerNames): string {
  const { col, row, colSpan, rowSpan } = cell.area
  const colName = names.columns.length > 0 ? nameOver(names.columns, col, col + colSpan) : columnLetter(col)
  const rowName = names.rows.length > 0 ? nameOver(names.rows, row, row + rowSpan) : String(row + 1)
  return `${colName}${rowName}`
}

/** A column's letter by its index (A … Z, AA …): the names before anything is measured. */
function columnLetter(n: number): string {
  let s = ''
  let k = n
  do {
    s = String.fromCharCode(65 + (k % 26)) + s
    k = Math.floor(k / 26) - 1
  } while (k >= 0)
  return s
}

/** An area's span on an axis, in ruler names: `B`, `B–C`, `4`, `4–5`. */
export function areaRulerName(area: CellArea, names: RulerNames): string {
  const end = { col: area.col + area.colSpan - 1, row: area.row + area.rowSpan - 1 }
  const first = cellRulerName({ area: { ...area, colSpan: 1, rowSpan: 1 } }, names)
  const last = cellRulerName({ area: { col: end.col, row: end.row, colSpan: 1, rowSpan: 1 } }, names)
  return first === last ? first : `${first}–${last}`
}

/**
 * A card's name in the mode (Swap with ▸, Join as tabs ▸, a swap's ghost,
 * the armed move's hint): a one-widget card its widget's title; a Numbers
 * strip `3 Numbers`; a card of tabs its first two tabs' titles and how many
 * more — `Tasks, Notes`, `Tasks, Notes + 2`. `titles` are its tabs'
 * titles, in order. An empty cell: `''`.
 */
export function cardName(cell: Pick<LayoutCell, 'tabs'>, titles: readonly string[]): string {
  const n = cell.tabs.length
  if (n === 0) return ''
  if (isNumberStripCell(cell)) return `${n} Numbers`
  const [a = 'A widget', b = 'a widget'] = titles
  if (n === 1) return a
  return n === 2 ? `${a}, ${b}` : `${a}, ${b} + ${n - 2}`
}

/** The layout's empty cells (slots), in reading order. */
export function emptySlots(body: LayoutBody): LayoutCell[] {
  return readingOrder(body).filter((c) => c.tabs.length === 0)
}

/** The layout's filled cells (cards) but `cellId`, in reading order. */
export function otherCards(body: LayoutBody, cellId: string): LayoutCell[] {
  return readingOrder(body).filter((c) => c.tabs.length > 0 && c.id !== cellId)
}

/** How many tracks `[a0, a1)` and `[b0, b1)` share. */
function shared(a: readonly [number, number], b: readonly [number, number]): number {
  return Math.max(0, Math.min(a[1], b[1]) - Math.max(a[0], b[0]))
}

/**
 * The cell an arrow key reaches from cell `cellId` (layout edit mode E3:
 * the selection moving between cards and slots): the neighbour across
 * `side` sharing the most of that edge — on a tie the one whose middle is
 * nearest its middle, then the first along it. `undefined` at the layout's
 * edge or for an unknown cell.
 */
export function spatialNeighbour(body: LayoutBody, cellId: string, side: Side): LayoutCell | undefined {
  const cell = cellById(body, cellId)
  if (!cell) return undefined
  const cross: GridAxis = crossAxis(sideAxis(side))
  const own = spanOf(cell.area, cross)
  const mid = (own[0] + own[1]) / 2
  let best: { cell: LayoutCell; share: number; gap: number } | null = null
  for (const n of neighbours(body, cellId, side)) {
    const span = spanOf(n.area, cross)
    const share = shared(own, span)
    const gap = Math.abs((span[0] + span[1]) / 2 - mid)
    if (!best || share > best.share || (share === best.share && gap < best.gap)) best = { cell: n, share, gap }
  }
  return best?.cell
}

/** Which way a card stretches by one track (its bottom-right corner): out right / down, or back left / up. */
export type StretchDirection = 'right' | 'left' | 'down' | 'up'

/**
 * The area cell `cellId` takes stretched one track `direction` from its
 * bottom-right corner (Stretch right / down, Shift+arrow): right / down
 * grow it over the next track, left / up give its last one back (never
 * below one track). `null` when that can't be: the layout's edge, a filled
 * cell in the way (`cellAreaFits`), or a single track to give back.
 */
export function stretchedArea(body: LayoutBody, cellId: string, direction: StretchDirection): CellArea | null {
  const cell = cellById(body, cellId)
  if (!cell) return null
  const { area } = cell
  const next: CellArea = direction === 'right' ? { ...area, colSpan: area.colSpan + 1 }
    : direction === 'left' ? { ...area, colSpan: area.colSpan - 1 }
      : direction === 'down' ? { ...area, rowSpan: area.rowSpan + 1 }
        : { ...area, rowSpan: area.rowSpan - 1 }
  return cellAreaFits(body, cellId, next) ? next : null
}

/** A drawn axis: each track's start and size (px, along it). */
export interface DrawnAxis {
  starts: readonly number[]
  sizes: readonly number[]
}

/**
 * The last track whose middle `pos` has reached (a card's corner dragged to
 * `pos`), never before track `min`; `min` with none.
 */
export function trackReached(axis: DrawnAxis, pos: number, min: number): number {
  let at = min
  axis.starts.forEach((start, i) => {
    const size = axis.sizes[i] ?? 0
    if (i > at && pos >= start + size / 2) at = i
  })
  return at
}

/**
 * Where a card's bottom-right corner dragged to `end` (its last column and
 * row) takes it: the cell's top-left kept, its spans to `end` (at least one
 * track each). `null` when that area doesn't fit (`cellAreaFits`) — the
 * drag keeps its last area that did.
 */
export function cornerArea(body: LayoutBody, cellId: string, end: { col: number; row: number }): CellArea | null {
  const cell = cellById(body, cellId)
  if (!cell) return null
  const { col, row } = cell.area
  const area: CellArea = { col, row, colSpan: Math.max(1, end.col - col + 1), rowSpan: Math.max(1, end.row - row + 1) }
  return cellAreaFits(body, cellId, area) ? area : null
}

/**
 * Alt+arrow on a card: what moving it one place `side` does — onto the
 * neighbouring slot (`move`, the slot taking it as a drop does), or a swap
 * with the neighbouring card (`swap`); `null` at the layout's edge.
 */
export function altMove(body: LayoutBody, cellId: string, side: Side): { kind: 'move' | 'swap'; cellId: string } | null {
  const n = spatialNeighbour(body, cellId, side)
  if (!n) return null
  return { kind: n.tabs.length === 0 ? 'move' : 'swap', cellId: n.id }
}

// ── Tap, then tap ───────────────────────────────────────────────────────────

/** The mode's selection as a tap reads it: the selected cell, and whether a tap on it armed a move. */
interface TapState {
  selectedCellId: string | null
  moveArmed: boolean
}

/** What is tapped: a card (on its middle, its tab area, or near an edge), or a slot. */
export type TapTarget =
  | { kind: 'card'; cellId: string; zone: 'middle' | 'tabs' | 'edge' }
  | { kind: 'slot'; cellId: string }

/**
 * What a tap does (WCAG 2.5.7's single-pointer way to move a card):
 * - a card, with no move armed (or on its own edge): selects it and arms a
 *   move (`select`);
 * - the armed card again: disarms (`disarm`), the card still selected;
 * - a slot, with a card armed: the card moves there (`move`);
 * - another card's middle, with a card armed: the two swap places
 *   (`swap`); its tab area (its strip, a one-widget card's top band): the
 *   armed card joins it as tabs (`join`); its edge selects it instead
 *   (`select`);
 * - a slot, with none armed: selects it and opens its kinds (`menu`).
 */
export type TapOutcome =
  | { kind: 'select'; cellId: string }
  | { kind: 'disarm' }
  | { kind: 'move'; from: string; to: string }
  | { kind: 'join'; from: string; into: string }
  | { kind: 'swap'; from: string; with: string }
  | { kind: 'menu'; cellId: string }
  /** The widgets in hand (Move / Copy to layout) placed in that slot or card (`workspace-store.tapEdit` only, never `tapOutcome`). */
  | { kind: 'place'; cellId: string }

export function tapOutcome(state: TapState, target: TapTarget): TapOutcome {
  const armed = state.moveArmed ? state.selectedCellId : null
  if (target.kind === 'slot') return armed != null ? { kind: 'move', from: armed, to: target.cellId } : { kind: 'menu', cellId: target.cellId }
  if (armed == null) return { kind: 'select', cellId: target.cellId }
  if (armed === target.cellId) return { kind: 'disarm' }
  if (target.zone === 'middle') return { kind: 'swap', from: armed, with: target.cellId }
  return target.zone === 'tabs' ? { kind: 'join', from: armed, into: target.cellId } : { kind: 'select', cellId: target.cellId }
}
