import type { DataRow, DataSet } from '../schema-upgrades'
import { isRecord } from '../../utils/is-record'
import { reviveDate } from '../date-revive'

/**
 * Date-typed fields of the v49 schema, per table (from an audit of
 * `src/models/`). Frozen with this transform: a field added by a later
 * version is revived by that version's own transform / `pick*`, not here.
 * `todoEvents.timestamp` and `backups.createdAt` are ISO strings by design.
 */
const V49_DATE_FIELDS: Readonly<Record<string, readonly string[]>> = {
  todos: ['createdAt', 'modifiedAt', 'dueDate'],
  canvases: ['createdAt'],
  projects: ['createdAt'],
  notes: ['createdAt', 'modifiedAt'],
  taskboards: ['createdAt', 'updatedAt'],
}

/** `todos.scheduledDate`: `{kind:'date', value}` / `{kind:'fuzzy', token, setAt}`. */
function reviveScheduled(sd: unknown): unknown {
  if (!isRecord(sd)) return sd
  const key = sd.kind === 'date' ? 'value' : sd.kind === 'fuzzy' ? 'setAt' : null
  if (key === null) return sd
  const revived = reviveDate(sd[key])
  return revived === sd[key] ? sd : { ...sd, [key]: revived }
}

function reviveRow(row: DataRow, fields: readonly string[], table: string): DataRow {
  if (!isRecord(row)) return row
  let next: DataRow | null = null
  for (const f of fields) {
    const revived = reviveDate(row[f])
    if (revived !== row[f]) (next ??= { ...row })[f] = revived
  }
  if (table === 'todos') {
    const sd = reviveScheduled(row.scheduledDate)
    if (sd !== row.scheduledDate) (next ??= { ...row }).scheduledDate = sd
  }
  return next ?? row
}

/**
 * v50 — normalize every Date field to a real `Date`.
 *
 * Before v50, import / restore / sync-file loads wrote JSON's ISO strings
 * straight into IndexedDB, so a live database that was ever loaded from a
 * file holds strings where the models say `Date` (breaking `dueDate` range
 * queries and `.getTime()` callers). This repairs the live DB (Dexie
 * upgrade) and every imported v49 file alike. Parseable strings become
 * `Date`s; Dates, absent fields and unparseable values pass through
 * untouched (validation rejects the latter on import). Idempotent; a table
 * with nothing to revive keeps its array reference, so Dexie leaves it alone.
 */
export function upgradeV50(data: DataSet): DataSet {
  let out: DataSet | null = null
  for (const [table, fields] of Object.entries(V49_DATE_FIELDS)) {
    const rows = data[table]
    if (!Array.isArray(rows)) continue
    let changed = false
    const next = rows.map((row) => {
      const r = reviveRow(row, fields, table)
      if (r !== row) changed = true
      return r
    })
    if (changed) (out ??= { ...data })[table] = next
  }
  return out ?? data
}
