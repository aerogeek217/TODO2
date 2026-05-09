import type {
  PersistedTodoItem,
  TodoPredicate,
  Person,
  Org,
  Project,
  Status,
  Tag,
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
  UNTAGGED_BUCKET_KEY,
  UNTAGGED_BUCKET_LABEL,
} from '../utils/bucket-by-tag'
import { bucketByDate, type DateBucketKey } from '../utils/bucket-by-date'
import { partitionByGroup, type GroupingContext } from '../utils/task-grouping'

export interface DashboardListsContext {
  today: Date
  /** Settings-driven week boundary used by every relative-date bucketer. */
  weekStartsOn: WeekStart
  /**
   * Evaluator for `{kind:'custom', predicate}` membership; closes over
   * assignment maps + statuses. Omitted → custom def matches no todos
   * with a once-per-build warning.
   */
  evalPredicate?: (predicate: TodoPredicate, todo: PersistedTodoItem) => boolean
  /** Required for `{kind:'by-tag'}` grouping; caller threads in registry + assignments. */
  assignedTagsMap?: Map<number, Tag[]>
  /** For `by-field` people/org bucketing. Missing → "Unassigned" / "No organization". */
  assignedPeopleMap?: Map<number, Person[]>
  assignedOrgsMap?: Map<number, Org[]>
  /** Person→org membership bridge for `by-field: 'org'`. */
  personOrgMap?: Map<number, number[]>
  /** Registries used to enumerate + label categorical buckets. */
  people?: Person[]
  orgs?: Org[]
  projects?: Project[]
  statuses?: Status[]
  /**
   * Per-definition runtime-filter picks keyed by def id. Missing key → list
   * returns `todos: []` + `runtimeFilterUnset: true` (surface renders a
   * "Pick a {label}…" placeholder). Empty array → no-op (predicate passes
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
 * Per-call grouping restrict args. Visible-groups intersection rule (P7):
 * narrow grouping to picked ids and tier-order direct→implicit so a multi-
 * assignee task surviving membership filter doesn't emit non-picked sections.
 */
export interface DashboardListGroupingRestrict {
  /** Non-empty → narrow `bucketByPeople` to these ids in tier-order direct→implicit. */
  restrictToPersonIds?: ReadonlyArray<number> | null
  /** Symmetric to `restrictToPersonIds` for `bucketByOrg`. */
  restrictToOrgIds?: ReadonlyArray<number> | null
  /** Symmetric for `bucketByTag` — untagged bucket suppressed in restrict mode. */
  restrictToTagIds?: ReadonlyArray<number> | null
  /** Cross-axis lookup for `bucketByPeople`; consulted only when person predicate is `'include-orgs'`. */
  implicitPersonIdsFor?: (todo: PersistedTodoItem) => readonly number[]
  /** Symmetric for `bucketByOrg` (`'include-people'`). */
  implicitOrgIdsFor?: (todo: PersistedTodoItem) => readonly number[]
}

/**
 * Narrow `field` to `values` (OR-combined). Empty `values` is a no-op so
 * "user cleared all chips" doesn't short-circuit to "match nothing". For
 * `person`/`org` hard-codes `*FilterMode = 'direct-only'` (the runtime picker
 * has no UI for the toggle).
 */
export function applyRuntimeFilter(
  predicate: TodoPredicate,
  spec: RuntimeFilterSpec,
  values: number[],
): TodoPredicate {
  if (values.length === 0) return predicate
  switch (spec.field) {
    case 'person': return { ...predicate, personIds: values, personFilterMode: 'direct-only' }
    case 'org': return { ...predicate, orgIds: values, orgFilterMode: 'direct-only' }
    case 'project': return { ...predicate, projectIds: values }
    case 'status': return { ...predicate, statusIds: values }
    case 'tag': return { ...predicate, tags: values }
  }
}

/**
 * Harvest restrict args from def's effective predicate. Implicit-tier
 * callbacks gated on `personFilterMode === 'include-orgs'` /
 * `orgFilterMode === 'include-people'`.
 */
function computeGroupingRestrict(
  def: PersistedListDefinition,
  ctx: DashboardListsContext,
): DashboardListGroupingRestrict | undefined {
  if (def.membership.kind !== 'custom') return undefined
  const predicate = def.membership.predicate
  const restrictToPersonIds = predicate.personIds ?? null
  const restrictToOrgIds = predicate.orgIds ?? null
  const restrictToTagIds = predicate.tags ?? null
  if (!restrictToPersonIds && !restrictToOrgIds && !restrictToTagIds) return undefined

  const { assignedOrgsMap, assignedPeopleMap, personOrgMap } = ctx

  const implicitPersonIdsFor =
    predicate.personFilterMode === 'include-orgs' && assignedOrgsMap && personOrgMap
      ? (todo: PersistedTodoItem): readonly number[] => {
          const orgIdSet = new Set<number>()
          for (const o of assignedOrgsMap.get(todo.id) ?? []) {
            if (o.id != null) orgIdSet.add(o.id)
          }
          if (orgIdSet.size === 0) return []
          // personOrgMap is iterated once per pid, so no dedupe needed.
          const memberIds: number[] = []
          for (const [pid, orgIds] of personOrgMap) {
            if (orgIds.some((oid) => orgIdSet.has(oid))) memberIds.push(pid)
          }
          return memberIds
        }
      : undefined

  const implicitOrgIdsFor =
    predicate.orgFilterMode === 'include-people' && assignedPeopleMap && personOrgMap
      ? (todo: PersistedTodoItem): readonly number[] => {
          const orgIds: number[] = []
          const seen = new Set<number>()
          for (const p of assignedPeopleMap.get(todo.id) ?? []) {
            if (p.id == null) continue
            for (const oid of personOrgMap.get(p.id) ?? []) {
              if (!seen.has(oid)) { seen.add(oid); orgIds.push(oid) }
            }
          }
          return orgIds
        }
      : undefined

  return {
    restrictToPersonIds,
    restrictToOrgIds,
    restrictToTagIds,
    implicitPersonIdsFor,
    implicitOrgIdsFor,
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
    const groupingRestrict = runtimeFilterUnset
      ? undefined
      : computeGroupingRestrict(effectiveDef, ctx)
    const groups = runtimeFilterUnset
      ? undefined
      : interpretGrouping(effectiveDef.grouping, sorted, ctx, groupingRestrict)
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

let warnedMissingEvaluator = false
export function interpretMembership(m: ListMembership, t: PersistedTodoItem, ctx: DashboardListsContext): boolean {
  if (!ctx.evalPredicate) {
    if (!warnedMissingEvaluator) {
      warnedMissingEvaluator = true
      console.warn('dashboard-lists: custom-membership list found but ctx.evalPredicate was not supplied; matching zero todos.')
    }
    return false
  }
  return ctx.evalPredicate(m.predicate, t)
}

export function interpretSort(s: ListSort, a: PersistedTodoItem, b: PersistedTodoItem, ctx: DashboardListsContext): number {
  switch (s) {
    case 'date':      return compareEffectiveDateAsc(a, b, ctx)
    case 'scheduled': return compareScheduledAsc(a, b, ctx)
    case 'deadline':  return compareDeadlineAsc(a, b)
    case 'manual': case 'name': case 'created': case 'people':
    case 'project': case 'org': case 'status':
      return compareSortOrder(a, b)
  }
}

const compareSortOrder = (a: PersistedTodoItem, b: PersistedTodoItem): number =>
  ((a.sortOrder ?? 0) - (b.sortOrder ?? 0)) || (a.id - b.id)

function compareNullableDates(ad: Date | null, bd: Date | null, a: PersistedTodoItem, b: PersistedTodoItem): number {
  if (ad === null && bd === null) return compareSortOrder(a, b)
  if (ad === null) return 1
  if (bd === null) return -1
  return (ad.getTime() - bd.getTime()) || compareSortOrder(a, b)
}

function compareEffectiveDateAsc(a: PersistedTodoItem, b: PersistedTodoItem, ctx: DashboardListsContext): number {
  const today = startOfDay(ctx.today)
  const ws = ctx.weekStartsOn
  const aExp = isScheduledExpired(a, today, ws)
  const bExp = isScheduledExpired(b, today, ws)
  if (aExp !== bExp) return aExp ? -1 : 1
  return compareNullableDates(effectiveDate(a, today, ws), effectiveDate(b, today, ws), a, b)
}

function compareScheduledAsc(a: PersistedTodoItem, b: PersistedTodoItem, ctx: DashboardListsContext): number {
  const today = startOfDay(ctx.today)
  const ws = ctx.weekStartsOn
  const as = a.scheduledDate ? resolveScheduled(a.scheduledDate, today, ws) : null
  const bs = b.scheduledDate ? resolveScheduled(b.scheduledDate, today, ws) : null
  return compareNullableDates(as, bs, a, b)
}

function compareDeadlineAsc(a: PersistedTodoItem, b: PersistedTodoItem): number {
  const ad = a.dueDate ? startOfDay(new Date(a.dueDate)) : null
  const bd = b.dueDate ? startOfDay(new Date(b.dueDate)) : null
  return compareNullableDates(ad, bd, a, b)
}

export function interpretGrouping(
  g: ListGrouping,
  todos: PersistedTodoItem[],
  ctx: DashboardListsContext,
  restrict?: DashboardListGroupingRestrict,
): DashboardListGroup[] | undefined {
  switch (g) {
    case 'none':      return undefined
    case 'date':      return bucketByEffective(todos, ctx)
    case 'scheduled': return bucketByScheduled(todos, ctx)
    case 'deadline':  return bucketByDeadline(todos, ctx)
    case 'project':   return bucketByProject(todos, ctx)
    case 'status':    return bucketByStatus(todos, ctx)
    case 'people':    return bucketByPeople(todos, ctx, restrict)
    case 'org':       return bucketByOrg(todos, ctx, restrict)
    case 'tag':       return bucketByTag(todos, ctx, restrict)
  }
}

const DATE_BUCKET_META: Record<DateBucketKey, { key: string; label: string }> = {
  overdue:    { key: 'overdue',     label: 'Overdue' },
  today:      { key: 'today',       label: 'Today' },
  tomorrow:   { key: 'tomorrow',    label: 'Tomorrow' },
  thisWeek:   { key: 'this-week',   label: 'This week' },
  nextWeek:   { key: 'next-week',   label: 'Next week' },
  thisMonth:  { key: 'this-month',  label: 'This month' },
  laterMonth: { key: 'later-month', label: 'Later this month' },
  nextMonth:  { key: 'next-month',  label: 'Next month' },
  later:      { key: 'later',       label: 'Later' },
  beyond:     { key: 'beyond',      label: 'Beyond' },
}

const EFFECTIVE_WINDOWS: readonly DateBucketKey[] = [
  'tomorrow', 'thisWeek', 'nextWeek', 'laterMonth', 'nextMonth', 'beyond',
]
const DEADLINE_WINDOWS: readonly DateBucketKey[] = [
  'overdue', 'today', 'thisWeek', 'nextWeek', 'thisMonth', 'later',
]
const SCHEDULED_WINDOWS = EFFECTIVE_WINDOWS

/**
 * Shared body for the 3 date bucketers. Resolves the day-anchor + week-start,
 * runs `bucketByDate`, maps buckets to dashboard groups; caller appends or
 * folds the no-date tail.
 */
function buildDateGroups(
  todos: PersistedTodoItem[],
  ctx: DashboardListsContext,
  windows: readonly DateBucketKey[],
  getDate: (t: PersistedTodoItem, today: Date, ws: WeekStart) => Date | null,
): { groups: DashboardListGroup[]; noDate: PersistedTodoItem[] } {
  const today = startOfDay(ctx.today)
  const ws = ctx.weekStartsOn
  const { buckets, noDate } = bucketByDate(todos, (t) => getDate(t, today, ws), today, ws, windows)
  const groups: DashboardListGroup[] = buckets.map((b) => ({ ...DATE_BUCKET_META[b.key], todos: b.todos }))
  return { groups, noDate }
}

function bucketByEffective(todos: PersistedTodoItem[], ctx: DashboardListsContext): DashboardListGroup[] {
  const { groups, noDate } = buildDateGroups(todos, ctx, EFFECTIVE_WINDOWS, (t, today, ws) => effectiveDate(t, today, ws))
  // No-date todos fold into 'beyond' (semantically Someday).
  if (noDate.length > 0) {
    const beyond = groups.find((g) => g.key === DATE_BUCKET_META.beyond.key)
    if (beyond) beyond.todos.push(...noDate)
    else groups.push({ ...DATE_BUCKET_META.beyond, todos: noDate })
  }
  return groups
}

function bucketByDeadline(todos: PersistedTodoItem[], ctx: DashboardListsContext): DashboardListGroup[] {
  const { groups, noDate } = buildDateGroups(todos, ctx, DEADLINE_WINDOWS,
    (t) => t.dueDate ? startOfDay(new Date(t.dueDate)) : null)
  if (noDate.length > 0) groups.push({ key: 'no-deadline', label: 'No deadline', todos: noDate })
  return groups
}

function bucketByScheduled(todos: PersistedTodoItem[], ctx: DashboardListsContext): DashboardListGroup[] {
  const { groups, noDate } = buildDateGroups(todos, ctx, SCHEDULED_WINDOWS,
    (t, today, ws) => t.scheduledDate ? resolveScheduled(t.scheduledDate, today, ws) : null)
  if (noDate.length > 0) groups.push({ key: 'no-date', label: 'No scheduled date', todos: noDate })
  return groups
}

function dashboardGroupingContext(ctx: DashboardListsContext): GroupingContext {
  return {
    assignedPeopleMap: ctx.assignedPeopleMap ?? new Map(),
    assignedOrgsMap: ctx.assignedOrgsMap ?? new Map(),
    assignedTagsMap: ctx.assignedTagsMap ?? new Map(),
    statuses: ctx.statuses ?? [],
    orgs: ctx.orgs ?? [],
    personOrgMap: ctx.personOrgMap ?? new Map(),
    projects: ctx.projects ?? [],
    today: startOfDay(ctx.today),
    weekStartsOn: ctx.weekStartsOn,
  }
}

/** Project bucketing — adapter over `partitionByGroup` (registry sortOrder). */
function bucketByProject(
  todos: PersistedTodoItem[],
  ctx: DashboardListsContext,
): DashboardListGroup[] {
  const groupingCtx = dashboardGroupingContext(ctx)
  const { groups, ungrouped } = partitionByGroup(todos, 'project', groupingCtx)
  const projectsById = new Map((ctx.projects ?? []).map((p) => [p.id, p] as const))
  const out: DashboardListGroup[] = groups.map((g) => {
    const id = Number(g.key.slice('project-'.length))
    return { key: g.key, label: projectsById.get(id)?.name ?? '', todos: g.todos }
  })
  if (ungrouped.length > 0) out.push({ key: 'no-project', label: 'No project', todos: ungrouped })
  return out
}

/** Status bucketing — adapter over `partitionByGroup` (registry sortOrder). */
function bucketByStatus(
  todos: PersistedTodoItem[],
  ctx: DashboardListsContext,
): DashboardListGroup[] {
  const groupingCtx = dashboardGroupingContext(ctx)
  const { groups, ungrouped } = partitionByGroup(todos, 'status', groupingCtx)
  const out: DashboardListGroup[] = groups.map((g) => ({ key: g.key, label: g.label, todos: g.todos }))
  if (ungrouped.length > 0) out.push({ key: 'no-status', label: 'No status', todos: ungrouped })
  return out
}

/**
 * Generic adapter for people/org/tag. Resolves labels from `registry` so
 * restrict-mode implicit-tier emits still get names. Restrict mode drops
 * `ungrouped` (axis-mismatched tasks shouldn't surface as the sentinel).
 */
function bucketByEntity(
  todos: PersistedTodoItem[],
  ctx: DashboardListsContext,
  axis: 'people' | 'org' | 'tag',
  prefix: 'person-' | 'org-' | 'tag-',
  registry: ReadonlyArray<{ id?: number; name: string }>,
  options: {
    restrictIds?: ReadonlyArray<number> | null
    implicitIdsFor?: (todo: PersistedTodoItem) => readonly number[]
    formatLabel: (name: string) => string
    ungroupedSentinel: { key: string; label: string }
  },
): DashboardListGroup[] {
  const restrictIds =
    options.restrictIds && options.restrictIds.length > 0 ? options.restrictIds : null

  const groupingCtx = dashboardGroupingContext(ctx)

  const restrictToFilterSet = restrictIds
    ? restrictIds.map((id) => `${prefix}${id}`)
    : undefined

  const implicitIdsFor = options.implicitIdsFor
  const implicitKeysFor =
    restrictIds && implicitIdsFor
      ? (todo: PersistedTodoItem): readonly string[] =>
          implicitIdsFor(todo).map((id) => `${prefix}${id}`)
      : undefined

  const { groups, ungrouped } = partitionByGroup(
    todos, axis, groupingCtx,
    undefined, restrictToFilterSet, implicitKeysFor,
  )

  const registryById = new Map(registry.map((e) => [e.id, e] as const))

  const out: DashboardListGroup[] = groups.map((g) => {
    const id = Number(g.key.slice(prefix.length))
    const name = registryById.get(id)?.name ?? g.label
    return { key: g.key, label: options.formatLabel(name), todos: g.todos }
  })

  if (!restrictIds && ungrouped.length > 0) {
    out.push({ ...options.ungroupedSentinel, todos: ungrouped })
  }
  return out
}

function bucketByPeople(
  todos: PersistedTodoItem[],
  ctx: DashboardListsContext,
  restrict?: DashboardListGroupingRestrict,
): DashboardListGroup[] {
  return bucketByEntity(todos, ctx, 'people', 'person-', ctx.people ?? [], {
    restrictIds: restrict?.restrictToPersonIds,
    implicitIdsFor: restrict?.implicitPersonIdsFor,
    formatLabel: (name) => name,
    ungroupedSentinel: { key: 'unassigned', label: 'Unassigned' },
  })
}

function bucketByOrg(
  todos: PersistedTodoItem[],
  ctx: DashboardListsContext,
  restrict?: DashboardListGroupingRestrict,
): DashboardListGroup[] {
  return bucketByEntity(todos, ctx, 'org', 'org-', ctx.orgs ?? [], {
    restrictIds: restrict?.restrictToOrgIds,
    implicitIdsFor: restrict?.implicitOrgIdsFor,
    formatLabel: (name) => name,
    ungroupedSentinel: { key: 'no-org', label: 'No organization' },
  })
}

function bucketByTag(
  todos: PersistedTodoItem[],
  ctx: DashboardListsContext,
  restrict?: DashboardListGroupingRestrict,
): DashboardListGroup[] {
  // No tag registry on ctx — labels come from `g.label` (resolved via
  // assignedTagsMap). Tags have no cross-axis path, so no implicitIdsFor.
  return bucketByEntity(todos, ctx, 'tag', 'tag-', [], {
    restrictIds: restrict?.restrictToTagIds,
    formatLabel: (name) => `#${name}`,
    ungroupedSentinel: { key: UNTAGGED_BUCKET_KEY, label: UNTAGGED_BUCKET_LABEL },
  })
}
