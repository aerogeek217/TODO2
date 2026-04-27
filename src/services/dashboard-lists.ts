import type {
  PersistedTodoItem,
  TodoPredicate,
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
import {
  effectiveDate,
  isScheduledExpired,
  resolveScheduled,
  type WeekStart,
} from '../utils/effective-date'
import { startOfDay } from '../utils/date'
import {
  bucketByTag as bucketByTagUtil,
  UNTAGGED_BUCKET_KEY,
  UNTAGGED_BUCKET_LABEL,
} from '../utils/bucket-by-tag'
import { bucketByDate, type DateBucketKey } from '../utils/bucket-by-date'
import { bucketByMany } from '../utils/bucket-by-many'

export interface DashboardListsContext {
  today: Date
  /** Settings-driven week boundary used by every relative-date bucketer. */
  weekStartsOn: WeekStart
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
   * merges it into the predicate as a multi-value OR before membership is
   * evaluated. A missing key means the user has not picked yet — the list
   * returns with `todos: []` and `runtimeFilterUnset: true` so the surface can
   * render a "Pick a {label} to populate…" placeholder instead of an empty
   * state. An empty array is treated as a no-op (helper passes the predicate
   * through unchanged) — matches "user cleared all chips" UX.
   */
  runtimeFilterValues?: ReadonlyMap<number, number[]>
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
 * Return a new predicate that narrows the given field to the supplied ids
 * (OR-combined). Replaces any existing id filter on that field — the runtime
 * pick is authoritative for the prompted field. Other clauses are preserved so
 * the def's baseline predicate (status / date window / etc.) still applies.
 *
 * An empty `values` array is a no-op: the predicate is returned unchanged so
 * "user cleared all chips" doesn't short-circuit the list to "match nothing"
 * (that would be the semantics of writing an empty id array into the
 * predicate). Callers that want "show no rows when the filter is unset" must
 * gate on the absence of a pick (see `buildDashboardLists` →
 * `runtimeFilterUnset`).
 */
export function applyRuntimeFilter(
  predicate: TodoPredicate,
  spec: RuntimeFilterSpec,
  values: number[],
): TodoPredicate {
  if (values.length === 0) return predicate
  switch (spec.field) {
    case 'person': return { ...predicate, personIds: values }
    case 'org': return { ...predicate, orgIds: values }
    case 'project': return { ...predicate, projectIds: values }
    case 'status': return { ...predicate, statusIds: values }
    case 'tag': return { ...predicate, tags: values }
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
  switch (s) {
    case 'date':
      return compareEffectiveDateAsc(a, b, ctx)
    case 'scheduled':
      return compareScheduledAsc(a, b, ctx)
    case 'deadline':
      return compareDeadlineAsc(a, b)
    case 'manual':
    case 'name':
    case 'created':
    case 'people':
    case 'project':
    case 'org':
    case 'status':
      return compareSortOrder(a, b)
  }
}

function compareEffectiveDateAsc(a: PersistedTodoItem, b: PersistedTodoItem, ctx: DashboardListsContext): number {
  const today = startOfDay(ctx.today)
  const ws = ctx.weekStartsOn
  const aExpired = isScheduledExpired(a, today, ws)
  const bExpired = isScheduledExpired(b, today, ws)
  if (aExpired !== bExpired) return aExpired ? -1 : 1

  const ad = effectiveDate(a, today, ws)
  const bd = effectiveDate(b, today, ws)
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
  const ws = ctx.weekStartsOn
  const as = a.scheduledDate ? resolveScheduled(a.scheduledDate, today, ws) : null
  const bs = b.scheduledDate ? resolveScheduled(b.scheduledDate, today, ws) : null
  if (as === null && bs === null) return ((a.sortOrder ?? 0) - (b.sortOrder ?? 0)) || (a.id - b.id)
  if (as === null) return 1
  if (bs === null) return -1
  const cmp = as.getTime() - bs.getTime()
  if (cmp !== 0) return cmp
  return ((a.sortOrder ?? 0) - (b.sortOrder ?? 0)) || (a.id - b.id)
}

export function interpretGrouping(
  g: ListGrouping,
  _sort: ListSort,
  todos: PersistedTodoItem[],
  ctx: DashboardListsContext,
): DashboardListGroup[] | undefined {
  switch (g) {
    case 'none':
      return undefined
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
    case 'tag':
      return bucketByTag(todos, ctx)
  }
}


const DASHBOARD_BUCKET_KEYS: Record<DateBucketKey, string> = {
  overdue: 'overdue',
  today: 'today',
  tomorrow: 'tomorrow',
  thisWeek: 'this-week',
  nextWeek: 'next-week',
  thisMonth: 'this-month',
  laterMonth: 'later-month',
  nextMonth: 'next-month',
  later: 'later',
  beyond: 'beyond',
}

const DASHBOARD_BUCKET_LABELS: Record<DateBucketKey, string> = {
  overdue: 'Overdue',
  today: 'Today',
  tomorrow: 'Tomorrow',
  thisWeek: 'This week',
  nextWeek: 'Next week',
  thisMonth: 'This month',
  laterMonth: 'Later this month',
  nextMonth: 'Next month',
  later: 'Later',
  beyond: 'Beyond',
}

function toGroups(
  buckets: { key: DateBucketKey; todos: PersistedTodoItem[] }[],
): DashboardListGroup[] {
  return buckets.map((b) => ({
    key: DASHBOARD_BUCKET_KEYS[b.key],
    label: DASHBOARD_BUCKET_LABELS[b.key],
    todos: b.todos,
  }))
}

const EFFECTIVE_WINDOWS: readonly DateBucketKey[] = [
  'tomorrow', 'thisWeek', 'nextWeek', 'laterMonth', 'nextMonth', 'beyond',
]
const DEADLINE_WINDOWS: readonly DateBucketKey[] = [
  'overdue', 'today', 'thisWeek', 'nextWeek', 'thisMonth', 'later',
]
const SCHEDULED_WINDOWS = EFFECTIVE_WINDOWS

function bucketByEffective(todos: PersistedTodoItem[], ctx: DashboardListsContext): DashboardListGroup[] {
  const today = startOfDay(ctx.today)
  const ws = ctx.weekStartsOn
  const { buckets, noDate } = bucketByDate(
    todos,
    (t) => effectiveDate(t, today, ws),
    today,
    ws,
    EFFECTIVE_WINDOWS,
  )
  const groups = toGroups(buckets)
  // Effective-date bucketing folds null-date todos into the trailing 'beyond'
  // bucket — they have neither scheduled nor deadline, so semantically they
  // are "Someday / no specific date" which the surface renders as Beyond.
  if (noDate.length > 0) {
    const beyond = groups.find((g) => g.key === 'beyond')
    if (beyond) beyond.todos.push(...noDate)
    else groups.push({
      key: DASHBOARD_BUCKET_KEYS.beyond,
      label: DASHBOARD_BUCKET_LABELS.beyond,
      todos: noDate,
    })
  }
  return groups
}

function bucketByDeadline(todos: PersistedTodoItem[], ctx: DashboardListsContext): DashboardListGroup[] {
  const today = startOfDay(ctx.today)
  const ws = ctx.weekStartsOn
  const { buckets, noDate } = bucketByDate(
    todos,
    (t) => t.dueDate ? startOfDay(new Date(t.dueDate)) : null,
    today,
    ws,
    DEADLINE_WINDOWS,
  )
  const groups = toGroups(buckets)
  if (noDate.length > 0) groups.push({ key: 'no-deadline', label: 'No deadline', todos: noDate })
  return groups
}

function bucketByScheduled(todos: PersistedTodoItem[], ctx: DashboardListsContext): DashboardListGroup[] {
  const today = startOfDay(ctx.today)
  const ws = ctx.weekStartsOn
  const { buckets, noDate } = bucketByDate(
    todos,
    (t) => t.scheduledDate ? resolveScheduled(t.scheduledDate, today, ws) : null,
    today,
    ws,
    SCHEDULED_WINDOWS,
  )
  const groups = toGroups(buckets)
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
 * bucket. Buckets enumerate from `ctx.people` in registry order. Shares
 * `bucketByMany` with task-grouping's people branch.
 */
function bucketByPeople(
  todos: PersistedTodoItem[],
  ctx: DashboardListsContext,
): DashboardListGroup[] {
  const { buckets, unassigned } = bucketByMany(todos, ctx.people ?? [], ctx.assignedPeopleMap)
  const groups: DashboardListGroup[] = buckets.map((b) => ({
    key: `person-${b.entity.id}`,
    label: b.entity.name,
    todos: b.todos,
  }))
  if (unassigned.length > 0) groups.push({ key: 'unassigned', label: 'Unassigned', todos: unassigned })
  return groups
}

/**
 * Org bucketing — each todo's direct org assignments plus the orgs its
 * assigned people belong to (via `personOrgMap`), deduped. Todos with no
 * matched org go into a trailing "No organization" bucket. Direct-org +
 * inferred-via-person fall together so the bucketByMany helper isn't a clean
 * fit; the inline walk stays here.
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
 * rather than the (transient) inline `todo.tags` string bag. Bucketing
 * logic is shared with `ListView.buildTagSections` via `utils/bucket-by-tag`.
 */
function bucketByTag(
  todos: PersistedTodoItem[],
  ctx: DashboardListsContext,
): DashboardListGroup[] {
  const { tagged, untagged } = bucketByTagUtil(todos, ctx.assignedTagsMap)
  const groups: DashboardListGroup[] = tagged.map(({ tag, todos: ts }) => ({
    key: `tag-${tag.id}`,
    label: `#${tag.name}`,
    todos: ts,
  }))
  if (untagged.length > 0) {
    groups.push({ key: UNTAGGED_BUCKET_KEY, label: UNTAGGED_BUCKET_LABEL, todos: untagged })
  }
  return groups
}
