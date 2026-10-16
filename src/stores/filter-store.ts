import { create } from 'zustand'
import type { TodoItem, PersistedTodoItem, Person, Status, Tag, DateField, TodoPredicate, DateAnchor, MarkersFilter, MarkerSet } from '../models'
import { startOfDay, startOfToday } from '../utils/date'
import { readDateAnchor } from '../utils/date-anchor'
import { resolveDateAnchor } from '../utils/effective-date'
import { useSettingsStore } from './settings-store'
import { matchTodoText, textMatchContextFor, type TextMatchContext, type TodoNameLookups } from '../utils/filter'
import { activeMarkers, hasMarkers, isHotFilter, matchesMarkers, type MarkerSettings } from '../utils/markers'

export type { DateField }

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
  /** null = no filter (all shown); Set = only tasks assigned to one of these people (0 = unassigned) */
  personIds: Set<number> | null
  /** null = no filter; Set = only those statuses shown (0 = no status) */
  statusIds: Set<number> | null
  /** Empty string = no filter; non-empty = case-insensitive substring match on title */
  searchText: string
  /**
   * Which date field drives the date range filter:
   *   'deadline'  → todo.dueDate
   *   'followup'  → todo.nextFollowupAt
   *   'created'   → todo.createdAt
   *   'modified'  → todo.modifiedAt
   */
  dateField: DateField
  /** null = no filter; `DateAnchor` = only show tasks with date on or after this anchor (resolved at eval time). */
  dateRangeStart: DateAnchor | null
  /** null = open-ended; `DateAnchor` = only show tasks with date on or before this anchor (resolved at eval time). */
  dateRangeEnd: DateAnchor | null
  /** When true AND dateField === 'deadline', tasks with no due date are included in date-range results. */
  dateRangeIncludeNoDate: boolean
  /** Tri-state presence filter on `dueDate`. null = no filter. */
  hasDeadline: boolean | null
  /** Tri-state presence filter on `nextFollowupAt`. null = no filter. */
  hasFollowup: boolean | null
  /**
   * Markers filter: the task must be hot (Settings' Hot rule) or have every
   * listed marker (Urgent = effective urgent, `utils/urgency.ts`). null = no
   * filter.
   */
  markers: MarkersFilter | null
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

  setShowCompleted: (show: boolean) => void
  setPersonIds: (personIds: Set<number> | null) => void
  setStatusIds: (statusIds: Set<number> | null) => void
  setSearchText: (text: string) => void
  /** Wraps Date endpoints as `{kind:'fixed', iso}` anchors. */
  setDateRange: (start: Date | null, end: Date | null) => void
  setTags: (tags: Set<number> | null) => void
  setAllFilters: (filters: FilterCriteria) => void
  clearAll: () => void
}

const defaultFilters: FilterCriteria = {
  showCompleted: false,
  personIds: null,
  statusIds: null,
  searchText: '',
  dateField: 'deadline',
  dateRangeStart: null,
  dateRangeEnd: null,
  dateRangeIncludeNoDate: false,
  hasDeadline: null,
  hasFollowup: null,
  markers: null,
  tags: null,
}

/**
 * Number of active screen filters, one per control: people, status,
 * tags, dates (range or due / follow-up presence), markers, show completed,
 * search.
 */
export function countActiveFilters(f: FilterCriteria): number {
  const dates = f.dateRangeStart !== null || f.dateRangeEnd !== null || f.hasDeadline !== null || f.hasFollowup != null
  return [
    f.personIds !== null,
    f.statusIds !== null,
    f.tags !== null,
    dates,
    hasMarkers(f.markers),
    f.showCompleted,
    f.searchText !== '',
  ].filter(Boolean).length
}

function isFilterActive(f: FilterCriteria): boolean {
  return countActiveFilters(f) > 0
}

/**
 * The settings the Markers filter reads (urgent range, Hot rule), as they are
 * now. Evaluators default to this; a memoized caller passes its own
 * subscribed copy (`useMarkerSettings`) so a settings change re-runs it.
 */
export function currentMarkerSettings(): MarkerSettings {
  const { urgentDueWithinDays, hotRule } = useSettingsStore.getState()
  return { urgentRange: urgentDueWithinDays, hotRule }
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
  today: Date = startOfToday(),
  searchCtx?: TextMatchContext,
  assignedTagIds?: number[],
  markerSettings?: MarkerSettings,
): boolean {
  if (todo.isCompleted && !filters.showCompleted) return false

  if (filters.statusIds !== null) {
    const hasStatus = todo.statusId != null
    if (!hasStatus) {
      if (!filters.statusIds.has(0)) return false
    } else if (!filters.statusIds.has(todo.statusId!)) return false
  }

  if (filters.searchText) {
    const { matched } = matchTodoText(todo, filters.searchText, searchCtx)
    if (!matched) return false
  }

  if (filters.personIds !== null) {
    const hasPerson = !!assignedPersonIds && assignedPersonIds.length > 0
    const personMatch = hasPerson && assignedPersonIds!.some((id) => filters.personIds!.has(id))
    const unassignedSentinel = !hasPerson && filters.personIds.has(0)
    if (!personMatch && !unassignedSentinel) return false
  }
  if (filters.hasDeadline !== null) {
    const has = todo.dueDate !== undefined
    if (has !== filters.hasDeadline) return false
  }
  if (filters.hasFollowup != null) {
    const has = todo.nextFollowupAt != null
    if (has !== filters.hasFollowup) return false
  }
  if (filters.markers != null && !matchesMarkers(todo, filters.markers, today, markerSettings ?? currentMarkerSettings())) {
    return false
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
      case 'deadline':
        rawDate = todo.dueDate ? new Date(todo.dueDate) : null
        break
      case 'followup':
        rawDate = todo.nextFollowupAt ? new Date(todo.nextFollowupAt) : null
        break
      case 'created':
        rawDate = todo.createdAt
        break
      case 'modified':
        rawDate = todo.modifiedAt
        break
    }

    if (!rawDate) {
      if (!(filters.dateField === 'deadline' && filters.dateRangeIncludeNoDate)) return false
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
 * `matchesFilter` with assignments and names resolved from `lookups` — the
 * one evaluation path shared by the screen filter (`applyFilter`, e.g. the
 * calendar widget) and list widgets (`createPredicateEvaluator`), so search
 * hits the same person / status / tag names on both.
 */
export function matchesFilterWithLookups(
  filters: FilterCriteria,
  todo: PersistedTodoItem,
  lookups: TodoNameLookups,
  today: Date = startOfToday(),
  markerSettings?: MarkerSettings,
): boolean {
  const personIds = (lookups.assignedPeopleMap?.get(todo.id) ?? []).map((p) => p.id!)
  const tagIds = (lookups.assignedTagsMap?.get(todo.id) ?? []).map((t) => t.id!)
  const searchCtx = filters.searchText ? textMatchContextFor(todo, lookups) : undefined
  return matchesFilter(filters, todo, personIds, today, searchCtx, tagIds, markerSettings)
}

/**
 * Canonical bulk evaluator. See `matchesFilter`.
 */
export function applyFilter(
  filters: FilterCriteria,
  todos: PersistedTodoItem[],
  assignedPeopleMap?: Map<number, Person[]>,
  statuses?: Status[],
  today: Date = startOfToday(),
  assignedTagsMap?: Map<number, Tag[]>,
  markerSettings: MarkerSettings = currentMarkerSettings(),
): PersistedTodoItem[] {
  const lookups: TodoNameLookups = {
    assignedPeopleMap,
    assignedTagsMap,
    statusesById: statuses ? new Map(statuses.map((s) => [s.id!, s])) : undefined,
  }
  return todos.filter((t) => matchesFilterWithLookups(filters, t, lookups, today, markerSettings))
}

/**
 * Membership evaluator for stored list predicates (`buildDashboardLists`'
 * `evalPredicate`). Converts each predicate to criteria once.
 */
export function createPredicateEvaluator(
  lookups: TodoNameLookups,
  today: Date,
  markerSettings: MarkerSettings = currentMarkerSettings(),
): (predicate: TodoPredicate, todo: PersistedTodoItem) => boolean {
  const criteriaByPredicate = new WeakMap<TodoPredicate, FilterCriteria>()
  return (predicate, todo) => {
    let criteria = criteriaByPredicate.get(predicate)
    if (!criteria) {
      criteria = predicateToCriteria(predicate)
      criteriaByPredicate.set(predicate, criteria)
    }
    return matchesFilterWithLookups(criteria, todo, lookups, today, markerSettings)
  }
}

/**
 * The screen (top-bar) filter composed with a list's own filter, as the two
 * stages a task must both pass:
 *
 * - Narrowing clauses (people, status, tags, markers, search, dates) AND
 *   together — strictly, even on the same field: screen `@Alice` + list
 *   `@Bob` keeps only tasks assigned to both; screen Hot + list Urgent
 *   keeps only hot tasks that are urgent.
 * - `showCompleted` ORs: completed tasks show when either side shows them.
 */
export function composeScreenFilter(
  screen: FilterCriteria,
  list: FilterCriteria,
): readonly [FilterCriteria, FilterCriteria] {
  const showCompleted = screen.showCompleted || list.showCompleted
  return [{ ...screen, showCompleted }, { ...list, showCompleted }]
}

/** Whether `todo` passes `list` composed with the `screen` filter (see `composeScreenFilter`). */
export function matchesComposedFilter(
  screen: FilterCriteria,
  list: FilterCriteria,
  todo: PersistedTodoItem,
  lookups: TodoNameLookups,
  today: Date = startOfToday(),
  markerSettings: MarkerSettings = currentMarkerSettings(),
): boolean {
  const [screenStage, listStage] = composeScreenFilter(screen, list)
  return matchesFilterWithLookups(listStage, todo, lookups, today, markerSettings)
    && matchesFilterWithLookups(screenStage, todo, lookups, today, markerSettings)
}

/**
 * `createPredicateEvaluator` with the screen filter composed in: a stored list
 * predicate matches a task only when the task also passes `screen` (see
 * `composeScreenFilter`).
 */
export function createScreenComposedEvaluator(
  screen: FilterCriteria,
  lookups: TodoNameLookups,
  today: Date,
  markerSettings: MarkerSettings = currentMarkerSettings(),
): (predicate: TodoPredicate, todo: PersistedTodoItem) => boolean {
  const criteriaByPredicate = new WeakMap<TodoPredicate, FilterCriteria>()
  return (predicate, todo) => {
    let criteria = criteriaByPredicate.get(predicate)
    if (!criteria) {
      criteria = predicateToCriteria(predicate)
      criteriaByPredicate.set(predicate, criteria)
    }
    return matchesComposedFilter(screen, criteria, todo, lookups, today, markerSettings)
  }
}

/** Runtime (Sets) → serializable (arrays) for saved views / list definitions. */
export function criteriaToPredicate(f: FilterCriteria): TodoPredicate {
  return {
    showCompleted: f.showCompleted,
    personIds: f.personIds ? Array.from(f.personIds) : null,
    statusIds: f.statusIds ? Array.from(f.statusIds) : null,
    searchText: f.searchText,
    dateField: f.dateField,
    dateRangeStart: f.dateRangeStart,
    dateRangeEnd: f.dateRangeEnd,
    dateRangeIncludeNoDate: f.dateRangeIncludeNoDate,
    hasDeadline: f.hasDeadline,
    hasFollowup: f.hasFollowup,
    markers: normalizeMarkers(f.markers),
    tags: f.tags ? Array.from(f.tags) : null,
  }
}

/** Serializable → runtime. Inverse of `criteriaToPredicate`. Auto-upgrades legacy ISO-string date anchors. */
export function predicateToCriteria(p: TodoPredicate): FilterCriteria {
  return {
    showCompleted: p.showCompleted,
    personIds: Array.isArray(p.personIds) ? new Set(p.personIds) : null,
    statusIds: Array.isArray(p.statusIds) ? new Set(p.statusIds) : null,
    searchText: p.searchText,
    dateField: p.dateField,
    dateRangeStart: readDateAnchor(p.dateRangeStart),
    dateRangeEnd: readDateAnchor(p.dateRangeEnd),
    dateRangeIncludeNoDate: p.dateRangeIncludeNoDate,
    hasDeadline: p.hasDeadline ?? null,
    hasFollowup: p.hasFollowup ?? null,
    markers: normalizeMarkers(p.markers),
    tags: Array.isArray(p.tags) ? new Set(p.tags) : null,
  }
}

/** Hot, a copy of the required markers, or null when none is ticked. */
function normalizeMarkers(m: MarkersFilter | null | undefined): MarkersFilter | null {
  if (isHotFilter(m)) return m
  const keys = activeMarkers(m)
  if (keys.length === 0) return null
  const out: MarkerSet = {}
  for (const k of keys) out[k] = true
  return out
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

  setPersonIds(personIds: Set<number> | null) {
    commit(set, { ...get().filters, personIds })
  },

  setStatusIds(statusIds: Set<number> | null) {
    commit(set, { ...get().filters, statusIds })
  },

  setSearchText(searchText: string) {
    commit(set, { ...get().filters, searchText })
  },

  setDateRange(start: Date | null, end: Date | null) {
    commit(set, {
      ...get().filters,
      dateRangeStart: start ? fixedAnchor(start) : null,
      dateRangeEnd: end ? fixedAnchor(end) : null,
    })
  },

  setTags(tags: Set<number> | null) {
    commit(set, { ...get().filters, tags })
  },

  setAllFilters(filters: FilterCriteria) {
    commit(set, { ...filters })
  },

  clearAll() {
    set({
      filters: { ...defaultFilters },
      isActive: false,
    })
  },
}))
