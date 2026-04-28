import { create } from 'zustand'
import type { TodoItem, PersistedTodoItem, Person, Org, Status, Project, Tag, DateField, TodoPredicate, PersonFilterMode, OrgFilterMode, DateAnchor } from '../models'
import type { RuntimeFilterSpec } from '../models/list-definition'
import { startOfDay, startOfToday } from '../utils/date'
import { readDateAnchor } from '../utils/date-anchor'
import { effectiveDate, resolveDateAnchor, resolveScheduled } from '../utils/effective-date'
import { useSettingsStore } from './settings-store'
import { matchTodoText, type TextMatchContext } from '../utils/filter'

export type { DateField, PersonFilterMode, OrgFilterMode }

/** Helper: wrap a Date as a fixed-ISO `DateAnchor`. */
export function fixedAnchor(d: Date): DateAnchor {
  return { kind: 'fixed', iso: d.toISOString() }
}

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
  /** null = no filter; Set = only people in these orgs are shown */
  orgIds: Set<number> | null
  /** 'include-people' (default) matches person-org + direct-org; 'direct-only' matches only direct org assignment */
  orgFilterMode: OrgFilterMode
  /** null = no filter; Set = only todos in these projects shown (0 = no project) */
  projectIds: Set<number> | null
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
  /** null = no filter; `DateAnchor` = only show tasks with date on or after this anchor (resolved at eval time). */
  dateRangeStart: DateAnchor | null
  /** null = open-ended; `DateAnchor` = only show tasks with date on or before this anchor (resolved at eval time). */
  dateRangeEnd: DateAnchor | null
  /** When true AND dateField === 'date', tasks with no effectiveDate (neither scheduledDate nor dueDate) are included in date-range results. */
  dateRangeIncludeNoDate: boolean
  /** Tri-state presence filter on `scheduledDate`. null = no filter. true = only tasks with it; false = only tasks without. */
  hasScheduled: boolean | null
  /** Tri-state presence filter on `dueDate`. null = no filter. */
  hasDeadline: boolean | null
  /**
   * null = no filter; Set of tag ids (into the `tags` registry) — todo must
   * have at least one assigned tag in the set (OR semantics). An empty Set
   * matches zero todos; a todo with no tag assignments is excluded whenever
   * this clause is non-null and non-empty.
   */
  tags: Set<number> | null
}

interface FilterState {
  filters: FilterCriteria
  /** Derived: true when any filter is active. Use useFilterStore(s => s.isActive) or getState().isActive. */
  readonly isActive: boolean
  /**
   * Per-list-definition runtime filter prompt (e.g. "Tasks for {assignee}").
   * The spec describes which entity field the list narrows on; the value is
   * the live picked id list. Lifted into the store so the FilterChipBar's
   * Clear-all path can drop both predicate AND runtime-filter state in one
   * shot — and so the runtime input visibly disappears when the user clears
   * filters from the topbar.
   */
  runtimeFilterSpec: RuntimeFilterSpec | null
  runtimeFilterValue: number[] | undefined

  setShowCompleted: (show: boolean) => void
  setShowHiddenStatuses: (show: boolean) => void
  setPersonIds: (personIds: Set<number> | null) => void
  setPersonFilterMode: (mode: PersonFilterMode) => void
  setOrgIds: (orgIds: Set<number> | null) => void
  setOrgFilterMode: (mode: OrgFilterMode) => void
  setProjectIds: (projectIds: Set<number> | null) => void
  setStatusIds: (statusIds: Set<number> | null) => void
  setSearchText: (text: string) => void
  setDateField: (field: DateField) => void
  /** Convenience API: wraps Date endpoints as `{kind:'fixed', iso}` anchors. Prefer `setDateRangeAnchors` for relative tokens. */
  setDateRange: (start: Date | null, end: Date | null) => void
  setDateRangeAnchors: (start: DateAnchor | null, end: DateAnchor | null) => void
  setDateRangeIncludeNoDate: (include: boolean) => void
  setHasScheduled: (value: boolean | null) => void
  setHasDeadline: (value: boolean | null) => void
  setTags: (tags: Set<number> | null) => void
  setAllFilters: (filters: FilterCriteria) => void
  setRuntimeFilterSpec: (spec: RuntimeFilterSpec | null) => void
  setRuntimeFilterValue: (value: number[] | undefined) => void
  clearAll: () => void
}

const defaultFilters: FilterCriteria = {
  showCompleted: false,
  showHiddenStatuses: false,
  personIds: null,
  personFilterMode: 'include-orgs',
  orgIds: null,
  orgFilterMode: 'include-people',
  projectIds: null,
  statusIds: null,
  searchText: '',
  dateField: 'date',
  dateRangeStart: null,
  dateRangeEnd: null,
  dateRangeIncludeNoDate: false,
  hasScheduled: null,
  hasDeadline: null,
  tags: null,
}

function isFilterActive(f: FilterCriteria): boolean {
  return (
    f.showCompleted ||
    f.showHiddenStatuses ||
    f.personIds !== null ||
    f.orgIds !== null ||
    f.projectIds !== null ||
    f.statusIds !== null ||
    f.searchText !== '' ||
    f.dateRangeStart !== null ||
    f.dateRangeEnd !== null ||
    f.hasScheduled !== null ||
    f.hasDeadline !== null ||
    f.tags !== null
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
  assignedPersonOrgIds?: number[],
  directOrgIds?: number[],
  filterPersonOrgIds?: Set<number>,
  statuses?: Status[],
  today: Date = startOfToday(),
  searchCtx?: TextMatchContext,
  assignedTagIds?: number[],
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

  if (filters.searchText) {
    const { matched } = matchTodoText(todo, filters.searchText, searchCtx)
    if (!matched) return false
  }

  if (filters.personIds !== null) {
    const hasPerson = !!assignedPersonIds && assignedPersonIds.length > 0
    const directPersonMatch = hasPerson && assignedPersonIds!.some((id) => filters.personIds!.has(id))
    const includeOrgs = filters.personFilterMode === 'include-orgs'
    const orgExpandedMatch = includeOrgs && !!filterPersonOrgIds && filterPersonOrgIds.size > 0
      && !!directOrgIds && directOrgIds.some((oid) => filterPersonOrgIds.has(oid))
    const unassignedSentinel = !hasPerson && filters.personIds.has(0)
    if (!directPersonMatch && !orgExpandedMatch && !unassignedSentinel) return false
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
  if (filters.projectIds !== null) {
    const pid = todo.projectId
    if (pid == null) {
      if (!filters.projectIds.has(0)) return false
    } else if (!filters.projectIds.has(pid)) return false
  }
  if (filters.hasScheduled !== null) {
    const has = todo.scheduledDate !== undefined
    if (has !== filters.hasScheduled) return false
  }
  if (filters.hasDeadline !== null) {
    const has = todo.dueDate !== undefined
    if (has !== filters.hasDeadline) return false
  }
  if (filters.tags !== null) {
    const ids = assignedTagIds ?? []
    if (ids.length === 0) return false
    if (!ids.some((id) => filters.tags!.has(id))) return false
  }

  if (filters.dateRangeStart !== null || filters.dateRangeEnd !== null) {
    const ws = useSettingsStore.getState().weekStartsOn
    const resolvedStart = filters.dateRangeStart ? resolveDateAnchor(filters.dateRangeStart, today, ws) : null
    const resolvedEnd = filters.dateRangeEnd ? resolveDateAnchor(filters.dateRangeEnd, today, ws) : null

    let rawDate: Date | null
    switch (filters.dateField) {
      case 'date':
        rawDate = effectiveDate(todo, today, ws)
        break
      case 'scheduled':
        rawDate = todo.scheduledDate ? resolveScheduled(todo.scheduledDate, today, ws) : null
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
      if (resolvedStart !== null) {
        const start = startOfDay(resolvedStart)
        if (d < start) return false
      }
      if (resolvedEnd !== null) {
        const end = new Date(resolvedEnd)
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
  personOrgMap?: Map<number, number[]>,
  assignedOrgsMap?: Map<number, Org[]>,
  statuses?: Status[],
  today: Date = startOfToday(),
  projectsById?: Map<number, Project>,
  assignedTagsMap?: Map<number, Tag[]>,
): PersistedTodoItem[] {
  const filterPersonOrgIds = computeFilterPersonOrgIds(filters.personIds, filters.personFilterMode, personOrgMap)
  const needsSearchCtx = !!filters.searchText
  return todos.filter((t) => {
    const people = assignedPeopleMap?.get(t.id) ?? []
    const personIds = people.map((p) => p.id!)
    const personOrgIds = personOrgMap ? people.flatMap((p) => personOrgMap.get(p.id!) ?? []) : undefined
    const orgs = assignedOrgsMap?.get(t.id) ?? []
    const directOrgIds = orgs.map((o) => o.id!)
    const tags = assignedTagsMap?.get(t.id) ?? []
    const tagIds = tags.map((tg) => tg.id!)
    const searchCtx: TextMatchContext | undefined = needsSearchCtx
      ? {
          projectName: t.projectId != null ? projectsById?.get(t.projectId)?.name : undefined,
          personNames: people.map(p => p.name),
          orgNames: orgs.map(o => o.name),
          statusName: t.statusId != null ? statuses?.find(s => s.id === t.statusId)?.name : undefined,
        }
      : undefined
    return matchesFilter(filters, t, personIds, personOrgIds, directOrgIds, filterPersonOrgIds, statuses, today, searchCtx, tagIds)
  })
}

/** Runtime (Sets) → serializable (arrays) for saved views / list definitions. */
export function criteriaToPredicate(f: FilterCriteria): TodoPredicate {
  return {
    showCompleted: f.showCompleted,
    showHiddenStatuses: f.showHiddenStatuses,
    personIds: f.personIds ? Array.from(f.personIds) : null,
    personFilterMode: f.personFilterMode,
    orgIds: f.orgIds ? Array.from(f.orgIds) : null,
    orgFilterMode: f.orgFilterMode,
    projectIds: f.projectIds ? Array.from(f.projectIds) : null,
    statusIds: f.statusIds ? Array.from(f.statusIds) : null,
    searchText: f.searchText,
    dateField: f.dateField,
    dateRangeStart: f.dateRangeStart,
    dateRangeEnd: f.dateRangeEnd,
    dateRangeIncludeNoDate: f.dateRangeIncludeNoDate,
    hasScheduled: f.hasScheduled,
    hasDeadline: f.hasDeadline,
    tags: f.tags ? Array.from(f.tags) : null,
  }
}

/** Serializable → runtime. Inverse of `criteriaToPredicate`. Auto-upgrades legacy ISO-string date anchors. */
export function predicateToCriteria(p: TodoPredicate): FilterCriteria {
  return {
    showCompleted: p.showCompleted,
    showHiddenStatuses: p.showHiddenStatuses,
    personIds: p.personIds ? new Set(p.personIds) : null,
    personFilterMode: p.personFilterMode,
    orgIds: p.orgIds ? new Set(p.orgIds) : null,
    orgFilterMode: p.orgFilterMode,
    projectIds: p.projectIds ? new Set(p.projectIds) : null,
    statusIds: p.statusIds ? new Set(p.statusIds) : null,
    searchText: p.searchText,
    dateField: p.dateField,
    dateRangeStart: readDateAnchor(p.dateRangeStart),
    dateRangeEnd: readDateAnchor(p.dateRangeEnd),
    dateRangeIncludeNoDate: p.dateRangeIncludeNoDate,
    hasScheduled: p.hasScheduled ?? null,
    hasDeadline: p.hasDeadline ?? null,
    tags: p.tags ? new Set(p.tags) : null,
  }
}

function commit(set: (s: Partial<FilterState>) => void, filters: FilterCriteria) {
  set({ filters, isActive: isFilterActive(filters) })
}

export const useFilterStore = create<FilterState>((set, get) => ({
  filters: { ...defaultFilters },
  isActive: false,
  runtimeFilterSpec: null,
  runtimeFilterValue: undefined,

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

  setOrgIds(orgIds: Set<number> | null) {
    commit(set, { ...get().filters, orgIds })
  },

  setOrgFilterMode(orgFilterMode: OrgFilterMode) {
    commit(set, { ...get().filters, orgFilterMode })
  },

  setProjectIds(projectIds: Set<number> | null) {
    commit(set, { ...get().filters, projectIds })
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

  setDateRange(start: Date | null, end: Date | null) {
    commit(set, {
      ...get().filters,
      dateRangeStart: start ? fixedAnchor(start) : null,
      dateRangeEnd: end ? fixedAnchor(end) : null,
    })
  },

  setDateRangeAnchors(dateRangeStart: DateAnchor | null, dateRangeEnd: DateAnchor | null) {
    commit(set, { ...get().filters, dateRangeStart, dateRangeEnd })
  },

  setDateRangeIncludeNoDate(dateRangeIncludeNoDate: boolean) {
    commit(set, { ...get().filters, dateRangeIncludeNoDate })
  },

  setHasScheduled(hasScheduled: boolean | null) {
    commit(set, { ...get().filters, hasScheduled })
  },

  setHasDeadline(hasDeadline: boolean | null) {
    commit(set, { ...get().filters, hasDeadline })
  },

  setTags(tags: Set<number> | null) {
    commit(set, { ...get().filters, tags })
  },

  setAllFilters(filters: FilterCriteria) {
    commit(set, { ...filters })
  },

  setRuntimeFilterSpec(spec: RuntimeFilterSpec | null) {
    set({ runtimeFilterSpec: spec })
  },

  setRuntimeFilterValue(value: number[] | undefined) {
    set({ runtimeFilterValue: value })
  },

  clearAll() {
    set({
      filters: { ...defaultFilters },
      isActive: false,
      runtimeFilterSpec: null,
      runtimeFilterValue: undefined,
    })
  },
}))
