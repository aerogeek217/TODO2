import { isGlanceKind as isGlanceWidgetKind, isWidgetKind, WIDGET_KIND_SPECS, type LayoutBody, type LayoutCell, type WidgetKind } from '../models/workspace-layout'
import { CELL_MIN_PX, CELL_MIN_WIDTH_PX } from './workspace-resize'

/**
 * How a cell and a row track draw, by what they hold: whether a row track
 * fits its content, and the height and width a cell may shrink to. Pure: the kind flags come from
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
/**
 * The height (px) a Numbers-only (fit) row fits at: a Number's small face as
 * drawn (its name over its count; 58px in Chromium for a count, a Share of…
 * and an Oldest — widget feedback 2D measured it; it was 76). Also the
 * smallest height of a cell holding one Number (`cellMinHeightPx`): the
 * minimum follows the fit height, so a divider beside a fitting row never
 * pushes it taller than it is (cr34 W3).
 */
export const FIT_ROW_PX = 58
/** The smallest width (px) of a glance cell: a Number's small face reads in it, so a row of them needn't scroll the table. */
export const GLANCE_CELL_MIN_WIDTH_PX = 72

/** The kind of a cell's only tab; `null` for an empty cell or one with several tabs. */
function onlyKind(cell: Pick<LayoutCell, 'tabs'>): WidgetKind | null {
  return cell.tabs.length === 1 ? (cell.tabs[0]?.kind ?? null) : null
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

/**
 * The smallest height (px) a cell may take: `FIT_ROW_PX` for a cell of one
 * Number (`isFitCell` — a fit row's height), `GLANCE_ROW_MIN_PX` for any
 * other glance cell, else `CELL_MIN_PX`.
 */
export function cellMinHeightPx(cell: Pick<LayoutCell, 'tabs'>, glance: KindFlag = isGlanceKind, fit: KindFlag = isFitHeightKind): number {
  if (isFitCell(cell, fit)) return FIT_ROW_PX
  return isGlanceCell(cell, glance) ? GLANCE_ROW_MIN_PX : CELL_MIN_PX
}

/** The smallest width (px) a cell may take: `GLANCE_CELL_MIN_WIDTH_PX` for a glance cell, else `CELL_MIN_WIDTH_PX`. */
export function cellMinWidthPx(cell: Pick<LayoutCell, 'tabs'>, glance: KindFlag = isGlanceKind): number {
  return isGlanceCell(cell, glance) ? GLANCE_CELL_MIN_WIDTH_PX : CELL_MIN_WIDTH_PX
}
