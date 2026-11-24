import type { DataRow, DataSet } from '../../schema-upgrades'

/**
 * v89 — the Planner holds nothing by hand: a task's plan state is a planned
 * day or none.
 *
 * - **Tasks**: `unplanned` is deleted from every row that has it (a task held
 *   in Unplanned falls back to its own day, the Unplanned filter, or leaves
 *   the Planner). `doDate` stays as it is.
 * - **Filters**: Planned's `held` clause (held in Unplanned, the
 *   expression's `unplanned`) matches nothing now, so it goes wherever a
 *   predicate is stored — a list's, a layout tab's config (any depth), the
 *   `checkinTaskFilter` setting's JSON. A date clause `dates.planned: {
 *   match: 'held' }` is deleted; an expression's `held` atom leaves its `and`
 *   / `or` (one left with a single item becomes that item, one left with
 *   none goes too), a `not` of it goes, and an expression left with nothing
 *   is deleted. `planned any or unplanned` reads `planned any`.
 *
 * Follows the transform contract (`schema-upgrades`): pure, idempotent (a row
 * with nothing to change comes back as the same object, a table with
 * nothing to change as the same array), tolerant of missing tables and of
 * malformed rows (left as they are, for validation and the repair).
 */

type Obj = Record<string, unknown>

const isRecord = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)

/** The setting whose value is a predicate's JSON. */
const CHECKIN_FILTER_KEY = 'checkinTaskFilter'

/** What a walk returns for a node its parent must drop: a `held` atom, or what is left empty without one. */
const GONE = Symbol('gone')
type Walked = unknown

const isHeld = (m: unknown): boolean => isRecord(m) && m.match === 'held'
const isHeldAtom = (v: Obj): boolean => v.kind === 'date' && v.field === 'planned' && isHeld(v.match)

/**
 * `value` without Planned's `held` clauses, the same reference when it has
 * none; `GONE` for a node its parent drops (a `held` atom, an `and` / `or`
 * left with no item, a `not` of a dropped node).
 */
function walk(value: unknown): Walked {
  if (Array.isArray(value)) {
    const next = value.map(walk)
    if (next.every((v, i) => v === value[i])) return value
    return next.filter((v) => v !== GONE)
  }
  if (!isRecord(value)) return value
  if (isHeldAtom(value)) return GONE
  let changed = false
  const out: Obj = {}
  for (const [key, child] of Object.entries(value)) {
    const next = key === 'dates' && isRecord(child) && isHeld(child.planned) ? withoutPlanned(child) : walk(child)
    if (next !== child) changed = true
    if (next !== GONE) out[key] = next
  }
  if (!changed) return value
  if ((value.kind === 'and' || value.kind === 'or') && Array.isArray(value.items)) {
    const items = out.items as unknown[]
    if (items.length === 0) return GONE
    if (items.length === 1) return items[0]
  }
  if (value.kind === 'not' && !('item' in out)) return GONE
  return out
}

/** A `dates` record without its `planned` clause, the other clauses as they are (none holds a `held` atom). */
function withoutPlanned(dates: Obj): Obj {
  const out: Obj = {}
  for (const [key, child] of Object.entries(dates)) if (key !== 'planned') out[key] = child
  return out
}

/** A stored row with no `held` clause in it (the same object when it had none). */
function rowOf(row: DataRow): DataRow {
  const next = walk(row)
  return next === GONE || !isRecord(next) ? row : next
}

/** A task row without `unplanned` (the same object without one). */
function todoOf(row: DataRow): DataRow {
  if (!('unplanned' in row)) return row
  const out: DataRow = {}
  for (const [key, value] of Object.entries(row)) if (key !== 'unplanned') out[key] = value
  return out
}

/** The check-in filter setting with no `held` clause in its JSON (the same row when it had none, or isn't JSON). */
function settingOf(row: DataRow): DataRow {
  if (row.key !== CHECKIN_FILTER_KEY || typeof row.value !== 'string') return row
  let parsed: unknown
  try {
    parsed = JSON.parse(row.value)
  } catch {
    return row
  }
  const next = walk(parsed)
  if (next === parsed || next === GONE) return row
  return { ...row, value: JSON.stringify(next) }
}

/** `rows` with `of` applied to each record (the same array when no row changes; a table that isn't a list stays as it is). */
function tableOf(rows: DataRow[] | undefined, of: (row: DataRow) => DataRow): DataRow[] | undefined {
  if (!Array.isArray(rows)) return rows
  const next = rows.map((row) => (isRecord(row) ? of(row) : row))
  return next.every((row, i) => row === rows[i]) ? rows : next
}

export function upgradeV89(data: DataSet): DataSet {
  const out: DataSet = { ...data }
  let changed = false
  const step = (table: string, of: (row: DataRow) => DataRow) => {
    const rows = data[table]
    const next = tableOf(rows, of)
    if (next !== rows && next) {
      out[table] = next
      changed = true
    }
  }
  step('todos', todoOf)
  step('listDefinitions', rowOf)
  step('layouts', rowOf)
  step('settings', settingOf)
  return changed ? out : data
}
