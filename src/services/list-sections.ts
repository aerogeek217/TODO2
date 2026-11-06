import type { PersistedTodoItem, Person, Status, Tag, TodoGroupBy, TodoSortBy, TodoSortDirection } from '../models'
import { effectiveSortDirection, isTodoGroupBy } from '../models'
import { assignedEntitiesById, partitionByGroup, getGroupColor, type GroupingContext } from '../utils/task-grouping'
import { compareTodosByDate, pickTodoDate, type WeekStart } from '../utils/effective-date'
import { bySortOrder } from '../utils/sort-order'
import { startOfDay } from '../utils/date'
import { UNTAGGED_BUCKET_KEY, UNTAGGED_BUCKET_LABEL } from '../utils/bucket-by-tag'
import type { DateBucketKey } from '../utils/bucket-by-date'
import { manualOrderComparator, type ListRanks } from '../utils/list-order'
import { priorityRank } from '../utils/markers'
import type { UrgentDueWithinDays } from '../utils/urgency'
import { NO_PRIORITY_KEY, NO_PRIORITY_LABEL } from '../utils/priority-groups'

/**
 * One rendered group of a list. Every list widget builds its sections with
 * {@link buildListSections}, so the same definition yields the same keys,
 * labels, accents and order everywhere.
 */
export interface Section {
  key: string
  label: string
  accentColor?: string
  todos: PersistedTodoItem[]
}

/** How a list arranges its members. */
export interface ListSectionsSpec {
  groupBy: TodoGroupBy
  sortBy: TodoSortBy
  /** `desc` reverses the sort (see {@link listSortComparator}); absent = natural order. */
  sortDirection?: TodoSortDirection
  /**
   * The person "is" picks that narrow the People groups, each one filter's
   * (the list's own, the screen's chips, the top bar's lens — all of which a
   * member passes). With one, only its people's sections show, in its
   * order, and a task assigned only to other people is left out; with
   * several, a task shows under each of its people every one of them picks,
   * or — when none of its people is picked by all of them — under each one
   * any of them picks (so no member drops out), the sections in the
   * picks' order. Id `0` (the "unassigned" pick) keeps the trailing
   * Unassigned section when every restriction has it. Absent / empty →
   * every person gets a section.
   */
  personRestrictions?: ReadonlyArray<ReadonlyArray<number>>
  /**
   * Same for the tag picks when grouping by tag: id `0` (No tags) keeps the
   * trailing No tags section; without it there is none.
   */
  tagRestrictions?: ReadonlyArray<ReadonlyArray<number>>
}

export interface ListSectionsContext {
  today: Date
  weekStartsOn: WeekStart
  people: readonly Person[]
  statuses: readonly Status[]
  assignedPeopleMap: Map<number, Person[]>
  assignedTagsMap: Map<number, Tag[]>
  /**
   * The list's manual order (`listOrders`). Given → `manual` sorts by it;
   * omitted (a surface without a stored list) → `manual` is `sortOrder`.
   */
  manualRanks?: ListRanks
  /** The app's "due date makes a task urgent" range, for the Priority sort and groups; absent = flags only. */
  urgentRange?: UrgentDueWithinDays
}

/** What a sort reads besides the tasks. */
export interface ListSortContext {
  /** The list's manual order (see {@link ListSectionsContext.manualRanks}). */
  manualRanks?: ListRanks
  /** The Priority sort's day (effective Urgent); absent = today. */
  today?: Date
  /** The Priority sort's urgent range; absent = flags only. */
  urgentRange?: UrgentDueWithinDays
  /** `desc` reverses the sort's primary key; absent = natural order. */
  direction?: TodoSortDirection
  /** The People sort's assignments; absent = every task unassigned. */
  assignedPeopleMap?: ReadonlyMap<number, readonly Person[]>
  /** The Status sort's statuses (their Settings order); absent = every task without one. */
  statuses?: readonly Status[]
}

/**
 * Comparator for a list's sort. Applied before grouping; grouping keeps input
 * order, so every section comes out sorted.
 *
 * - `manual` — the list's ranks when given (`manualOrderComparator`: ranked
 *   first, then unranked oldest first), else `sortOrder` (then id).
 * - `name` — alphabetical title, ties by `sortOrder`.
 * - `deadline` / `followup` — ascending date, undated last, ties by `sortOrder`.
 * - `lastFollowup` / `completed` — ascending moment (oldest first; Completed
 *   is picked descending, newest first), never followed up / open last,
 *   ties by `sortOrder`.
 * - `created` — oldest first by `createdAt`, ties by `sortOrder`.
 * - `modified` — longest untouched first by `modifiedAt` (any edit moves it,
 *   a reorder or a bulk edit too), ties by `sortOrder`.
 * - `priority` — Focus, then Urgent + Important, Urgent, Important, none
 *   (`priorityRank`; Urgent includes due soon); ties by due date (undated
 *   last), then manual order.
 * - `people` — by the task's people's names (its alphabetically first
 *   person), unassigned last; ties by manual order.
 * - `status` — by the statuses' order in Settings, no status (or a deleted
 *   one) last; ties by manual order.
 * - A stored value this build doesn't know falls back to manual order.
 *
 * `ctx.direction` `desc` reverses the primary key only (latest / newest /
 * Z → A / lowest priority first): ties keep their tie-break order and
 * undated tasks stay last. Manual and `people` / `status` have no direction
 * (`sortHasDirection`).
 */
export function listSortComparator(
  sortBy: TodoSortBy,
  ctx: ListSortContext = {},
): (a: PersistedTodoItem, b: PersistedTodoItem) => number {
  const { manualRanks } = ctx
  if (sortBy === 'manual' && manualRanks) return manualOrderComparator(manualRanks)
  const sign: 1 | -1 = effectiveSortDirection(sortBy, ctx.direction) === 'desc' ? -1 : 1
  switch (sortBy) {
    case 'priority':
      return priorityComparator(ctx, sign)
    case 'name':
      return (a, b) => (sign * a.title.localeCompare(b.title)) || bySortOrder(a, b)
    case 'deadline':
    case 'followup':
    case 'lastFollowup':
    case 'completed':
      return compareTodosByDate(sortBy, sign < 0)
    case 'created':
      return (a, b) => (sign * (a.createdAt.getTime() - b.createdAt.getTime())) || bySortOrder(a, b)
    case 'modified':
      return (a, b) => (sign * (a.modifiedAt.getTime() - b.modifiedAt.getTime())) || bySortOrder(a, b)
    case 'people':
      return peopleComparator(ctx)
    case 'status':
      return statusComparator(ctx)
    case 'manual':
      return bySortOrder
  }
  return bySortOrder
}

/** The People sort: the task's alphabetically first person's name, unassigned last, then manual order. */
function peopleComparator(ctx: ListSortContext): (a: PersistedTodoItem, b: PersistedTodoItem) => number {
  const manual = ctx.manualRanks ? manualOrderComparator(ctx.manualRanks) : bySortOrder
  const firstName = new Map<number, string | null>()
  const nameOf = (t: PersistedTodoItem): string | null => {
    let name = firstName.get(t.id)
    if (name === undefined) {
      name = null
      for (const p of ctx.assignedPeopleMap?.get(t.id) ?? []) {
        if (name === null || p.name.localeCompare(name) < 0) name = p.name
      }
      firstName.set(t.id, name)
    }
    return name
  }
  return (a, b) => {
    const an = nameOf(a)
    const bn = nameOf(b)
    if (an !== null && bn !== null) return an.localeCompare(bn) || manual(a, b)
    if (an === null && bn !== null) return 1
    if (an !== null && bn === null) return -1
    return manual(a, b)
  }
}

/** The Status sort: the statuses' order in Settings, no status last, then manual order. */
function statusComparator(ctx: ListSortContext): (a: PersistedTodoItem, b: PersistedTodoItem) => number {
  const manual = ctx.manualRanks ? manualOrderComparator(ctx.manualRanks) : bySortOrder
  const rank = new Map([...(ctx.statuses ?? [])].sort(bySortOrder).map((st, i) => [st.id, i]))
  const rankOf = (t: PersistedTodoItem): number => (t.statusId != null ? rank.get(t.statusId) : undefined) ?? Infinity
  return (a, b) => {
    const ar = rankOf(a)
    const br = rankOf(b)
    return (ar === br ? 0 : ar < br ? -1 : 1) || manual(a, b)
  }
}

/** The Priority sort: rank (reversed for `sign` -1), then due date (undated last), then manual order. */
function priorityComparator(ctx: ListSortContext, sign: 1 | -1): (a: PersistedTodoItem, b: PersistedTodoItem) => number {
  const today = ctx.today ?? startOfDay(new Date())
  const range = ctx.urgentRange ?? null
  const manual = ctx.manualRanks ? manualOrderComparator(ctx.manualRanks) : bySortOrder
  const rank = new Map<number, number>()
  const rankOf = (t: PersistedTodoItem): number => {
    let r = rank.get(t.id)
    if (r === undefined) {
      r = priorityRank(t, today, range)
      rank.set(t.id, r)
    }
    return r
  }
  return (a, b) => {
    const byRank = sign * (rankOf(a) - rankOf(b))
    if (byRank !== 0) return byRank
    const ad = pickTodoDate(a, 'deadline')
    const bd = pickTodoDate(b, 'deadline')
    if (ad !== null && bd !== null && ad.getTime() !== bd.getTime()) return ad.getTime() - bd.getTime()
    if (ad === null && bd !== null) return 1
    if (ad !== null && bd === null) return -1
    return manual(a, b)
  }
}

/** Group colours of date sections; the trailing "No …" sections are muted too. */
const DATE_ACCENTS: Partial<Record<DateBucketKey, string>> = {
  overdue: 'var(--color-overdue)',
  today: 'var(--color-accent-text)',
  week: 'var(--color-text-secondary)',
  later: 'var(--color-text-muted)',
}

const UNGROUPED_ACCENT = 'var(--color-text-muted)'

/** Trailing section for tasks with no value on the grouped axis. */
const UNGROUPED_SECTION: Record<Exclude<TodoGroupBy, 'none'>, { key: string; label: string }> = {
  deadline: { key: 'none', label: 'No Due Date' },
  followup: { key: 'none', label: 'No Follow-up' },
  people: { key: 'unassigned', label: 'Unassigned' },
  status: { key: 'no-status', label: 'No Status' },
  tag: { key: UNTAGGED_BUCKET_KEY, label: UNTAGGED_BUCKET_LABEL },
  priority: { key: NO_PRIORITY_KEY, label: NO_PRIORITY_LABEL },
}

/** Whether `key` is the trailing "No …" / "Unassigned" section of `groupBy`. */
export function isUngroupedSectionKey(groupBy: TodoGroupBy, key: string): boolean {
  return groupBy !== 'none' && UNGROUPED_SECTION[groupBy]?.key === key
}

/**
 * The groups `spec`'s restrictions leave: `keys` the sections allowed, in
 * order (absent = every group); `preferred` (several restrictions) the ones
 * every restriction picks, where a task that has one of them shows only;
 * whether the trailing "No …" section stays.
 */
function restrictKeys(spec: ListSectionsSpec): { keys?: string[]; preferred?: ReadonlySet<string>; keepUngrouped: boolean } {
  const restrictions = (
    spec.groupBy === 'people' ? spec.personRestrictions
    : spec.groupBy === 'tag' ? spec.tagRestrictions
    : undefined
  )?.filter((ids) => ids.length > 0) ?? []
  if (restrictions.length === 0) return { keepUngrouped: true }
  const prefix = spec.groupBy === 'people' ? 'person-' : 'tag-'
  const keysOf = restrictions.map((ids) => new Set(ids.filter((id) => id !== 0).map((id) => `${prefix}${id}`)))
  const union = [...new Set(keysOf.flatMap((keys) => [...keys]))]
  const keepUngrouped = restrictions.every((ids) => ids.includes(0))
  // Only the none pick (Unassigned / No tags): a key no task has, so every
  // assigned or tagged task drops out and the trailing section alone shows.
  const keys = union.length > 0 ? union : [`${prefix}0`]
  if (restrictions.length === 1) return { keys, keepUngrouped }
  return { keys, preferred: new Set(union.filter((k) => keysOf.every((ks) => ks.has(k)))), keepUngrouped }
}

/** `groups` with a task that is in a `preferred` group taken out of the others (emptied ones dropped). */
function preferGroups<G extends { key: string; todos: PersistedTodoItem[] }>(groups: G[], preferred: ReadonlySet<string>): G[] {
  const placed = new Set<number>()
  for (const g of groups) if (preferred.has(g.key)) for (const t of g.todos) placed.add(t.id)
  if (placed.size === 0) return groups
  return groups
    .map((g) => (preferred.has(g.key) ? g : { ...g, todos: g.todos.filter((t) => !placed.has(t.id)) }))
    .filter((g) => g.todos.length > 0)
}

/**
 * Sort `members` and split them into sections for `spec.groupBy`.
 *
 * Group order: dates Overdue → Today → This Week → Later; status by its
 * registry `sortOrder`; people and tags alphabetically (or in the
 * restrict order); Priority Focus → Urgent → Important (Urgent = effective
 * Urgent). A task with
 * several people / tags / priority markers appears in each of their
 * sections. Tasks with no value on the axis trail in one "No …" /
 * "Unassigned" section. Empty groups aren't shown. Ungrouped lists return
 * one `all` section (none when empty).
 */
export function buildListSections(
  members: readonly PersistedTodoItem[],
  spec: ListSectionsSpec,
  ctx: ListSectionsContext,
): Section[] {
  // A stored grouping this build doesn't know reads as ungrouped rather than
  // breaking the surface.
  const groupBy = isTodoGroupBy(spec.groupBy) ? spec.groupBy : 'none'
  const sorted = [...members].sort(listSortComparator(spec.sortBy, {
    manualRanks: ctx.manualRanks,
    today: ctx.today,
    urgentRange: ctx.urgentRange,
    direction: spec.sortDirection,
    assignedPeopleMap: ctx.assignedPeopleMap,
    statuses: ctx.statuses,
  }))
  if (groupBy === 'none') {
    return sorted.length > 0 ? [{ key: 'all', label: 'All tasks', todos: sorted }] : []
  }

  const groupingCtx: GroupingContext = {
    assignedPeopleMap: ctx.assignedPeopleMap,
    assignedTagsMap: ctx.assignedTagsMap,
    peopleById: assignedEntitiesById(ctx.assignedPeopleMap),
    tagsById: assignedEntitiesById(ctx.assignedTagsMap),
    statuses: ctx.statuses,
    today: ctx.today,
    weekStartsOn: ctx.weekStartsOn,
    urgentRange: ctx.urgentRange,
  }
  const restrict = restrictKeys({ ...spec, groupBy })
  const partition = partitionByGroup(sorted, groupBy, groupingCtx, undefined, restrict.keys)
  const groups = restrict.preferred ? preferGroups(partition.groups, restrict.preferred) : partition.groups
  const { ungrouped } = partition
  const peopleById = new Map(ctx.people.map((p) => [p.id, p] as const))

  const sections: Section[] = groups.map((g) => {
    switch (groupBy) {
      case 'deadline':
      case 'followup':
        return { key: g.key, label: g.label, accentColor: DATE_ACCENTS[g.key as DateBucketKey], todos: g.todos }
      case 'people': {
        const person = peopleById.get(Number(g.key.slice('person-'.length)))
        return { key: g.key, label: person?.name ?? g.label, accentColor: person?.color, todos: g.todos }
      }
      case 'status':
        return { key: g.key, label: g.label, accentColor: getGroupColor(g.key, 'status', groupingCtx), todos: g.todos }
      case 'tag':
        return { key: g.key, label: `#${g.label}`, accentColor: getGroupColor(g.key, 'tag', groupingCtx), todos: g.todos }
      case 'priority':
        return { key: g.key, label: g.label, accentColor: getGroupColor(g.key, 'priority', groupingCtx), todos: g.todos }
    }
  })

  if (ungrouped.length > 0 && restrict.keepUngrouped) {
    sections.push({ ...UNGROUPED_SECTION[groupBy], accentColor: UNGROUPED_ACCENT, todos: ungrouped })
  }
  return sections
}
