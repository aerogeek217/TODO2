import { isWidgetKind, WIDGET_KIND_SPECS, type LayoutCell, type LayoutCellRow, type WidgetKind } from '../models/workspace-layout'
import { CELL_MIN_PX } from './workspace-resize'

/**
 * How a cell and a row of cells draw, by what they hold: whether a cell
 * hides its tab strip (headless), whether a row fits its content, and the
 * height a row may shrink to. Pure: the kind flags come from
 * `WIDGET_KIND_SPECS` unless a caller (a test) passes its own.
 */

/** Whether a widget kind has a given flag (`glance`, `fitHeight`). */
export type KindFlag = (kind: WidgetKind) => boolean

/** A glance widget (`WidgetKindSpec.glance`); an unknown kind is not. */
export const isGlanceKind: KindFlag = (kind) => isWidgetKind(kind) && WIDGET_KIND_SPECS[kind].glance === true

/** A kind whose content sets its height (`WidgetKindSpec.fitHeight`); an unknown kind is not. */
export const isFitHeightKind: KindFlag = (kind) => isWidgetKind(kind) && WIDGET_KIND_SPECS[kind].fitHeight === true

/** The smallest height (px) of a row whose cells hold only glance widgets. */
export const GLANCE_ROW_MIN_PX = 64

/** The kind of a cell's only tab; `null` for an empty cell or one with several tabs. */
function onlyKind(cell: Pick<LayoutCell, 'tabs'>): WidgetKind | null {
  return cell.tabs.length === 1 ? (cell.tabs[0]?.kind ?? null) : null
}

/**
 * Whether a cell hides its tab strip (it slides in on hover or focus): it
 * holds exactly one tab, and either its `stripShown` is `false`, or it has
 * none and that tab is a glance widget. `stripShown: true` always shows it.
 */
export function isHeadlessCell(cell: Pick<LayoutCell, 'tabs' | 'stripShown'>, glance: KindFlag = isGlanceKind): boolean {
  const kind = onlyKind(cell)
  if (kind == null || cell.stripShown === true) return false
  return cell.stripShown === false || glance(kind)
}

/** What a cell's strip would be with no `stripShown` of its own: headless (`false`) or shown (`true`). */
export function stripShownByWidget(cell: Pick<LayoutCell, 'tabs'>, glance: KindFlag = isGlanceKind): boolean {
  return !isHeadlessCell({ tabs: cell.tabs }, glance)
}

/**
 * The `stripShown` the cell menu's toggle writes to show (`show`) or hide
 * the strip: the explicit choice, or `null` (by widget) when the widget
 * would do that by itself — so toggling twice puts the cell back to its
 * widget's way.
 */
export function stripShownChoice(cell: Pick<LayoutCell, 'tabs'>, show: boolean, glance: KindFlag = isGlanceKind): boolean | null {
  return stripShownByWidget(cell, glance) === show ? null : show
}

/** Whether a row fits its content: every cell holds exactly one tab, of a `fitHeight` kind. */
export function isFitRow(row: Pick<LayoutCellRow, 'cells'>, fit: KindFlag = isFitHeightKind): boolean {
  return row.cells.length > 0 && row.cells.every((cell) => {
    const kind = onlyKind(cell)
    return kind != null && fit(kind)
  })
}

/** Whether a row's cells hold only glance widgets (each at least one tab, every tab a glance kind). */
export function isGlanceRow(row: Pick<LayoutCellRow, 'cells'>, glance: KindFlag = isGlanceKind): boolean {
  return row.cells.length > 0 && row.cells.every((cell) => cell.tabs.length > 0 && cell.tabs.every((tab) => glance(tab.kind)))
}

/** The smallest height (px) a row's divider may size it to: `GLANCE_ROW_MIN_PX` for a glance row, else `CELL_MIN_PX`. */
export function rowMinHeightPx(row: Pick<LayoutCellRow, 'cells'>, glance: KindFlag = isGlanceKind): number {
  return isGlanceRow(row, glance) ? GLANCE_ROW_MIN_PX : CELL_MIN_PX
}
