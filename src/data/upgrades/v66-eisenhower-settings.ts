import type { DataRow, DataSet } from '../schema-upgrades'
import { isRecord } from '../../utils/is-record'

/**
 * v66 — the Eisenhower's panes and source become app-wide settings.
 *
 * Up to v65 each Eisenhower tab kept its own custom panes
 * (`config.panes`) and its own source list (`config.listDefinitionId`),
 * saved with its layout. From v66 one set of panes and one source serve
 * every Eisenhower tab (and the dashboard's Eisenhower section), as the
 * settings `eisenhowerPanes` (JSON of the panes) and `eisenhowerSource`
 * (`list:<id>`).
 *
 * The layouts are walked in id order (rows without an id after them, as
 * they come), each one's tabs panel by panel as the app reads them — the
 * top band, the columns' cells, the bottom band — tab by tab. The first
 * Eisenhower tab whose `panes` is an object with at least one key gives
 * `eisenhowerPanes` (its value as stored, as JSON); the first whose
 * `listDefinitionId` is a positive whole number gives `eisenhowerSource` —
 * each only when the dataset has a `settings` table without that key yet.
 * Then `panes` and `listDefinitionId` are removed from every Eisenhower
 * tab's config.
 *
 * Idempotent (v66 data has no such keys, so nothing changes and the input
 * is returned); tolerates a missing `layouts` or `settings` table (a kept
 * layout draft is upgraded as `layouts` alone: its tabs are stripped, no
 * setting is made) and rows whose shape it can't walk (passed through for
 * validation to judge). Returns the input itself when nothing changes.
 */

type Obj = Record<string, unknown>

const PANES_KEY = 'eisenhowerPanes'
const SOURCE_KEY = 'eisenhowerSource'

/** The tab lists of a layout row, in reading order: top band, the columns' cells, bottom band. */
function tabListsOf(row: Obj): unknown[][] {
  const out: unknown[][] = []
  const band = (b: unknown) => {
    if (isRecord(b) && Array.isArray(b.tabs)) out.push(b.tabs)
  }
  band(row.top)
  if (Array.isArray(row.columns)) {
    for (const col of row.columns) {
      if (!isRecord(col) || !Array.isArray(col.cells)) continue
      for (const cell of col.cells) if (isRecord(cell) && Array.isArray(cell.tabs)) out.push(cell.tabs)
    }
  }
  band(row.bottom)
  return out
}

function isEisenhowerTab(tab: unknown): tab is Obj & { config: Obj } {
  return isRecord(tab) && tab.kind === 'eisenhower' && isRecord(tab.config)
}

function hasMovedKeys(config: Obj): boolean {
  return 'panes' in config || 'listDefinitionId' in config
}

function isListId(v: unknown): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v) && v > 0
}

/** The layout rows in the order they are read: by id, rows without a numeric id last (input order). */
function readingOrder(rows: readonly DataRow[]): DataRow[] {
  const idOf = (row: DataRow) => (isRecord(row) && typeof row.id === 'number' && Number.isFinite(row.id) ? row.id : Infinity)
  return rows.map((row, i) => ({ row, i })).sort((a, b) => idOf(a.row) - idOf(b.row) || a.i - b.i).map((x) => x.row)
}

/** The first customized panes and list source of the layouts, as setting values. */
function settingsFrom(rows: readonly DataRow[]): { panes?: string; source?: string } {
  const out: { panes?: string; source?: string } = {}
  for (const row of readingOrder(rows)) {
    if (!isRecord(row)) continue
    for (const tabs of tabListsOf(row)) {
      for (const tab of tabs) {
        if (!isEisenhowerTab(tab)) continue
        const { panes, listDefinitionId } = tab.config
        if (out.panes === undefined && isRecord(panes) && Object.keys(panes).length > 0) out.panes = JSON.stringify(panes)
        if (out.source === undefined && isListId(listDefinitionId)) out.source = `list:${listDefinitionId}`
      }
    }
  }
  return out
}

/** `tabs` with `panes` / `listDefinitionId` removed from each Eisenhower tab's config; the same array when none has them. */
function stripTabs(tabs: unknown[]): unknown[] {
  if (!tabs.some((t) => isEisenhowerTab(t) && hasMovedKeys(t.config))) return tabs
  return tabs.map((tab) => {
    if (!isEisenhowerTab(tab) || !hasMovedKeys(tab.config)) return tab
    const config: Obj = { ...tab.config }
    delete config.panes
    delete config.listDefinitionId
    return { ...tab, config }
  })
}

/** A band / cell with its tabs stripped; the same object when nothing changes. */
function stripPanel(panel: unknown): unknown {
  if (!isRecord(panel) || !Array.isArray(panel.tabs)) return panel
  const tabs = stripTabs(panel.tabs)
  return tabs === panel.tabs ? panel : { ...panel, tabs }
}

/** A layout row with every Eisenhower tab stripped; the same row when nothing changes. */
function stripLayout(row: DataRow): DataRow {
  if (!isRecord(row)) return row
  let changed = false
  const next: Obj = { ...row }
  for (const edge of ['top', 'bottom'] as const) {
    if (row[edge] === undefined) continue
    const band = stripPanel(row[edge])
    if (band !== row[edge]) {
      next[edge] = band
      changed = true
    }
  }
  if (Array.isArray(row.columns)) {
    const columns = row.columns.map((col: unknown) => {
      if (!isRecord(col) || !Array.isArray(col.cells)) return col
      const cells = col.cells.map(stripPanel)
      return cells.every((c, i) => c === (col.cells as unknown[])[i]) ? col : { ...col, cells }
    })
    if (columns.some((c, i) => c !== (row.columns as unknown[])[i])) {
      next.columns = columns
      changed = true
    }
  }
  return changed ? next : row
}

/** v66 — the first customized Eisenhower tab's panes / list → settings; strip both from every Eisenhower tab. */
export function upgradeV66(data: DataSet): DataSet {
  const layouts = data.layouts
  if (!Array.isArray(layouts)) return data
  const strippedLayouts = layouts.map(stripLayout)
  const layoutsChanged = strippedLayouts.some((row, i) => row !== layouts[i])
  if (!layoutsChanged) return data

  const out: DataSet = { ...data, layouts: strippedLayouts }
  const settings = data.settings
  if (Array.isArray(settings)) {
    const has = (key: string) => settings.some((r) => isRecord(r) && r.key === key)
    const found = settingsFrom(layouts)
    const added: DataRow[] = []
    if (found.panes !== undefined && !has(PANES_KEY)) added.push({ key: PANES_KEY, value: found.panes })
    if (found.source !== undefined && !has(SOURCE_KEY)) added.push({ key: SOURCE_KEY, value: found.source })
    if (added.length > 0) out.settings = [...settings, ...added]
  }
  return out
}
