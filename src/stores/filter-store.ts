import { create } from 'zustand'
import { Priority } from '../models'
import type { TodoItem, PersistedTodoItem, Person, Tag, Org, DateField, AssignedFilter, FollowupFilter, CompletedFilter } from '../models'
import { startOfDay } from '../utils/date'

export type OrgFilterMode = 'include-people' | 'direct-only'
export type PersonFilterMode = 'include-orgs' | 'direct-only'

export type { DateField, AssignedFilter, FollowupFilter, CompletedFilter }

export interface FilterCriteria {
  /** null = no filter (all shown); Set = only those in set are shown */
  priorities: Set<Priority> | null
  completedFilter: CompletedFilter
  assignedFilter: AssignedFilter
  followupFilter: FollowupFilter
  hardDeadlineOnly: boolean
  /** null = no filter (all shown); Set = only those in set are shown */
  personIds: Set<number> | null
  /** 'include-orgs' (default) also matches tasks with orgs the filter person belongs to; 'direct-only' matches only direct person assignment */
  personFilterMode: PersonFilterMode
  /** null = no filter (all shown); Set = only those in set are shown */
  tagIds: Set<number> | null
  /** null = no filter; Set = only people in these orgs are shown */
  orgIds: Set<number> | null
  /** 'include-people' (default) matches person-org + direct-org; 'direct-only' matches only direct org assignment */
  orgFilterMode: OrgFilterMode
  /** null = no filter; Set = only those statuses shown (0 = no status) */
  statusIds: Set<number> | null
  /** Empty string = no filter; non-empty = case-insensitive substring match on title */
  searchText: string
  /** Which date field to filter on: due, created, or modified */
  dateField: DateField
  /** null = no filter; Date = only show tasks with date on or after this date */
  dateRangeStart: Date | null
  /** null = open-ended; Date = only show tasks with date on or before this date */
  dateRangeEnd: Date | null
  /** When true and dateField is 'due', tasks with no dueDate are included in date range filter results */
  dateRangeIncludeNoDue: boolean
}

interface FilterState {
  filters: FilterCriteria
  /** Derived: true when any filter is active. Use useFilterStore(s => s.isActive) or getState().isActive. */
  readonly isActive: boolean

  setPriorities: (priorities: Set<Priority> | null) => void
  setCompletedFilter: (v: CompletedFilter) => void
  setAssignedFilter: (v: AssignedFilter) => void
  setFollowupFilter: (v: FollowupFilter) => void
  cycleCompletedFilter: () => void
  cycleFollowupFilter: () => void
  toggleHardDeadlineOnly: () => void
  setPersonIds: (personIds: Set<number> | null) => void
  setPersonFilterMode: (mode: PersonFilterMode) => void
  setTagIds: (tagIds: Set<number> | null) => void
  setOrgIds: (orgIds: Set<number> | null) => void
  setOrgFilterMode: (mode: OrgFilterMode) => void
  setStatusIds: (statusIds: Set<number> | null) => void
  setSearchText: (text: string) => void
  setDateField: (field: DateField) => void
  setDateRange: (start: Date | null, end: Date | null) => void
  setDateRangeIncludeNoDue: (include: boolean) => void
  setAllFilters: (filters: FilterCriteria) => void
  clearAll: () => void
  applyFilter: (todos: PersistedTodoItem[], assignedPeopleMap?: Map<number, Person[]>, assignedTagsMap?: Map<number, Tag[]>, personOrgMap?: Map<number, number[]>, assignedOrgsMap?: Map<number, Org[]>) => PersistedTodoItem[]
  matchesFilter: (todo: TodoItem, assignedPersonIds?: number[], assignedTagIds?: number[], assignedPersonOrgIds?: number[], directOrgIds?: number[], skipVisibility?: boolean, filterPersonOrgIds?: Set<number>) => boolean
}

const defaultFilters: FilterCriteria = {
  priorities: null,
  completedFilter: 'incomplete-only',
  assignedFilter: 'unassigned-only',
  followupFilter: 'all',
  hardDeadlineOnly: false,
  personIds: null,
  personFilterMode: 'include-orgs',
  tagIds: null,
  orgIds: null,
  orgFilterMode: 'include-people',
  statusIds: null,
  searchText: '',
  dateField: 'due',
  dateRangeStart: null,
  dateRangeEnd: null,
  dateRangeIncludeNoDue: false,
}

function isFilterActive(f: FilterCriteria): boolean {
  return f.priorities !== null || f.completedFilter !== 'incomplete-only' || f.assignedFilter !== 'unassigned-only' || f.followupFilter !== 'all' || f.hardDeadlineOnly || f.personIds !== null || f.tagIds !== null || f.orgIds !== null || f.statusIds !== null || f.searchText !== '' || f.dateRangeStart !== null || f.dateRangeEnd !== null
}

export function computeFilterPersonOrgIds(
  personIds: Set<number> | null,
  mode: PersonFilterMode,
  personOrgMap: Map<number, number[]> | undefined,
): Set<number> | undefined {
  if (mode !== 'include-orgs' || !personIds || personIds.size === 0 || !personOrgMap) return undefined
  const s = new Set<number>()
  for (const pid of personIds) {
    if (pid === 0) continue
    for (const oid of personOrgMap.get(pid) ?? []) s.add(oid)
  }
  return s.size > 0 ? s : undefined
}

function todoMatchesFilter(
  todo: TodoItem,
  filters: FilterCriteria,
  assignedPersonIds?: number[],
  assignedTagIds?: number[],
  assignedPersonOrgIds?: number[],
  directOrgIds?: number[],
  skipVisibility?: boolean,
  filterPersonOrgIds?: Set<number>,
): boolean {
  // "only" variants always hide (canvas + lists); regular variants hide only in lists (skipVisibility=false)
  if (filters.completedFilter === 'incomplete-only' && todo.isCompleted) return false
  if (filters.assignedFilter === 'unassigned-only' && todo.isAssigned) return false
  if (!skipVisibility) {
    if (filters.completedFilter === 'incomplete' && todo.isCompleted) return false
    if (filters.completedFilter === 'completed' && !todo.isCompleted) return false
    if (filters.assignedFilter === 'unassigned' && todo.isAssigned) return false
    if (filters.assignedFilter === 'assigned' && !todo.isAssigned) return false
  }
  if (filters.priorities !== null && !filters.priorities.has(todo.priority)) return false
  if (filters.searchText && !todo.title.toLowerCase().includes(filters.searchText.toLowerCase())) return false
  if (filters.followupFilter === 'followup' && !todo.isStarred) return false
  if (filters.followupFilter === 'no-followup' && todo.isStarred) return false
  if (filters.hardDeadlineOnly && !todo.isHardDeadline) return false
  if (filters.personIds !== null) {
    const hasPerson = !!assignedPersonIds && assignedPersonIds.length > 0
    const directPersonMatch = hasPerson && assignedPersonIds!.some((id) => filters.personIds!.has(id))
    const includeOrgs = filters.personFilterMode === 'include-orgs'
    const orgExpandedMatch = includeOrgs && !!filterPersonOrgIds && filterPersonOrgIds.size > 0
      && !!directOrgIds && directOrgIds.some((oid) => filterPersonOrgIds.has(oid))
    const unassignedSentinel = !hasPerson && filters.personIds.has(0)
    if (!directPersonMatch && !orgExpandedMatch && !unassignedSentinel) return false
  }
  if (filters.tagIds !== null) {
    const hasAssignment = assignedTagIds && assignedTagIds.length > 0
    if (!hasAssignment) {
      if (!filters.tagIds.has(0)) return false
    } else if (!assignedTagIds.some((id) => filters.tagIds!.has(id))) return false
  }
  if (filters.statusIds !== null) {
    const hasStatus = todo.statusId != null
    if (!hasStatus) {
      if (!filters.statusIds.has(0)) return false
    } else if (!filters.statusIds.has(todo.statusId!)) return false
  }
  if (filters.orgIds !== null) {
    const directOnly = filters.orgFilterMode === 'direct-only'
    const hasPersonOrg = !directOnly && assignedPersonOrgIds && assignedPersonOrgIds.length > 0
    const hasDirectOrg = directOrgIds && directOrgIds.length > 0
    if (!hasPersonOrg && !hasDirectOrg) {
      if (!filters.orgIds.has(0)) return false
    } else {
      const personOrgMatch = !directOnly && (assignedPersonOrgIds?.some((orgId) => filters.orgIds!.has(orgId)) ?? false)
      const directOrgMatch = directOrgIds?.some((orgId) => filters.orgIds!.has(orgId)) ?? false
      if (!personOrgMatch && !directOrgMatch) return false
    }
  }
  if (filters.dateRangeStart !== null || filters.dateRangeEnd !== null) {
    const rawDate = filters.dateField === 'due' ? todo.dueDate
      : filters.dateField === 'created' ? todo.createdAt
      : todo.modifiedAt
    if (!rawDate) {
      // Only dueDate can be absent; created/modified are always set
      if (!filters.dateRangeIncludeNoDue) return false
    } else {
      const d = startOfDay(new Date(rawDate))
      if (filters.dateRangeStart !== null) {
        const start = startOfDay(new Date(filters.dateRangeStart))
        if (d < start) return false
      }
      if (filters.dateRangeEnd !== null) {
        const end = new Date(filters.dateRangeEnd)
        end.setHours(23, 59, 59, 999)
        if (d > end) return false
      }
    }
  }
  return true
}

function commit(set: (s: Partial<FilterState>) => void, filters: FilterCriteria) {
  set({ filters, isActive: isFilterActive(filters) })
}

export const useFilterStore = create<FilterState>((set, get) => ({
  filters: { ...defaultFilters },
  isActive: false,

  setPriorities(priorities: Set<Priority> | null) {
    commit(set, { ...get().filters, priorities })
  },

  setCompletedFilter(completedFilter: CompletedFilter) {
    commit(set, { ...get().filters, completedFilter })
  },

  setAssignedFilter(assignedFilter: AssignedFilter) {
    commit(set, { ...get().filters, assignedFilter })
  },

  setFollowupFilter(followupFilter: FollowupFilter) {
    commit(set, { ...get().filters, followupFilter })
  },

  cycleCompletedFilter() {
    const { filters } = get()
    const cycle: CompletedFilter[] = ['incomplete', 'all', 'completed', 'incomplete-only']
    const idx = cycle.indexOf(filters.completedFilter)
    const next = cycle[(idx + 1) % cycle.length]
    commit(set, { ...filters, completedFilter: next })
  },

  cycleFollowupFilter() {
    const { filters } = get()
    const next: FollowupFilter = filters.followupFilter === 'all' ? 'followup' : filters.followupFilter === 'followup' ? 'no-followup' : 'all'
    commit(set, { ...filters, followupFilter: next })
  },

  toggleHardDeadlineOnly() {
    const { filters } = get()
    commit(set, { ...filters, hardDeadlineOnly: !filters.hardDeadlineOnly })
  },

  setPersonIds(personIds: Set<number> | null) {
    commit(set, { ...get().filters, personIds })
  },

  setPersonFilterMode(personFilterMode: PersonFilterMode) {
    commit(set, { ...get().filters, personFilterMode })
  },

  setTagIds(tagIds: Set<number> | null) {
    commit(set, { ...get().filters, tagIds })
  },

  setOrgIds(orgIds: Set<number> | null) {
    commit(set, { ...get().filters, orgIds })
  },

  setOrgFilterMode(orgFilterMode: OrgFilterMode) {
    commit(set, { ...get().filters, orgFilterMode })
  },

  setStatusIds(statusIds: Set<number> | null) {
    commit(set, { ...get().filters, statusIds })
  },

  setSearchText(searchText: string) {
    commit(set, { ...get().filters, searchText })
  },

  setDateField(dateField: DateField) {
    commit(set, { ...get().filters, dateField })
  },

  setDateRange(dateRangeStart: Date | null, dateRangeEnd: Date | null) {
    commit(set, { ...get().filters, dateRangeStart, dateRangeEnd })
  },

  setDateRangeIncludeNoDue(dateRangeIncludeNoDue: boolean) {
    commit(set, { ...get().filters, dateRangeIncludeNoDue })
  },

  setAllFilters(filters: FilterCriteria) {
    commit(set, { ...filters })
  },

  clearAll() {
    set({ filters: { ...defaultFilters }, isActive: false })
  },

  applyFilter(todos: PersistedTodoItem[], assignedPeopleMap?: Map<number, Person[]>, assignedTagsMap?: Map<number, Tag[]>, personOrgMap?: Map<number, number[]>, assignedOrgsMap?: Map<number, Org[]>): PersistedTodoItem[] {
    const { filters } = get()
    const filterPersonOrgIds = computeFilterPersonOrgIds(filters.personIds, filters.personFilterMode, personOrgMap)
    return todos.filter((t) => {
      const people = assignedPeopleMap?.get(t.id) ?? []
      const personIds = people.map((p) => p.id!)
      const tagIds = (assignedTagsMap?.get(t.id) ?? []).map((tg) => tg.id!)
      const personOrgIds = personOrgMap ? people.flatMap((p) => personOrgMap.get(p.id!) ?? []) : undefined
      const directOrgIds = (assignedOrgsMap?.get(t.id) ?? []).map((o) => o.id!)
      return todoMatchesFilter(t, filters, personIds, tagIds, personOrgIds, directOrgIds, undefined, filterPersonOrgIds)
    })
  },

  matchesFilter(todo: TodoItem, assignedPersonIds?: number[], assignedTagIds?: number[], assignedPersonOrgIds?: number[], directOrgIds?: number[], skipVisibility?: boolean, filterPersonOrgIds?: Set<number>): boolean {
    return todoMatchesFilter(todo, get().filters, assignedPersonIds, assignedTagIds, assignedPersonOrgIds, directOrgIds, skipVisibility, filterPersonOrgIds)
  },
}))
