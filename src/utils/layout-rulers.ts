import type { GridAxis, LayoutBody, LayoutCell } from '../models/workspace-layout'
import type { TrackRemoval } from './workspace-layout-ops'
import { spanOf } from './workspace-grid'
import { isFitCell, isNumberStripCell } from './workspace-rows'
import { trackSizing } from './workspace-table'

/**
 * The layout edit mode's rulers (E2): what each track's ruler says, which
 * tracks are slivers, and the words Remove row / column shows. Pure.
 *
 * **Major and sliver tracks** (decision F): a track is a *sliver* when it is
 * drawn under `SLIVER_PX` and no cell lies only in it — every cell over it
 * also covers a track beside it, as when part of a line was dragged a few
 * px off its line. A cell's minimum (58px and up) keeps any track a cell
 * lies only in wider than that, so the second test only guards a track
 * that can't be measured. Every other track is *major*: only majors are
 * lettered (columns A, B, C…) and numbered (rows 1, 2, 3…), in order; a
 * sliver gets an unlabelled tick whose menu merges it into a neighbour.
 */

/** Below this drawn size (px) a track no cell lies only in is a sliver. */
export const SLIVER_PX = 24

/** A column's letter: A … Z, then AA, AB … */
export function columnLetter(n: number): string {
  let s = ''
  let k = n
  do {
    s = String.fromCharCode(65 + (k % 26)) + s
    k = Math.floor(k / 26) - 1
  } while (k >= 0)
  return s
}

/** Whether some cell lies only in track `i` of `axis` (starts and ends in it). */
function someCellOnlyIn(body: LayoutBody, axis: GridAxis, i: number): boolean {
  return body.cells.some((c) => {
    const [s, e] = spanOf(c.area, axis)
    return s === i && e === i + 1
  })
}

/**
 * Whether track `i` of `axis` is a sliver: drawn (`sizes`, px, the table's
 * computed tracks) under `SLIVER_PX`, with no cell lying only in it. With
 * no size for it (not measured), never.
 */
export function isSliverTrack(body: LayoutBody, axis: GridAxis, i: number, sizes: readonly number[]): boolean {
  const size = sizes[i]
  return size != null && Number.isFinite(size) && size < SLIVER_PX && !someCellOnlyIn(body, axis, i)
}

/** Each track's ruler name — a major's letter (columns) or number (rows), counted over the majors only; `null` for a sliver. */
export function trackNames(body: LayoutBody, axis: GridAxis, sizes: readonly number[]): Array<string | null> {
  let n = 0
  return body.grid[axis].map((_, i) => {
    if (isSliverTrack(body, axis, i, sizes)) return null
    const name = axis === 'columns' ? columnLetter(n) : String(n + 1)
    n++
    return name
  })
}

/** A column's share as its ruler shows it: a weighted column its percent of the weighted columns, a fixed one its px. */
export function columnShare(body: LayoutBody, i: number): string {
  const sizing = trackSizing(body, 'columns', i)
  if (sizing.kind === 'fixed') return `${sizing.px}px`
  let total = 0
  body.grid.columns.forEach((_, j) => {
    const s = trackSizing(body, 'columns', j)
    if (s.kind === 'weighted') total += s.weight
  })
  return sizing.kind === 'weighted' && total > 0 ? `${Math.round((sizing.weight / total) * 100)}%` : ''
}

/** A row's mark on its ruler: `folded` while collapsed, `fit` while it fits its Numbers; else none. */
export function rowMark(body: LayoutBody, i: number): 'fit' | 'folded' | null {
  const sizing = trackSizing(body, 'rows', i)
  if (sizing.kind === 'collapsed') return 'folded'
  if (sizing.kind === 'fit') return 'fit'
  return null
}

/** Whether row `i` can collapse: some filled cell lies only in it (a folded row nothing can expand opens again at once). */
export function rowCanCollapse(body: LayoutBody, i: number): boolean {
  return body.cells.some((c) => c.tabs.length > 0 && c.area.row === i && c.area.rowSpan === 1)
}

/** `A`, `A and B`, `A, B and C`, `A, B and 2 more`. */
function namesInWords(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  if (names.length > 3) return `${names.slice(0, 2).join(', ')} and ${names.length - 2} more`
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1) ?? ''}`
}

/** Where a removed track's place is, in words: `the row above`, `the column to the right`. */
function neighbourWords(axis: GridAxis, index: number, neighbour: number): string {
  if (axis === 'rows') return neighbour < index ? 'the row above' : 'the row below'
  return neighbour < index ? 'the column to the left' : 'the column to the right'
}

/**
 * What Remove row / column will do, in words, for its menu: each cell that
 * moves, named by its widgets (`title`, a tab's title), and where — `Status
 * joins Tasks for… as a tab.`, `Status and Trend join Tasks for… as tabs.`,
 * `Notes moves into the row above.` A Numbers strip that joins a cell not of
 * Numbers says its Numbers become tabs (and a strip that takes other
 * widgets, that it becomes tabs). With nothing that moves, that the cells
 * across it lose it.
 */
export function removeTrackMessage(
  body: LayoutBody,
  axis: GridAxis,
  index: number,
  plan: TrackRemoval,
  title: (tabId: string) => string,
): string {
  const kind = axis === 'rows' ? 'row' : 'column'
  if (plan.moves.length === 0) return `No widget lies only in this ${kind}: the cells across it get ${axis === 'rows' ? 'shorter' : 'narrower'}.`
  const byId = new Map(body.cells.map((c) => [c.id, c]))
  const cellName = (c: LayoutCell): string => {
    const active = c.tabs.find((t) => t.id === c.activeTabId) ?? c.tabs[0]
    return active ? title(active.id) : 'an empty cell'
  }
  // The moves into one cell said together (`Notes and Calendar join Tasks as tabs.`); a move into its place on its own.
  const groups: Array<{ into: string | null; moves: TrackRemoval['moves'] }> = []
  for (const m of plan.moves) {
    const group = m.into != null ? groups.find((g) => g.into === m.into) : undefined
    if (group) group.moves.push(m)
    else groups.push({ into: m.into, moves: [m] })
  }
  return groups.map(({ into: intoId, moves }) => {
    const names = moves.flatMap((m) => m.tabIds.map(title))
    const many = names.length > 1
    const verb = many ? 'join' : 'joins'
    if (intoId == null) return `${namesInWords(names)} ${many ? 'move' : 'moves'} into ${neighbourWords(axis, index, plan.neighbour)}.`
    const into = byId.get(intoId)
    const from = moves.map((m) => byId.get(m.cellId)).filter((c): c is LayoutCell => c != null)
    if (!into || from.length === 0) return `${namesInWords(names)} ${verb} another cell.`
    if (from.every((c) => isFitCell(c)) && isFitCell(into)) {
      return `${namesInWords(names)} ${verb} ${isNumberStripCell(into) ? 'the Numbers strip' : `${cellName(into)} in one Numbers strip`}.`
    }
    if (from.length === 1 && from[0] && isNumberStripCell(from[0])) return `The Numbers strip (${namesInWords(names)}) joins ${cellName(into)}: its Numbers become tabs.`
    if (from.some((c) => isNumberStripCell(c))) return `${namesInWords(names)} join ${cellName(into)} as tabs: the Numbers strip’s Numbers become tabs.`
    if (isNumberStripCell(into)) return `${namesInWords(names)} ${verb} the Numbers strip, whose Numbers become tabs.`
    return `${namesInWords(names)} ${verb} ${cellName(into)} as ${many ? 'tabs' : 'a tab'}.`
  }).join(' ')
}
