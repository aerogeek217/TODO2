import type { DataRow, DataSet } from '../../schema-upgrades'
import { isRecord, layoutTabsOf, type Obj } from '../layout-tabs'

/**
 * v81 — lenses removed (user feedback 2026-11-15, decision 1): the named
 * screen filters picked in the top bar, and every list's and widget's
 * switch for them, are gone, and so is what they stored:
 *
 * - the `settings` rows `lenses` (the lenses), `activeLensId` (the top bar's
 *   pick) and `lensPresetsSeeded` (the presets' seed mark) deleted;
 * - the `keyboardShortcuts` row without the `cycle-lens` and `lift-lens`
 *   bindings (the row's other bindings kept as they were; a row that
 *   doesn't read is left for validation);
 * - every `listDefinitions` row without its `ignoreLens`;
 * - every layout tab's view state without its `ignoreLens` (a view state
 *   left with nothing in it goes).
 *
 * Nothing else moves: tasks and their `modifiedAt`, the history log and
 * `historyLogSince` stay as they were. Follows the transform contract
 * (`schema-upgrades`): pure, idempotent, tolerant of missing tables and
 * malformed rows (left for validation); a table it leaves alone comes back
 * as the same array.
 */

const RETIRED_SETTING_KEYS: ReadonlySet<unknown> = new Set(['lenses', 'activeLensId', 'lensPresetsSeeded'])

/** The keyboard shortcut ids the lenses had. */
const RETIRED_SHORTCUT_IDS: readonly string[] = ['cycle-lens', 'lift-lens']

const SHORTCUTS_KEY = 'keyboardShortcuts'

/** The shortcut row's text without the retired bindings; the same text when it names none or doesn't read. */
function shortcutsTextOf(text: unknown): unknown {
  if (typeof text !== 'string') return text
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return text
  }
  if (!isRecord(raw) || !RETIRED_SHORTCUT_IDS.some((id) => id in raw)) return text
  const kept = Object.fromEntries(Object.entries(raw).filter(([id]) => !RETIRED_SHORTCUT_IDS.includes(id)))
  return JSON.stringify(kept)
}

function upgradeSettings(data: DataSet): DataSet {
  const settings = data.settings
  if (!settings) return data
  let changed = false
  const next: DataRow[] = []
  for (const row of settings) {
    if (!isRecord(row)) {
      next.push(row)
    } else if (RETIRED_SETTING_KEYS.has(row.key)) {
      changed = true
    } else if (row.key === SHORTCUTS_KEY) {
      const value = shortcutsTextOf(row.value)
      if (value !== row.value) changed = true
      next.push(value === row.value ? row : { ...row, value })
    } else {
      next.push(row)
    }
  }
  return changed ? { ...data, settings: next } : data
}

/** `row` without its `ignoreLens`; the row itself when it has none. */
function withoutIgnoreLens<T extends Obj>(row: T): T {
  if (!('ignoreLens' in row)) return row
  const { ignoreLens: _i, ...rest } = row
  void _i
  return rest as T
}

function upgradeLists(data: DataSet): DataSet {
  const lists = data.listDefinitions
  if (!lists || !lists.some((r) => isRecord(r) && 'ignoreLens' in r)) return data
  return { ...data, listDefinitions: lists.map((row) => (isRecord(row) ? withoutIgnoreLens(row) : row)) }
}

/** A tab without its view state's lens switch (a view state left empty goes). */
function lensFreeTab(tab: Obj): Obj {
  const view = tab.viewState
  if (!isRecord(view) || !('ignoreLens' in view)) return tab
  const rest = withoutIgnoreLens(view)
  if (Object.keys(rest).length > 0) return { ...tab, viewState: rest }
  const { viewState: _v, ...bare } = tab
  void _v
  return bare
}

function upgradeLayouts(data: DataSet): DataSet {
  const layouts = data.layouts
  if (!layouts) return data
  const next = layouts.map((row) => layoutTabsOf(row, lensFreeTab))
  if (next.every((row, i) => row === layouts[i])) return data
  return { ...data, layouts: next }
}

export function upgradeV81(data: DataSet): DataSet {
  return upgradeLayouts(upgradeLists(upgradeSettings(data)))
}
