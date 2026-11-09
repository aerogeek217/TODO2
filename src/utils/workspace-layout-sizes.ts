import type { GridAxis, GridTrack, LayoutBody } from '../models/workspace-layout'
import { isPositive, withTracks } from './workspace-layout-edit'
import { spanOf } from './workspace-grid'

/**
 * A layout's sizes: its tracks' weights (a weighted track), px (a fixed
 * one) and a Numbers-only row's `fitPx` (the height a divider gave it) — a
 * divider drag sets two neighbours at once — copied between two bodies on
 * an axis where both have the same tracks (`copySizes`). Sizes are view
 * state. Each write returns the same object when nothing changes.
 */

/** Both axes, columns first. */
export const GRID_AXES: readonly GridAxis[] = ['columns', 'rows']

/** A track with its size set to `size`, in its own unit (its `px` when it has one, else its weight); the track itself when unchanged. */
function sized(track: GridTrack, size: number): GridTrack {
  if (track.px != null) {
    const px = Math.max(1, Math.round(size))
    return px === track.px ? track : { ...track, px }
  }
  return size === track.weight ? track : { ...track, weight: size }
}

/**
 * Batched resize: sets the size of every listed track (by id, either axis)
 * at once, so a divider drag updates its two neighbours together — a
 * weighted track's weight, a fixed track's px (rounded). Unknown ids and
 * non-positive / non-finite sizes are ignored.
 */
export function setTrackSizes<L extends LayoutBody>(layout: L, sizeById: Readonly<Record<string, number>>): L {
  let next = layout
  for (const axis of GRID_AXES) {
    const tracks = next.grid[axis]
    let changed = false
    const out = tracks.map((track) => {
      const size = sizeById[track.id]
      if (!isPositive(size)) return track
      const t = sized(track, size)
      if (t !== track) changed = true
      return t
    })
    if (changed) next = withTracks(next, axis, out)
  }
  return next
}

/** `track` without its `fitPx`; the track itself when it has none. */
function withoutFitPx(track: GridTrack): GridTrack {
  if (track.fitPx == null) return track
  const { fitPx: _f, ...rest } = track
  void _f
  return rest
}

/**
 * Row track `trackId` without its `fitPx` — a Numbers-only row a divider
 * gave a height fits its content again. The same object when it has none.
 */
export function withoutTrackFitPx<L extends LayoutBody>(layout: L, trackId: string): L {
  const tracks = layout.grid.rows
  const i = tracks.findIndex((t) => t.id === trackId)
  const track = tracks[i]
  if (!track || track.fitPx == null) return layout
  return withTracks(layout, 'rows', tracks.map((t, j) => (j === i ? withoutFitPx(t) : t)))
}

/** The axes the tracks `trackIds` are on, in `layout`. */
export function trackAxes(layout: LayoutBody, trackIds: Iterable<string>): GridAxis[] {
  const ids = new Set(trackIds)
  return GRID_AXES.filter((axis) => layout.grid[axis].some((t) => ids.has(t.id)))
}

function sameIds(a: readonly { id: string }[], b: readonly { id: string }[]): boolean {
  return a.length === b.length && a.every((x, i) => x.id === b[i]?.id)
}

/** `track` with `from`'s size (its weight or px, whichever it has, and its `fitPx` or none); the track itself when the same. */
function sizeFrom(track: GridTrack, from: GridTrack): GridTrack {
  if (track.weight === from.weight && track.px === from.px && track.fitPx === from.fitPx) return track
  const { weight: _w, px: _p, fitPx: _f, ...rest } = track
  void _w
  void _p
  void _f
  return {
    ...rest,
    ...(from.px != null ? { px: from.px } : { weight: from.weight ?? 1 }),
    ...(from.fitPx != null ? { fitPx: from.fitPx } : {}),
  }
}

/** `track` with `from`'s `fitPx` (or none); the track itself when the same. */
function fitPxFrom(track: GridTrack, from: GridTrack): GridTrack {
  if (track.fitPx === from.fitPx) return track
  return from.fitPx != null ? { ...track, fitPx: from.fitPx } : withoutFitPx(track)
}

/** Each cell over track `i` of `axis`, with the tracks it spans (by id). */
function cellsOver(body: LayoutBody, axis: GridAxis, i: number): string {
  const tracks = body.grid[axis]
  return body.cells.flatMap((c) => {
    const [s, e] = spanOf(c.area, axis)
    return s <= i && i < e ? [`${c.id}:${tracks[s]?.id ?? ''}:${tracks[e - 1]?.id ?? ''}`] : []
  }).sort().join(' ')
}

/** A fixed track beside track `i` of `body` that `other` doesn't have: only a split makes one, so `i` is a split's half. */
function besideNewFixed(body: LayoutBody, other: LayoutBody, axis: GridAxis, i: number): boolean {
  const ids = new Set(other.grid[axis].map((t) => t.id))
  return [body.grid[axis][i - 1], body.grid[axis][i + 1]].some((t) => t != null && t.px != null && !ids.has(t.id))
}

/**
 * Whether track `id` of `axis` is the same track in `a` and `b`: the same
 * id under the same cells, each spanning the same tracks — and, for a fixed
 * track, not half of a split (`besideNewFixed`; a split's first half keeps
 * the old id). View state set on a track that isn't the same there (a
 * collapse, a fixed track's px) stays with the unsaved edit that made it.
 */
export function sameTrackIn(a: LayoutBody, b: LayoutBody, axis: GridAxis, id: string): boolean {
  const ia = a.grid[axis].findIndex((t) => t.id === id)
  const ib = b.grid[axis].findIndex((t) => t.id === id)
  if (ia < 0 || ib < 0 || cellsOver(a, axis, ia) !== cellsOver(b, axis, ib)) return false
  const fixed = a.grid[axis][ia]?.px != null || b.grid[axis][ib]?.px != null
  return !fixed || (!besideNewFixed(a, b, axis, ia) && !besideNewFixed(b, a, axis, ib))
}

/**
 * `target` with the track sizes of `axes` (`all`: both) copied from
 * `source` — an axis's weights only where both have the same tracks (by id,
 * in order: a weight means something only among its axis's others); a
 * fixed track's px (an absolute size) wherever both have that fixed track
 * and it is the same track there (`sameTrackIn`); a row's `fitPx` (set or
 * cleared, an absolute size too) wherever it is the same track there.
 * Other sizes stay. The same object when nothing changes.
 */
export function copySizes<L extends LayoutBody>(target: L, source: LayoutBody, axes: readonly GridAxis[] | 'all'): L {
  let next = target
  for (const axis of axes === 'all' ? GRID_AXES : axes) {
    const to = next.grid[axis]
    const from = source.grid[axis]
    const same = sameIds(to, from)
    const byId = new Map(from.map((t) => [t.id, t]))
    const out = to.map((t, i) => {
      if (same) {
        const f = from[i]
        return f ? sizeFrom(t, f) : t
      }
      const f = byId.get(t.id)
      if (!f || !sameTrackIn(next, source, axis, t.id)) return t
      return f.px != null && t.px != null ? sizeFrom(t, f) : fitPxFrom(t, f)
    })
    if (out.some((t, i) => t !== to[i])) next = withTracks(next, axis, out)
  }
  return next
}
