import type { DataRow, DataSet } from '../schema-upgrades'

/**
 * Widget kinds removed in v52 (horizons ribbon, discipline scoreboard, snooze
 * graveyard). Frozen with this transform.
 */
const REMOVED_KINDS: ReadonlySet<string> = new Set(['horizons', 'scoreboard', 'snoozeGraveyard'])

/** Placement tables of the removed kinds; v52 drops them. */
export const V52_DROPPED_TABLES = ['floatingHorizons', 'floatingScoreboard', 'floatingSnoozeGraveyard'] as const

/** Settings rows that only the horizons widget read. */
const REMOVED_SETTING_KEYS: ReadonlySet<string> = new Set(['horizonSlots', 'selectedHorizonDefId'])

const RAIL_SIDES = ['left', 'right', 'top', 'bottom'] as const

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

function isRemovedTab(tab: unknown): boolean {
  return isRecord(tab) && typeof tab.type === 'string' && REMOVED_KINDS.has(tab.type)
}

/**
 * Returns the slot without tabs of removed kinds, `null` when no tab is left,
 * or the same object when nothing changed. `activeTabId` moves to the first
 * remaining tab when it pointed at a removed one.
 */
function stripSlot(slot: unknown): unknown {
  if (!isRecord(slot) || !Array.isArray(slot.tabs)) return slot
  if (!slot.tabs.some(isRemovedTab)) return slot
  const tabs = slot.tabs.filter((t) => !isRemovedTab(t))
  if (tabs.length === 0) return null
  const next: Record<string, unknown> = { ...slot, tabs }
  const activeStillThere = tabs.some((t) => isRecord(t) && t.id === slot.activeTabId)
  if (!activeStillThere) {
    const first = tabs[0]
    if (isRecord(first) && typeof first.id === 'string') next.activeTabId = first.id
  }
  return next
}

/**
 * Rewrites a serialized `canvasRails` value: removes tabs of the removed
 * kinds, slots left without tabs, and rails left without slots (set to
 * `null`, the "no rail on this side" value). Sizes, corners and collapsed
 * flags are kept. Returns the input string when nothing changed or the value
 * isn't parseable (validation decides what to do with a broken value).
 */
export function stripRemovedKindsFromRails(value: string): string {
  let parsed: unknown
  try { parsed = JSON.parse(value) } catch { return value }
  if (!isRecord(parsed)) return value
  let changed = false
  const next: Record<string, unknown> = { ...parsed }
  for (const side of RAIL_SIDES) {
    const rail = parsed[side]
    if (!isRecord(rail) || !Array.isArray(rail.slots)) continue
    const slots: unknown[] = []
    let railChanged = false
    for (const slot of rail.slots) {
      const stripped = stripSlot(slot)
      if (stripped !== slot) railChanged = true
      if (stripped !== null) slots.push(stripped)
    }
    if (!railChanged) continue
    changed = true
    next[side] = slots.length > 0 ? { ...rail, slots } : null
  }
  return changed ? JSON.stringify(next) : value
}

function upgradeSettings(rows: DataRow[] | undefined): DataRow[] | undefined {
  if (!Array.isArray(rows)) return rows
  let changed = false
  const out: DataRow[] = []
  for (const row of rows) {
    if (isRecord(row) && typeof row.key === 'string' && REMOVED_SETTING_KEYS.has(row.key)) {
      changed = true
      continue
    }
    if (isRecord(row) && row.key === 'canvasRails' && typeof row.value === 'string') {
      const value = stripRemovedKindsFromRails(row.value)
      if (value !== row.value) {
        changed = true
        out.push({ ...row, value })
        continue
      }
    }
    out.push(row)
  }
  return changed ? out : rows
}

/**
 * v52 — remove the horizons, discipline-scoreboard and snooze-graveyard
 * widgets (they were built on the scheduled date, which is being removed).
 *
 * - Drops the `floatingHorizons` / `floatingScoreboard` /
 *   `floatingSnoozeGraveyard` placement tables (the Dexie block declares
 *   them `null`; removing the keys here keeps imported files consistent).
 * - Deletes the `horizonSlots` / `selectedHorizonDefId` settings rows.
 * - Rewrites the `canvasRails` setting without tabs of those kinds (and
 *   without slots / rails that end up empty).
 *
 * List definitions the horizons widget showed are ordinary lists and stay.
 * Idempotent; tolerates missing tables (task archives carry no settings).
 */
export function upgradeV52(data: DataSet): DataSet {
  const out: DataSet = { ...data }
  for (const table of V52_DROPPED_TABLES) delete out[table]
  const settings = upgradeSettings(data.settings)
  if (settings !== undefined && settings !== data.settings) out.settings = settings
  return out
}
