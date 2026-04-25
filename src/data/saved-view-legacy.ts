import type {
  ListSortBy,
  ListGroupBy,
  ListItemSortBy,
  DateField,
  Status,
  TodoPredicate,
} from '../models'
import type { ListDefinition } from '../models/list-definition'
import { readDateAnchor } from '../utils/date-anchor'
import { encodeGroupSort, resolveSavedViewGrouping } from '../utils/list-view-encoding'

/**
 * Legacy SavedView types + migration-only composers. The pure runtime
 * encoders (`encodeGroupSort` / `resolveSavedViewGrouping` / `translateSortBy`)
 * live in `utils/list-view-encoding.ts` so views/components don't have to
 * reach into `data/` — only restore + the v39 migration call into this file.
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
