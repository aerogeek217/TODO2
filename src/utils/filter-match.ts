import { DATE_FIELD_VALUES, type DateField, type DateMatch, type TodoItem, type PersistedTodoItem, type Person, type Status, type Tag, type TodoPredicate } from '../models'
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
 * single todo; returns whether the todo passes the filter. A People / Status
 * / Tags clause with its "is not" switch passes the tasks the clause without
 * it would fail (`FilterNegation`).
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

  const negate = filters.negate
  if (filters.statusIds !== null) {
    // 0 = no status.
    const ticked = filters.statusIds.has(todo.statusId ?? 0)
    if (ticked === (negate?.statusIds === true)) return false
  }

  if (filters.searchText) {
    const { matched } = matchTodoText(todo, filters.searchText, searchCtx)
    if (!matched) return false
  }

  if (filters.personIds !== null) {
    const hasPerson = !!assignedPersonIds && assignedPersonIds.length > 0
    const personMatch = hasPerson && assignedPersonIds!.some((id) => filters.personIds!.has(id))
    const unassignedSentinel = !hasPerson && filters.personIds.has(0)
    // Is: one of the ticked people (or unassigned when ticked). Is not: none of them.
    if ((personMatch || unassignedSentinel) === (negate?.personIds === true)) return false
  }
  if (filters.markers != null && !matchesMarkers(todo, filters.markers, today, settings)) {
    return false
  }
  if (filters.tags !== null) {
    // Is: one of the ticked tags (untagged fails). Is not: none of them (untagged passes).
    const tagMatch = (assignedTagIds ?? []).some((id) => filters.tags!.has(id))
    if (tagMatch === (negate?.tags === true)) return false
  }

  for (const field of DATE_FIELD_VALUES) {
    const clause = filters.dates[field]
    if (clause && !matchesDateMatch(todo, field, clause, today, settings.weekStartsOn)) return false
  }
  return true
}

/** The task's date of one date type, or null when it has none. */
function todoDate(todo: TodoItem, field: DateField): Date | null {
  switch (field) {
    case 'deadline': return todo.dueDate ? new Date(todo.dueDate) : null
    case 'followup': return todo.nextFollowupAt ? new Date(todo.nextFollowupAt) : null
    case 'created': return todo.createdAt
    case 'modified': return todo.modifiedAt
  }
}

/**
 * Whether a task passes one date clause: Has a date / No date by whether the
 * date is set; a range by the date as a day (anchors resolved against
 * `today`; either end open), a task without the date passing only with
 * `includeNoDate`. A range with neither end passes every task.
 */
export function matchesDateMatch(todo: TodoItem, field: DateField, clause: DateMatch, today: Date, weekStartsOn: WeekStart): boolean {
  const raw = todoDate(todo, field)
  if (clause.match === 'set') return raw != null
  if (clause.match === 'unset') return raw == null
  if (clause.start == null && clause.end == null) return true
  if (!raw) return clause.includeNoDate === true
  const d = startOfDay(new Date(raw))
  if (clause.start != null && d < startOfDay(resolveDateAnchor(clause.start, today, weekStartsOn))) return false
  if (clause.end != null) {
    const end = new Date(resolveDateAnchor(clause.end, today, weekStartsOn))
    end.setHours(23, 59, 59, 999)
    if (d > end) return false
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
 * Membership evaluator for stored list predicates (`buildList`'s
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
