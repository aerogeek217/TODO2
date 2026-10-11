import type {
  PersistedTodoItem,
  TodoPredicate,
  Person,
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
  compareTodosByDate,
  type WeekStart,
} from '../utils/effective-date'
import { startOfDay } from '../utils/date'
import {
  UNTAGGED_BUCKET_KEY,
  UNTAGGED_BUCKET_LABEL,
} from '../utils/bucket-by-tag'
import { bucketByDate, type DateBucketKey } from '../utils/bucket-by-date'
import { partitionByGroup, type GroupingContext } from '../utils/task-grouping'
import { bySortOrder } from '../utils/sort-order'

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
  /** For people bucketing. Missing → "Unassigned". */
  assignedPeopleMap?: Map<number, Person[]>
  /** Registries used to enumerate + label categorical buckets. */
  people?: Person[]
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
 * Per-call grouping restrict args. Visible-groups intersection rule: narrow
 * grouping to the filter's picked ids so a multi-assignee task surviving the
 * membership filter doesn't emit non-picked sections.
 */
export interface DashboardListGroupingRestrict {
  /** Non-empty → narrow `bucketByPeople` to these ids, in this order. */
  restrictToPersonIds?: ReadonlyArray<number> | null
  /** Same for `bucketByTag` — untagged bucket suppressed in restrict mode. */
  restrictToTagIds?: ReadonlyArray<number> | null
}

/**
 * Narrow `field` to `values` (OR-combined). Empty `values` is a no-op so
 * "user cleared all chips" doesn't short-circuit to "match nothing".
 */
export function applyRuntimeFilter(
  predicate: TodoPredicate,
  spec: RuntimeFilterSpec,
  values: number[],
): TodoPredicate {
  if (values.length === 0) return predicate
  switch (spec.field) {
    case 'person': return { ...predicate, personIds: values }
    case 'project': return { ...predicate, projectIds: values }
    case 'status': return { ...predicate, statusIds: values }
    case 'tag': return { ...predicate, tags: values }
  }
}

/** Harvest restrict args from def's effective predicate. */
function computeGroupingRestrict(
  def: PersistedListDefinition,
): DashboardListGroupingRestrict | undefined {
  if (def.membership.kind !== 'custom') return undefined
  const predicate = def.membership.predicate
  const restrictToPersonIds = predicate.personIds ?? null
  const restrictToTagIds = predicate.tags ?? null
  if (!restrictToPersonIds && !restrictToTagIds) return undefined
  return { restrictToPersonIds, restrictToTagIds }
}

export function buildDashboardLists(
  definitions: PersistedListDefinition[],
  todos: PersistedTodoItem[],
  ctx: DashboardListsContext,
): DashboardList[] {
  const ordered = [...definitions].sort(bySortOrder)
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
    const sorted = [...members].sort((a, b) => interpretSort(effectiveDef.sort, a, b))
    const groupingRestrict = runtimeFilterUnset
      ? undefined
      : computeGroupingRestrict(effectiveDef)
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

export function interpretSort(s: ListSort, a: PersistedTodoItem, b: PersistedTodoItem): number {
  switch (s) {
    case 'deadline':  return compareTodosByDate('deadline')(a, b)
    case 'followup':  return compareTodosByDate('followup')(a, b)
    case 'manual': case 'name': case 'created': case 'people':
    case 'project': case 'status':
      return bySortOrder(a, b)
  }
}

export function interpretGrouping(
  g: ListGrouping,
  todos: PersistedTodoItem[],
  ctx: DashboardListsContext,
  restrict?: DashboardListGroupingRestrict,
): DashboardListGroup[] | undefined {
  switch (g) {
    case 'none':      return undefined
    case 'deadline':  return bucketByDeadline(todos, ctx)
    case 'followup':  return bucketByFollowup(todos, ctx)
    case 'project':   return bucketByProject(todos, ctx)
    case 'status':    return bucketByStatus(todos, ctx)
    case 'people':    return bucketByPeople(todos, ctx, restrict)
    case 'tag':       return bucketByTag(todos, ctx, restrict)
  }
}

const DATE_BUCKET_META: Record<DateBucketKey, { key: string; label: string }> = {
  overdue:    { key: 'overdue',     label: 'Overdue' },
  today:      { key: 'today',       label: 'Today' },
  thisWeek:   { key: 'this-week',   label: 'This week' },
  nextWeek:   { key: 'next-week',   label: 'Next week' },
  thisMonth:  { key: 'this-month',  label: 'This month' },
  later:      { key: 'later',       label: 'Later' },
}

const DEADLINE_WINDOWS: readonly DateBucketKey[] = [
  'overdue', 'today', 'thisWeek', 'nextWeek', 'thisMonth', 'later',
]
/** ListView's date vocabulary: Overdue / Today / This week / Later (+ No follow-up). */
const FOLLOWUP_WINDOWS: readonly DateBucketKey[] = ['overdue', 'today', 'thisWeek', 'later']

/**
 * Shared body for the date bucketers. Resolves the day-anchor + week-start,
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

function bucketByDeadline(todos: PersistedTodoItem[], ctx: DashboardListsContext): DashboardListGroup[] {
  const { groups, noDate } = buildDateGroups(todos, ctx, DEADLINE_WINDOWS,
    (t) => t.dueDate ? startOfDay(new Date(t.dueDate)) : null)
  if (noDate.length > 0) groups.push({ key: 'no-deadline', label: 'No due date', todos: noDate })
  return groups
}

function bucketByFollowup(todos: PersistedTodoItem[], ctx: DashboardListsContext): DashboardListGroup[] {
  const { groups, noDate } = buildDateGroups(todos, ctx, FOLLOWUP_WINDOWS,
    (t) => t.nextFollowupAt ? startOfDay(new Date(t.nextFollowupAt)) : null)
  if (noDate.length > 0) groups.push({ key: 'no-followup', label: 'No follow-up', todos: noDate })
  return groups
}

function dashboardGroupingContext(ctx: DashboardListsContext): GroupingContext {
  return {
    assignedPeopleMap: ctx.assignedPeopleMap ?? new Map(),
    assignedTagsMap: ctx.assignedTagsMap ?? new Map(),
    statuses: ctx.statuses ?? [],
    projects: ctx.projects ?? [],
    today: startOfDay(ctx.today),
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
 * Generic adapter for people/tag. Resolves labels from `registry` when one is
 * given. Restrict mode drops `ungrouped` (axis-mismatched tasks shouldn't
 * surface as the sentinel).
 */
function bucketByEntity(
  todos: PersistedTodoItem[],
  ctx: DashboardListsContext,
  axis: 'people' | 'tag',
  prefix: 'person-' | 'tag-',
  registry: ReadonlyArray<{ id?: number; name: string }>,
  options: {
    restrictIds?: ReadonlyArray<number> | null
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

  const { groups, ungrouped } = partitionByGroup(
    todos, axis, groupingCtx,
    undefined, restrictToFilterSet,
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
    formatLabel: (name) => name,
    ungroupedSentinel: { key: 'unassigned', label: 'Unassigned' },
  })
}

function bucketByTag(
  todos: PersistedTodoItem[],
  ctx: DashboardListsContext,
  restrict?: DashboardListGroupingRestrict,
): DashboardListGroup[] {
  // No tag registry on ctx — labels come from `g.label` (resolved via
  // assignedTagsMap).
  return bucketByEntity(todos, ctx, 'tag', 'tag-', [], {
    restrictIds: restrict?.restrictToTagIds,
    formatLabel: (name) => `#${name}`,
    ungroupedSentinel: { key: UNTAGGED_BUCKET_KEY, label: UNTAGGED_BUCKET_LABEL },
  })
}
