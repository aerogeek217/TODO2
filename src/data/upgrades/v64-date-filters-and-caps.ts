import type { DataRow, DataSet } from '../schema-upgrades'
import { isRecord } from '../../utils/is-record'

/**
 * v64 — date filters per date type; the list and tag caps go.
 *
 * **Date filters.** A stored list predicate held one date range on one date
 * type (`dateField` + `dateRangeStart` / `dateRangeEnd`, with
 * `dateRangeIncludeNoDate`, which only ever applied to the due date) and two
 * presence filters (`hasDeadline` on the due date, `hasFollowup` on the next
 * follow-up). They become one map, `dates`, with a clause per date type,
 * all of which must pass:
 *
 * | Old | `dates` |
 * |---|---|
 * | a range on type F (a start or an end) | `F: { match: 'range', start, end }`, plus `includeNoDate: true` when F is the due date and `dateRangeIncludeNoDate` was on |
 * | `hasDeadline: true` | a due-date range stays, without `includeNoDate` (range ∧ has a date = the range alone); else `deadline: { match: 'set' }` |
 * | `hasDeadline: false` | a due-date range with `includeNoDate` → `deadline: { match: 'unset' }` (range ∪ none, ∧ none = none); a due-date range without it matched no task: the range is kept and the presence filter dropped; no range → `deadline: { match: 'unset' }` |
 * | `hasFollowup` | the same rules on `followup` (the old "include no date" never applied to it) |
 *
 * A presence filter on another type than the range's gets its own clause
 * (a Created range + `hasDeadline: true` → `created: range`, `deadline: set`).
 * `dateField` missing means the due date (as the app read it). A legacy
 * ISO-string range end becomes a `fixed` anchor; any other end is carried as
 * it is, for validation to judge. A predicate that already has `dates` is
 * left alone (idempotent).
 *
 * **Caps.** `listDefinitions[].maxTasks` / `limitMode` (a list shows every
 * task; its panel scrolls) and the `maxTags` setting (no cap on tags) are
 * dropped.
 *
 * Tolerates missing tables (task archives carry no lists or settings) and
 * malformed rows (passed through for validation to judge). Returns the input
 * itself when nothing changes.
 */

const OLD_DATE_KEYS = ['dateField', 'dateRangeStart', 'dateRangeEnd', 'dateRangeIncludeNoDate', 'hasDeadline', 'hasFollowup'] as const

/** A range end: a legacy ISO string becomes a fixed anchor; null / undefined → null; anything else as it is. */
function rangeEnd(v: unknown): unknown {
  if (v === undefined || v === null) return null
  if (typeof v === 'string') return { kind: 'fixed', iso: v }
  return v
}

/** The old fields of one predicate as the `dates` map. */
function datesOf(p: DataRow): Record<string, unknown> {
  const dates: Record<string, unknown> = {}
  const field = typeof p.dateField === 'string' ? p.dateField : 'deadline'
  const start = rangeEnd(p.dateRangeStart)
  const end = rangeEnd(p.dateRangeEnd)
  if (start !== null || end !== null) {
    dates[field] = {
      match: 'range', start, end,
      ...(field === 'deadline' && p.dateRangeIncludeNoDate === true ? { includeNoDate: true } : {}),
    }
  }
  presence(dates, 'deadline', p.hasDeadline)
  presence(dates, 'followup', p.hasFollowup)
  return dates
}

/** Folds a presence filter (`true` / `false`; anything else is none) into `dates[field]`. */
function presence(dates: Record<string, unknown>, field: string, has: unknown): void {
  if (has !== true && has !== false) return
  const range = dates[field] as { includeNoDate?: true } | undefined
  if (!range) {
    dates[field] = { match: has ? 'set' : 'unset' }
    return
  }
  if (has) {
    // Range ∧ has a date: the range alone.
    const kept = { ...range }
    delete kept.includeNoDate
    dates[field] = kept
  } else if (range.includeNoDate === true) {
    // (Range ∪ no date) ∧ no date: no date.
    dates[field] = { match: 'unset' }
  }
  // Range (without no date) ∧ no date matched nothing: the range is kept.
}

function upgradePredicate(p: unknown): unknown {
  if (!isRecord(p) || 'dates' in p) return p
  const next: DataRow = { ...p, dates: datesOf(p) }
  for (const key of OLD_DATE_KEYS) delete next[key]
  return next
}

function upgradeListDefinitions(rows: DataRow[] | undefined): DataRow[] | undefined {
  if (!Array.isArray(rows)) return rows
  let changed = false
  const out = rows.map((row) => {
    if (!isRecord(row)) return row
    const membership = row.membership
    const predicate = isRecord(membership) ? membership.predicate : undefined
    const nextPredicate = upgradePredicate(predicate)
    const capped = 'maxTasks' in row || 'limitMode' in row
    if (nextPredicate === predicate && !capped) return row
    changed = true
    const next: DataRow = { ...row }
    delete next.maxTasks
    delete next.limitMode
    if (nextPredicate !== predicate) next.membership = { ...(membership as DataRow), predicate: nextPredicate }
    return next
  })
  return changed ? out : rows
}

function upgradeSettings(rows: DataRow[] | undefined): DataRow[] | undefined {
  if (!Array.isArray(rows)) return rows
  const out = rows.filter((row) => !(isRecord(row) && row.key === 'maxTags'))
  return out.length === rows.length ? rows : out
}

/** v64 — list predicates' date filters → `dates` (a clause per date type); drop `maxTasks` / `limitMode` and `maxTags`. */
export function upgradeV64(data: DataSet): DataSet {
  const listDefinitions = upgradeListDefinitions(data.listDefinitions)
  const settings = upgradeSettings(data.settings)
  if (listDefinitions === data.listDefinitions && settings === data.settings) return data
  const out: DataSet = { ...data }
  if (listDefinitions !== undefined) out.listDefinitions = listDefinitions
  if (settings !== undefined) out.settings = settings
  return out
}
