import type {
  PersistedTodoItem,
  TodoPredicate,
  ListSortBy,
  Tag,
  Person,
  Org,
  Project,
  Status,
} from '../models'
import type {
  ListMembership,
  ListSort,
  ListGrouping,
  PersistedListDefinition,
  RuntimeFilterSpec,
} from '../models/list-definition'
import { effectiveDate, isScheduledExpired, resolveScheduled } from '../utils/effective-date'
import { startOfDay, MS_PER_DAY } from '../utils/date'

export interface DashboardListsContext {
  today: Date
  /**
   * Evaluator for `{kind:'custom', predicate}` membership. The caller closes
   * over assignment maps + statuses so the interpreter can stay UI-agnostic.
   * The definition's own predicate (via this evaluator) is authoritative for
   * `showCompleted` / `showHiddenStatuses` — there is no ctx-level override.
   * Omitted when no custom definitions are in play — in that case an accidental
   * `{kind:'custom'}` definition is treated as matching no todos (with a
   * console warning once per build).
   */
  evalPredicate?: (predicate: TodoPredicate, todo: PersistedTodoItem) => boolean
  /**
   * Required for `{kind:'by-tag'}` grouping. Parallels `assignedPeopleMap` /
   * `assignedOrgsMap`: caller threads the registry + assignments through so
   * the interpreter can bucket by tag id without reading the (transient)
   * inline `todo.tags` string bag. When omitted, by-tag grouping yields an
   * empty group list (untagged bucket still emits).
   */
  assignedTagsMap?: Map<number, Tag[]>
  /** For `by-field` people/org bucketing. Missing → all todos go to "Unassigned" / "No organization". */
  assignedPeopleMap?: Map<number, Person[]>
  assignedOrgsMap?: Map<number, Org[]>
  /** Person→org membership bridge for `by-field: 'org'`. */
  personOrgMap?: Map<number, number[]>
  /** Registries used to enumerate + label categorical buckets. Missing → only empty/unassigned buckets render. */
  people?: Person[]
  orgs?: Org[]
  projects?: Project[]
  statuses?: Status[]
  /**
   * Per-definition runtime-filter picks keyed by def id. When a def declares a
   * `runtimeFilter`, the interpreter reads the caller's current pick here and
   * merges it into the predicate as an equality before membership is
   * evaluated. A missing key means the user has not picked yet — the list
   * returns with `todos: []` and `runtimeFilterUnset: true` so the surface can
   * render a "Pick a {label} to populate…" placeholder instead of an empty
   * state.
   */
  runtimeFilterValues?: ReadonlyMap<number, number>
}

export interface DashboardListGroup {
  key: string
  label: string
  todos: PersistedTodoItem[]
}

export interface DashboardList {
  id: number
  key: string
  label: string
  todos: PersistedTodoItem[]
  groups?: DashboardListGroup[]
  /** True when the def declares a `runtimeFilter` but the caller has no pick yet. */
  runtimeFilterUnset?: true
}

/**
 * Return a new predicate that narrows the given field to the supplied id.
 * Replaces any existing id filter on that field — the runtime pick is
 * authoritative for the prompted field. Other clauses are preserved so the
 * def's baseline predicate (status / date window / etc.) still applies.
 */
export function applyRuntimeFilter(
  predicate: TodoPredicate,
  spec: RuntimeFilterSpec,
  value: number,
): TodoPredicate {
  switch (spec.field) {
    case 'person': return { ...predicate, personIds: [value] }
    case 'org': return { ...predicate, orgIds: [value] }
    case 'project': return { ...predicate, projectIds: [value] }
    case 'status': return { ...predicate, statusIds: [value] }
  }
}

export function buildDashboardLists(
  definitions: PersistedListDefinition[],
  todos: PersistedTodoItem[],
  ctx: DashboardListsContext,
): DashboardList[] {
  const ordered = [...definitions].sort((a, b) => a.sortOrder - b.sortOrder)
  const result: DashboardList[] = []
  for (const def of ordered) {
    let effectiveDef = def
    let runtimeFilterUnset: true | undefined
    if (def.runtimeFilter) {
      const pick = ctx.runtimeFilterValues?.get(def.id)
      if (pick == null) {
        runtimeFilterUnset = true
      } else if (def.membership.kind === 'custom') {
        effectiveDef = {
          ...def,
          membership: {
            kind: 'custom',
            predicate: applyRuntimeFilter(def.membership.predicate, def.runtimeFilter, pick),
          },
        }
      }
    }
    const members = runtimeFilterUnset
      ? []
      : todos.filter((t) => interpretMembership(effectiveDef.membership, t, ctx))
    const sorted = [...members].sort((a, b) => interpretSort(effectiveDef.sort, a, b, ctx))
    const groups = runtimeFilterUnset
      ? undefined
      : interpretGrouping(effectiveDef.grouping, effectiveDef.sort, sorted, ctx)
    result.push({
      id: def.id,
      key: `def-${def.id}`,
      label: def.name,
      todos: sorted,
      groups,
      ...(runtimeFilterUnset ? { runtimeFilterUnset } : {}),
    })
  }
  return result
}

export function interpretMembership(
  m: ListMembership,
  t: PersistedTodoItem,
  ctx: DashboardListsContext,
): boolean {
  if (!ctx.evalPredicate) {
    warnOnceMissingEvaluator()
    return false
  }
  return ctx.evalPredicate(m.predicate, t)
}

let warnedMissingEvaluator = false
function warnOnceMissingEvaluator() {
  if (warnedMissingEvaluator) return
  warnedMissingEvaluator = true
  console.warn(
    'dashboard-lists: custom-membership list found but ctx.evalPredicate was not supplied; matching zero todos.',
  )
}

export function interpretSort(
  s: ListSort,
  a: PersistedTodoItem,
  b: PersistedTodoItem,
  ctx: DashboardListsContext,
): number {
  switch (s.kind) {
    case 'effective-date-asc':
      return compareEffectiveDateAsc(a, b, ctx)

    case 'scheduled-asc':
      return compareScheduledAsc(a, b, ctx)

    case 'deadline-asc':
      return compareDeadlineAsc(a, b)

    case 'sort-order':
      return compareSortOrder(a, b)

    case 'sortBy':
      return compareBySortBy(s.by, a, b, ctx)
  }
}

function compareEffectiveDateAsc(a: PersistedTodoItem, b: PersistedTodoItem, ctx: DashboardListsContext): number {
  const today = startOfDay(ctx.today)
  const aExpired = isScheduledExpired(a, today)
  const bExpired = isScheduledExpired(b, today)
  if (aExpired !== bExpired) return aExpired ? -1 : 1

  const ad = effectiveDate(a, today)
  const bd = effectiveDate(b, today)
  if (ad === null && bd === null) return ((a.sortOrder ?? 0) - (b.sortOrder ?? 0)) || (a.id - b.id)
  if (ad === null) return 1
  if (bd === null) return -1
  const cmp = ad.getTime() - bd.getTime()
  if (cmp !== 0) return cmp
  return ((a.sortOrder ?? 0) - (b.sortOrder ?? 0)) || (a.id - b.id)
}

function compareDeadlineAsc(a: PersistedTodoItem, b: PersistedTodoItem): number {
  const ad = a.dueDate ? startOfDay(new Date(a.dueDate)).getTime() : null
  const bd = b.dueDate ? startOfDay(new Date(b.dueDate)).getTime() : null
  if (ad === null && bd === null) return ((a.sortOrder ?? 0) - (b.sortOrder ?? 0)) || (a.id - b.id)
  if (ad === null) return 1
  if (bd === null) return -1
  const cmp = ad - bd
  if (cmp !== 0) return cmp
  return ((a.sortOrder ?? 0) - (b.sortOrder ?? 0)) || (a.id - b.id)
}

function compareSortOrder(a: PersistedTodoItem, b: PersistedTodoItem): number {
  const cmp = (a.sortOrder ?? 0) - (b.sortOrder ?? 0)
  if (cmp !== 0) return cmp
  return a.id - b.id
}

function compareScheduledAsc(a: PersistedTodoItem, b: PersistedTodoItem, ctx: DashboardListsContext): number {
  const today = startOfDay(ctx.today)
  const as = a.scheduledDate ? resolveScheduled(a.scheduledDate, today) : null
  const bs = b.scheduledDate ? resolveScheduled(b.scheduledDate, today) : null
  if (as === null && bs === null) return ((a.sortOrder ?? 0) - (b.sortOrder ?? 0)) || (a.id - b.id)
  if (as === null) return 1
  if (bs === null) return -1
  const cmp = as.getTime() - bs.getTime()
  if (cmp !== 0) return cmp
  return ((a.sortOrder ?? 0) - (b.sortOrder ?? 0)) || (a.id - b.id)
}

/**
 * Chronological `sortBy` values (date/scheduled/deadline) get proper
 * comparators. Categorical values (people/project/org/status) fall back to
 * sortOrder — the grouping node (`by-sortBy`) is where the categorical split
 * happens; a total order inside a single list for a categorical field is
 * ambiguous (multi-assignment).
 */
function compareBySortBy(
  by: ListSortBy,
  a: PersistedTodoItem,
  b: PersistedTodoItem,
  ctx: DashboardListsContext,
): number {
  switch (by) {
    case 'date':
      return compareEffectiveDateAsc(a, b, ctx)
    case 'scheduled':
      return compareScheduledAsc(a, b, ctx)
    case 'deadline':
      return compareDeadlineAsc(a, b)
    case 'people':
    case 'project':
    case 'org':
    case 'status':
    default:
      return compareSortOrder(a, b)
  }
}

export function interpretGrouping(
  g: ListGrouping,
  sort: ListSort,
  todos: PersistedTodoItem[],
  ctx: DashboardListsContext,
): DashboardListGroup[] | undefined {
  switch (g.kind) {
    case 'none':
      return undefined
    case 'relative-effective':
      return bucketByEffective(todos, ctx)
    case 'relative-deadline':
      return bucketByDeadline(todos, ctx)
    case 'by-sortBy': {
      if (sort.kind !== 'sortBy') return undefined
      return bucketByField(sort.by, todos, ctx)
    }
    case 'by-field':
      return bucketByField(g.by, todos, ctx)
    case 'by-tag':
      return bucketByTag(todos, ctx)
  }
}

function bucketByField(
  by: ListSortBy,
  todos: PersistedTodoItem[],
  ctx: DashboardListsContext,
): DashboardListGroup[] | undefined {
  switch (by) {
    case 'date':
      return bucketByEffective(todos, ctx)
    case 'scheduled':
      return bucketByScheduled(todos, ctx)
    case 'deadline':
      return bucketByDeadline(todos, ctx)
    case 'project':
      return bucketByProject(todos, ctx)
    case 'status':
      return bucketByStatus(todos, ctx)
    case 'people':
      return bucketByPeople(todos, ctx)
    case 'org':
      return bucketByOrg(todos, ctx)
  }
}

function weekBoundaries(today: Date) {
  const base = startOfDay(today).getTime()
  const dow = startOfDay(today).getDay()
  const daysUntilSunday = dow === 0 ? 0 : 7 - dow
  const thisWeekEnd = base + daysUntilSunday * MS_PER_DAY
  const nextWeekEnd = thisWeekEnd + 7 * MS_PER_DAY
  return { base, thisWeekEnd, nextWeekEnd }
}

function bucketByEffective(todos: PersistedTodoItem[], ctx: DashboardListsContext): DashboardListGroup[] {
  const today = startOfDay(ctx.today)
  const { base, thisWeekEnd, nextWeekEnd } = weekBoundaries(today)
  const tomorrowEnd = base + MS_PER_DAY
  const thisMonthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0).getTime()
  const nextMonthEnd = new Date(today.getFullYear(), today.getMonth() + 2, 0).getTime()

  const tomorrow: PersistedTodoItem[] = []
  const thisWeek: PersistedTodoItem[] = []
  const nextWeek: PersistedTodoItem[] = []
  const laterMonth: PersistedTodoItem[] = []
  const nextMonth: PersistedTodoItem[] = []
  const beyond: PersistedTodoItem[] = []

  for (const t of todos) {
    const eff = effectiveDate(t, today)
    if (eff === null) { beyond.push(t); continue }
    const ms = eff.getTime()
    if (ms <= tomorrowEnd) tomorrow.push(t)
    else if (ms <= thisWeekEnd) thisWeek.push(t)
    else if (ms <= nextWeekEnd) nextWeek.push(t)
    else if (ms <= thisMonthEnd) laterMonth.push(t)
    else if (ms <= nextMonthEnd) nextMonth.push(t)
    else beyond.push(t)
  }

  const groups: DashboardListGroup[] = []
  if (tomorrow.length > 0) groups.push({ key: 'tomorrow', label: 'Tomorrow', todos: tomorrow })
  if (thisWeek.length > 0) groups.push({ key: 'this-week', label: 'This week', todos: thisWeek })
  if (nextWeek.length > 0) groups.push({ key: 'next-week', label: 'Next week', todos: nextWeek })
  if (laterMonth.length > 0) groups.push({ key: 'later-month', label: 'Later this month', todos: laterMonth })
  if (nextMonth.length > 0) groups.push({ key: 'next-month', label: 'Next month', todos: nextMonth })
  if (beyond.length > 0) groups.push({ key: 'beyond', label: 'Beyond', todos: beyond })
  return groups
}

function bucketByDeadline(todos: PersistedTodoItem[], ctx: DashboardListsContext): DashboardListGroup[] {
  const today = startOfDay(ctx.today)
  const { base, thisWeekEnd, nextWeekEnd } = weekBoundaries(today)
  const tomorrowStart = base + MS_PER_DAY
  const thisMonthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0).getTime()

  const overdue: PersistedTodoItem[] = []
  const dueToday: PersistedTodoItem[] = []
  const thisWeek: PersistedTodoItem[] = []
  const nextWeek: PersistedTodoItem[] = []
  const thisMonth: PersistedTodoItem[] = []
  const later: PersistedTodoItem[] = []

  for (const t of todos) {
    const d = t.dueDate ? startOfDay(new Date(t.dueDate)) : null
    if (d === null) continue
    const ms = d.getTime()
    if (ms < base) overdue.push(t)
    else if (ms < tomorrowStart) dueToday.push(t)
    else if (ms <= thisWeekEnd) thisWeek.push(t)
    else if (ms <= nextWeekEnd) nextWeek.push(t)
    else if (ms <= thisMonthEnd) thisMonth.push(t)
    else later.push(t)
  }

  const groups: DashboardListGroup[] = []
  if (overdue.length > 0) groups.push({ key: 'overdue', label: 'Overdue', todos: overdue })
  if (dueToday.length > 0) groups.push({ key: 'today', label: 'Today', todos: dueToday })
  if (thisWeek.length > 0) groups.push({ key: 'this-week', label: 'This week', todos: thisWeek })
  if (nextWeek.length > 0) groups.push({ key: 'next-week', label: 'Next week', todos: nextWeek })
  if (thisMonth.length > 0) groups.push({ key: 'this-month', label: 'This month', todos: thisMonth })
  if (later.length > 0) groups.push({ key: 'later', label: 'Later', todos: later })
  return groups
}

function bucketByScheduled(todos: PersistedTodoItem[], ctx: DashboardListsContext): DashboardListGroup[] {
  const today = startOfDay(ctx.today)
  const { base, thisWeekEnd, nextWeekEnd } = weekBoundaries(today)
  const tomorrowEnd = base + MS_PER_DAY
  const thisMonthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0).getTime()
  const nextMonthEnd = new Date(today.getFullYear(), today.getMonth() + 2, 0).getTime()

  const noDate: PersistedTodoItem[] = []
  const tomorrow: PersistedTodoItem[] = []
  const thisWeek: PersistedTodoItem[] = []
  const nextWeek: PersistedTodoItem[] = []
  const laterMonth: PersistedTodoItem[] = []
  const nextMonth: PersistedTodoItem[] = []
  const beyond: PersistedTodoItem[] = []

  for (const t of todos) {
    const resolved = t.scheduledDate ? resolveScheduled(t.scheduledDate, today) : null
    if (!resolved) { noDate.push(t); continue }
    const ms = resolved.getTime()
    if (ms <= tomorrowEnd) tomorrow.push(t)
    else if (ms <= thisWeekEnd) thisWeek.push(t)
    else if (ms <= nextWeekEnd) nextWeek.push(t)
    else if (ms <= thisMonthEnd) laterMonth.push(t)
    else if (ms <= nextMonthEnd) nextMonth.push(t)
    else beyond.push(t)
  }

  const groups: DashboardListGroup[] = []
  if (tomorrow.length > 0) groups.push({ key: 'tomorrow', label: 'Tomorrow', todos: tomorrow })
  if (thisWeek.length > 0) groups.push({ key: 'this-week', label: 'This week', todos: thisWeek })
  if (nextWeek.length > 0) groups.push({ key: 'next-week', label: 'Next week', todos: nextWeek })
  if (laterMonth.length > 0) groups.push({ key: 'later-month', label: 'Later this month', todos: laterMonth })
  if (nextMonth.length > 0) groups.push({ key: 'next-month', label: 'Next month', todos: nextMonth })
  if (beyond.length > 0) groups.push({ key: 'beyond', label: 'Beyond', todos: beyond })
  if (noDate.length > 0) groups.push({ key: 'no-date', label: 'No scheduled date', todos: noDate })
  return groups
}

/**
 * Project bucketing — each todo lands in exactly one bucket based on
 * `todo.projectId`. Unassigned todos go to a trailing "No project" bucket.
 * Buckets enumerate from `ctx.projects` in registry order; empty buckets are
 * dropped. Mirrors `buildProjectSections` in ListView.
 */
function bucketByProject(
  todos: PersistedTodoItem[],
  ctx: DashboardListsContext,
): DashboardListGroup[] {
  const projects = ctx.projects ?? []
  const buckets = new Map<number, PersistedTodoItem[]>()
  for (const p of projects) if (p.id != null) buckets.set(p.id, [])
  const noProject: PersistedTodoItem[] = []

  for (const t of todos) {
    const bucket = t.projectId != null ? buckets.get(t.projectId) : undefined
    if (bucket) bucket.push(t)
    else noProject.push(t)
  }

  const groups: DashboardListGroup[] = []
  for (const p of projects) {
    const ts = p.id != null ? buckets.get(p.id)! : []
    if (ts.length > 0) groups.push({ key: `project-${p.id}`, label: p.name, todos: ts })
  }
  if (noProject.length > 0) groups.push({ key: 'no-project', label: 'No project', todos: noProject })
  return groups
}

/**
 * Status bucketing — each todo lands in exactly one bucket based on
 * `todo.statusId`. Unassigned todos go to a trailing "No status" bucket.
 * Buckets enumerate from `ctx.statuses` in registry `sortOrder`.
 */
function bucketByStatus(
  todos: PersistedTodoItem[],
  ctx: DashboardListsContext,
): DashboardListGroup[] {
  const statuses = [...(ctx.statuses ?? [])].sort(
    (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0),
  )
  const buckets = new Map<number, PersistedTodoItem[]>()
  for (const s of statuses) if (s.id != null) buckets.set(s.id, [])
  const noStatus: PersistedTodoItem[] = []

  for (const t of todos) {
    const bucket = t.statusId != null ? buckets.get(t.statusId) : undefined
    if (bucket) bucket.push(t)
    else noStatus.push(t)
  }

  const groups: DashboardListGroup[] = []
  for (const s of statuses) {
    const ts = s.id != null ? buckets.get(s.id)! : []
    if (ts.length > 0) groups.push({ key: `status-${s.id}`, label: s.name, todos: ts })
  }
  if (noStatus.length > 0) groups.push({ key: 'no-status', label: 'No status', todos: noStatus })
  return groups
}

/**
 * People bucketing — N-assignee todos land in all N buckets (many-to-many
 * via `ctx.assignedPeopleMap`). Unassigned todos go to a trailing "Unassigned"
 * bucket. Buckets enumerate from `ctx.people` in registry order.
 */
function bucketByPeople(
  todos: PersistedTodoItem[],
  ctx: DashboardListsContext,
): DashboardListGroup[] {
  const people = ctx.people ?? []
  const assignedPeopleMap = ctx.assignedPeopleMap
  const buckets = new Map<number, PersistedTodoItem[]>()
  for (const p of people) if (p.id != null) buckets.set(p.id, [])
  const unassigned: PersistedTodoItem[] = []

  for (const t of todos) {
    const assigned = assignedPeopleMap?.get(t.id) ?? []
    if (assigned.length === 0) { unassigned.push(t); continue }
    const seen = new Set<number>()
    let hit = false
    for (const p of assigned) {
      const id = p.id!
      if (seen.has(id)) continue
      seen.add(id)
      const bucket = buckets.get(id)
      if (bucket) { bucket.push(t); hit = true }
    }
    if (!hit) unassigned.push(t)
  }

  const groups: DashboardListGroup[] = []
  for (const p of people) {
    const ts = p.id != null ? buckets.get(p.id)! : []
    if (ts.length > 0) groups.push({ key: `person-${p.id}`, label: p.name, todos: ts })
  }
  if (unassigned.length > 0) groups.push({ key: 'unassigned', label: 'Unassigned', todos: unassigned })
  return groups
}

/**
 * Org bucketing — each todo's direct org assignments plus the orgs its
 * assigned people belong to (via `personOrgMap`), deduped. Todos with no
 * matched org go into a trailing "No organization" bucket.
 */
function bucketByOrg(
  todos: PersistedTodoItem[],
  ctx: DashboardListsContext,
): DashboardListGroup[] {
  const orgs = ctx.orgs ?? []
  const assignedPeopleMap = ctx.assignedPeopleMap
  const assignedOrgsMap = ctx.assignedOrgsMap
  const personOrgMap = ctx.personOrgMap
  const buckets = new Map<number, PersistedTodoItem[]>()
  for (const o of orgs) if (o.id != null) buckets.set(o.id, [])
  const noOrg: PersistedTodoItem[] = []

  for (const t of todos) {
    const matched = new Set<number>()
    const directOrgs = assignedOrgsMap?.get(t.id) ?? []
    for (const o of directOrgs) if (o.id != null && buckets.has(o.id)) matched.add(o.id)
    const assignedPeople = assignedPeopleMap?.get(t.id) ?? []
    for (const p of assignedPeople) {
      const pid = p.id
      if (pid == null) continue
      const personOrgs = personOrgMap?.get(pid) ?? []
      for (const oid of personOrgs) if (buckets.has(oid)) matched.add(oid)
    }
    if (matched.size === 0) noOrg.push(t)
    else for (const oid of matched) buckets.get(oid)!.push(t)
  }

  const groups: DashboardListGroup[] = []
  for (const o of orgs) {
    const ts = o.id != null ? buckets.get(o.id)! : []
    if (ts.length > 0) groups.push({ key: `org-${o.id}`, label: o.name, todos: ts })
  }
  if (noOrg.length > 0) groups.push({ key: 'no-org', label: 'No organization', todos: noOrg })
  return groups
}

/**
 * Tag buckets — N-tag todos land in all N buckets (many-to-many). Untagged
 * todos go into a trailing "No tag" bucket. Buckets sort alphabetically by
 * registry name. Parallels `buildTagSections` in ListView so widget +
 * ListView grouping stays consistent; reads from `ctx.assignedTagsMap`
 * rather than the (transient) inline `todo.tags` string bag.
 */
function bucketByTag(
  todos: PersistedTodoItem[],
  ctx: DashboardListsContext,
): DashboardListGroup[] {
  const assignedTagsMap = ctx.assignedTagsMap
  const buckets = new Map<number, { tag: Tag; todos: PersistedTodoItem[] }>()
  const untagged: PersistedTodoItem[] = []

  for (const t of todos) {
    const assigned = assignedTagsMap?.get(t.id) ?? []
    if (assigned.length === 0) { untagged.push(t); continue }
    const seen = new Set<number>()
    for (const tg of assigned) {
      const id = tg.id!
      if (seen.has(id)) continue
      seen.add(id)
      let entry = buckets.get(id)
      if (!entry) {
        entry = { tag: tg, todos: [] }
        buckets.set(id, entry)
      }
      entry.todos.push(t)
    }
  }

  const sortedEntries = [...buckets.values()].sort((a, b) =>
    a.tag.name.localeCompare(b.tag.name),
  )
  const groups: DashboardListGroup[] = sortedEntries.map(({ tag, todos }) => ({
    key: `tag-${tag.id}`,
    label: `#${tag.name}`,
    todos,
  }))
  if (untagged.length > 0) groups.push({ key: 'no-tag', label: 'No tag', todos: untagged })
  return groups
}
