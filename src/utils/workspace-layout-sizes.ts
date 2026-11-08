import type { GridAxis, GridTrack, LayoutBody } from '../models/workspace-layout'
import { isPositive, withTracks } from './workspace-layout-edit'

/**
 * A layout's sizes: its tracks' weights (a weighted track) and px (a fixed
 * one) — a divider drag sets two neighbours at once — copied between two
 * bodies on an axis where both have the same tracks (`copySizes`). Sizes
 * are view state. Each write returns the same object when nothing changes.
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

/** The axes the tracks `trackIds` are on, in `layout`. */
export function trackAxes(layout: LayoutBody, trackIds: Iterable<string>): GridAxis[] {
  const ids = new Set(trackIds)
  return GRID_AXES.filter((axis) => layout.grid[axis].some((t) => ids.has(t.id)))
}

function sameIds(a: readonly { id: string }[], b: readonly { id: string }[]): boolean {
  return a.length === b.length && a.every((x, i) => x.id === b[i]?.id)
}

/** `track` with `from`'s size (its weight or px, whichever it has); the track itself when the same. */
function sizeFrom(track: GridTrack, from: GridTrack): GridTrack {
  if (track.weight === from.weight && track.px === from.px) return track
  const { weight: _w, px: _p, ...rest } = track
  void _w
  void _p
  return { ...rest, ...(from.px != null ? { px: from.px } : { weight: from.weight ?? 1 }) }
}

/**
 * `target` with the track sizes of `axes` (`all`: both) copied from
 * `source` — an axis's weights only where both have the same tracks (by id,
 * in order: a weight means something only among its axis's others); a
 * fixed track's px (an absolute size) wherever both have that fixed track.
 * Other sizes stay. The same object when nothing changes.
 */
export function copySizes<L extends LayoutBody>(target: L, source: LayoutBody, axes: readonly GridAxis[] | 'all'): L {
  let next = target
  for (const axis of axes === 'all' ? GRID_AXES : axes) {
    const to = next.grid[axis]
    const from = source.grid[axis]
    const same = sameIds(to, from)
    const fixed = new Map(from.filter((t) => t.px != null).map((t) => [t.id, t]))
    const out = to.map((t, i) => {
      if (same) {
        const f = from[i]
        return f ? sizeFrom(t, f) : t
      }
      const f = fixed.get(t.id)
      return f && t.px != null ? sizeFrom(t, f) : t
    })
    if (out.some((t, i) => t !== to[i])) next = withTracks(next, axis, out)
  }
  return next
}
