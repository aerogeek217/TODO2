import type {
  ListSortBy,
  ListGroupBy,
  ListItemSortBy,
  DateField,
  Status,
  TodoPredicate,
} from '../models'
import type { ListGrouping, ListSort, ListDefinition } from '../models/list-definition'
import { readDateAnchor } from '../utils/date-anchor'

/**
 * Legacy SavedView types. Kept here (not re-exported as models) so the v39
 * migration + restore pass can translate pre-v39 rows into `ListDefinition`s
 * without resurrecting the SavedView runtime surface.
 */
export interface LegacySavedViewFilters extends Partial<TodoPredicate> {
  priorities?: number[] | null
  completedFilter?: string
  assignedFilter?: string
  followupFilter?: string
  showAssigned?: boolean
  starredOnly?: boolean
  hardDeadlineOnly?: boolean
  dateRangeIncludeNoDue?: boolean
}

export interface LegacySavedView {
  id?: number
  name: string
  sortBy: ListSortBy
  groupBy?: ListGroupBy
  itemSortBy?: ListItemSortBy
  filters: LegacySavedViewFilters
  sortOrder: number
  maxTasks?: number
  limitMode?: 'hard' | 'scroll'
}

/**
 * Translate a persisted saved-view sortBy value into the current `ListSortBy`.
 * Legacy tokens (`priority`, `due`, `tag`) fold to `'date'` so old rows still
 * produce a readable group.
 */
export function translateSortBy(sortBy: string): ListSortBy {
  if (sortBy === 'priority' || sortBy === 'due' || sortBy === 'tag') return 'date'
  if (sortBy === 'date' || sortBy === 'scheduled' || sortBy === 'deadline'
      || sortBy === 'people'
      || sortBy === 'project' || sortBy === 'org' || sortBy === 'status') {
    return sortBy
  }
  return 'date'
}

/**
 * Resolve grouping + within-group sort from a persisted saved view, falling
 * back to the legacy single `sortBy` field for views saved before group/sort
 * were split.
 */
export function resolveSavedViewGrouping(v: { sortBy: string; groupBy?: ListGroupBy; itemSortBy?: ListItemSortBy }): {
  groupBy: ListGroupBy
  itemSortBy: ListItemSortBy
} {
  const groupBy: ListGroupBy = v.groupBy ?? translateSortBy(v.sortBy)
  const itemSortBy: ListItemSortBy = v.itemSortBy ?? 'manual'
  return { groupBy, itemSortBy }
}

/**
 * Encode runtime group/sort choice into a list-definition's `sort` + `grouping`.
 * Moved here from `ListView.tsx` so the save path and the v39 migration share
 * one encoder.
 */
export function encodeGroupSort(
  groupBy: ListGroupBy,
  itemSortBy: ListItemSortBy,
): { sort: ListSort; grouping: ListGrouping } {
  const sort: ListSort = itemSortBy === 'manual'
    ? { kind: 'sort-order' }
    : { kind: 'sortBy', by: itemSortBy }

  let grouping: ListGrouping
  if (groupBy === 'none') {
    grouping = { kind: 'none' }
  } else if (groupBy === 'tag') {
    grouping = { kind: 'by-tag' }
  } else if (itemSortBy !== 'manual' && groupBy === itemSortBy) {
    grouping = { kind: 'by-sortBy' }
  } else {
    grouping = { kind: 'by-field', by: groupBy }
  }
  return { sort, grouping }
}

/**
 * Translate a `LegacySavedViewFilters` bag into a serializable `TodoPredicate`.
 * Mirrors the runtime `savedFiltersToRuntime` translation in spirit but emits
 * arrays (not Sets) so the result can live directly inside
 * `ListDefinition.membership.predicate`.
 *
 * `seededAssignedId` / `seededFollowupId` come from `settings` so the legacy
 * starred / assigned / follow-up filters can resolve to concrete status ids
 * when the seeds are still present. `allStatuses` is used for the inverse-set
 * translations (`unassigned`, `no-followup`).
 */
export function savedFiltersToPredicate(
  s: LegacySavedViewFilters,
  seededAssignedId: number | null = null,
  seededFollowupId: number | null = null,
  allStatuses: Status[] = [],
): TodoPredicate {
  const hasLegacyFormat = s.completedFilter !== undefined
    || s.assignedFilter !== undefined
    || s.followupFilter !== undefined
    || s.starredOnly !== undefined

  let showCompleted: boolean
  let showHiddenStatuses: boolean
  let statusIds: number[] | null = s.statusIds ? [...s.statusIds] : null

  if (hasLegacyFormat) {
    const cf = s.completedFilter as string | undefined
    showCompleted = cf === 'all' || cf === 'completed' || (cf === undefined && s.showCompleted === true)

    const af = s.assignedFilter as string | undefined
    showHiddenStatuses = false
    if (af === 'all') {
      showHiddenStatuses = true
    } else if (af === 'assigned' && seededAssignedId != null) {
      statusIds = [seededAssignedId]
      showHiddenStatuses = true
    } else if (af === 'unassigned' && seededAssignedId != null) {
      const inverseIds = allStatuses.filter(st => st.id != null && st.id !== seededAssignedId).map(st => st.id!)
      statusIds = [...inverseIds, 0]
    }

    const ff = s.followupFilter as string | undefined
    const isStarredFilter = ff === 'followup' || s.starredOnly === true
    const isNoFollowupFilter = ff === 'no-followup'
    if (isStarredFilter && seededFollowupId != null) {
      statusIds = [seededFollowupId]
    } else if (isNoFollowupFilter && seededFollowupId != null) {
      const inverseIds = allStatuses.filter(st => st.id != null && st.id !== seededFollowupId).map(st => st.id!)
      statusIds = [...inverseIds, 0]
    }
  } else {
    showCompleted = s.showCompleted ?? false
    showHiddenStatuses = s.showHiddenStatuses ?? false
  }

  const dateFieldRaw = s.dateField as string | undefined
  const dateField: DateField =
    dateFieldRaw === 'created' ? 'created'
    : dateFieldRaw === 'modified' ? 'modified'
    : dateFieldRaw === 'scheduled' ? 'scheduled'
    : dateFieldRaw === 'deadline' ? 'deadline'
    : 'date'

  const dateRangeIncludeNoDate = typeof s.dateRangeIncludeNoDate === 'boolean'
    ? s.dateRangeIncludeNoDate
    : typeof s.dateRangeIncludeNoDue === 'boolean'
      ? s.dateRangeIncludeNoDue
      : false

  return {
    showCompleted,
    showHiddenStatuses,
    personIds: s.personIds ? [...s.personIds] : null,
    personFilterMode: s.personFilterMode === 'direct-only' ? 'direct-only' : 'include-orgs',
    orgIds: s.orgIds ? [...s.orgIds] : null,
    orgFilterMode: s.orgFilterMode === 'direct-only' ? 'direct-only' : 'include-people',
    projectIds: s.projectIds ? [...s.projectIds] : null,
    statusIds,
    searchText: '',
    dateField,
    dateRangeStart: readDateAnchor(s.dateRangeStart),
    dateRangeEnd: readDateAnchor(s.dateRangeEnd),
    dateRangeIncludeNoDate,
    hasScheduled: s.hasScheduled ?? null,
    hasDeadline: s.hasDeadline ?? null,
    tags: s.tags ? [...s.tags] : null,
  }
}

/**
 * Compose a full `ListDefinition` (minus `id` + `sortOrder`) from a legacy
 * saved-view row. Used by the v39 migration and by restore-time translation
 * of pre-v39 backups. The resulting row is:
 *   - `favorited: true` (saved views become Favorites by default)
 *   - `pinnedToDashboard: false` (they were never Dashboard cards)
 *   - membership as a custom predicate via `savedFiltersToPredicate`
 *   - sort + grouping via `encodeGroupSort` on the resolved group/sort
 *   - `maxTasks` / `limitMode` copied through when set
 */
export function savedViewToListDefinition(
  sv: LegacySavedView,
  seededAssignedId: number | null = null,
  seededFollowupId: number | null = null,
  allStatuses: Status[] = [],
): Omit<ListDefinition, 'id' | 'sortOrder'> {
  const { groupBy, itemSortBy } = resolveSavedViewGrouping(sv)
  const { sort, grouping } = encodeGroupSort(groupBy, itemSortBy)
  const predicate = savedFiltersToPredicate(sv.filters, seededAssignedId, seededFollowupId, allStatuses)
  return {
    name: sv.name,
    favorited: true,
    pinnedToDashboard: false,
    membership: { kind: 'custom', predicate },
    sort,
    grouping,
    ...(sv.maxTasks != null ? { maxTasks: sv.maxTasks } : {}),
    ...(sv.limitMode != null ? { limitMode: sv.limitMode } : {}),
  }
}
