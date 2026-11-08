import { isGlanceKind as isGlanceWidgetKind, isWidgetKind, WIDGET_KIND_SPECS, type LayoutBody, type LayoutCell, type WidgetKind } from '../models/workspace-layout'
import { CELL_MIN_PX } from './workspace-resize'

/**
 * How a cell and a row track draw, by what they hold: whether a cell hides
 * its tab strip (headless), whether a row track fits its content, and the
 * height a row track may shrink to. Pure: the kind flags come from
 * `WIDGET_KIND_SPECS` unless a caller (a test) passes its own.
 */

/** Whether a widget kind has a given flag (`glance`, `fitHeight`). */
export type KindFlag = (kind: WidgetKind) => boolean

/** A glance widget (`WidgetKindSpec.glance`, `models/workspace-layout.isGlanceKind`); an unknown kind is not. */
export const isGlanceKind: KindFlag = (kind) => isGlanceWidgetKind(kind)

/** A kind whose content sets its height (`WidgetKindSpec.fitHeight`); an unknown kind is not. */
export const isFitHeightKind: KindFlag = (kind) => isWidgetKind(kind) && WIDGET_KIND_SPECS[kind].fitHeight

/** The smallest height (px) of a row track whose cells hold only glance widgets. */
export const GLANCE_ROW_MIN_PX = 64

/** The kind of a cell's only tab; `null` for an empty cell or one with several tabs. */
function onlyKind(cell: Pick<LayoutCell, 'tabs'>): WidgetKind | null {
  return cell.tabs.length === 1 ? (cell.tabs[0]?.kind ?? null) : null
}

/**
 * Whether a cell hides its tab strip (it slides in on hover or focus): it
 * holds exactly one tab, a glance widget — or one showing its small face
 * (D25 R: `smallFace`, what the cell heard from its widget).
 */
export function isHeadlessCell(cell: Pick<LayoutCell, 'tabs'>, glance: KindFlag = isGlanceKind, smallFace = false): boolean {
  const kind = onlyKind(cell)
  if (kind == null) return false
  return glance(kind) || smallFace
}

/** The cells lying only in row track `row` (starting and ending in it). */
export function cellsOnlyInRow(body: LayoutBody, row: number): LayoutCell[] {
  return body.cells.filter((c) => c.area.row === row && c.area.rowSpan === 1)
}

/** Whether a cell holds exactly one tab, of a `fitHeight` kind. */
export function isFitCell(cell: Pick<LayoutCell, 'tabs'>, fit: KindFlag = isFitHeightKind): boolean {
  const kind = onlyKind(cell)
  return kind != null && fit(kind)
}

/**
 * Whether row track `row` fits its content: some cells lie only in it and
 * each holds exactly one tab, of a `fitHeight` kind (a Number). Cells
 * spanning through it don't count. Derived, never stored.
 */
export function isFitTrack(body: LayoutBody, row: number, fit: KindFlag = isFitHeightKind): boolean {
  const cells = cellsOnlyInRow(body, row)
  return cells.length > 0 && cells.every((cell) => isFitCell(cell, fit))
}

/** Whether a cell holds only glance widgets (at least one tab, every tab a glance kind). */
export function isGlanceCell(cell: Pick<LayoutCell, 'tabs'>, glance: KindFlag = isGlanceKind): boolean {
  return cell.tabs.length > 0 && cell.tabs.every((tab) => glance(tab.kind))
}

/** The smallest height (px) a cell may take: `GLANCE_ROW_MIN_PX` for a glance cell, else `CELL_MIN_PX`. */
export function cellMinHeightPx(cell: Pick<LayoutCell, 'tabs'>, glance: KindFlag = isGlanceKind): number {
  return isGlanceCell(cell, glance) ? GLANCE_ROW_MIN_PX : CELL_MIN_PX
}
