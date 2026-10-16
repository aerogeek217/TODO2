import type { TodoItem, PersistedTodoItem, Person, Status, Tag, TodoPredicate } from '../models'
import { startOfDay } from './date'
import { resolveDateAnchor, type WeekStart } from './effective-date'
import { matchTodoText, textMatchContextFor, type TextMatchContext, type TodoNameLookups } from './filter'
import { composeScreenFilter, predicateToCriteria, type FilterCriteria } from './filter-criteria'
import { matchesMarkers, type MarkerSettings } from './markers'

/**
 * The settings a filter is evaluated with: the Markers filter's (urgent
 * range, Hot rule) and the week start that relative date anchors resolve
 * against. `settings-store.currentFilterSettings` reads them as they are now;
 * a memoized caller passes its own subscribed copy (`useFilterSettings`) so
 * a settings change re-runs it.
 */
export interface FilterSettings extends MarkerSettings {
  weekStartsOn: WeekStart
}

/**
 * Canonical evaluator. Takes runtime filter state (`FilterCriteria`) and a
 * single todo; returns whether the todo passes the filter.
 */
export function matchesFilter(
  filters: FilterCriteria,
  todo: TodoItem,
  assignedPersonIds: number[] | undefined,
  today: Date,
  searchCtx: TextMatchContext | undefined,
  assignedTagIds: number[] | undefined,
  settings: FilterSettings,
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
  if (filters.markers != null && !matchesMarkers(todo, filters.markers, today, settings)) {
    return false
  }
  if (filters.tags !== null) {
    const ids = assignedTagIds ?? []
    if (ids.length === 0) return false
    if (!ids.some((id) => filters.tags!.has(id))) return false
  }

  if (filters.dateRangeStart !== null || filters.dateRangeEnd !== null) {
    const ws = settings.weekStartsOn
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
  today: Date,
  settings: FilterSettings,
): boolean {
  const personIds = (lookups.assignedPeopleMap?.get(todo.id) ?? []).map((p) => p.id!)
  const tagIds = (lookups.assignedTagsMap?.get(todo.id) ?? []).map((t) => t.id!)
  const searchCtx = filters.searchText ? textMatchContextFor(todo, lookups) : undefined
  return matchesFilter(filters, todo, personIds, today, searchCtx, tagIds, settings)
}

/**
 * Canonical bulk evaluator. See `matchesFilter`.
 */
export function applyFilter(
  filters: FilterCriteria,
  todos: PersistedTodoItem[],
  assignedPeopleMap: Map<number, Person[]> | undefined,
  statuses: Status[] | undefined,
  today: Date,
  assignedTagsMap: Map<number, Tag[]> | undefined,
  settings: FilterSettings,
): PersistedTodoItem[] {
  const lookups: TodoNameLookups = {
    assignedPeopleMap,
    assignedTagsMap,
    statusesById: statuses ? new Map(statuses.map((s) => [s.id!, s])) : undefined,
  }
  return todos.filter((t) => matchesFilterWithLookups(filters, t, lookups, today, settings))
}

/**
 * Membership evaluator for stored list predicates (`buildDashboardLists`'
 * `evalPredicate`). Converts each predicate to criteria once.
 */
export function createPredicateEvaluator(
  lookups: TodoNameLookups,
  today: Date,
  settings: FilterSettings,
): (predicate: TodoPredicate, todo: PersistedTodoItem) => boolean {
  const criteriaByPredicate = new WeakMap<TodoPredicate, FilterCriteria>()
  return (predicate, todo) => {
    let criteria = criteriaByPredicate.get(predicate)
    if (!criteria) {
      criteria = predicateToCriteria(predicate)
      criteriaByPredicate.set(predicate, criteria)
    }
    return matchesFilterWithLookups(criteria, todo, lookups, today, settings)
  }
}

/** Whether `todo` passes `list` composed with the `screen` filter (see `composeScreenFilter`). */
export function matchesComposedFilter(
  screen: FilterCriteria,
  list: FilterCriteria,
  todo: PersistedTodoItem,
  lookups: TodoNameLookups,
  today: Date,
  settings: FilterSettings,
): boolean {
  const [screenStage, listStage] = composeScreenFilter(screen, list)
  return matchesFilterWithLookups(listStage, todo, lookups, today, settings)
    && matchesFilterWithLookups(screenStage, todo, lookups, today, settings)
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
  settings: FilterSettings,
): (predicate: TodoPredicate, todo: PersistedTodoItem) => boolean {
  const criteriaByPredicate = new WeakMap<TodoPredicate, FilterCriteria>()
  return (predicate, todo) => {
    let criteria = criteriaByPredicate.get(predicate)
    if (!criteria) {
      criteria = predicateToCriteria(predicate)
      criteriaByPredicate.set(predicate, criteria)
    }
    return matchesComposedFilter(screen, criteria, todo, lookups, today, settings)
  }
}
