import type { DataRow, DataSet } from '../schema-upgrades'

/**
 * v55 — merge orgs into people. Frozen with this transform: the orange the
 * migrated entries get, the name prefix, the initials rule and the removed
 * enum values are copied here so later code changes can't alter what the
 * upgrade does.
 */

/** Color written onto every person created from an org. */
export const MIGRATED_ORG_COLOR = '#f28c4e'

/** Name prefix of a person created from an org. */
export const MIGRATED_ORG_PREFIX = 'Org: '

/** Tables v55 drops (the Dexie block declares them `null`). */
export const V55_DROPPED_TABLES = ['orgs', 'todoOrgs', 'personOrgs'] as const

const PERSON_NAME_MAX = 200

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

function isId(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

function nameKey(name: string): string {
  return name.trim().toLowerCase()
}

function initialsFor(name: string): string {
  const generated = name.split(/\s+/).filter(Boolean).map((w) => w[0]).join('').toUpperCase().slice(0, 3)
  return generated || 'O'
}

function maxId(rows: DataRow[] | undefined): number {
  let max = 0
  for (const row of rows ?? []) if (isRecord(row) && isId(row.id) && row.id > max) max = row.id
  return max
}

/** True when the person row has a usable color already. */
function hasColor(row: DataRow): boolean {
  return typeof row.color === 'string' && row.color !== ''
}

interface PeopleResult {
  people: DataRow[] | undefined
  /** org id → person id */
  orgToPerson: Map<number, number>
}

/**
 * People after the merge:
 *
 * - A person who belonged to orgs keeps the color they were shown in — the
 *   first of their orgs (membership order) that has a color — when they have
 *   none of their own.
 * - Each org becomes a person `Org: <name>` with the org's initials (or ones
 *   generated from its name) and the migration orange. A person with that
 *   name (case-insensitive) already present is reused instead; it gets the
 *   orange only if it has no color. Two orgs with the same name map to one
 *   person.
 */
function mergePeople(
  peopleIn: DataRow[] | undefined,
  orgs: DataRow[] | undefined,
  personOrgs: DataRow[] | undefined,
): PeopleResult {
  const orgToPerson = new Map<number, number>()
  const orgRows = (orgs ?? []).filter((o) => isRecord(o) && isId(o.id) && typeof o.name === 'string')
  const orgColor = new Map<number, string>()
  for (const o of orgRows) {
    if (typeof o.color === 'string' && o.color !== '') orgColor.set(o.id as number, o.color)
  }

  // First org color per member, in membership order.
  const memberColor = new Map<number, string>()
  for (const link of personOrgs ?? []) {
    if (!isRecord(link) || !isId(link.personId) || !isId(link.orgId)) continue
    if (memberColor.has(link.personId)) continue
    const color = orgColor.get(link.orgId)
    if (color) memberColor.set(link.personId, color)
  }

  if (orgRows.length === 0 && memberColor.size === 0) return { people: peopleIn, orgToPerson }

  let changed = false
  const people: DataRow[] = (peopleIn ?? []).map((row) => {
    if (!isRecord(row) || !isId(row.id) || hasColor(row)) return row
    const color = memberColor.get(row.id)
    if (!color) return row
    changed = true
    return { ...row, color }
  })

  const byName = new Map<string, number>()
  people.forEach((row, index) => {
    if (isRecord(row) && typeof row.name === 'string' && !byName.has(nameKey(row.name))) byName.set(nameKey(row.name), index)
  })

  let nextId = maxId(peopleIn) + 1
  for (const org of orgRows) {
    const orgName = (org.name as string).trim()
    const name = (MIGRATED_ORG_PREFIX + orgName).slice(0, PERSON_NAME_MAX)
    const existingIndex = byName.get(nameKey(name))
    if (existingIndex !== undefined) {
      const existing = people[existingIndex] as DataRow
      orgToPerson.set(org.id as number, existing.id as number)
      if (!hasColor(existing)) {
        people[existingIndex] = { ...existing, color: MIGRATED_ORG_COLOR }
        changed = true
      }
      continue
    }
    const initials = typeof org.initials === 'string' && org.initials.trim() !== ''
      ? org.initials.trim().slice(0, 4)
      : initialsFor(orgName)
    const person: DataRow = { id: nextId++, name, initials, color: MIGRATED_ORG_COLOR }
    byName.set(nameKey(name), people.length)
    people.push(person)
    orgToPerson.set(org.id as number, person.id as number)
    changed = true
  }

  return { people: changed ? people : peopleIn, orgToPerson }
}

/**
 * `todoOrgs` → `todoPeople` with the mapped person ids. Pairs the task
 * already has are skipped; rows pointing at a missing org (or, when the
 * dataset carries tasks, a missing task) are dropped. New rows get explicit
 * ids so the live-DB and file paths produce identical rows.
 */
function mergeAssignments(
  todoPeopleIn: DataRow[] | undefined,
  todoOrgs: DataRow[] | undefined,
  todos: DataRow[] | undefined,
  orgToPerson: ReadonlyMap<number, number>,
): DataRow[] | undefined {
  if (!Array.isArray(todoOrgs) || todoOrgs.length === 0) return todoPeopleIn
  const todoIds = Array.isArray(todos)
    ? new Set(todos.filter((t) => isRecord(t) && isId(t.id)).map((t) => t.id as number))
    : null
  const seen = new Set<string>()
  for (const row of todoPeopleIn ?? []) {
    if (isRecord(row) && isId(row.todoId) && isId(row.personId)) seen.add(`${row.todoId}:${row.personId}`)
  }
  const out = [...(todoPeopleIn ?? [])]
  let nextId = maxId(todoPeopleIn) + 1
  for (const link of todoOrgs) {
    if (!isRecord(link) || !isId(link.todoId) || !isId(link.orgId)) continue
    const personId = orgToPerson.get(link.orgId)
    if (personId === undefined) continue
    if (todoIds && !todoIds.has(link.todoId)) continue
    const key = `${link.todoId}:${personId}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ id: nextId++, todoId: link.todoId, personId })
  }
  return out.length === (todoPeopleIn ?? []).length ? todoPeopleIn : out
}

/** Maps org ids to person ids; ids of orgs that no longer exist are dropped. */
function mapOrgIds(ids: readonly unknown[], orgToPerson: ReadonlyMap<number, number>): number[] {
  const out: number[] = []
  for (const id of ids) {
    if (!isId(id)) continue
    const mapped = id === 0 ? 0 : orgToPerson.get(id)
    if (mapped !== undefined && !out.includes(mapped)) out.push(mapped)
  }
  return out
}

/**
 * Stored predicate: the org filter folds into the person filter.
 *
 * Both used to AND together; there is one filter now, so the org side's
 * people are added to the person side (union, OR):
 *
 * - person `null` + org `null` → `null` (no filter)
 * - one side `null` → the other side (org ids mapped to their people)
 * - both arrays → union; the "unassigned" sentinel `0` is kept when either
 *   side had it (`0` in the org filter meant "no org", now "no one assigned")
 * - either side `[]` → `[]`: an empty filter matched nothing and still does
 *
 * `personFilterMode` / `orgFilterMode` are removed (membership is gone).
 * Only predicates that still carry an org key are touched (idempotency).
 */
function rewritePredicate(p: unknown, orgToPerson: ReadonlyMap<number, number>): unknown {
  if (!isRecord(p)) return p
  if (!('orgIds' in p) && !('orgFilterMode' in p) && !('personFilterMode' in p)) return p
  const next: Record<string, unknown> = { ...p }
  delete next.orgIds
  delete next.orgFilterMode
  delete next.personFilterMode
  const orgSide = Array.isArray(p.orgIds) ? mapOrgIds(p.orgIds, orgToPerson) : null
  if (orgSide !== null) {
    const personSide = p.personIds
    if (personSide === null || personSide === undefined) {
      next.personIds = orgSide
    } else if (Array.isArray(personSide)) {
      next.personIds = personSide.length === 0 || orgSide.length === 0
        ? []
        : [...personSide, ...orgSide.filter((id) => !personSide.includes(id))]
    }
  }
  return next
}

const ORG_AXIS = 'org'
const PEOPLE_AXIS = 'people'

function rewriteAxis(v: unknown): unknown {
  return v === ORG_AXIS ? PEOPLE_AXIS : v
}

interface ListDefsResult {
  rows: DataRow[] | undefined
  /** Ids of lists whose runtime filter picked orgs (their stored picks need remapping). */
  orgRuntimeListIds: Set<number>
}

function upgradeListDefinitions(rows: DataRow[] | undefined, orgToPerson: ReadonlyMap<number, number>): ListDefsResult {
  const orgRuntimeListIds = new Set<number>()
  if (!Array.isArray(rows)) return { rows, orgRuntimeListIds }
  let changed = false
  const out = rows.map((row) => {
    if (!isRecord(row)) return row
    const next: DataRow = { ...row }
    let rowChanged = false
    if ('sort' in row && rewriteAxis(row.sort) !== row.sort) { next.sort = rewriteAxis(row.sort); rowChanged = true }
    if ('grouping' in row && rewriteAxis(row.grouping) !== row.grouping) { next.grouping = rewriteAxis(row.grouping); rowChanged = true }
    const membership = row.membership
    if (isRecord(membership) && 'predicate' in membership) {
      const predicate = rewritePredicate(membership.predicate, orgToPerson)
      if (predicate !== membership.predicate) { next.membership = { ...membership, predicate }; rowChanged = true }
    }
    const rf = row.runtimeFilter
    if (isRecord(rf) && rf.field === 'org') {
      next.runtimeFilter = { ...rf, field: 'person' }
      if (isId(row.id)) orgRuntimeListIds.add(row.id)
      rowChanged = true
    }
    if (!rowChanged) return row
    changed = true
    return next
  })
  return { rows: changed ? out : rows, orgRuntimeListIds }
}

/** Remaps stored runtime-filter picks; `undefined` when nothing is left. */
function remapPicks(value: unknown, orgToPerson: ReadonlyMap<number, number>): number[] | undefined {
  if (!Array.isArray(value)) return undefined
  const ids = mapOrgIds(value.filter((v) => v !== 0), orgToPerson)
  return ids.length > 0 ? ids : undefined
}

function upgradeListInsets(
  rows: DataRow[] | undefined,
  orgRuntimeListIds: ReadonlySet<number>,
  orgToPerson: ReadonlyMap<number, number>,
): DataRow[] | undefined {
  if (!Array.isArray(rows) || orgRuntimeListIds.size === 0) return rows
  let changed = false
  const out = rows.map((row) => {
    if (!isRecord(row) || !isId(row.listDefinitionId) || !orgRuntimeListIds.has(row.listDefinitionId)) return row
    if (!('runtimeFilterValue' in row)) return row
    changed = true
    const next: DataRow = { ...row }
    const picks = remapPicks(row.runtimeFilterValue, orgToPerson)
    if (picks) next.runtimeFilterValue = picks
    else delete next.runtimeFilterValue
    return next
  })
  return changed ? out : rows
}

const RAIL_SIDES = ['left', 'right', 'top', 'bottom'] as const

/** Remaps the runtime picks of rail lens tabs showing an org-runtime list. */
function remapRailPicks(
  value: string,
  orgRuntimeListIds: ReadonlySet<number>,
  orgToPerson: ReadonlyMap<number, number>,
): string {
  if (orgRuntimeListIds.size === 0) return value
  let parsed: unknown
  try { parsed = JSON.parse(value) } catch { return value }
  if (!isRecord(parsed)) return value
  let changed = false
  const next: Record<string, unknown> = { ...parsed }
  for (const side of RAIL_SIDES) {
    const rail = parsed[side]
    if (!isRecord(rail) || !Array.isArray(rail.slots)) continue
    let railChanged = false
    const slots = rail.slots.map((slot: unknown) => {
      if (!isRecord(slot) || !Array.isArray(slot.tabs)) return slot
      let slotChanged = false
      const tabs = slot.tabs.map((tab: unknown) => {
        if (!isRecord(tab) || !isId(tab.listDefinitionId) || !orgRuntimeListIds.has(tab.listDefinitionId)) return tab
        if (!('runtimeFilterValue' in tab)) return tab
        slotChanged = true
        const nextTab: Record<string, unknown> = { ...tab }
        const picks = remapPicks(tab.runtimeFilterValue, orgToPerson)
        if (picks) nextTab.runtimeFilterValue = picks
        else delete nextTab.runtimeFilterValue
        return nextTab
      })
      if (!slotChanged) return slot
      railChanged = true
      return { ...slot, tabs }
    })
    if (!railChanged) continue
    changed = true
    next[side] = { ...rail, slots }
  }
  return changed ? JSON.stringify(next) : value
}

function upgradeSettings(
  rows: DataRow[] | undefined,
  orgRuntimeListIds: ReadonlySet<number>,
  orgToPerson: ReadonlyMap<number, number>,
): DataRow[] | undefined {
  if (!Array.isArray(rows)) return rows
  let changed = false
  const out = rows.map((row) => {
    if (!isRecord(row)) return row
    if (row.key === 'defaultProjectGroupBy' && row.value === ORG_AXIS) {
      changed = true
      return { ...row, value: PEOPLE_AXIS }
    }
    if (row.key === 'canvasRails' && typeof row.value === 'string') {
      const value = remapRailPicks(row.value, orgRuntimeListIds, orgToPerson)
      if (value !== row.value) {
        changed = true
        return { ...row, value }
      }
    }
    return row
  })
  return changed ? out : rows
}

function upgradeProjects(rows: DataRow[] | undefined): DataRow[] | undefined {
  if (!Array.isArray(rows)) return rows
  let changed = false
  const out = rows.map((row) => {
    if (!isRecord(row) || row.groupBy !== ORG_AXIS) return row
    changed = true
    return { ...row, groupBy: PEOPLE_AXIS }
  })
  return changed ? out : rows
}

/**
 * v55 — merge orgs into people.
 *
 * - Each org becomes a person named `Org: <name>` colored `MIGRATED_ORG_COLOR`
 *   (an existing person of that name is reused); org assignments
 *   (`todoOrgs`) become person assignments. Person–org membership is
 *   dropped; members keep the org color they were shown in (see
 *   `mergePeople`).
 * - Drops `orgs`, `todoOrgs`, `personOrgs`.
 * - Stored list predicates: the org filter folds into the person filter (see
 *   `rewritePredicate`); filter modes removed. Sort / group `'org'` →
 *   `'people'` in list definitions, projects and `defaultProjectGroupBy`.
 *   Runtime filters on `'org'` become `'person'`, and the picks stored for
 *   those lists (list insets, rail lens tabs) are remapped.
 *
 * Idempotent; tolerates missing tables (task archives carry orgs and their
 * joins but no list definitions or settings).
 */
export function upgradeV55(data: DataSet): DataSet {
  const out: DataSet = { ...data }
  for (const table of V55_DROPPED_TABLES) delete out[table]

  const { people, orgToPerson } = mergePeople(data.people, data.orgs, data.personOrgs)
  if (people !== undefined && people !== data.people) out.people = people
  const todoPeople = mergeAssignments(data.todoPeople, data.todoOrgs, data.todos, orgToPerson)
  if (todoPeople !== undefined && todoPeople !== data.todoPeople) out.todoPeople = todoPeople

  const lists = upgradeListDefinitions(data.listDefinitions, orgToPerson)
  if (lists.rows !== undefined && lists.rows !== data.listDefinitions) out.listDefinitions = lists.rows
  const listInsets = upgradeListInsets(data.listInsets, lists.orgRuntimeListIds, orgToPerson)
  if (listInsets !== undefined && listInsets !== data.listInsets) out.listInsets = listInsets
  const settings = upgradeSettings(data.settings, lists.orgRuntimeListIds, orgToPerson)
  if (settings !== undefined && settings !== data.settings) out.settings = settings
  const projects = upgradeProjects(data.projects)
  if (projects !== undefined && projects !== data.projects) out.projects = projects
  return out
}
