import type { DataRow, DataSet } from '../../schema-upgrades'
import { isRecord } from '../layout-tabs'

/**
 * v79, part 2 — what the removed Eisenhower and the older list zoom left in
 * the other tables (runs after `layouts`, so the Eisenhower tabs it dropped
 * name nothing any more):
 *
 * - **The Eisenhower's hidden list** — a `listDefinitions` row whose owner is
 *   `{ eisenhower: true }` — goes, with its manual order (its `listOrders`
 *   rows). Should a stored layout still name it (a `listDefinitionId`
 *   anywhere in a layout row — none that the app made), it is kept and only
 *   loses that owner: a list that belongs to no layout, which Settings ›
 *   Data integrity's cleanup gives the layout showing it. Never a list's
 *   data lost while something shows it.
 * - **Its settings rows**, `eisenhowerPanes` and `eisenhowerSource`, go.
 * - **The Default list zoom** (`rowDensity`) holding the removed `strips`
 *   becomes `lines`; the densities before the zoom levels, `comfortable`
 *   and `compact`, become `stacked` and `rows` (as the read had them).
 *
 * Over `listDefinitions`, `listOrders` and `settings` (and kept list drafts,
 * through the pipeline: a draft of the Eisenhower's list then comes out
 * without its row and is dropped, as nothing shows that list). Holds its own
 * copy of the shapes it reads. Tolerates missing tables and malformed rows
 * (left for validation); data already in the v79 shape comes back as it was
 * (idempotent).
 */

const RETIRED_SETTING_KEYS: ReadonlySet<unknown> = new Set(['eisenhowerPanes', 'eisenhowerSource'])

/** The `rowDensity` values a v79 database no longer holds → the level each read as. */
const ZOOM_SETTING: Readonly<Record<string, string>> = { strips: 'lines', comfortable: 'stacked', compact: 'rows' }

function isEisenhowerOwned(row: DataRow): boolean {
  const owner = row.owner
  return isRecord(owner) && owner.eisenhower === true
}

/** Every list id a layout row names (a `listDefinitionId` anywhere in it), as the layouts' own list refs are walked. */
function namedListIds(layouts: readonly DataRow[] | undefined): Set<unknown> {
  const ids = new Set<unknown>()
  const seen = new Set<object>()
  const stack: unknown[] = [...(layouts ?? [])]
  while (stack.length > 0) {
    const node = stack.pop()
    if (node === null || typeof node !== 'object' || seen.has(node)) continue
    seen.add(node)
    if (Array.isArray(node)) {
      stack.push(...(node as unknown[]))
      continue
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === 'listDefinitionId') ids.add(value)
      stack.push(value)
    }
  }
  return ids
}

function upgradeEisenhowerList(data: DataSet): DataSet {
  const lists = data.listDefinitions
  if (!lists || !lists.some((r) => isRecord(r) && isEisenhowerOwned(r))) return data
  const named = namedListIds(data.layouts)
  const gone = new Set<unknown>()
  const next: DataRow[] = []
  for (const row of lists) {
    if (!isRecord(row) || !isEisenhowerOwned(row)) {
      next.push(row)
    } else if (named.has(row.id)) {
      const { owner: _o, ...rest } = row
      void _o
      next.push(rest)
    } else {
      gone.add(row.id)
    }
  }
  const orders = data.listOrders
  const out: DataSet = { ...data, listDefinitions: next }
  if (orders && gone.size > 0 && orders.some((r) => isRecord(r) && gone.has(r.listDefinitionId))) {
    out.listOrders = orders.filter((r) => !isRecord(r) || !gone.has(r.listDefinitionId))
  }
  return out
}

function upgradeSettings(data: DataSet): DataSet {
  const settings = data.settings
  if (!settings) return data
  let changed = false
  const next: DataRow[] = []
  for (const row of settings) {
    if (isRecord(row) && RETIRED_SETTING_KEYS.has(row.key)) {
      changed = true
      continue
    }
    const zoom = isRecord(row) && row.key === 'rowDensity' && typeof row.value === 'string' ? ZOOM_SETTING[row.value] : undefined
    if (zoom) {
      changed = true
      next.push({ ...row, value: zoom })
      continue
    }
    next.push(row)
  }
  return changed ? { ...data, settings: next } : data
}

export function upgradeLeftoversV79(data: DataSet): DataSet {
  return upgradeSettings(upgradeEisenhowerList(data))
}
