import type { PersistedTodoItem, Person, Status, Tag, TodoGroupBy, TodoSortBy } from '../models'
import { isTodoGroupBy } from '../models'
import { partitionByGroup, getGroupColor, type GroupingContext } from '../utils/task-grouping'
import { compareTodosByDate, pickTodoDate, type WeekStart } from '../utils/effective-date'
import { bySortOrder } from '../utils/sort-order'
import { startOfDay } from '../utils/date'
import { UNTAGGED_BUCKET_KEY, UNTAGGED_BUCKET_LABEL } from '../utils/bucket-by-tag'
import type { DateBucketKey } from '../utils/bucket-by-date'
import { manualOrderComparator, type ListRanks } from '../utils/list-order'
import { priorityRank } from '../utils/markers'
import type { UrgentDueWithinDays } from '../utils/urgency'

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
  /**
   * The list's effective person filter. When grouping by people, only these
   * people's sections are shown, in this order; a task assigned only to other
   * people is left out. Id `0` (the "unassigned" pick) keeps the trailing
   * Unassigned section. `null` / empty → every person gets a section.
   */
  restrictToPersonIds?: ReadonlyArray<number> | null
  /** Same for the tag filter when grouping by tag (no untagged section then). */
  restrictToTagIds?: ReadonlyArray<number> | null
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
  /** The app's "due date makes a task urgent" range, for the Priority sort; absent = flags only. */
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
}

/**
 * Comparator for a list's sort. Applied before grouping; grouping keeps input
 * order, so every section comes out sorted.
 *
 * - `manual` — the list's ranks when given (`manualOrderComparator`: ranked
 *   first, then unranked oldest first), else `sortOrder` (then id).
 * - `name` — alphabetical title, ties by `sortOrder`.
 * - `deadline` / `followup` — ascending date, undated last, ties by `sortOrder`.
 * - `created` — oldest first by `createdAt`, ties by `sortOrder`.
 * - `priority` — Focus, then Urgent + Important, Urgent, Important, none
 *   (`priorityRank`; Urgent includes due soon); ties by due date (undated
 *   last), then manual order.
 * - `people` / `status` — no ordering of their own; they fall back to manual
 *   order (as does a stored value this build doesn't know).
 */
export function listSortComparator(
  sortBy: TodoSortBy,
  ctx: ListSortContext = {},
): (a: PersistedTodoItem, b: PersistedTodoItem) => number {
  const { manualRanks } = ctx
  if (sortBy === 'manual' && manualRanks) return manualOrderComparator(manualRanks)
  switch (sortBy) {
    case 'priority':
      return priorityComparator(ctx)
    case 'name':
      return (a, b) => a.title.localeCompare(b.title) || bySortOrder(a, b)
    case 'deadline':
    case 'followup':
      return compareTodosByDate(sortBy)
    case 'created':
      return (a, b) => (a.createdAt.getTime() - b.createdAt.getTime()) || bySortOrder(a, b)
    case 'manual':
    case 'people':
    case 'status':
      return bySortOrder
  }
  return bySortOrder
}

/** The Priority sort: rank, then due date (undated last), then manual order. */
function priorityComparator(ctx: ListSortContext): (a: PersistedTodoItem, b: PersistedTodoItem) => number {
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
    const byRank = rankOf(a) - rankOf(b)
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
  today: 'var(--color-accent)',
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
}

/** Whether `key` is the trailing "No …" / "Unassigned" section of `groupBy`. */
export function isUngroupedSectionKey(groupBy: TodoGroupBy, key: string): boolean {
  return groupBy !== 'none' && UNGROUPED_SECTION[groupBy]?.key === key
}

function restrictKeys(spec: ListSectionsSpec): { keys?: string[]; keepUngrouped: boolean } {
  const ids =
    spec.groupBy === 'people' ? spec.restrictToPersonIds
    : spec.groupBy === 'tag' ? spec.restrictToTagIds
    : null
  if (!ids || ids.length === 0) return { keepUngrouped: true }
  const prefix = spec.groupBy === 'people' ? 'person-' : 'tag-'
  return {
    keys: ids.filter((id) => id !== 0).map((id) => `${prefix}${id}`),
    keepUngrouped: spec.groupBy === 'people' && ids.includes(0),
  }
}

/**
 * Sort `members` and split them into sections for `spec.groupBy`.
 *
 * Group order: dates Overdue → Today → This Week → Later; status by its
 * registry `sortOrder`; people and tags alphabetically (or in the
 * restrict order). A task with several people / tags appears in each of
 * their sections. Tasks with no value on the axis trail in one
 * "No …" / "Unassigned" section. Ungrouped lists return one `all` section
 * (none when empty).
 */
export function buildListSections(
  members: readonly PersistedTodoItem[],
  spec: ListSectionsSpec,
  ctx: ListSectionsContext,
): Section[] {
  // A stored grouping this build doesn't know reads as ungrouped rather than
  // breaking the surface.
  const groupBy = isTodoGroupBy(spec.groupBy) ? spec.groupBy : 'none'
  const sorted = [...members].sort(listSortComparator(spec.sortBy, { manualRanks: ctx.manualRanks, today: ctx.today, urgentRange: ctx.urgentRange }))
  if (groupBy === 'none') {
    return sorted.length > 0 ? [{ key: 'all', label: 'All tasks', todos: sorted }] : []
  }

  const groupingCtx: GroupingContext = {
    assignedPeopleMap: ctx.assignedPeopleMap,
    assignedTagsMap: ctx.assignedTagsMap,
    statuses: ctx.statuses,
    today: ctx.today,
    weekStartsOn: ctx.weekStartsOn,
  }
  const restrict = restrictKeys({ ...spec, groupBy })
  // An empty restrict set means "nothing named" (only the unassigned pick):
  // pass a key no task has so every assigned task drops out.
  const restrictSet = restrict.keys && restrict.keys.length === 0 ? ['person-0'] : restrict.keys
  const { groups, ungrouped } = partitionByGroup(sorted, groupBy, groupingCtx, undefined, restrictSet)
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
    }
  })

  if (ungrouped.length > 0 && restrict.keepUngrouped) {
    sections.push({ ...UNGROUPED_SECTION[groupBy], accentColor: UNGROUPED_ACCENT, todos: ungrouped })
  }
  return sections
}
