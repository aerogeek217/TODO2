import type { PersistedTodoItem, Person, Status, Tag, TodoGroupBy } from '../models'
import type { WeekStart } from './effective-date'
import { bySortOrder } from './sort-order'
import { DATE_BUCKET_LABELS, DATE_BUCKET_ORDER, dateBucketKey, isDateBucketKey } from './bucket-by-date'
import { NEUTRAL_PERSON_COLOR } from '../constants'

export interface GroupingContext {
  assignedPeopleMap: Map<number, Person[]>
  assignedTagsMap: Map<number, Tag[]>
  statuses: readonly Status[]
  today: Date
  /** Week boundary for the date axes' "This Week" bucket. */
  weekStartsOn: WeekStart
}

export interface PartitionGroup<T extends PersistedTodoItem> {
  key: string
  label: string
  todos: T[]
}

export interface PartitionResult<T extends PersistedTodoItem> {
  ungrouped: T[]
  groups: PartitionGroup<T>[]
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
 * - `string[]` — todo belongs to multiple groups (people / tag many-to-many);
 *   it appears once in each group.
 *
 * Bucket keys for `deadline` / `followup` are the shared relative-date keys
 * (`overdue` / `today` / `week` / `later`, see `utils/bucket-by-date`).
 *
 * `'none'` is a no-op at this layer (means "ungrouped"; callers gate on it).
 * `'priority'` groups nothing here yet: lists grouped by it read as ungrouped.
 */
export function getGroupKey(
  todo: PersistedTodoItem,
  groupBy: TodoGroupBy,
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
    case 'tag': {
      const assigned = ctx.assignedTagsMap.get(todo.id) ?? []
      const keys = new Set<string>()
      for (const t of assigned) {
        if (t.id != null) keys.add(`tag-${t.id}`)
      }
      return keys.size === 0 ? null : [...keys]
    }
    case 'deadline':
      return dateBucketKey(todo.dueDate ? new Date(todo.dueDate) : null, ctx.today, ctx.weekStartsOn)
    case 'followup':
      return dateBucketKey(todo.nextFollowupAt ? new Date(todo.nextFollowupAt) : null, ctx.today, ctx.weekStartsOn)
    case 'priority':
    case 'none':
      return null
  }
}

/**
 * Human-readable label for a key produced by `getGroupKey`. Person / tag
 * names are looked up via the assigned-{people,tags} maps; status names
 * via `ctx.statuses`; deadline/followup keys map to the shared date labels
 * ("Overdue" / "Today" / "This Week" / "Later").
 */
export function getGroupLabel(
  key: string,
  groupBy: TodoGroupBy,
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
    case 'tag': {
      const id = parseId('tag-', key)
      if (id == null) return ''
      for (const arr of ctx.assignedTagsMap.values()) {
        const hit = arr.find((t) => t.id === id)
        if (hit) return hit.name
      }
      return ''
    }
    case 'deadline':
    case 'followup':
      return isDateBucketKey(key) ? DATE_BUCKET_LABELS[key] : ''
    case 'priority':
    case 'none':
      return ''
  }
}

/**
 * Resolve the swatch color for a group header. Returns `undefined` when the
 * key has no associated color (date buckets, unknown keys, status with no
 * defined color). People without a color fall back to
 * `NEUTRAL_PERSON_COLOR`, mirroring `AvatarStack`'s fill-variant behavior.
 *
 * Date-bucket dimensions (`deadline` / `followup`) are derived
 * buckets, not entities — they intentionally have no color.
 */
export function getGroupColor(
  key: string,
  groupBy: TodoGroupBy,
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
      for (const arr of ctx.assignedPeopleMap.values()) {
        const hit = arr.find((p) => p.id === id)
        if (hit) return hit.color ?? NEUTRAL_PERSON_COLOR
      }
      return NEUTRAL_PERSON_COLOR
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
    case 'deadline':
    case 'followup':
    case 'priority':
    case 'none':
      return undefined
  }
}

/**
 * Order group keys by dimension-default rules (status sortOrder, date bucket
 * order, alphabetical for people/tag), then optionally pull
 * `prioritizeGroupKeys` to the front in caller order.
 *
 * Used by `partitionByGroup` to satisfy "filter by X + group by X → put X
 * first" UX. Caller passes the same
 * prefixed keys `getGroupKey` emits (`person-N` / `tag-N`); only
 * keys present in the input list are pulled forward, so passing IDs that
 * don't have a group is harmless. Keys not in the prioritize list keep
 * their default order.
 */
function orderGroupKeys(
  keys: string[],
  groupBy: TodoGroupBy,
  ctx: GroupingContext,
  prioritizeGroupKeys?: ReadonlyArray<string>,
): string[] {
  const sorted = ((): string[] => {
    switch (groupBy) {
      case 'status': {
        const order = new Map<number, number>()
        const statusSorted = [...ctx.statuses].sort(bySortOrder)
        statusSorted.forEach((s, i) => {
          if (s.id != null) order.set(s.id, i)
        })
        return keys.slice().sort((a, b) => {
          const ai = order.get(parseId('status-', a) ?? -1) ?? Number.MAX_SAFE_INTEGER
          const bi = order.get(parseId('status-', b) ?? -1) ?? Number.MAX_SAFE_INTEGER
          return ai - bi
        })
      }
      case 'deadline':
      case 'followup': {
        const idx = (k: string) => (isDateBucketKey(k) ? DATE_BUCKET_ORDER.indexOf(k) : DATE_BUCKET_ORDER.length)
        return keys.slice().sort((a, b) => idx(a) - idx(b))
      }
      case 'people':
      case 'tag':
        return keys.slice().sort((a, b) =>
          getGroupLabel(a, groupBy, ctx).localeCompare(getGroupLabel(b, groupBy, ctx)),
        )
      case 'priority':
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
 * - Group order: status by `sortOrder`, deadline/followup by
 *   bucket order (overdue → today → week → later), people/tag
 *   alphabetically by label.
 * - A todo with N keys (people/tag) appears once per group — the same
 *   row reference, no clone.
 *
 * `prioritizeGroupKeys` (optional): keys pulled to the front in caller
 * order (filter-aware ordering for "filter by X + group by X"). Pass the
 * same prefixed keys `getGroupKey` emits (`person-N`, `tag-N`).
 *
 * `restrictToFilterSet` (optional): when set, only groups whose key is in
 * the set are emitted, in the set's order. Tasks with no key at all still
 * route to `ungrouped` (preserves the unassigned-sentinel filter case);
 * tasks whose keys all fall outside the set are dropped. Pass the same
 * prefixed keys `getGroupKey` emits.
 */
export function partitionByGroup<T extends PersistedTodoItem>(
  todos: readonly T[],
  groupBy: TodoGroupBy,
  ctx: GroupingContext,
  prioritizeGroupKeys?: ReadonlyArray<string>,
  restrictToFilterSet?: ReadonlyArray<string>,
): PartitionResult<T> {
  const ungrouped: T[] = []
  const groupMap = new Map<string, T[]>()
  const filterSet =
    restrictToFilterSet && restrictToFilterSet.length > 0
      ? new Set(restrictToFilterSet)
      : null

  for (const t of todos) {
    const key = getGroupKey(t, groupBy, ctx)
    const keys = new Set(key == null ? [] : Array.isArray(key) ? key : [key])
    if (keys.size === 0) {
      ungrouped.push(t)
      continue
    }
    for (const k of keys) {
      if (filterSet !== null && !filterSet.has(k)) continue
      let bucket = groupMap.get(k)
      if (!bucket) {
        bucket = []
        groupMap.set(k, bucket)
      }
      bucket.push(t)
    }
  }

  const orderedKeys =
    filterSet !== null
      ? [...new Set(restrictToFilterSet)].filter((k) => groupMap.has(k))
      : orderGroupKeys([...groupMap.keys()], groupBy, ctx, prioritizeGroupKeys)

  const groups = orderedKeys.map((key) => ({
    key,
    label: getGroupLabel(key, groupBy, ctx),
    todos: groupMap.get(key) ?? [],
  }))

  return { ungrouped, groups }
}
