import type { DataRow, DataSet } from '../schema-upgrades'
import { isRecord } from '../../utils/is-record'

/**
 * v53 — remove the scheduled date (`todos.scheduledDate`) and everything that
 * referenced it. Frozen with this transform: the fuzzy-token window math, the
 * removed enum values and the removed settings keys are copied here so later
 * code changes can't alter what the upgrade does.
 */

/** A real `Date` from a `Date` / parseable string / epoch number, else `null`. */
function toDate(v: unknown): Date | null {
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v : null
  if (typeof v === 'string' || typeof v === 'number') {
    const d = new Date(v)
    return Number.isFinite(d.getTime()) ? d : null
  }
  return null
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

type WeekStart = 0 | 1

/**
 * End-of-window day of a fuzzy token, anchored on the moment it was picked
 * (`setAt`) — the "aged" reading the app showed for fuzzy values: a "this
 * week" picked three weeks ago meant that week's last day.
 */
function resolveFuzzyAt(token: string, setAt: Date, weekStartsOn: WeekStart): Date | null {
  const base = startOfDay(setAt)
  const y = base.getFullYear()
  const m = base.getMonth()
  const d = base.getDate()
  const endDow = weekStartsOn === 1 ? 0 : 6
  const toWeekEnd = (endDow - base.getDay() + 7) % 7
  switch (token) {
    case 'today': return base
    case 'tomorrow': return new Date(y, m, d + 1)
    case 'this-week': return new Date(y, m, d + toWeekEnd)
    case 'next-week': return new Date(y, m, d + toWeekEnd + 7)
    case 'this-month': return new Date(y, m + 1, 0)
    case 'next-month': return new Date(y, m + 2, 0)
    default: return null
  }
}

/** The day (local midnight) a stored scheduled value stood for, else `null`. */
export function resolveStoredScheduled(
  value: unknown,
  createdAt: unknown,
  weekStartsOn: WeekStart,
): { day: Date; precise: boolean } | null {
  if (!isRecord(value)) return null
  if (value.kind === 'date') {
    const d = toDate(value.value)
    return d ? { day: startOfDay(d), precise: true } : null
  }
  if (value.kind === 'fuzzy' && typeof value.token === 'string') {
    const setAt = toDate(value.setAt) ?? toDate(createdAt)
    if (!setAt) return null
    const day = resolveFuzzyAt(value.token, setAt, weekStartsOn)
    return day ? { day, precise: false } : null
  }
  return null
}

function readWeekStart(settings: DataRow[] | undefined): WeekStart {
  const row = settings?.find((r) => isRecord(r) && r.key === 'weekStartsOn')
  return row && row.value === '0' ? 0 : 1
}

/**
 * Todos: the scheduled day becomes the next follow-up (when the task has
 * none); a recurring task anchored on a precise scheduled date (no due date)
 * gets that day as its due date instead, so the recurrence keeps its anchor
 * and the follow-up doesn't go stale after the first repeat. `scheduledDate`
 * is removed from every row.
 */
function upgradeTodos(rows: DataRow[] | undefined, weekStartsOn: WeekStart): DataRow[] | undefined {
  if (!Array.isArray(rows)) return rows
  let changed = false
  const out = rows.map((row) => {
    if (!isRecord(row) || !('scheduledDate' in row)) return row
    changed = true
    const rest: DataRow = { ...row }
    delete rest.scheduledDate
    const resolved = resolveStoredScheduled(row.scheduledDate, row.createdAt, weekStartsOn)
    if (!resolved) return rest
    const anchorsRecurrence = resolved.precise && row.recurrenceRule != null && row.dueDate == null
    if (anchorsRecurrence) return { ...rest, dueDate: resolved.day }
    if (row.nextFollowupAt == null) return { ...rest, nextFollowupAt: resolved.day }
    return rest
  })
  return changed ? out : rows
}

/** Sort / group / date-field values removed in v53 → their replacement. */
const REMOVED_DATE_ENUMS: ReadonlySet<string> = new Set(['date', 'scheduled'])
const REPLACEMENT = 'deadline'

function rewriteEnum(v: unknown): unknown {
  return typeof v === 'string' && REMOVED_DATE_ENUMS.has(v) ? REPLACEMENT : v
}

/**
 * Stored predicate: `dateField` `'date'` (effective date) / `'scheduled'` →
 * `'deadline'`; `hasScheduled` removed. `dateRangeIncludeNoDate` only ever
 * applied to `'date'`, and now applies to `'deadline'`: kept for former
 * `'date'` predicates, cleared for the rest so their result doesn't change.
 *
 * Only pre-v53 predicates are touched — recognised by a removed `dateField`
 * value or the `hasScheduled` key (every predicate saved since that filter
 * existed carries it). That keeps the transform idempotent: a rewritten
 * predicate (`'deadline'`, no `hasScheduled`) is left alone on a second run.
 */
function rewritePredicate(p: unknown): unknown {
  if (!isRecord(p)) return p
  const isPreV53 = 'hasScheduled' in p || rewriteEnum(p.dateField) !== p.dateField
  if (!isPreV53) return p
  const fromEffective = p.dateField === 'date'
  const next: Record<string, unknown> = { ...p }
  delete next.hasScheduled
  if ('dateField' in p) next.dateField = rewriteEnum(p.dateField)
  if (!fromEffective && p.dateRangeIncludeNoDate === true) next.dateRangeIncludeNoDate = false
  return next
}

function upgradeListDefinitions(rows: DataRow[] | undefined): DataRow[] | undefined {
  if (!Array.isArray(rows)) return rows
  let changed = false
  const out = rows.map((row) => {
    if (!isRecord(row)) return row
    const sort = rewriteEnum(row.sort)
    const grouping = rewriteEnum(row.grouping)
    const membership = row.membership
    let nextMembership = membership
    if (isRecord(membership) && 'predicate' in membership) {
      const predicate = rewritePredicate(membership.predicate)
      if (predicate !== membership.predicate) nextMembership = { ...membership, predicate }
    }
    if (sort === row.sort && grouping === row.grouping && nextMembership === membership) return row
    changed = true
    const next: DataRow = { ...row }
    if ('sort' in row) next.sort = sort
    if ('grouping' in row) next.grouping = grouping
    if ('membership' in row) next.membership = nextMembership
    return next
  })
  return changed ? out : rows
}

function upgradeProjects(rows: DataRow[] | undefined): DataRow[] | undefined {
  if (!Array.isArray(rows)) return rows
  let changed = false
  const out = rows.map((row) => {
    if (!isRecord(row) || rewriteEnum(row.groupBy) === row.groupBy) return row
    changed = true
    return { ...row, groupBy: REPLACEMENT }
  })
  return changed ? out : rows
}

/** Settings rows removed outright: the seeded status pointer and the scheduled-chip theme colors. */
const REMOVED_SETTING_KEYS: ReadonlySet<string> = new Set([
  'seededFollowupStatusId',
  'color.dark.scheduled',
  'color.light.scheduled',
])

/**
 * Settings: `defaultProjectGroupBy` enum rewritten; the seeded "Follow-up"
 * status pointer and the scheduled-chip color overrides removed. The status row itself stays (user data). When the
 * user never picked a quick status, the app fell back to that seeded status —
 * that choice is written out as an explicit `quickStatusId` so the quick
 * status doesn't change.
 */
function upgradeSettings(rows: DataRow[] | undefined, statuses: DataRow[] | undefined): DataRow[] | undefined {
  if (!Array.isArray(rows)) return rows
  const seeded = rows.find((r) => isRecord(r) && r.key === 'seededFollowupStatusId')
  const hasQuick = rows.some((r) => isRecord(r) && r.key === 'quickStatusId' && r.value !== '')
  let changed = false
  const out: DataRow[] = []
  for (const row of rows) {
    if (isRecord(row) && typeof row.key === 'string' && REMOVED_SETTING_KEYS.has(row.key)) {
      changed = true
      continue
    }
    if (isRecord(row) && row.key === 'defaultProjectGroupBy' && rewriteEnum(row.value) !== row.value) {
      changed = true
      out.push({ ...row, value: REPLACEMENT })
      continue
    }
    out.push(row)
  }
  if (seeded && !hasQuick && typeof seeded.value === 'string' && seeded.value !== '') {
    const id = Number(seeded.value)
    const statusExists = statuses?.some((s) => isRecord(s) && s.id === id) ?? false
    if (Number.isFinite(id) && statusExists) {
      const withoutEmptyQuick = out.filter((r) => !(isRecord(r) && r.key === 'quickStatusId'))
      withoutEmptyQuick.push({ key: 'quickStatusId', value: seeded.value })
      return withoutEmptyQuick
    }
  }
  return changed ? out : rows
}

/**
 * v53 — remove the scheduled date.
 *
 * - Todos: a scheduled day (precise, or fuzzy resolved to the end of the
 *   window it was picked for) becomes `nextFollowupAt` when the task has no
 *   next follow-up; recurring tasks anchored on a precise scheduled date with
 *   no due date get it as `dueDate`. `scheduledDate` is stripped.
 * - List definitions / project group-by / `defaultProjectGroupBy`: `'date'`
 *   (effective date) and `'scheduled'` become `'deadline'`; `hasScheduled`
 *   is dropped from predicates.
 * - Settings: `seededFollowupStatusId` and the `scheduled` theme colors
 *   removed (see `upgradeSettings`).
 * - Historical `'scheduled'` todoEvents are kept.
 *
 * Idempotent; tolerates missing tables (task archives carry no settings —
 * fuzzy values then resolve with a Monday week start, the app default).
 */
export function upgradeV53(data: DataSet): DataSet {
  const out: DataSet = { ...data }
  const weekStartsOn = readWeekStart(data.settings)
  const todos = upgradeTodos(data.todos, weekStartsOn)
  if (todos !== undefined && todos !== data.todos) out.todos = todos
  const listDefinitions = upgradeListDefinitions(data.listDefinitions)
  if (listDefinitions !== undefined && listDefinitions !== data.listDefinitions) out.listDefinitions = listDefinitions
  const projects = upgradeProjects(data.projects)
  if (projects !== undefined && projects !== data.projects) out.projects = projects
  const settings = upgradeSettings(data.settings, data.statuses)
  if (settings !== undefined && settings !== data.settings) out.settings = settings
  return out
}
