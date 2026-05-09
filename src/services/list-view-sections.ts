import type { PersistedTodoItem, Person, Project, Org, Status, Tag, ListItemSortBy } from '../models'
import { partitionByGroup, getGroupColor, type GroupingContext } from '../utils/task-grouping'
import { bucketByDate, type DateBucketKey } from '../utils/bucket-by-date'
import { startOfToday, startOfDay } from '../utils/date'
import { effectiveDate, resolveScheduled, type WeekStart } from '../utils/effective-date'
import { resolvePersonColor } from '../utils/person-color'
import { UNTAGGED_BUCKET_KEY, UNTAGGED_BUCKET_LABEL } from '../utils/bucket-by-tag'

export interface Section {
  key: string
  label: string
  accentColor?: string
  todos: PersistedTodoItem[]
}

type DateBucketField = 'date' | 'scheduled' | 'deadline'

function pickBucketDate(todo: PersistedTodoItem, field: DateBucketField, today: Date, weekStartsOn: WeekStart): Date | null {
  switch (field) {
    case 'date': return effectiveDate(todo, today, weekStartsOn)
    case 'scheduled': return todo.scheduledDate ? resolveScheduled(todo.scheduledDate, today, weekStartsOn) : null
    case 'deadline': return todo.dueDate ? startOfDay(new Date(todo.dueDate)) : null
  }
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
  field: DateBucketField,
  today: Date,
  weekStartsOn: WeekStart,
  noDateLabel: string,
): Section[] {
  const getDate = (t: PersistedTodoItem): Date | null => pickBucketDate(t, field, today, weekStartsOn)
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

export function buildDateSections(todos: PersistedTodoItem[], weekStartsOn: WeekStart, today: Date = startOfToday()): Section[] {
  return buildBucketSections(todos, 'date', today, weekStartsOn, 'No Date')
}

export function buildScheduledSections(todos: PersistedTodoItem[], weekStartsOn: WeekStart, today: Date = startOfToday()): Section[] {
  return buildBucketSections(todos, 'scheduled', today, weekStartsOn, 'Not Scheduled')
}

export function buildDeadlineSections(todos: PersistedTodoItem[], weekStartsOn: WeekStart, today: Date = startOfToday()): Section[] {
  return buildBucketSections(todos, 'deadline', today, weekStartsOn, 'No Deadline')
}

/**
 * People grouping. Adapter over `partitionByGroup`.
 *
 * Group-by-people emits one section per assigned person, period — no
 * org-first short-circuit, no `filteredOrgIds`-driven `visiblePeople`
 * narrowing. Filtering and grouping are independent axes: `personFilterMode`
 * / `orgFilterMode` already gives finer-grained control over who reaches
 * the partition. `orgs` + `personOrgMap` are kept on the signature so the
 * post-step can resolve a per-section accent via `resolvePersonColor` (the
 * person's first assigned org's color).
 *
 * Sentinel rule: `Unassigned` rendered only in legacy mode when `ungrouped`
 * is non-empty. Restrict mode silently drops `ungrouped` (axis-mismatched
 * tasks shouldn't surface as Unassigned).
 */
export function buildPeopleSections(
  todos: PersistedTodoItem[],
  people: Person[],
  assignedPeopleMap: Map<number, Person[]>,
  orgs?: Org[],
  personOrgMap?: Map<number, number[]>,
  /**
   * P6 (item 1) intersection rule: when groupBy=people AND the active
   * filter narrows to specific people, restrict the visible person
   * sections to these ids AND tier-order them — direct-tier (any task
   * emitted under the section via direct person assignment) first;
   * implicit-tier (all emits came via the cross-axis include-orgs
   * callback) at the bottom of the person block. Tasks whose
   * intersection is empty are skipped (NOT routed to "Unassigned" — the
   * filter pass shouldn't have let an axis-mismatched task through).
   *
   * `null`/`undefined`/empty → existing behavior (every assigned person
   * gets a section, alphabetical via `partitionByGroup`).
   */
  restrictToPersonIds?: ReadonlyArray<number> | null,
  /**
   * P6 cross-axis lookup. Only consulted when `restrictToPersonIds` is
   * non-empty. For `personFilterMode === 'include-orgs'`: returns the
   * personIds of members of the task's direct orgs. For `'direct-only'`:
   * pass `undefined` (no implicit path — tasks that survived the filter
   * via direct assignment are the only emit path).
   */
  implicitPersonIdsFor?: (todo: PersistedTodoItem) => readonly number[],
): Section[] {
  const restrictSet = restrictToPersonIds && restrictToPersonIds.length > 0
    ? new Set<number>(restrictToPersonIds)
    : null

  const ctx: GroupingContext = {
    assignedPeopleMap,
    assignedOrgsMap: new Map(),
    assignedTagsMap: new Map(),
    statuses: [],
    orgs: orgs ?? [],
    personOrgMap: personOrgMap ?? new Map(),
    today: startOfToday(),
    weekStartsOn: 0,
  }

  const restrictToFilterSet =
    restrictToPersonIds && restrictToPersonIds.length > 0
      ? restrictToPersonIds.map((id) => `person-${id}`)
      : undefined

  const implicitKeysFor = implicitPersonIdsFor
    ? (todo: PersistedTodoItem): readonly string[] =>
        implicitPersonIdsFor(todo).map((id) => `person-${id}`)
    : undefined

  const { groups, ungrouped } = partitionByGroup(
    todos,
    'people',
    ctx,
    undefined,
    restrictToFilterSet,
    implicitKeysFor,
  )

  // `g.label` from `partitionByGroup` resolves names by scanning
  // `ctx.assignedPeopleMap`, which misses implicit-tier people (no task
  // directly assigns them — they only emerge via the cross-axis
  // include-orgs callback). Look up via the `people` registry instead.
  const sections: Section[] = groups.map((g) => {
    const personId = Number(g.key.slice('person-'.length))
    const personEntry = people.find((p) => p.id === personId)
    return {
      key: g.key,
      label: personEntry?.name ?? '',
      accentColor: orgs && personOrgMap
        ? resolvePersonColor(personId, personOrgMap, orgs)
        : undefined,
      todos: g.todos,
    }
  })

  if (!restrictSet && ungrouped.length > 0) {
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
    assignedOrgsMap: new Map(),
    assignedTagsMap: new Map(),
    statuses: [],
    orgs: [],
    personOrgMap: new Map(),
    today: startOfToday(),
    weekStartsOn: 0,
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
 * Org grouping. Adapter over `partitionByGroup`.
 *
 * One ListView-only concern rides on top of the core partition:
 * **`filteredOrgIds`-driven visibility (legacy mode only)**: when an org
 * filter is active, only orgs in the filter set are emitable. Implemented
 * by reshaping `assignedOrgsMap` so `getGroupKey` only emits visible-org
 * keys. Tasks with no visible direct orgs fall to `ungrouped` → render as
 * `No Organization` only when `showNoOrg` is true (`!filteredOrgIds ||
 * filteredOrgIds.has(0)`).
 *
 * Person→org inference (legacy mode) was retired in
 * grouping-cross-surface-convergence-2026-04-29 P3 — group-by-org now
 * means "show direct-org assignments only", matching every other surface.
 * Restrict-mode `implicitOrgIdsFor` (the `'include-people'` filter mode)
 * stays — it's filter-driven, not grouping-driven.
 *
 * Sentinel rule: `No Organization` rendered iff legacy mode AND
 * `ungrouped.length > 0` AND `showNoOrg`. Restrict mode silently drops
 * ungrouped (axis-mismatched tasks shouldn't surface as no-org).
 */
export function buildOrgSections(
  todos: PersistedTodoItem[],
  orgs: Org[],
  assignedOrgsMap: Map<number, Org[]>,
  personOrgMap: Map<number, number[]>,
  filteredOrgIds?: Set<number> | null,
  /**
   * P6 (item 1) intersection rule: when groupBy=org AND the active
   * filter narrows to specific orgs, restrict the visible org sections
   * to these ids AND tier-order them — direct-tier (any task emitted
   * via direct org assignment) first; implicit-tier (all emits via the
   * cross-axis people→orgs membership callback) at the bottom.
   * `null`/`undefined`/empty → existing behavior (direct + person-org
   * emits collapsed into one entry per visible org).
   */
  restrictToOrgIds?: ReadonlyArray<number> | null,
  /**
   * P6 cross-axis lookup. Only consulted when `restrictToOrgIds` is
   * non-empty. For `orgFilterMode === 'include-people'`: returns the
   * orgIds reachable through the task's directly-assigned people via
   * `personOrgMap`. For `'direct-only'`: pass `undefined` (no implicit
   * path).
   */
  implicitOrgIdsFor?: (todo: PersistedTodoItem) => readonly number[],
): Section[] {
  const visibleOrgs = filteredOrgIds ? orgs.filter((o) => filteredOrgIds.has(o.id!)) : orgs
  const visibleOrgIdSet = new Set(visibleOrgs.map((o) => o.id!))
  const restrictSet = restrictToOrgIds && restrictToOrgIds.length > 0
    ? new Set<number>(restrictToOrgIds)
    : null

  const showNoOrg = !restrictSet && (!filteredOrgIds || filteredOrgIds.has(0))

  // Pre-step (legacy mode only): filter `assignedOrgsMap` so `getGroupKey`
  // only emits visible-org keys. Tasks with only-filtered-out direct orgs
  // fall to `ungrouped`. Restrict mode passes the unfiltered map; the
  // `restrictToFilterSet` narrowing happens inside `partitionByGroup`.
  const filteredAssignedOrgsMap: Map<number, Org[]> = (restrictSet || !filteredOrgIds)
    ? assignedOrgsMap
    : (() => {
        const out = new Map<number, Org[]>()
        for (const [todoId, orgArr] of assignedOrgsMap) {
          const filtered = orgArr.filter((o) => o.id != null && visibleOrgIdSet.has(o.id))
          if (filtered.length > 0) out.set(todoId, filtered)
        }
        return out
      })()

  const ctx: GroupingContext = {
    assignedPeopleMap: new Map(),
    assignedOrgsMap: filteredAssignedOrgsMap,
    assignedTagsMap: new Map(),
    statuses: [],
    orgs,
    personOrgMap,
    today: startOfToday(),
    weekStartsOn: 0,
  }

  const restrictToFilterSet = restrictSet
    ? Array.from(restrictSet).map((id) => `org-${id}`)
    : undefined

  const implicitKeysFor = restrictSet && implicitOrgIdsFor
    ? (todo: PersistedTodoItem): readonly string[] =>
        implicitOrgIdsFor(todo).map((id) => `org-${id}`)
    : undefined

  const { groups, ungrouped } = partitionByGroup(
    todos,
    'org',
    ctx,
    undefined,
    restrictToFilterSet,
    implicitKeysFor,
  )

  // Section labels/colors come from the `orgs` registry — `g.label` /
  // `getGroupColor` look at `ctx.assignedOrgsMap` which misses orgs that
  // only emerge via `implicitKeysFor` (no task directly assigns them).
  // Mirrors P3's adapter pattern for people.
  const groupsByKey = new Map(groups.map((g) => [g.key, g] as const))

  let orgSections: Section[]
  if (restrictSet) {
    // Restrict mode: tier-aware ordering already encoded in `groups`.
    orgSections = groups.map((g) => {
      const id = Number(g.key.slice('org-'.length))
      const orgEntry = orgs.find((o) => o.id === id)
      return {
        key: g.key,
        label: orgEntry?.name ?? '',
        accentColor: orgEntry?.color,
        todos: g.todos,
      }
    })
  } else {
    // Legacy mode: iterate `visibleOrgs` in registry order so additional-key
    // emits (which `getGroupLabel` sees as '') don't drift to the front.
    orgSections = []
    for (const o of visibleOrgs) {
      const g = groupsByKey.get(`org-${o.id}`)
      if (g && g.todos.length > 0) {
        orgSections.push({
          key: g.key,
          label: o.name,
          accentColor: o.color,
          todos: g.todos,
        })
      }
    }
  }

  const sections: Section[] = [...orgSections]
  if (showNoOrg && ungrouped.length > 0) {
    sections.push({ key: 'no-org', label: 'No Organization', todos: ungrouped })
  }
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
    assignedOrgsMap: new Map(),
    assignedTagsMap: new Map(),
    statuses,
    orgs: [],
    personOrgMap: new Map(),
    today: startOfToday(),
    weekStartsOn: 0,
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
 * Tags have no cross-axis path, so no `implicitKeysFor` callback.
 */
export function buildTagSections(
  todos: PersistedTodoItem[],
  assignedTagsMap: Map<number, Tag[]>,
  /**
   * P6 (item 1) intersection rule: when groupBy=tag AND the filter has
   * tags non-empty, restrict the visible tag sections to these ids in
   * caller order. Tags have no cross-axis path — every emit is direct,
   * so tier ordering reduces to caller-order dedup.
   */
  restrictToTagIds?: ReadonlyArray<number> | null,
): Section[] {
  const ctx: GroupingContext = {
    assignedPeopleMap: new Map(),
    assignedOrgsMap: new Map(),
    assignedTagsMap,
    statuses: [],
    orgs: [],
    personOrgMap: new Map(),
    today: startOfToday(),
    weekStartsOn: 0,
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
  weekStartsOn: WeekStart,
  today: Date = startOfToday(),
): ((a: PersistedTodoItem, b: PersistedTodoItem) => number) | undefined {
  if (sortBy === 'manual') return undefined
  if (sortBy === 'name') {
    return (a, b) => {
      const cmp = a.title.localeCompare(b.title)
      if (cmp !== 0) return cmp
      return ((a.sortOrder ?? 0) - (b.sortOrder ?? 0)) || (a.id - b.id)
    }
  }
  const pick = (t: PersistedTodoItem): Date | null => {
    if (sortBy === 'date') return effectiveDate(t, today, weekStartsOn)
    if (sortBy === 'scheduled') return t.scheduledDate ? resolveScheduled(t.scheduledDate, today, weekStartsOn) : null
    return t.dueDate ? new Date(t.dueDate) : null
  }
  return (a, b) => {
    const ad = pick(a)
    const bd = pick(b)
    if (ad === null && bd === null) {
      return ((a.sortOrder ?? 0) - (b.sortOrder ?? 0)) || (a.id - b.id)
    }
    if (ad === null) return 1
    if (bd === null) return -1
    const cmp = ad.getTime() - bd.getTime()
    if (cmp !== 0) return cmp
    return ((a.sortOrder ?? 0) - (b.sortOrder ?? 0)) || (a.id - b.id)
  }
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
