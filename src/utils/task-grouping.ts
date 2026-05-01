import type { PersistedTodoItem, Person, Org, Status, Tag, Project, ProjectGroupBy } from '../models'
import { effectiveDate, resolveScheduled, type WeekStart } from './effective-date'
import { startOfDay, MS_PER_DAY } from './date'
import { resolvePersonColor } from './person-color'
import { UNAFFILIATED_PERSON_COLOR } from '../constants'

export const GROUP_OPTIONS: { value: ProjectGroupBy | null; label: string }[] = [
  { value: null, label: 'None' },
  { value: 'date', label: 'Effective Date' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'deadline', label: 'Deadline' },
  { value: 'status', label: 'Status' },
  { value: 'people', label: 'People' },
  { value: 'org', label: 'Org' },
  { value: 'tag', label: 'Tag' },
]

export interface GroupingContext {
  assignedPeopleMap: Map<number, Person[]>
  assignedOrgsMap: Map<number, Org[]>
  assignedTagsMap: Map<number, Tag[]>
  statuses: readonly Status[]
  /** Org registry — used by `getGroupColor` to resolve person colors via
   *  their first assigned org. Empty list is fine when not grouping by people. */
  orgs: readonly Org[]
  /** personId → orgId[] — used by `getGroupColor` to resolve person colors. */
  personOrgMap: Map<number, number[]>
  /** Project registry — used by `orderGroupKeys` to sort project keys by
   *  registry `sortOrder`. Optional: empty/undefined is fine when not grouping
   *  by project (caller can also resolve labels at the call site, mirroring
   *  the people/org pattern). */
  projects?: readonly Project[]
  today: Date
  weekStartsOn: WeekStart
}

export interface PartitionGroup<T extends PersistedTodoItem> {
  key: string
  label: string
  todos: T[]
  /**
   * `'direct'` when at least one task emit under this key came via the task's
   * direct group keys (assigned person/org/tag). `'implicit'` when every emit
   * came via the cross-axis `implicitKeysFor` callback (e.g. via the task's
   * direct orgs' member-people, when grouping by people).
   *
   * When `partitionByGroup` is called without `restrictToFilterSet`, every
   * group reports `'direct'` — the implicit path is gated on restrict mode
   * (P6, item 1).
   */
  tier: 'direct' | 'implicit'
}

export interface PartitionResult<T extends PersistedTodoItem> {
  ungrouped: T[]
  groups: PartitionGroup<T>[]
}

const DATE_BUCKET_ORDER = ['overdue', 'today', 'week', 'later'] as const

const DATE_BUCKET_LABELS: Record<string, string> = {
  overdue: 'Overdue',
  today: 'Today',
  week: 'This Week',
  later: 'Later',
}

function bucketDateKey(d: Date | null, today: Date): string | null {
  if (!d) return null
  const tomorrow = new Date(today.getTime() + MS_PER_DAY)
  const weekEnd = new Date(today.getTime() + 7 * MS_PER_DAY)
  if (d < today) return 'overdue'
  if (d < tomorrow) return 'today'
  if (d < weekEnd) return 'week'
  return 'later'
}

function parseId(prefix: string, key: string): number | null {
  if (!key.startsWith(prefix)) return null
  const n = Number(key.slice(prefix.length))
  return Number.isFinite(n) ? n : null
}

/**
 * Resolve the group key(s) for `todo` under `groupBy`.
 *
 * - `null` — todo has no value for this dimension; the partition routes it
 *   into the `ungrouped` block.
 * - `string` — single group key.
 * - `string[]` — todo belongs to multiple groups (people / org many-to-many);
 *   it appears once in each group, mirroring the ListView convention.
 *
 * Bucket keys for `date` / `scheduled` / `deadline` (`overdue` / `today` /
 * `week` / `later`) match `ListView.buildBucketSections` so users see the
 * same grouping across views.
 *
 * Post ui-consistency-2026-04-25 P4 `ProjectGroupBy = TodoGroupBy` widens
 * the union to include `'none'` and `'project'`. `'none'` is a no-op at this
 * layer (means "ungrouped"; callers gate on it). `'project'` returns
 * `project-${todo.projectId}` for surfaces that can group by project (the
 * canvas `ProjectNode` is one project at a time and excludes this axis from
 * `PROJECT_GROUP_VALUES`; ListView includes it).
 */
export function getGroupKey(
  todo: PersistedTodoItem,
  groupBy: ProjectGroupBy,
  ctx: GroupingContext,
): string | string[] | null {
  switch (groupBy) {
    case 'status':
      return todo.statusId != null ? `status-${todo.statusId}` : null
    case 'people': {
      const assigned = ctx.assignedPeopleMap.get(todo.id) ?? []
      const keys = new Set<string>()
      for (const p of assigned) {
        if (p.id != null) keys.add(`person-${p.id}`)
      }
      return keys.size === 0 ? null : [...keys]
    }
    case 'org': {
      const assigned = ctx.assignedOrgsMap.get(todo.id) ?? []
      const keys = new Set<string>()
      for (const o of assigned) {
        if (o.id != null) keys.add(`org-${o.id}`)
      }
      return keys.size === 0 ? null : [...keys]
    }
    case 'tag': {
      const assigned = ctx.assignedTagsMap.get(todo.id) ?? []
      const keys = new Set<string>()
      for (const t of assigned) {
        if (t.id != null) keys.add(`tag-${t.id}`)
      }
      return keys.size === 0 ? null : [...keys]
    }
    case 'project':
      return todo.projectId != null ? `project-${todo.projectId}` : null
    case 'date':
      return bucketDateKey(effectiveDate(todo, ctx.today, ctx.weekStartsOn), ctx.today)
    case 'scheduled':
      return bucketDateKey(resolveScheduled(todo.scheduledDate, ctx.today, ctx.weekStartsOn), ctx.today)
    case 'deadline':
      return bucketDateKey(
        todo.dueDate ? startOfDay(new Date(todo.dueDate)) : null,
        ctx.today,
      )
    case 'none':
      return null
  }
}

/**
 * Human-readable label for a key produced by `getGroupKey`. Person/org
 * names are looked up via the assigned-{people,orgs} maps; status names
 * via `ctx.statuses`; date/scheduled/deadline keys map to the same labels
 * `ListView` uses ("Overdue" / "Today" / "This Week" / "Later").
 */
export function getGroupLabel(
  key: string,
  groupBy: ProjectGroupBy,
  ctx: GroupingContext,
): string {
  switch (groupBy) {
    case 'status': {
      const id = parseId('status-', key)
      if (id == null) return ''
      const s = ctx.statuses.find((x) => x.id === id)
      return s?.name ?? ''
    }
    case 'people': {
      const id = parseId('person-', key)
      if (id == null) return ''
      for (const arr of ctx.assignedPeopleMap.values()) {
        const hit = arr.find((p) => p.id === id)
        if (hit) return hit.name
      }
      return ''
    }
    case 'org': {
      const id = parseId('org-', key)
      if (id == null) return ''
      for (const arr of ctx.assignedOrgsMap.values()) {
        const hit = arr.find((o) => o.id === id)
        if (hit) return hit.name
      }
      return ''
    }
    case 'tag': {
      const id = parseId('tag-', key)
      if (id == null) return ''
      for (const arr of ctx.assignedTagsMap.values()) {
        const hit = arr.find((t) => t.id === id)
        if (hit) return hit.name
      }
      return ''
    }
    case 'project': {
      const id = parseId('project-', key)
      if (id == null) return ''
      const project = ctx.projects?.find((p) => p.id === id)
      return project?.name ?? ''
    }
    case 'date':
    case 'scheduled':
    case 'deadline':
      return DATE_BUCKET_LABELS[key] ?? ''
    case 'none':
      return ''
  }
}

/**
 * Resolve the swatch color for a group header. Returns `undefined` when the
 * key has no associated color (date buckets, unknown keys, status with no
 * defined color). People without an org membership fall back to
 * `UNAFFILIATED_PERSON_COLOR`, mirroring `AvatarStack`'s fill-variant behavior.
 *
 * Date-bucket dimensions (`date` / `scheduled` / `deadline`) are derived
 * buckets, not entities — they intentionally have no color.
 */
export function getGroupColor(
  key: string,
  groupBy: ProjectGroupBy,
  ctx: GroupingContext,
): string | undefined {
  switch (groupBy) {
    case 'status': {
      const id = parseId('status-', key)
      if (id == null) return undefined
      const s = ctx.statuses.find((x) => x.id === id)
      return s?.color
    }
    case 'people': {
      const id = parseId('person-', key)
      if (id == null) return undefined
      return resolvePersonColor(id, ctx.personOrgMap, [...ctx.orgs]) ?? UNAFFILIATED_PERSON_COLOR
    }
    case 'org': {
      const id = parseId('org-', key)
      if (id == null) return undefined
      for (const arr of ctx.assignedOrgsMap.values()) {
        const hit = arr.find((o) => o.id === id)
        if (hit?.color) return hit.color
      }
      return undefined
    }
    case 'tag': {
      const id = parseId('tag-', key)
      if (id == null) return undefined
      for (const arr of ctx.assignedTagsMap.values()) {
        const hit = arr.find((t) => t.id === id)
        if (hit?.color) return hit.color
      }
      return undefined
    }
    case 'project':
    case 'date':
    case 'scheduled':
    case 'deadline':
    case 'none':
      return undefined
  }
}

/**
 * Order group keys by dimension-default rules (status sortOrder, date bucket
 * order, alphabetical for people/org/tag), then optionally pull
 * `prioritizeGroupKeys` to the front in caller order.
 *
 * Used by `partitionByGroup` to satisfy "filter by X + group by X → put X
 * first" UX (item 12, triage-2026-04-27-batch2 P5). Caller passes the same
 * prefixed keys `getGroupKey` emits (`person-N` / `org-N` / `tag-N`); only
 * keys present in the input list are pulled forward, so passing IDs that
 * don't have a group is harmless. Keys not in the prioritize list keep
 * their default order.
 */
function orderGroupKeys(
  keys: string[],
  groupBy: ProjectGroupBy,
  ctx: GroupingContext,
  prioritizeGroupKeys?: ReadonlyArray<string>,
): string[] {
  const sorted = ((): string[] => {
    switch (groupBy) {
      case 'status': {
        const order = new Map<number, number>()
        const statusSorted = [...ctx.statuses].sort(
          (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0),
        )
        statusSorted.forEach((s, i) => {
          if (s.id != null) order.set(s.id, i)
        })
        return keys.slice().sort((a, b) => {
          const ai = order.get(parseId('status-', a) ?? -1) ?? Number.MAX_SAFE_INTEGER
          const bi = order.get(parseId('status-', b) ?? -1) ?? Number.MAX_SAFE_INTEGER
          return ai - bi
        })
      }
      case 'date':
      case 'scheduled':
      case 'deadline': {
        const idx = (k: string) => {
          const i = (DATE_BUCKET_ORDER as readonly string[]).indexOf(k)
          return i === -1 ? DATE_BUCKET_ORDER.length : i
        }
        return keys.slice().sort((a, b) => idx(a) - idx(b))
      }
      case 'people':
      case 'org':
      case 'tag':
        return keys.slice().sort((a, b) =>
          getGroupLabel(a, groupBy, ctx).localeCompare(getGroupLabel(b, groupBy, ctx)),
        )
      case 'project': {
        // Sort by project registry sortOrder when `ctx.projects` is supplied;
        // otherwise fall through to alphabetical-by-label fallback (mirrors
        // people/org/tag behavior when label is empty).
        const projects = ctx.projects
        if (projects && projects.length > 0) {
          const order = new Map<number, number>()
          const sorted = [...projects].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
          sorted.forEach((p, i) => {
            if (p.id != null) order.set(p.id, i)
          })
          return keys.slice().sort((a, b) => {
            const ai = order.get(parseId('project-', a) ?? -1) ?? Number.MAX_SAFE_INTEGER
            const bi = order.get(parseId('project-', b) ?? -1) ?? Number.MAX_SAFE_INTEGER
            return ai - bi
          })
        }
        return keys.slice().sort((a, b) =>
          getGroupLabel(a, groupBy, ctx).localeCompare(getGroupLabel(b, groupBy, ctx)),
        )
      }
      case 'none':
        return keys.slice()
    }
  })()

  if (!prioritizeGroupKeys || prioritizeGroupKeys.length === 0) return sorted
  const sortedSet = new Set(sorted)
  const prioritized: string[] = []
  const seen = new Set<string>()
  for (const k of prioritizeGroupKeys) {
    if (sortedSet.has(k) && !seen.has(k)) {
      prioritized.push(k)
      seen.add(k)
    }
  }
  if (prioritized.length === 0) return sorted
  const rest = sorted.filter((k) => !seen.has(k))
  return [...prioritized, ...rest]
}

/**
 * Walk `todos` once and partition them by `groupBy`. Items with no value
 * for the dimension land in `ungrouped`; everything else goes into
 * `groups` keyed by the value(s) returned from `getGroupKey`.
 *
 * - Within each bucket, todo order is preserved from the input.
 * - Group order: status by `sortOrder`, date/scheduled/deadline by
 *   bucket order (overdue → today → week → later), people/org
 *   alphabetically by label.
 * - A todo with N keys (people/org) appears once per group — the same
 *   row reference, no clone.
 *
 * `prioritizeGroupKeys` (optional): keys pulled to the front in caller
 * order (filter-aware ordering for "filter by X + group by X" — item 12,
 * P5). Pass the same prefixed keys `getGroupKey` emits (`person-N`,
 * `org-N`, `tag-N`).
 *
 * `restrictToFilterSet` (optional, P6 item 1): when set, the partition
 * narrows to *visible* groups defined by `(filterSet) ∩ (direct keys ∪
 * implicit keys)`. Tasks whose intersection is empty are skipped; tasks
 * with no direct keys at all (and no implicit rescue) still route to
 * `ungrouped` (preserves the unassigned-sentinel filter case). When a
 * task has no direct keys but `implicitKeysFor` returns filter-matched
 * keys, the task emits under those keys as implicit-tier (mirrors
 * ListView legacy `buildPeopleSections` behavior — task assigned only
 * to an org whose member is in the people filter). Pass the same
 * prefixed keys `getGroupKey` emits.
 *
 * `implicitKeysFor` (optional, P6): caller-supplied cross-axis lookup,
 * only consulted when `restrictToFilterSet` is set. For
 * `groupBy === 'people'`, return person keys reachable from the task's
 * orgs (members of any direct org). For `groupBy === 'org'`, return org
 * keys reachable from the task's people. Tags have no cross-axis path —
 * pass nothing.
 *
 * Returns `groups` with a per-group `tier`: `'direct'` when at least one
 * emit under that key came via the task's direct group keys; `'implicit'`
 * when every emit came via `implicitKeysFor`. When `restrictToFilterSet`
 * is unset, every group is `'direct'` and ordering follows the legacy
 * `prioritizeGroupKeys` path. When it *is* set, ordering is direct-tier
 * first then implicit-tier — within each tier, the order of
 * `restrictToFilterSet` is preserved.
 */
export function partitionByGroup<T extends PersistedTodoItem>(
  todos: readonly T[],
  groupBy: ProjectGroupBy,
  ctx: GroupingContext,
  prioritizeGroupKeys?: ReadonlyArray<string>,
  restrictToFilterSet?: ReadonlyArray<string>,
  implicitKeysFor?: (todo: T, axis: ProjectGroupBy) => readonly string[],
): PartitionResult<T> {
  const ungrouped: T[] = []
  const groupMap = new Map<string, { todos: T[]; hasDirect: boolean }>()
  const filterSet =
    restrictToFilterSet && restrictToFilterSet.length > 0
      ? new Set(restrictToFilterSet)
      : null

  const pushDirect = (key: string, t: T): void => {
    let bucket = groupMap.get(key)
    if (!bucket) {
      bucket = { todos: [], hasDirect: true }
      groupMap.set(key, bucket)
    } else {
      bucket.hasDirect = true
    }
    bucket.todos.push(t)
  }

  const pushImplicit = (key: string, t: T): void => {
    let bucket = groupMap.get(key)
    if (!bucket) {
      bucket = { todos: [], hasDirect: false }
      groupMap.set(key, bucket)
    }
    bucket.todos.push(t)
  }

  for (const t of todos) {
    const key = getGroupKey(t, groupBy, ctx)
    const baseDirectKeys: string[] =
      key == null ? [] : Array.isArray(key) ? key : [key]

    const directKeys: string[] = []
    const directSeen = new Set<string>()
    for (const k of baseDirectKeys) {
      if (!directSeen.has(k)) {
        directSeen.add(k)
        directKeys.push(k)
      }
    }

    if (filterSet === null) {
      // Legacy mode: no implicit path runs.
      if (directKeys.length === 0) {
        ungrouped.push(t)
        continue
      }
      for (const k of directKeys) pushDirect(k, t)
      continue
    }

    const emitDirect: string[] = []
    for (const k of directKeys) if (filterSet.has(k)) emitDirect.push(k)

    const directSet = new Set(emitDirect)
    const emitImplicit: string[] = []
    if (implicitKeysFor) {
      for (const k of implicitKeysFor(t, groupBy)) {
        if (filterSet.has(k) && !directSet.has(k)) emitImplicit.push(k)
      }
    }

    if (emitDirect.length === 0 && emitImplicit.length === 0) {
      // Restrict mode, empty intersection. Two sub-cases:
      // - directKeys.length === 0: task has no direct keys at all (e.g.,
      //   no people assigned). Route to ungrouped — preserves the
      //   unassigned-sentinel filter case.
      // - directKeys.length > 0 but none match the filter set, and implicit
      //   didn't rescue: task is axis-mismatched. Drop entirely.
      if (directKeys.length === 0) ungrouped.push(t)
      continue
    }

    for (const k of emitDirect) pushDirect(k, t)
    for (const k of emitImplicit) pushImplicit(k, t)
  }

  const orderedKeys =
    filterSet !== null
      ? orderRestrictedKeys(restrictToFilterSet!, groupMap)
      : orderGroupKeys([...groupMap.keys()], groupBy, ctx, prioritizeGroupKeys)

  const groups = orderedKeys.map((key) => {
    const bucket = groupMap.get(key)!
    return {
      key,
      label: getGroupLabel(key, groupBy, ctx),
      todos: bucket.todos,
      tier: (bucket.hasDirect ? 'direct' : 'implicit') as 'direct' | 'implicit',
    }
  })

  return { ungrouped, groups }
}

/**
 * Tier-aware ordering for restrict mode (P6 item 1). Walks
 * `restrictToFilterSet` in caller order, splits keys into direct- vs
 * implicit-only tiers based on `groupMap[k].hasDirect`, and emits
 * `[...direct, ...implicit]`. Keys not present in `groupMap` (no task
 * emitted there) are dropped. Repeated keys in the input are deduped to
 * their first appearance.
 */
function orderRestrictedKeys<T extends PersistedTodoItem>(
  restrictToFilterSet: ReadonlyArray<string>,
  groupMap: Map<string, { todos: T[]; hasDirect: boolean }>,
): string[] {
  const direct: string[] = []
  const implicit: string[] = []
  const seen = new Set<string>()
  for (const k of restrictToFilterSet) {
    if (seen.has(k)) continue
    seen.add(k)
    const bucket = groupMap.get(k)
    if (!bucket) continue
    if (bucket.hasDirect) direct.push(k)
    else implicit.push(k)
  }
  return [...direct, ...implicit]
}
