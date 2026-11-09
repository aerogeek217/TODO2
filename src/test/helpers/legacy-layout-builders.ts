import type { LayoutTab } from '../../models/workspace-layout'

/**
 * Builders for layouts in the v76 / v77 rows shape (columns → rows → cells,
 * bands as rows of cells): what the layout upgrades up to v77 read and
 * write, and what a v77 file or kept draft holds — for the tests of those
 * upgrades and of an older file's import. The app's own shape is a table
 * (v78, `layout-builders`).
 */

export interface LegacyCell {
  id: string
  weight: number
  tabs: LayoutTab[]
  activeTabId?: string
  stripShown?: boolean
}

export interface LegacyRow {
  id: string
  weight: number
  collapsed?: boolean
  cells: LegacyCell[]
}

export interface LegacyColumn {
  id: string
  weight: number
  rows: LegacyRow[]
}

export interface LegacyBand {
  id: string
  height: number
  collapsed?: boolean
  cells: LegacyCell[]
}

/** A cell holding `tabs` (weight 1, no active tab unless `extra` says). */
export function cell(id: string, tabs: LayoutTab[] = [], extra: Partial<Omit<LegacyCell, 'id' | 'tabs'>> = {}): LegacyCell {
  return { id, weight: 1, tabs, ...extra }
}

/**
 * A row of one cell — `only` taking the whole width —, its id `<cell>-r`
 * unless `extra` names one, weight 1 unless `extra` sets it. A cell that
 * isn't a valid one makes a raw row.
 */
export function rowOf(only: LegacyCell, extra?: Partial<Omit<LegacyRow, 'cells'>>): LegacyRow
export function rowOf(only: object, extra?: object): Record<string, unknown>
export function rowOf(only: object, extra: object = {}): object {
  return { id: `${String((only as { id?: unknown }).id)}-r`, weight: 1, ...extra, cells: [only] }
}

/** A row of `cells` side by side (weight 1 unless `extra` sets it). */
export function row(id: string, cells: LegacyCell[], extra: Partial<Omit<LegacyRow, 'id' | 'cells'>> = {}): LegacyRow {
  return { id, weight: 1, ...extra, cells }
}

/** A column of `rows` (weight 1 unless given). */
export function col(id: string, rows: LegacyRow[], weight = 1): LegacyColumn {
  return { id, weight, rows }
}

/** A band of `cells` side by side (160px high unless `extra` sets it). */
export function band(id: string, cells: LegacyCell[], extra: Partial<Omit<LegacyBand, 'id' | 'cells'>> = {}): LegacyBand {
  return { id, height: 160, ...extra, cells }
}
