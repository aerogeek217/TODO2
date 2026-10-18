import type { DataRow, DataSet } from '../schema-upgrades'
import { isRecord } from '../../utils/is-record'

/**
 * v63 — two leftovers of the canvas go.
 *
 * - `listDefinitions[].pinnedToDashboard` is removed. It was only ever
 *   written: a list shows where a layout or a dashboard tab puts it.
 * - The theme colour override `color.<theme>.canvasBg` is renamed
 *   `color.<theme>.appBg` (the app's background, behind the top bar and the
 *   workspace), value unchanged. When a dataset already holds the new key for
 *   that theme, the old row is dropped and the new one kept.
 *
 * Idempotent; tolerates missing tables (task archives carry no lists or
 * settings) and malformed rows (passed through for validation to judge).
 * Returns the input itself when nothing changes.
 */

const RENAMED_COLOR_KEYS: ReadonlyMap<string, string> = new Map([
  ['color.dark.canvasBg', 'color.dark.appBg'],
  ['color.light.canvasBg', 'color.light.appBg'],
])

function upgradeListDefinitions(rows: DataRow[] | undefined): DataRow[] | undefined {
  if (!Array.isArray(rows)) return rows
  let changed = false
  const out = rows.map((row) => {
    if (!isRecord(row) || !('pinnedToDashboard' in row)) return row
    changed = true
    const next: DataRow = { ...row }
    delete next.pinnedToDashboard
    return next
  })
  return changed ? out : rows
}

function upgradeSettings(rows: DataRow[] | undefined): DataRow[] | undefined {
  if (!Array.isArray(rows)) return rows
  const present = new Set<unknown>(rows.map((row) => (isRecord(row) ? row.key : undefined)))
  let changed = false
  const out: DataRow[] = []
  for (const row of rows) {
    const renamed = isRecord(row) && typeof row.key === 'string' ? RENAMED_COLOR_KEYS.get(row.key) : undefined
    if (renamed === undefined) {
      out.push(row)
      continue
    }
    changed = true
    if (!present.has(renamed)) out.push({ ...row, key: renamed })
  }
  return changed ? out : rows
}

/** v63 — drop `listDefinitions[].pinnedToDashboard`; `color.*.canvasBg` → `color.*.appBg`. */
export function upgradeV63(data: DataSet): DataSet {
  const listDefinitions = upgradeListDefinitions(data.listDefinitions)
  const settings = upgradeSettings(data.settings)
  if (listDefinitions === data.listDefinitions && settings === data.settings) return data
  const out: DataSet = { ...data }
  if (listDefinitions !== undefined) out.listDefinitions = listDefinitions
  if (settings !== undefined) out.settings = settings
  return out
}
