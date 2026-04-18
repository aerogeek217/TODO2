import { create } from 'zustand'
import type { TodoItem, PersistedTodoItem, Person, Tag, Org, Status, DateField, TodoPredicate, PersonFilterMode, OrgFilterMode } from '../models'
import { startOfDay, startOfToday } from '../utils/date'
import { effectiveDate, resolveScheduled } from '../utils/effective-date'

export type { DateField, PersonFilterMode, OrgFilterMode }

/**
 * Runtime filter state: same fields as the serializable `TodoPredicate`, but
 * with `Set<number>` instead of `number[]` and `Date` instead of ISO string.
 * Keep the Sets for O(1) `.has()` in UI hot paths (TopBar, FilterSheet).
 *
 * Serializable boundary: `criteriaToPredicate` / `predicateToCriteria` convert
 * between this and `TodoPredicate` at storage / evaluation boundaries.
 */
export interface FilterCriteria {
  showCompleted: boolean
  showHiddenStatuses: boolean
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
  /**
   * Which date field drives the date range filter:
   *   'date'      → effectiveDate(todo, today)
   *   'scheduled' → resolveScheduled(todo.scheduledDate, today)
   *   'deadline'  → todo.dueDate
   *   'created'   → todo.createdAt
   *   'modified'  → todo.modifiedAt
   */
  dateField: DateField
  /** null = no filter; Date = only show tasks with date on or after this date */
  dateRangeStart: Date | null
  /** null = open-ended; Date = only show tasks with date on or before this date */
  dateRangeEnd: Date | null
  /** When true AND dateField === 'date', tasks with no effectiveDate (neither scheduledDate nor dueDate) are included in date-range results. */
  dateRangeIncludeNoDate: boolean
}

interface FilterState {
  filters: FilterCriteria
  /** Derived: true when any filter is active. Use useFilterStore(s => s.isActive) or getState().isActive. */
  readonly isActive: boolean

  setShowCompleted: (show: boolean) => void
  setShowHiddenStatuses: (show: boolean) => void
  setPersonIds: (personIds: Set<number> | null) => void
  setPersonFilterMode: (mode: PersonFilterMode) => void
  setTagIds: (tagIds: Set<number> | null) => void
  setOrgIds: (orgIds: Set<number> | null) => void
  setOrgFilterMode: (mode: OrgFilterMode) => void
  setStatusIds: (statusIds: Set<number> | null) => void
  setSearchText: (text: string) => void
  setDateField: (field: DateField) => void
  setDateRange: (start: Date | null, end: Date | null) => void
  setDateRangeIncludeNoDate: (include: boolean) => void
  setAllFilters: (filters: FilterCriteria) => void
  clearAll: () => void
}

const defaultFilters: FilterCriteria = {
  showCompleted: false,
  showHiddenStatuses: false,
  personIds: null,
  personFilterMode: 'include-orgs',
  tagIds: null,
  orgIds: null,
  orgFilterMode: 'include-people',
  statusIds: null,
  searchText: '',
  dateField: 'date',
  dateRangeStart: null,
  dateRangeEnd: null,
  dateRangeIncludeNoDate: false,
}

function isFilterActive(f: FilterCriteria): boolean {
  return (
    f.showCompleted ||
    f.showHiddenStatuses ||
    f.personIds !== null ||
    f.tagIds !== null ||
    f.orgIds !== null ||
    f.statusIds !== null ||
    f.searchText !== '' ||
    f.dateRangeStart !== null ||
    f.dateRangeEnd !== null
  )
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

/**
 * Canonical evaluator. Takes runtime filter state (`FilterCriteria`) and a
 * single todo; returns whether the todo passes the filter. Top-level function
 * (not a store method) so the interpreter in `dashboard-lists.ts` can call it
 * with a `FilterCriteria` synthesized from a stored `TodoPredicate`.
 */
export function matchesFilter(
  filters: FilterCriteria,
  todo: TodoItem,
  assignedPersonIds?: number[],
  assignedTagIds?: number[],
  assignedPersonOrgIds?: number[],
  directOrgIds?: number[],
  filterPersonOrgIds?: Set<number>,
  statuses?: Status[],
  today: Date = startOfToday(),
): boolean {
  if (todo.isCompleted && !filters.showCompleted) return false

  if (filters.statusIds !== null) {
    const hasStatus = todo.statusId != null
    if (!hasStatus) {
      if (!filters.statusIds.has(0)) return false
    } else if (!filters.statusIds.has(todo.statusId!)) return false
  } else {
    if (todo.statusId != null && !filters.showHiddenStatuses) {
      const status = statuses?.find(s => s.id === todo.statusId)
      if (status?.hideByDefault) return false
    }
  }

  if (filters.searchText && !todo.title.toLowerCase().includes(filters.searchText.toLowerCase())) return false

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
    let rawDate: Date | null
    switch (filters.dateField) {
      case 'date':
        rawDate = effectiveDate(todo, today)
        break
      case 'scheduled':
        rawDate = todo.scheduledDate ? resolveScheduled(todo.scheduledDate, today) : null
        break
      case 'deadline':
        rawDate = todo.dueDate ? new Date(todo.dueDate) : null
        break
      case 'created':
        rawDate = todo.createdAt
        break
      case 'modified':
        rawDate = todo.modifiedAt
        break
    }

    if (!rawDate) {
      if (!(filters.dateField === 'date' && filters.dateRangeIncludeNoDate)) return false
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

/**
 * Canonical bulk evaluator. See `matchesFilter`.
 */
export function applyFilter(
  filters: FilterCriteria,
  todos: PersistedTodoItem[],
  assignedPeopleMap?: Map<number, Person[]>,
  assignedTagsMap?: Map<number, Tag[]>,
  personOrgMap?: Map<number, number[]>,
  assignedOrgsMap?: Map<number, Org[]>,
  statuses?: Status[],
  today: Date = startOfToday(),
): PersistedTodoItem[] {
  const filterPersonOrgIds = computeFilterPersonOrgIds(filters.personIds, filters.personFilterMode, personOrgMap)
  return todos.filter((t) => {
    const people = assignedPeopleMap?.get(t.id) ?? []
    const personIds = people.map((p) => p.id!)
    const tagIds = (assignedTagsMap?.get(t.id) ?? []).map((tg) => tg.id!)
    const personOrgIds = personOrgMap ? people.flatMap((p) => personOrgMap.get(p.id!) ?? []) : undefined
    const directOrgIds = (assignedOrgsMap?.get(t.id) ?? []).map((o) => o.id!)
    return matchesFilter(filters, t, personIds, tagIds, personOrgIds, directOrgIds, filterPersonOrgIds, statuses, today)
  })
}

/** Runtime (Sets + Dates) → serializable (arrays + ISO strings) for saved views / list definitions. */
export function criteriaToPredicate(f: FilterCriteria): TodoPredicate {
  return {
    showCompleted: f.showCompleted,
    showHiddenStatuses: f.showHiddenStatuses,
    personIds: f.personIds ? Array.from(f.personIds) : null,
    personFilterMode: f.personFilterMode,
    tagIds: f.tagIds ? Array.from(f.tagIds) : null,
    orgIds: f.orgIds ? Array.from(f.orgIds) : null,
    orgFilterMode: f.orgFilterMode,
    statusIds: f.statusIds ? Array.from(f.statusIds) : null,
    searchText: f.searchText,
    dateField: f.dateField,
    dateRangeStart: f.dateRangeStart ? f.dateRangeStart.toISOString() : null,
    dateRangeEnd: f.dateRangeEnd ? f.dateRangeEnd.toISOString() : null,
    dateRangeIncludeNoDate: f.dateRangeIncludeNoDate,
  }
}

/** Serializable (arrays + ISO strings) → runtime (Sets + Dates). Inverse of `criteriaToPredicate`. */
export function predicateToCriteria(p: TodoPredicate): FilterCriteria {
  return {
    showCompleted: p.showCompleted,
    showHiddenStatuses: p.showHiddenStatuses,
    personIds: p.personIds ? new Set(p.personIds) : null,
    personFilterMode: p.personFilterMode,
    tagIds: p.tagIds ? new Set(p.tagIds) : null,
    orgIds: p.orgIds ? new Set(p.orgIds) : null,
    orgFilterMode: p.orgFilterMode,
    statusIds: p.statusIds ? new Set(p.statusIds) : null,
    searchText: p.searchText,
    dateField: p.dateField,
    dateRangeStart: p.dateRangeStart ? new Date(p.dateRangeStart) : null,
    dateRangeEnd: p.dateRangeEnd ? new Date(p.dateRangeEnd) : null,
    dateRangeIncludeNoDate: p.dateRangeIncludeNoDate,
  }
}

function commit(set: (s: Partial<FilterState>) => void, filters: FilterCriteria) {
  set({ filters, isActive: isFilterActive(filters) })
}

export const useFilterStore = create<FilterState>((set, get) => ({
  filters: { ...defaultFilters },
  isActive: false,

  setShowCompleted(showCompleted: boolean) {
    commit(set, { ...get().filters, showCompleted })
  },

  setShowHiddenStatuses(showHiddenStatuses: boolean) {
    commit(set, { ...get().filters, showHiddenStatuses })
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

  setDateRangeIncludeNoDate(dateRangeIncludeNoDate: boolean) {
    commit(set, { ...get().filters, dateRangeIncludeNoDate })
  },

  setAllFilters(filters: FilterCriteria) {
    commit(set, { ...filters })
  },

  clearAll() {
    set({ filters: { ...defaultFilters }, isActive: false })
  },
}))
