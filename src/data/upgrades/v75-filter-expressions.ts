import type { DataRow, DataSet } from '../schema-upgrades'

/**
 * v75 — a filter is Graphical (a chip per field, ANDed; one Priority chip)
 * or an expression (`TodoPredicate.expression`). A stored filter Graphical
 * can no longer say — one with or groups, or with more than one Priority
 * condition — becomes the expression that filters the same, its clauses
 * emptied and its or groups gone:
 *
 * - each clause outside the or groups is one `and` term: an id filter `@a or
 *   @b` (its "is not" a `not`), each Priority condition likewise, text a
 *   `text` atom, each date clause a `date` atom (an "is not" range a `not`,
 *   "or none" an `or … none`);
 * - each or group is one term: an `or` of its clauses' terms;
 * - an expression already there (a build between v74 and v75) is the last
 *   term.
 *
 * Over list definitions, the settings rows `lenses`, `eisenhowerPanes` and
 * `checkinTaskFilter`, and kept list drafts (through the pipeline). Holds its
 * own copy of the conversion: this step must go on meaning this whatever
 * later builds do. A clause it can't read is left out of the conversion's
 * reach — the predicate passes through unchanged, for validation to judge;
 * a filter Graphical can say stays as it is (idempotent).
 */

type Expr = Record<string, unknown>

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Not readable: the predicate passes through unchanged. */
class Unreadable extends Error {}

const anyOf = (items: Expr[]): Expr => (items.length === 1 && items[0] ? items[0] : { kind: 'or', items })
const not = (item: Expr): Expr => ({ kind: 'not', item })

function idTerms(c: Record<string, unknown>, field: 'personIds' | 'statusIds' | 'tags', kind: string): Expr[] {
  const ids = c[field]
  if (ids == null) return []
  if (!Array.isArray(ids) || !ids.every((id) => typeof id === 'number' && Number.isInteger(id) && id >= 0)) throw new Unreadable()
  if (ids.length === 0) return []
  const term = anyOf((ids as number[]).map((id) => ({ kind, id })))
  const negate = c.negate
  return [isRecord(negate) && negate[field] === true ? not(term) : term]
}

const MARKER_VALUES = new Set(['focus', 'urgent', 'important', 'none'])

function markerTerms(c: Record<string, unknown>): Expr[] {
  const markers = c.markers
  if (markers == null) return []
  if (!Array.isArray(markers)) throw new Unreadable()
  return (markers as unknown[]).flatMap((clause) => {
    if (!isRecord(clause) || !Array.isArray(clause.values) || !clause.values.every((v) => MARKER_VALUES.has(v as string))) throw new Unreadable()
    if (clause.values.length === 0) return []
    const term = anyOf((clause.values as string[]).map((value) => ({ kind: 'priority', value })))
    return [clause.not === true ? not(term) : term]
  })
}

const DATE_FIELDS = ['deadline', 'followup', 'lastFollowup', 'completed', 'created', 'modified']

function dateTerms(c: Record<string, unknown>): Expr[] {
  const dates = c.dates
  if (dates == null) return []
  if (!isRecord(dates)) throw new Unreadable()
  return DATE_FIELDS.flatMap((field) => {
    const m = dates[field]
    if (m == null) return []
    if (!isRecord(m)) throw new Unreadable()
    if (m.match === 'set' || m.match === 'unset') return [{ kind: 'date', field, match: { match: m.match } }]
    if (m.match !== 'range') throw new Unreadable()
    const start = m.start ?? null
    const end = m.end ?? null
    if (start === null && end === null) return []
    const atom: Expr = { kind: 'date', field, match: { match: 'range', start, end } }
    if (m.not === true) return [not(atom)]
    if (m.includeNoDate === true) return [{ kind: 'or', items: [atom, { kind: 'date', field, match: { match: 'unset' } }] }]
    return [atom]
  })
}

/** A set of clauses as terms, in the chips' order: priority, tags, people, dates, status, text. */
function clauseTerms(c: Record<string, unknown>): Expr[] {
  const text = c.searchText
  if (text != null && typeof text !== 'string') throw new Unreadable()
  return [
    ...markerTerms(c),
    ...idTerms(c, 'tags', 'tag'),
    ...idTerms(c, 'personIds', 'person'),
    ...dateTerms(c),
    ...idTerms(c, 'statusIds', 'status'),
    ...(typeof text === 'string' && text.trim() !== '' ? [{ kind: 'text', text: text.trim() }] : []),
  ]
}

/** Whether Graphical can't say `p`: it has an or group, or more than one Priority condition. */
function needsExpression(p: Record<string, unknown>): boolean {
  return (Array.isArray(p.orGroups) && p.orGroups.length > 0) || (Array.isArray(p.markers) && p.markers.length > 1)
}

function upgradePredicate(p: unknown): unknown {
  if (!isRecord(p) || !needsExpression(p)) return p
  try {
    const terms = clauseTerms(p)
    for (const group of (p.orGroups as unknown[] | undefined) ?? []) {
      if (!isRecord(group)) throw new Unreadable()
      const alternatives = clauseTerms(group)
      if (alternatives.length > 0) terms.push(anyOf(alternatives))
    }
    if (isRecord(p.expression)) terms.push(p.expression)
    const { orGroups: _orGroups, negate: _negate, expression: _expression, ...rest } = p
    void _orGroups
    void _negate
    void _expression
    const out: Record<string, unknown> = { ...rest, personIds: null, statusIds: null, tags: null, searchText: '', dates: {}, markers: null }
    if (terms.length > 0) out.expression = terms.length === 1 ? terms[0] : { kind: 'and', items: terms }
    return out
  } catch (err) {
    if (err instanceof Unreadable) return p
    throw err
  }
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
function withPredicateAt<T extends Record<string, unknown>>(holder: T, key: string): T {
  const next = upgradePredicate(holder[key])
  return next === holder[key] ? holder : { ...holder, [key]: next }
}

export function upgradeV75(data: DataSet): DataSet {
  const lists = data.listDefinitions && mapSame(data.listDefinitions, (row) => {
    if (!isRecord(row) || !isRecord(row.membership)) return row
    const membership = withPredicateAt(row.membership, 'predicate')
    return membership === row.membership ? row : { ...row, membership }
  })
  const settings = data.settings && mapSame(data.settings, (row) => {
    if (!isRecord(row)) return row
    switch (row.key) {
      case 'checkinTaskFilter':
        return withJsonValue(row, upgradePredicate)
      case 'lenses':
        return withJsonValue(row, (lenses) => (Array.isArray(lenses)
          ? mapSame(lenses as unknown[], (lens) => (isRecord(lens) ? withPredicateAt(lens, 'predicate') : lens))
          : lenses))
      case 'eisenhowerPanes':
        return withJsonValue(row, (panes) => {
          if (!isRecord(panes)) return panes
          const entries = Object.entries(panes)
          const next = mapSame(entries, (entry): [string, unknown] => {
            const [id, pane] = entry
            const upgraded = isRecord(pane) ? withPredicateAt(pane, 'filter') : pane
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
