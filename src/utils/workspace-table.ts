import type { GridAxis, GridTrack, LayoutBody, LayoutCell } from '../models/workspace-layout'
import { spanOf } from './workspace-grid'
import { cellMinHeightPx, cellMinWidthPx, FIT_ROW_PX, isFitTrack } from './workspace-rows'

/**
 * How the layout's table sizes its tracks (D26 P2), for the view's CSS grid
 * and for the drop ghost, which predicts the sizes a drop's result will
 * take from the sizes measured when the drag started. Pure.
 *
 * A track is one of four sizes:
 * - **fixed** — a `px` track (a former band), its px;
 * - **collapsed** — a collapsed row track, a cell header's height;
 * - **fit** — a row track whose cells hold one Number each
 *   (`workspace-rows.isFitTrack`): `auto`, its content's height — or,
 *   given a height by a divider (`GridTrack.fitPx`), fixed at it;
 * - **weighted** — its share of the free space (`fr`), never under its
 *   minimum: the smallest size its cells may take (`trackMinimums`). When
 *   the minimums don't fit, the table scrolls.
 */

/** The gap (px) between the table's tracks: `--workspace-gutter` (tokens.css), which the CSS grid draws. */
export const WORKSPACE_GUTTER_PX = 6
/** The height (px) of a cell's header: a collapsed row track's size. */
export const TABLE_HEADER_PX = 32
/** A fit row's height (px) when it can't be measured: `workspace-rows.FIT_ROW_PX`, a Number's small face as drawn. */
export const FIT_TRACK_NOMINAL_PX = FIT_ROW_PX

/** How a track is sized: see the module comment. */
export type TrackSizing =
  | { kind: 'fixed'; px: number }
  | { kind: 'collapsed' }
  | { kind: 'fit' }
  | { kind: 'weighted'; weight: number }

/** Track `i` of `axis`: how it is sized. */
export function trackSizing(body: LayoutBody, axis: GridAxis, i: number): TrackSizing {
  const track = body.grid[axis][i]
  if (!track) return { kind: 'weighted', weight: 0 }
  if (axis === 'rows' && track.collapsed === true) return { kind: 'collapsed' }
  if (track.px != null) return { kind: 'fixed', px: track.px }
  if (axis === 'rows' && isFitTrack(body, i)) return track.fitPx != null ? { kind: 'fixed', px: track.fitPx } : { kind: 'fit' }
  return { kind: 'weighted', weight: Math.max(0, track.weight ?? 0) }
}

/**
 * Whether row track `row` draws its cells at their small face, as a fit
 * row does: it fits its content — or is collapsed and would (the cells
 * keep their small face folded). One a divider gave a height draws them
 * by their size.
 */
export function rowDrawsFitFaces(body: LayoutBody, row: number): boolean {
  const sizing = trackSizing(body, 'rows', row)
  return sizing.kind === 'fit' || (sizing.kind === 'collapsed' && isFitTrack(body, row))
}

/** Every track of `axis`: how it is sized. */
export function trackSizings(body: LayoutBody, axis: GridAxis): TrackSizing[] {
  return body.grid[axis].map((_, i) => trackSizing(body, axis, i))
}

/** Whether every row track a cell covers is collapsed (it shows only its header). */
export function isCellCollapsedIn(body: LayoutBody, cell: LayoutCell): boolean {
  const [start, end] = spanOf(cell.area, 'rows')
  const tracks = body.grid.rows.slice(start, end)
  return tracks.length > 0 && tracks.every((t) => t.collapsed === true)
}

/**
 * The smallest size (px) a cell may take along `axis`: 120px wide (a glance
 * cell 72px, `workspace-rows.cellMinWidthPx`); high,
 * `CELL_MIN_PX` (64px for a glance cell, 58px for a cell of one Number —
 * `workspace-rows.cellMinHeightPx`), or its header's height while collapsed.
 */
export function cellMinPx(body: LayoutBody, cell: LayoutCell, axis: GridAxis): number {
  if (axis === 'columns') return cellMinWidthPx(cell)
  return isCellCollapsedIn(body, cell) ? TABLE_HEADER_PX : cellMinHeightPx(cell)
}

/** A track's size (px) that doesn't share the free space, for summing what a cell spans; `null` for a weighted one. */
function settledPx(sizing: TrackSizing): number | null {
  switch (sizing.kind) {
    case 'fixed': return sizing.px
    case 'collapsed': return TABLE_HEADER_PX
    case 'fit': return 0
    case 'weighted': return null
  }
}

/**
 * Each track's minimum (px) along `axis` — 0 for a track that isn't
 * weighted: the largest minimum among the cells lying only in it, then, a
 * cell spanning several tracks short of its minimum (the gaps between them
 * counted), the shortfall shared among its weighted tracks by weight —
 * narrower spans first.
 */
export function trackMinimums(body: LayoutBody, axis: GridAxis, gap: number): number[] {
  const sizings = trackSizings(body, axis)
  const mins = sizings.map(() => 0)
  const cells = [...body.cells].sort((a, b) => {
    const [as, ae] = spanOf(a.area, axis)
    const [bs, be] = spanOf(b.area, axis)
    return ae - as - (be - bs)
  })
  for (const cell of cells) {
    const [start, end] = spanOf(cell.area, axis)
    const weighted: number[] = []
    let have = (end - start - 1) * gap
    for (let t = start; t < end; t++) {
      const sizing = sizings[t]
      const settled = sizing ? settledPx(sizing) : 0
      if (settled == null) {
        weighted.push(t)
        have += mins[t] ?? 0
      } else {
        have += settled
      }
    }
    const short = cellMinPx(body, cell, axis) - have
    if (short <= 0 || weighted.length === 0) continue
    const weightOf = (t: number) => {
      const s = sizings[t]
      return s?.kind === 'weighted' ? s.weight : 0
    }
    const total = weighted.reduce((sum, t) => sum + weightOf(t), 0)
    for (const t of weighted) {
      const share = total > 0 ? weightOf(t) / total : 1 / weighted.length
      mins[t] = (mins[t] ?? 0) + short * share
    }
  }
  return mins
}

/**
 * The CSS `grid-template-*` of `axis`: a fixed track its px, a collapsed one
 * the header's height, a fit one `auto`, a weighted one its share of the
 * free space as `fr` — scaled so the shares sum to 100 (`fr` under 1 in
 * total would leave space empty) — never under its minimum
 * (`minmax(<min>px, <n>fr)`).
 */
export function trackTemplate(body: LayoutBody, axis: GridAxis, gap: number): string {
  const sizings = trackSizings(body, axis)
  const mins = trackMinimums(body, axis, gap)
  const total = sizings.reduce((sum, s) => (s.kind === 'weighted' ? sum + s.weight : sum), 0) || 1
  return sizings.map((s, i) => {
    switch (s.kind) {
      case 'fixed': return `${s.px}px`
      case 'collapsed': return `${TABLE_HEADER_PX}px`
      case 'fit': return 'auto'
      case 'weighted': return `minmax(${Math.round((mins[i] ?? 0) * 100) / 100}px, ${(s.weight / total) * 100}fr)`
    }
    return 'auto'
  }).join(' ')
}

/** A track to lay out: a settled size (px), or a share of the free space no smaller than `min`. */
export type SolveTrack = { px: number } | { weight: number; min: number }

/**
 * The tracks' sizes (px) in `available` px with `gap` between them, as CSS
 * grid sizes flexible tracks (`minmax(min, n fr)`, the `n` summing to 100,
 * `trackTemplate`): the free space shared by weight, a track whose share is under its
 * minimum taking its minimum and leaving the rest to the others. When the
 * minimums don't fit, every flexible track takes its minimum (the table
 * scrolls).
 */
export function solveTracks(tracks: readonly SolveTrack[], available: number, gap: number): number[] {
  const sizes = tracks.map((t) => ('px' in t ? Math.max(0, t.px) : 0))
  const settled = sizes.reduce((sum, s) => sum + s, 0)
  let free = available - settled - Math.max(0, tracks.length - 1) * gap
  const flexible = new Set(tracks.flatMap((t, i) => ('weight' in t ? [i] : [])))
  const totalWeight = [...flexible].reduce((sum, i) => {
    const t = tracks[i]
    return sum + (t && 'weight' in t ? Math.max(0, t.weight) : 0)
  }, 0)
  // The `fr` are scaled to sum to 100 (`trackTemplate`): a share is its weight over the total.
  const factor = (i: number) => {
    const t = tracks[i]
    const w = t && 'weight' in t ? Math.max(0, t.weight) : 0
    return totalWeight > 0 ? w / totalWeight : 0
  }
  const minOf = (i: number) => {
    const t = tracks[i]
    return t && 'weight' in t ? Math.max(0, t.min) : 0
  }
  for (;;) {
    const sumFactor = [...flexible].reduce((sum, i) => sum + factor(i), 0)
    // CSS counts a flex sum under 1 fr as 1 fr — 0.01 of the shares here (100 fr in all).
    const unit = Math.max(0, free) / Math.max(0.01, sumFactor)
    const under = [...flexible].filter((i) => unit * factor(i) < minOf(i))
    if (under.length === 0) {
      for (const i of flexible) sizes[i] = unit * factor(i)
      return sizes
    }
    for (const i of under) {
      sizes[i] = minOf(i)
      free -= minOf(i)
      flexible.delete(i)
    }
  }
}

/** A size measured when the drag started, by track id (a fit row's content height). */
export type MeasuredTracks = ReadonlyMap<string, number>

/**
 * The tracks of `axis` sized in `available` px (`solveTracks`), a fit row
 * at its size `measured` (by its id) or `FIT_TRACK_NOMINAL_PX`.
 */
export function tableTrackSizes(body: LayoutBody, axis: GridAxis, available: number, gap: number, measured: MeasuredTracks = new Map()): number[] {
  const mins = trackMinimums(body, axis, gap)
  const tracks: SolveTrack[] = trackSizings(body, axis).map((s, i) => {
    switch (s.kind) {
      case 'fixed': return { px: s.px }
      case 'collapsed': return { px: TABLE_HEADER_PX }
      case 'fit': return { px: measured.get(body.grid[axis][i]?.id ?? '') ?? FIT_TRACK_NOMINAL_PX }
      case 'weighted': return { weight: s.weight, min: mins[i] ?? 0 }
    }
    return { px: 0 }
  })
  return solveTracks(tracks, available, gap)
}

/** Where track `i` starts (px from the table's content edge), with `gap` between tracks. */
export function trackStart(sizes: readonly number[], i: number, gap: number): number {
  let at = 0
  for (let t = 0; t < i; t++) at += (sizes[t] ?? 0) + gap
  return at
}

/** The span of tracks `start … end - 1` (px): their sizes and the gaps between them. */
export function spanPx(sizes: readonly number[], start: number, end: number, gap: number): number {
  let px = 0
  for (let t = start; t < end; t++) px += sizes[t] ?? 0
  return px + Math.max(0, end - start - 1) * gap
}

/** A track list's ids, for `MeasuredTracks`. */
export function trackIds(tracks: readonly GridTrack[]): string[] {
  return tracks.map((t) => t.id)
}
