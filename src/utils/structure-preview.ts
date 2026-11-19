import type { LayoutBody, LayoutCell } from '../models/workspace-layout'
import type { IdGen } from './workspace-layout-ops'

/**
 * The layout edit mode's previews of an edit before it is made (layout
 * editor round two, concept A): a "+" hovered, a toolbar's Split hovered.
 * The edit runs on the layout with probe ids; the table then draws what it
 * would leave, its new empty cells as the new slots and the cells it grows
 * outlined.
 */

/** What an edit would leave: its body, the cells it makes, the filled cells it grows. */
interface StructureProbe {
  body: LayoutBody
  newCellIds: string[]
  grewCellIds: string[]
}

/** A probe cell's id: never one a layout holds. */
const PROBE_ID = '\u0000preview-'

/** How many tracks a cell covers, across and down. */
const tracksCovered = (cell: LayoutCell) => cell.area.colSpan + cell.area.rowSpan

/**
 * Runs `edit` on `layout` with probe ids: the body it leaves, the cells it
 * makes (new ids) and the filled cells that cover more tracks than before
 * (a cell crossing a new line grows across the new track). `null` when the
 * edit changes nothing.
 */
export function structureProbe(layout: LayoutBody, edit: (layout: LayoutBody, genId: IdGen) => LayoutBody): StructureProbe | null {
  let n = 0
  const out = edit(layout, () => `${PROBE_ID}${n++}`)
  if (out === layout) return null
  const before = new Map(layout.cells.map((c) => [c.id, c]))
  const newCellIds: string[] = []
  const grewCellIds: string[] = []
  for (const c of out.cells) {
    const was = before.get(c.id)
    if (!was) newCellIds.push(c.id)
    else if (c.tabs.length > 0 && tracksCovered(c) > tracksCovered(was)) grewCellIds.push(c.id)
  }
  return { body: { grid: out.grid, cells: out.cells }, newCellIds, grewCellIds }
}

/**
 * The layout drawn as a probe's `body`: its grid, each of the layout's
 * cells at its area there (the same object where it didn't move, so no
 * cell renders again for nothing), then the probe's new cells. The layout
 * itself when the probe dropped one of its cells.
 */
export function withStructurePreview<L extends LayoutBody>(layout: L, body: LayoutBody, newCellIds: readonly string[]): L {
  const byId = new Map(body.cells.map((c) => [c.id, c]))
  const cells: LayoutCell[] = []
  for (const c of layout.cells) {
    const next = byId.get(c.id)
    if (!next) return layout
    const a = next.area
    const b = c.area
    cells.push(a.col === b.col && a.row === b.row && a.colSpan === b.colSpan && a.rowSpan === b.rowSpan ? c : { ...c, area: a })
  }
  for (const id of newCellIds) {
    const c = byId.get(id)
    if (c) cells.push(c)
  }
  return { ...layout, grid: body.grid, cells }
}
