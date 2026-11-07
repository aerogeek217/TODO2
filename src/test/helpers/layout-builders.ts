import type { LayoutBand, LayoutCell, LayoutColumn, LayoutRow, LayoutTab } from '../../models/workspace-layout'

/**
 * Builders for workspace layouts in the rows shape (columns → rows → cells,
 * bands as rows of cells), so a test says what it builds:
 * `col('A', [rowOf(cell('k', [tab]))])`, `band('T', [cell('t', [tab])])`.
 */

/** A cell holding `tabs` (weight 1, no active tab unless `extra` says). */
export function cell(id: string, tabs: LayoutTab[] = [], extra: Partial<Omit<LayoutCell, 'id' | 'tabs'>> = {}): LayoutCell {
  return { id, weight: 1, tabs, ...extra }
}

/**
 * A row of one cell — `only` taking the whole width —, its id `<cell>-r`
 * unless `extra` names one, weight 1 unless `extra` sets it (its share of the
 * column's height), collapsed when `extra` says. A cell that isn't a valid
 * one (a test of what import or the repair does with it) makes a raw row.
 */
export function rowOf(only: LayoutCell, extra?: Partial<Omit<LayoutRow, 'cells'>>): LayoutRow
export function rowOf(only: object, extra?: object): Record<string, unknown>
export function rowOf(only: object, extra: object = {}): object {
  return { id: `${String((only as { id?: unknown }).id)}-r`, weight: 1, ...extra, cells: [only] }
}

/** A row of `cells` side by side (weight 1 unless `extra` sets it). */
export function row(id: string, cells: LayoutCell[], extra: Partial<Omit<LayoutRow, 'id' | 'cells'>> = {}): LayoutRow {
  return { id, weight: 1, ...extra, cells }
}

/** A column of `rows` (weight 1 unless given). */
export function col(id: string, rows: LayoutRow[], weight = 1): LayoutColumn {
  return { id, weight, rows }
}

/** A band of `cells` side by side (160px high unless `extra` sets it). */
export function band(id: string, cells: LayoutCell[], extra: Partial<Omit<LayoutBand, 'id' | 'cells'>> = {}): LayoutBand {
  return { id, height: 160, ...extra, cells }
}
