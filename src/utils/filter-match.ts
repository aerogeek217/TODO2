import { DATE_FIELD_VALUES, type DateField, type DateMatch, type TodoItem, type PersistedTodoItem, type Person, type Status, type Tag, type TodoPredicate } from '../models'
import { startOfDay } from './date'
import { resolveDateAnchor, type WeekStart } from './effective-date'
import { matchTodoText, textMatchContextFor, type TextMatchContext, type TodoNameLookups } from './filter'
import { composeScreenFilter, predicateToCriteria, type CriteriaClauses, type FilterCriteria } from './filter-criteria'
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

/** One task as the clause matchers read it. */
interface ClauseTask {
  todo: TodoItem
  personIds: number[] | undefined
  tagIds: number[] | undefined
  today: Date
  searchCtx: TextMatchContext | undefined
  settings: FilterSettings
}

// ── One clause each (the caller checks that the clause filters) ─────────────

function matchesStatusClause(c: CriteriaClauses, t: ClauseTask): boolean {
  // 0 = no status.
  const ticked = c.statusIds?.has(t.todo.statusId ?? 0) === true
  return ticked !== (c.negate?.statusIds === true)
}

function matchesTextClause(c: CriteriaClauses, t: ClauseTask): boolean {
  return matchTodoText(t.todo, c.searchText, t.searchCtx).matched
}

function matchesPeopleClause(c: CriteriaClauses, t: ClauseTask): boolean {
  const ids = c.personIds
  const people = t.personIds ?? []
  const personMatch = ids != null && people.some((id) => ids.has(id))
  const unassignedSentinel = people.length === 0 && ids?.has(0) === true
  // Is: one of the ticked people (or unassigned when ticked). Is not: none of them.
  return (personMatch || unassignedSentinel) !== (c.negate?.personIds === true)
}

function matchesMarkersClause(c: CriteriaClauses, t: ClauseTask): boolean {
  return c.markers != null && matchesMarkers(t.todo, c.markers, t.today, t.settings)
}

function matchesTagsClause(c: CriteriaClauses, t: ClauseTask): boolean {
  // 0 = no tags. Is: one of the ticked tags (or untagged when No tags is
  // ticked). Is not: none of them (untagged passes unless No tags is ticked).
  const ids = c.tags
  const assigned = t.tagIds ?? []
  const tagMatch = ids != null && (assigned.some((id) => ids.has(id)) || (assigned.length === 0 && ids.has(0)))
  return tagMatch !== (c.negate?.tags === true)
}

function matchesDateClause(c: CriteriaClauses, field: DateField, t: ClauseTask): boolean {
  const clause = c.dates[field]
  return clause == null || matchesDateMatch(t.todo, field, clause, t.today, t.settings.weekStartsOn)
}

/**
 * Runs `test` on each clause of `c` that filters, in a fixed order (cheap
 * ones first), and stops at the first result equal to `stopAt`: with
 * `false` that is "every clause passes", with `true` "some clause passes".
 * Returns `stopAt` when it stopped, `!stopAt` when it ran through, and `null`
 * when no clause filters.
 */
function scanClauses(c: CriteriaClauses, t: ClauseTask, stopAt: boolean): boolean | null {
  let any = false
  const hit = (result: boolean): boolean => {
    any = true
    return result === stopAt
  }
  if (c.statusIds != null && hit(matchesStatusClause(c, t))) return stopAt
  if (c.searchText && hit(matchesTextClause(c, t))) return stopAt
  if (c.personIds != null && hit(matchesPeopleClause(c, t))) return stopAt
  if (c.markers != null && hit(matchesMarkersClause(c, t))) return stopAt
  if (c.tags != null && hit(matchesTagsClause(c, t))) return stopAt
  for (const field of DATE_FIELD_VALUES) {
    if (c.dates[field] && hit(matchesDateClause(c, field, t))) return stopAt
  }
  return any ? !stopAt : null
}

/** Whether the task passes every clause of `c` (no clause: it passes). */
function passesEveryClause(c: CriteriaClauses, t: ClauseTask): boolean {
  return scanClauses(c, t, false) !== false
}

/** Whether the task passes an or group: at least one of its clauses (one with no clause filters nothing). */
function passesOrGroup(group: CriteriaClauses, t: ClauseTask): boolean {
  return scanClauses(group, t, true) !== false
}

/**
 * Canonical evaluator. Takes runtime filter state (`FilterCriteria`) and a
 * single todo; returns whether the todo passes the filter: its completion
 * (`showCompleted`), the lens, every clause and every or group (at least
 * one clause of each). A People / Status / Tags clause with its "is not"
 * switch passes the tasks the clause without it would fail
 * (`FilterNegation`) — inside an or group as outside.
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
  // The lens: its own clauses under these; completion is decided above.
  if (filters.lens && !matchesFilter({ ...filters.lens, showCompleted: true }, todo, assignedPersonIds, today, searchCtx, assignedTagIds, settings)) {
    return false
  }
  const t: ClauseTask = { todo, personIds: assignedPersonIds, tagIds: assignedTagIds, today, searchCtx, settings }
  if (!passesEveryClause(filters, t)) return false
  return (filters.orGroups ?? []).every((group) => passesOrGroup(group, t))
}

/** Whether evaluating `f` reads a text filter — its own, an or group's or its lens's — so needs the task's names. */
function readsText(f: FilterCriteria): boolean {
  return !!f.searchText || (f.orGroups ?? []).some((group) => !!group.searchText) || (f.lens != null && readsText(f.lens))
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
  const searchCtx = readsText(filters) ? textMatchContextFor(todo, lookups) : undefined
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
