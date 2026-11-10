import type { CellArea, GridTrack, LayoutBody, LayoutCell } from '../models/workspace-layout'

/**
 * A resize handle's preview of a structural move (a divider or crossing drag
 * that moves part of a line, or a line onto or past another): the table
 * drawn as the release will leave it. The cells keep their objects and
 * their order (so none remounts or moves in the DOM); only the grid and
 * their areas change.
 */

function sameArea(a: CellArea, b: CellArea): boolean {
  return a.col === b.col && a.row === b.row && a.colSpan === b.colSpan && a.rowSpan === b.rowSpan
}

function sameTracks(a: readonly GridTrack[], b: readonly GridTrack[]): boolean {
  return a.length === b.length && a.every((t, i) => {
    const u = b[i]
    return u != null && t.id === u.id && t.weight === u.weight && t.px === u.px && t.fitPx === u.fitPx && t.collapsed === u.collapsed
  })
}

/**
 * `layout` drawn as `body`: `body`'s grid, and each of `layout`'s cells at
 * its area in `body` — the cell objects otherwise as they are (their tabs as
 * the working copy holds them now), in `layout`'s order. `layout` itself
 * when the two don't hold the same cells.
 */
export function previewedLayout<L extends LayoutBody>(layout: L, body: LayoutBody): L {
  if (body.cells.length !== layout.cells.length) return layout
  const areaById = new Map(body.cells.map((c) => [c.id, c.area]))
  const cells: LayoutCell[] = []
  for (const c of layout.cells) {
    const area = areaById.get(c.id)
    if (!area) return layout
    cells.push(sameArea(area, c.area) ? c : { ...c, area })
  }
  return { ...layout, grid: body.grid, cells }
}

/** Whether two previews draw the same table: the same tracks (ids and sizes) and every cell at the same area. */
export function samePreviewBody(a: LayoutBody, b: LayoutBody): boolean {
  if (!sameTracks(a.grid.columns, b.grid.columns) || !sameTracks(a.grid.rows, b.grid.rows)) return false
  if (a.cells.length !== b.cells.length) return false
  const areaById = new Map(b.cells.map((c) => [c.id, c.area]))
  return a.cells.every((c) => {
    const area = areaById.get(c.id)
    return area != null && sameArea(area, c.area)
  })
}
