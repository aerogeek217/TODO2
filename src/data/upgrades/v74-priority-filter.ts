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
 * Hot itself goes: the `hotRule` settings row (read above, then deleted) and a
 * dashboard tab's Hot tile and section, so a stored layout doesn't open as
 * needing repair.
 *
 * Subtask titles are made what the subtask store writes (cr31): one line,
 * trimmed, at most 500 characters; a row left with no title goes. v73 builds
 * stored a note line's subtasks as they were — an empty done box (`- [x]`)
 * as `''`, a long line whole — which import refuses, so one such row made
 * every export, backup and sync file of that browser unimportable. Here both
 * the browser's database and every file a v73 build wrote are repaired.
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

/** The subtask title rule as v74 stores it (`utils/subtasks.subtaskTitle` then). */
const SUBTASK_TITLE_MAX = 500

function storedSubtaskTitle(title: string): string {
  return title.replace(/\s+/g, ' ').trim().slice(0, SUBTASK_TITLE_MAX).trim()
}

/** The subtasks with their titles as stored, a row left with none dropped; the table itself when nothing changes. */
function withStoredTitles(rows: readonly DataRow[]): readonly DataRow[] {
  let changed = false
  const out = rows.flatMap((row) => {
    if (!isRecord(row) || typeof row.title !== 'string') return [row]
    const title = storedSubtaskTitle(row.title)
    if (title !== '' && title === row.title) return [row]
    changed = true
    return title === '' ? [] : [{ ...row, title }]
  })
  return changed ? out : rows
}

/** The rule's lines (each an AND of markers), the default for a row that is absent or can't be read. */
function readRule(settings: readonly DataRow[] | undefined): readonly (readonly Marker[])[] {
  const row = settings?.find((s) => isRecord(s) && s.key === 'hotRule')
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

const bitOf = (m: Marker): number => 1 << MARKERS.indexOf(m)

/**
 * Lines ORed, each an AND → the same as an AND of "any of" lists: one marker
 * from each line, the ones another implies left out. A pick is a set of the
 * 3 markers (a bitmask), so there are at most 8 of them whatever the rule's
 * length: the picks are kept once each, in the order they first come, which
 * is the order the full expansion would give them.
 */
function ruleConditions(rule: readonly (readonly Marker[])[]): Condition[] {
  let picks: number[] = [0]
  for (const line of rule) {
    const next = new Set<number>()
    for (const pick of picks) for (const m of line) next.add(pick | bitOf(m))
    picks = [...next]
  }
  const sets = picks.map((pick) => MARKERS.filter((m) => (pick & bitOf(m)) !== 0))
  const minimal = sets.filter((set, i) => !sets.some((other, j) => {
    if (i === j || !other.every((m) => set.includes(m))) return false
    // A smaller list implies this one (picks are distinct, so no two are the same).
    return other.length < set.length
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

/** A dashboard tab without its Hot tile and section; the tab itself when it has neither. */
function withoutHot(tab: unknown): unknown {
  if (!isRecord(tab) || tab.kind !== 'dashboard' || !isRecord(tab.config)) return tab
  const { tiles, sections } = tab.config
  const keptTiles = Array.isArray(tiles) ? tiles.filter((t) => t !== 'hot') : tiles
  const keptSections = Array.isArray(sections) ? sections.filter((s) => !(isRecord(s) && s.id === 'hot')) : sections
  const same = (Array.isArray(tiles) ? (keptTiles as unknown[]).length === tiles.length : true)
    && (Array.isArray(sections) ? (keptSections as unknown[]).length === sections.length : true)
  if (same) return tab
  return { ...tab, config: { ...tab.config, tiles: keptTiles, sections: keptSections } }
}

function panelWithoutHot(panel: unknown): unknown {
  if (!isRecord(panel) || !Array.isArray(panel.tabs)) return panel
  const tabs = mapSame(panel.tabs as unknown[], withoutHot)
  return tabs === panel.tabs ? panel : { ...panel, tabs }
}

/** A layout row (or a kept draft's body) without its dashboards' Hot. */
function layoutWithoutHot(row: DataRow): DataRow {
  if (!isRecord(row)) return row
  let out = row
  for (const edge of ['top', 'bottom'] as const) {
    const band = panelWithoutHot(out[edge])
    if (band !== out[edge]) out = { ...out, [edge]: band }
  }
  if (!Array.isArray(row.columns)) return out
  const columns = mapSame(row.columns as unknown[], (col) => {
    if (!isRecord(col) || !Array.isArray(col.cells)) return col
    const cells = mapSame(col.cells as unknown[], panelWithoutHot)
    return cells === col.cells ? col : { ...col, cells }
  })
  return columns === row.columns ? out : { ...out, columns }
}

/** The object with its predicate at `key` upgraded; the object itself when that changes nothing. */
function withPredicateAt<T extends Record<string, unknown>>(holder: T, key: string, rule: readonly (readonly Marker[])[]): T {
  const next = upgradePredicate(holder[key], rule)
  return next === holder[key] ? holder : { ...holder, [key]: next }
}

export function upgradeV74(data: DataSet): DataSet {
  const rule = readRule(data.settings)
  const lists = data.listDefinitions && mapSame(data.listDefinitions, (row) => {
    if (!isRecord(row) || !isRecord(row.membership)) return row
    const membership = withPredicateAt(row.membership, 'predicate', rule)
    return membership === row.membership ? row : { ...row, membership }
  })
  const layouts = data.layouts && mapSame(data.layouts, layoutWithoutHot)
  const upgradedSettings = data.settings && mapSame(data.settings, (row) => {
    if (!isRecord(row)) return row
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
  const isRule = (row: DataRow) => isRecord(row) && row.key === 'hotRule'
  const settings = upgradedSettings?.some(isRule) === true ? upgradedSettings.filter((row) => !isRule(row)) : upgradedSettings
  const subtasks = data.subtasks && withStoredTitles(data.subtasks)
  if (lists === data.listDefinitions && settings === data.settings && layouts === data.layouts && subtasks === data.subtasks) return data
  return {
    ...data,
    ...(subtasks ? { subtasks: subtasks as DataRow[] } : {}),
    ...(lists ? { listDefinitions: lists as DataRow[] } : {}),
    ...(settings ? { settings: settings as DataRow[] } : {}),
    ...(layouts ? { layouts: layouts as DataRow[] } : {}),
  }
}
