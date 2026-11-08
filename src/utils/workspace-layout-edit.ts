import type { GridAxis, GridTrack, LayoutBody, LayoutCell } from '../models/workspace-layout'

/**
 * The immutable setters the layout reducers (`workspace-layout-ops`) and
 * the size writes (`workspace-layout-sizes`) share: put back the cells, a
 * cell, or an axis's tracks. Internal to the layout modules; they don't
 * normalize (the ops do, `workspace-grid.normalizeGrid`).
 */

export function replaceAt<T>(arr: readonly T[], idx: number, value: T): T[] {
  const next = arr.slice()
  next[idx] = value
  return next
}

export function insertAt<T>(arr: readonly T[], idx: number, value: T): T[] {
  return insertAllAt(arr, idx, [value])
}

export function insertAllAt<T>(arr: readonly T[], idx: number, values: readonly T[]): T[] {
  const clamped = Math.max(0, Math.min(idx, arr.length))
  return [...arr.slice(0, clamped), ...values, ...arr.slice(clamped)]
}

export function removeAt<T>(arr: readonly T[], idx: number): T[] {
  return [...arr.slice(0, idx), ...arr.slice(idx + 1)]
}

export function isPositive(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0
}

/** `layout` with its cells replaced. */
export function withCells<L extends LayoutBody>(layout: L, cells: LayoutCell[]): L {
  return { ...layout, cells }
}

/** `layout` with the tracks of `axis` replaced. */
export function withTracks<L extends LayoutBody>(layout: L, axis: GridAxis, tracks: GridTrack[]): L {
  return { ...layout, grid: { ...layout.grid, [axis]: tracks } }
}

/** Replaces the cell with id `cellId` (`null` removes it); the same layout for an unknown id. */
export function setCell<L extends LayoutBody>(layout: L, cellId: string, cell: LayoutCell | null): L {
  const idx = layout.cells.findIndex((c) => c.id === cellId)
  if (idx === -1) return layout
  return withCells(layout, cell ? replaceAt(layout.cells, idx, cell) : removeAt(layout.cells, idx))
}
