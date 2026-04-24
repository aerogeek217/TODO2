import type { PersistedTodoItem, Person, Org, Status, ProjectGroupBy } from '../models'
import { effectiveDate, resolveScheduled } from './effective-date'
import { startOfDay, MS_PER_DAY } from './date'

export interface GroupingContext {
  assignedPeopleMap: Map<number, Person[]>
  assignedOrgsMap: Map<number, Org[]>
  statuses: readonly Status[]
  today: Date
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
    case 'date':
      return bucketDateKey(effectiveDate(todo, ctx.today), ctx.today)
    case 'scheduled':
      return bucketDateKey(resolveScheduled(todo.scheduledDate, ctx.today), ctx.today)
    case 'deadline':
      return bucketDateKey(
        todo.dueDate ? startOfDay(new Date(todo.dueDate)) : null,
        ctx.today,
      )
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
    case 'date':
    case 'scheduled':
    case 'deadline':
      return DATE_BUCKET_LABELS[key] ?? ''
  }
}

function orderGroupKeys(
  keys: string[],
  groupBy: ProjectGroupBy,
  ctx: GroupingContext,
): string[] {
  switch (groupBy) {
    case 'status': {
      const order = new Map<number, number>()
      const sorted = [...ctx.statuses].sort(
        (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0),
      )
      sorted.forEach((s, i) => {
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
      return keys.slice().sort((a, b) =>
        getGroupLabel(a, groupBy, ctx).localeCompare(getGroupLabel(b, groupBy, ctx)),
      )
  }
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
 */
export function partitionByGroup<T extends PersistedTodoItem>(
  todos: readonly T[],
  groupBy: ProjectGroupBy,
  ctx: GroupingContext,
): PartitionResult<T> {
  const ungrouped: T[] = []
  const groupMap = new Map<string, T[]>()

  for (const t of todos) {
    const key = getGroupKey(t, groupBy, ctx)
    if (key == null) {
      ungrouped.push(t)
      continue
    }
    if (Array.isArray(key)) {
      if (key.length === 0) {
        ungrouped.push(t)
        continue
      }
      for (const k of key) {
        let bucket = groupMap.get(k)
        if (!bucket) {
          bucket = []
          groupMap.set(k, bucket)
        }
        bucket.push(t)
      }
    } else {
      let bucket = groupMap.get(key)
      if (!bucket) {
        bucket = []
        groupMap.set(key, bucket)
      }
      bucket.push(t)
    }
  }

  const groups = orderGroupKeys([...groupMap.keys()], groupBy, ctx).map((key) => ({
    key,
    label: getGroupLabel(key, groupBy, ctx),
    todos: groupMap.get(key)!,
  }))

  return { ungrouped, groups }
}
