import type { DataRow, DataSet } from '../schema-upgrades'

/**
 * v74 — a stored Priority filter (`markers`) becomes a list of conditions,
 * each what one chip shows: `{ values, not? }`, is / is not any of the values.
 * The conditions AND among a predicate's own clauses and OR in an or group.
 *
 * Every filter keeps exactly what it matched:
 *
 * - `{ urgent: true, important: true }` → `is Urgent`, `is Important`;
 *   `{ important: true, urgent: false }` → `is Important`, `is not Urgent`;
 *   the No markers go together: `{ urgent: false, important: false }` → `is
 *   not Urgent or Important`.
 * - `'hot'` → the stored Hot rule (settings row `hotRule`, the default rule
 *   when there is none, as for a kept draft) in conjunctive form: `(U & I) or
 *   F` → `is Urgent or Focus`, `is Important or Focus`. Only an open task was
 *   hot, so a list showing completed tasks now also keeps those that match.
 * - An AND inside an or group distributes over its other clauses, since a
 *   group's conditions OR: `(U & I) or Ann` → `[U or Ann]` and `[I or Ann]`.
 *   Up to 3 conditions from each of at most 10 groups: `OR_GROUPS_MAX` holds them.
 *
 * Holds its own copies of the marker keys and the rule's reading: this step
 * must go on meaning this whatever later builds do with them. A value it can't
 * read passes through, for validation to drop; a list is already in the new
 * shape stays as it is (idempotent).
 */

type Marker = 'focus' | 'urgent' | 'important'

const MARKERS: readonly Marker[] = ['focus', 'urgent', 'important']

interface Condition {
  values: Marker[]
  not?: true
}

const DEFAULT_RULE: readonly (readonly Marker[])[] = [['urgent', 'important'], ['focus']]

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** The rule's lines (each an AND of markers), the default for a row that is absent or can't be read. */
function readRule(settings: readonly DataRow[] | undefined): readonly (readonly Marker[])[] {
  const row = settings?.find((s) => s.key === 'hotRule')
  if (typeof row?.value !== 'string') return DEFAULT_RULE
  let parsed: unknown
  try {
    parsed = JSON.parse(row.value)
  } catch {
    return DEFAULT_RULE
  }
  if (!Array.isArray(parsed)) return DEFAULT_RULE
  const lines = parsed.map((line: unknown) => (isRecord(line) ? MARKERS.filter((m) => line[m] === true) : []))
  return lines.length > 0 && lines.every((l) => l.length > 0) ? lines : DEFAULT_RULE
}

/** Lines ORed, each an AND → the same as an AND of "any of" lists: one marker from each line, the ones another implies left out. */
function ruleConditions(rule: readonly (readonly Marker[])[]): Condition[] {
  let picks: Marker[][] = [[]]
  for (const line of rule) {
    picks = picks.flatMap((pick) => line.map((m) => (pick.includes(m) ? pick : [...pick, m])))
  }
  const sets = picks.map((pick) => MARKERS.filter((m) => pick.includes(m)))
  const minimal = sets.filter((set, i) => !sets.some((other, j) => {
    if (i === j || !other.every((m) => set.includes(m))) return false
    // A smaller list implies this one; of two the same, the first stays.
    return other.length < set.length || j < i
  }))
  return minimal.map((values) => ({ values }))
}

function conditionsOf(markers: unknown, rule: readonly (readonly Marker[])[]): Condition[] | null | undefined {
  if (markers === 'hot') return ruleConditions(rule)
  if (!isRecord(markers)) return undefined
  const entries = Object.entries(markers)
  if (entries.some(([k, v]) => !(MARKERS as readonly string[]).includes(k) || typeof v !== 'boolean')) return undefined
  const yes = MARKERS.filter((m) => markers[m] === true).map((m): Condition => ({ values: [m] }))
  const no = MARKERS.filter((m) => markers[m] === false)
  const out = no.length > 0 ? [...yes, { values: no, not: true as const }] : yes
  return out.length > 0 ? out : null
}

/** A clause set's Priority filter in the new shape; the set itself when there is nothing to convert. */
function withConditions(clauses: DataRow, rule: readonly (readonly Marker[])[]): DataRow {
  const conditions = conditionsOf(clauses.markers, rule)
  return conditions === undefined ? clauses : { ...clauses, markers: conditions }
}

function upgradeGroup(group: unknown, rule: readonly (readonly Marker[])[]): unknown[] {
  if (!isRecord(group)) return [group]
  const conditions = conditionsOf(group.markers, rule)
  if (conditions === undefined) return [group]
  // Each ANDed condition with the group's other clauses: `(a & b) or c` = `(a or c) & (b or c)`.
  if (conditions === null || conditions.length <= 1) return [{ ...group, markers: conditions }]
  return conditions.map((condition) => ({ ...group, markers: [condition] }))
}

function upgradePredicate(predicate: unknown, rule: readonly (readonly Marker[])[]): unknown {
  if (!isRecord(predicate)) return predicate
  const out = withConditions(predicate, rule)
  if (!Array.isArray(predicate.orGroups)) return out
  const groups = predicate.orGroups as unknown[]
  const orGroups = groups.flatMap((g) => upgradeGroup(g, rule))
  if (orGroups.length === groups.length && orGroups.every((g, i) => g === groups[i])) return out
  return { ...out, orGroups }
}

/** A JSON settings value with `edit` applied; the row itself when it can't be read or nothing changes. */
function withJsonValue(row: DataRow, edit: (value: unknown) => unknown): DataRow {
  if (typeof row.value !== 'string') return row
  try {
    const before = JSON.parse(row.value) as unknown
    const after = edit(before)
    return after === before ? row : { ...row, value: JSON.stringify(after) }
  } catch {
    return row
  }
}

/** `list` with `edit` applied to each item; `list` itself when no item changes. */
function mapSame<T>(list: readonly T[], edit: (item: T) => T): readonly T[] {
  const out = list.map(edit)
  return out.every((item, i) => item === list[i]) ? list : out
}

/** The object with its predicate at `key` upgraded; the object itself when that changes nothing. */
function withPredicateAt<T extends Record<string, unknown>>(holder: T, key: string, rule: readonly (readonly Marker[])[]): T {
  const next = upgradePredicate(holder[key], rule)
  return next === holder[key] ? holder : { ...holder, [key]: next }
}

export function upgradeV74(data: DataSet): DataSet {
  const rule = readRule(data.settings)
  const lists = data.listDefinitions && mapSame(data.listDefinitions, (row) => {
    if (!isRecord(row.membership)) return row
    const membership = withPredicateAt(row.membership, 'predicate', rule)
    return membership === row.membership ? row : { ...row, membership }
  })
  const settings = data.settings && mapSame(data.settings, (row) => {
    switch (row.key) {
      case 'checkinTaskFilter':
        return withJsonValue(row, (filter) => upgradePredicate(filter, rule))
      case 'lenses':
        return withJsonValue(row, (lenses) => (Array.isArray(lenses)
          ? mapSame(lenses as unknown[], (lens) => (isRecord(lens) ? withPredicateAt(lens, 'predicate', rule) : lens))
          : lenses))
      case 'eisenhowerPanes':
        return withJsonValue(row, (panes) => {
          if (!isRecord(panes)) return panes
          const entries = Object.entries(panes)
          const next = mapSame(entries, (entry): [string, unknown] => {
            const [id, pane] = entry
            const upgraded = isRecord(pane) ? withPredicateAt(pane, 'filter', rule) : pane
            return upgraded === pane ? entry : [id, upgraded]
          })
          return next === entries ? panes : Object.fromEntries(next)
        })
      default:
        return row
    }
  })
  if (lists === data.listDefinitions && settings === data.settings) return data
  return {
    ...data,
    ...(lists ? { listDefinitions: lists as DataRow[] } : {}),
    ...(settings ? { settings: settings as DataRow[] } : {}),
  }
}
