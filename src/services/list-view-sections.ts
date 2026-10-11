import type { PersistedTodoItem, Person, Project, Status, Tag, ListItemSortBy } from '../models'
import { partitionByGroup, getGroupColor, type GroupingContext } from '../utils/task-grouping'
import { bucketByDate, type DateBucketKey } from '../utils/bucket-by-date'
import { startOfToday } from '../utils/date'
import { compareTodosByDate, pickTodoDate, type TodoDateField, type WeekStart } from '../utils/effective-date'
import { bySortOrder } from '../utils/sort-order'
import { UNTAGGED_BUCKET_KEY, UNTAGGED_BUCKET_LABEL } from '../utils/bucket-by-tag'

export interface Section {
  key: string
  label: string
  accentColor?: string
  todos: PersistedTodoItem[]
}

const DATE_LIST_WINDOWS: readonly DateBucketKey[] = ['overdue', 'today', 'thisWeek', 'later']

const DATE_LIST_META: Partial<Record<DateBucketKey, { sectionKey: string; label: string; accentColor?: string }>> = {
  overdue: { sectionKey: 'overdue', label: 'Overdue', accentColor: 'var(--color-danger)' },
  today: { sectionKey: 'today', label: 'Today', accentColor: 'var(--color-accent)' },
  // Section key stays `'week'` for parity with prior call sites; the bucket
  // primitive's `thisWeek` keys it on calendar week boundaries (the migration
  // intentionally drops the rolling-7-day window).
  thisWeek: { sectionKey: 'week', label: 'This Week', accentColor: 'var(--color-accent)' },
  later: { sectionKey: 'later', label: 'Later' },
}

function buildBucketSections(
  todos: PersistedTodoItem[],
  field: TodoDateField,
  today: Date,
  weekStartsOn: WeekStart,
  noDateLabel: string,
): Section[] {
  const getDate = (t: PersistedTodoItem): Date | null => pickTodoDate(t, field)
  const { buckets, noDate } = bucketByDate(todos, getDate, today, weekStartsOn, DATE_LIST_WINDOWS)
  const sections: Section[] = []
  for (const b of buckets) {
    const meta = DATE_LIST_META[b.key]
    if (!meta) continue
    sections.push({ key: meta.sectionKey, label: meta.label, accentColor: meta.accentColor, todos: b.todos })
  }
  if (noDate.length > 0) sections.push({ key: 'none', label: noDateLabel, todos: noDate })
  return sections
}

export function buildFlatSection(todos: PersistedTodoItem[]): Section[] {
  if (todos.length === 0) return []
  return [{ key: 'all', label: 'All tasks', todos }]
}

export function buildDeadlineSections(todos: PersistedTodoItem[], weekStartsOn: WeekStart, today: Date = startOfToday()): Section[] {
  return buildBucketSections(todos, 'deadline', today, weekStartsOn, 'No Due Date')
}

export function buildFollowupSections(todos: PersistedTodoItem[], weekStartsOn: WeekStart, today: Date = startOfToday()): Section[] {
  return buildBucketSections(todos, 'followup', today, weekStartsOn, 'No Follow-up')
}

/**
 * People grouping. Adapter over `partitionByGroup`: one section per assigned
 * person (accent = the person's color), then `Unassigned`.
 *
 * `restrictToPersonIds`: when groupBy=people AND the active filter narrows
 * to specific people, only those people's sections are shown, in that
 * order; tasks assigned only to other people are skipped and `Unassigned`
 * is not rendered (the filter's unassigned sentinel keeps the ungrouped
 * tasks out of every section). `null`/`undefined`/empty → every assigned
 * person gets a section, alphabetical.
 */
export function buildPeopleSections(
  todos: PersistedTodoItem[],
  people: Person[],
  assignedPeopleMap: Map<number, Person[]>,
  restrictToPersonIds?: ReadonlyArray<number> | null,
): Section[] {
  const ctx: GroupingContext = {
    assignedPeopleMap,
    assignedTagsMap: new Map(),
    statuses: [],
    today: startOfToday(),
  }

  const restrictToFilterSet =
    restrictToPersonIds && restrictToPersonIds.length > 0
      ? restrictToPersonIds.map((id) => `person-${id}`)
      : undefined

  const { groups, ungrouped } = partitionByGroup(
    todos,
    'people',
    ctx,
    undefined,
    restrictToFilterSet,
  )

  const sections: Section[] = groups.map((g) => {
    const personId = Number(g.key.slice('person-'.length))
    const personEntry = people.find((p) => p.id === personId)
    return {
      key: g.key,
      label: personEntry?.name ?? g.label,
      accentColor: personEntry?.color,
      todos: g.todos,
    }
  })

  if (!restrictToFilterSet && ungrouped.length > 0) {
    sections.push({ key: 'unassigned', label: 'Unassigned', todos: ungrouped })
  }
  return sections
}

/**
 * Project grouping. Adapter over `partitionByGroup`. Iterates the `projects`
 * registry in input order at the call site to preserve the ListView convention
 * of "registry order, empty buckets dropped, no-project sentinel last".
 */
export function buildProjectSections(
  todos: PersistedTodoItem[],
  projects: Project[],
): Section[] {
  const ctx: GroupingContext = {
    assignedPeopleMap: new Map(),
    assignedTagsMap: new Map(),
    statuses: [],
    today: startOfToday(),
  }
  const { groups, ungrouped } = partitionByGroup(todos, 'project', ctx)
  const groupsByKey = new Map(groups.map((g) => [g.key, g] as const))

  const sections: Section[] = []
  for (const p of projects) {
    const g = groupsByKey.get(`project-${p.id}`)
    if (g && g.todos.length > 0) {
      sections.push({ key: g.key, label: p.name, accentColor: 'var(--color-accent)', todos: g.todos })
    }
  }
  if (ungrouped.length > 0) sections.push({ key: 'no-project', label: 'No Project', todos: ungrouped })
  return sections
}

/**
 * Status grouping. Adapter over `partitionByGroup`. `partitionByGroup` already
 * orders status groups by registry `sortOrder` via `orderGroupKeys`, so the
 * adapter just maps through and appends the no-status sentinel.
 */
export function buildStatusSections(
  todos: PersistedTodoItem[],
  statuses: Status[],
): Section[] {
  const ctx: GroupingContext = {
    assignedPeopleMap: new Map(),
    assignedTagsMap: new Map(),
    statuses,
    today: startOfToday(),
  }
  const { groups, ungrouped } = partitionByGroup(todos, 'status', ctx)
  const sections: Section[] = groups.map((g) => ({
    key: g.key,
    label: g.label,
    accentColor: getGroupColor(g.key, 'status', ctx),
    todos: g.todos,
  }))
  if (ungrouped.length > 0) sections.push({ key: 'no-status', label: 'No Status', todos: ungrouped })
  return sections
}

/**
 * Tag grouping. Adapter over `partitionByGroup`: `tag-N` keys map to
 * `#name` labels with `tag.color` accents; untagged todos trail in a
 * single "No tag" bucket in legacy mode only — when filtering by tag
 * (restrict mode), the untagged trail is suppressed (the user has
 * narrowed to specific tags, so an "untagged" bucket is incoherent).
 */
export function buildTagSections(
  todos: PersistedTodoItem[],
  assignedTagsMap: Map<number, Tag[]>,
  /**
   * When groupBy=tag AND the filter has tags non-empty, restrict the
   * visible tag sections to these ids in caller order.
   */
  restrictToTagIds?: ReadonlyArray<number> | null,
): Section[] {
  const ctx: GroupingContext = {
    assignedPeopleMap: new Map(),
    assignedTagsMap,
    statuses: [],
    today: startOfToday(),
  }
  const restrictToFilterSet =
    restrictToTagIds && restrictToTagIds.length > 0
      ? restrictToTagIds.map((id) => `tag-${id}`)
      : undefined
  const { groups, ungrouped } = partitionByGroup(
    todos,
    'tag',
    ctx,
    undefined,
    restrictToFilterSet,
  )

  const sections: Section[] = groups.map((g) => ({
    key: g.key,
    label: `#${g.label}`,
    accentColor: getGroupColor(g.key, 'tag', ctx),
    todos: g.todos,
  }))
  if (ungrouped.length > 0 && !restrictToFilterSet) {
    sections.push({ key: UNTAGGED_BUCKET_KEY, label: UNTAGGED_BUCKET_LABEL, todos: ungrouped })
  }
  return sections
}

/**
 * Build a comparator for within-group sort. `'manual'` returns undefined so
 * the caller skips `.sort()` and preserves the upstream sortOrder order.
 */
export function itemSortComparator(
  sortBy: ListItemSortBy,
): ((a: PersistedTodoItem, b: PersistedTodoItem) => number) | undefined {
  if (sortBy === 'manual') return undefined
  if (sortBy === 'name') {
    return (a, b) => {
      const cmp = a.title.localeCompare(b.title)
      if (cmp !== 0) return cmp
      return bySortOrder(a, b)
    }
  }
  if (sortBy === 'deadline' || sortBy === 'followup') {
    return compareTodosByDate(sortBy)
  }
  // Categorical sort fields (created / people / project / status) aren't
  // exposed in `LIST_SORT_VALUES`; fall back to manual order if they leak in.
  return undefined
}

/**
 * Walk sections in order and truncate at the tail so the total task count
 * doesn't exceed `maxTasks`. Returns the clipped sections and how many tasks
 * were hidden.
 */
export function truncateSections(sections: Section[], maxTasks: number): { displaySections: Section[]; truncatedCount: number } {
  let remaining = maxTasks
  let dropped = 0
  const out: Section[] = []
  for (const s of sections) {
    if (remaining <= 0) {
      dropped += s.todos.length
      continue
    }
    if (s.todos.length <= remaining) {
      out.push(s)
      remaining -= s.todos.length
    } else {
      out.push({ ...s, todos: s.todos.slice(0, remaining) })
      dropped += s.todos.length - remaining
      remaining = 0
    }
  }
  return { displaySections: out, truncatedCount: dropped }
}
