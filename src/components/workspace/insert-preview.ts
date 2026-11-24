import type { GridAxis, LayoutCell, WorkspaceLayout } from '../../models/workspace-layout'
import { useWorkspaceStore, type StructurePreview } from '../../stores/workspace-store'
import { structureProbe } from '../../utils/structure-preview'
import { insertTrackAt, splitCell } from '../../utils/workspace-layout-ops'
import type { Side } from '../../utils/workspace-grid'
import type { MergeKind } from '../../utils/layout-edit-cards'
import { mergeCells } from '../../utils/workspace-layout-ops'

/**
 * The layout edit mode's previews of an edit not yet made: the table draws
 * what the edit would leave (`workspace-store.structurePreview`, drawn by
 * `WorkspaceView`), and the mode bar says it in words. The selection's
 * controls stay where they were while the table reflows under them
 * (`EditSelection`), so the preview never flickers.
 */

/** `a`, `a and b`, `a, b and c`. */
function listWords(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
}

/** The grown cells in words: `By person stretches across it`, `nothing stretches`. */
function grewWords(layout: WorkspaceLayout, grewIds: readonly string[], cellName: (cell: LayoutCell) => string, across: string): string {
  const names = grewIds.map((id) => layout.cells.find((c) => c.id === id)).filter((c): c is LayoutCell => c != null).map(cellName)
  if (names.length === 0) return ''
  return ` · ${listWords(names)} ${names.length === 1 ? 'stretches' : 'stretch'} ${across}`
}

/**
 * A full row / column on the run of lines `first` … `last` (an edge tab):
 * its preview, `where` its place in words (`between 1 and 2`), sized from
 * track `from` (`insertTrackAt`).
 */
export function insertPreview(
  layout: WorkspaceLayout,
  axis: GridAxis,
  first: number,
  last: number,
  where: string,
  cellName: (cell: LayoutCell) => string,
  from?: number,
): StructurePreview | null {
  const probe = structureProbe(layout, (l, genId) => insertTrackAt(l, axis, first, genId, from, last).layout)
  if (!probe || layout.id == null) return null
  const noun = axis === 'columns' ? 'Column' : 'Row'
  return {
    layoutId: layout.id,
    ...probe,
    hint: `${noun} ${where}${grewWords(layout, probe.grewCellIds, cellName, 'across it')} · click to insert`,
  }
}

/** A card split on `side` (the toolbar's Split → / ↓): its preview. */
export function splitPreview(layout: WorkspaceLayout, cell: LayoutCell, side: Side, cellName: (cell: LayoutCell) => string): StructurePreview | null {
  const probe = structureProbe(layout, (l, genId) => splitCell(l, cell.id, side, genId).layout)
  if (!probe || layout.id == null) return null
  const way = side === 'right' || side === 'left' ? 'side by side' : 'one above the other'
  return {
    layoutId: layout.id,
    ...probe,
    hint: `Split “${cellName(cell)}” in two, ${way} · the new half is an empty slot${grewWords(layout, probe.grewCellIds, cellName, 'over the new line')} · click to split`,
  }
}

/**
 * Card `cell` merged with its neighbour `other` (a merge button, Merge ▾):
 * its preview — the merged cell outlined, the card's tabs first, the
 * neighbour's after (`mergeCells`).
 */
export function mergePreview(layout: WorkspaceLayout, cell: LayoutCell, other: LayoutCell, kind: MergeKind, cellName: (cell: LayoutCell) => string): StructurePreview | null {
  const probe = structureProbe(layout, (l) => mergeCells(l, cell.id, other.id))
  if (!probe || layout.id == null) return null
  const count = cell.tabs.length + other.tabs.length
  const hint = kind === 'slot'
    ? `Stretch ${cellName(cell)} over the empty slot · click to stretch`
    : `Merge ${cellName(cell)} with ${cellName(other)} · ${kind === 'strip' ? `one strip, ${count} Numbers` : `one cell, ${count} tabs`} · click to merge`
  return { layoutId: layout.id, ...probe, grewCellIds: [cell.id], grewLabel: '', hint }
}

/** Sets the preview (`null` clears it). */
export function showStructurePreview(preview: StructurePreview | null): void {
  useWorkspaceStore.getState().setStructurePreview(preview)
}
