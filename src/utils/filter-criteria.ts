import type { DateAnchor, DateFilters, FilterClauses, FilterNegation, MarkersFilter, TodoPredicate } from '../models'
import { hasDateFilters, normalizeDateFilters, readDateFilters } from './date-filters'
import { normalizeOrGroups } from './or-groups'
import { withNormalizedNegation } from './filter-negation'
import { hasMarkers, normalizeMarkersFilter } from './markers'

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
  /**
   * null = no filter (all shown); Set = only tasks assigned to one of these
   * people (0 = unassigned) — or, with `negate.personIds`, to none of them.
   */
  personIds: Set<number> | null
  /** null = no filter; Set = only those statuses shown (0 = no status), or with `negate.statusIds` all but those. */
  statusIds: Set<number> | null
  /** Empty string = no filter; non-empty = case-insensitive substring match on title */
  searchText: string
  /**
   * The date filters, one clause per date type, all of which must pass:
   *   'deadline'  → todo.dueDate
   *   'followup'  → todo.nextFollowupAt
   *   'created'   → todo.createdAt
   *   'modified'  → todo.modifiedAt
   * `{}` = no date filter (see `DateFilters`).
   */
  dates: DateFilters
  /**
   * Markers filter: the task must be hot (Settings' Hot rule) or meet every
   * marker's Yes (`true`) / No (`false`) (Urgent = effective urgent,
   * `utils/urgency.ts`). null = no filter.
   */
  markers: MarkersFilter | null
  /**
   * null = no filter; Set of tag ids (into the `tags` registry) — todo must
   * have at least one assigned tag in the set (OR semantics; 0 = no tags, which
   * an untagged todo matches). An empty Set matches zero todos; a todo with no
   * tag assignments is excluded whenever this clause is non-null, non-empty
   * and without 0. With `negate.tags`: only tasks with none of these tags
   * (untagged passes unless 0 is in the set).
   */
  tags: Set<number> | null
  /** The "is not" switches of people / status / tags (`utils/filter-negation`); absent = every field "is". */
  negate?: FilterNegation
  /**
   * The or groups (`TodoPredicate.orGroups`), each with Sets as above: a
   * task must pass at least one clause of each. Absent = none (the
   * top bar's chips never have one; a list's, a lens's or a pane's may).
   */
  orGroups?: CriteriaClauses[]
  /**
   * The screen filter only: the top bar's lens (`utils/lens.withLens`),
   * a stage a task must pass as well — its own clauses and "is not"
   * switches, ANDed under these. It never decides completion (its
   * `showCompleted` is ignored: these do). Absent = no lens, or lifted.
   */
  lens?: FilterCriteria
}

/** The narrowing clauses of the runtime filter (the runtime `FilterClauses`): the shape of the root's and of each or group. */
export type CriteriaClauses = Pick<FilterCriteria, 'personIds' | 'statusIds' | 'tags' | 'searchText' | 'dates' | 'markers' | 'negate'>

/** Wraps a Date as a fixed-ISO `DateAnchor`. */
export function fixedAnchor(d: Date): DateAnchor {
  return { kind: 'fixed', iso: d.toISOString() }
}

/**
 * Number of active screen filters, one per control: people, status,
 * tags, dates (however many date types filter), markers, show completed,
 * search — and the lens, when the filter carries one (the composed screen
 * filter; the top bar's chips alone never do). Or groups aren't
 * counted: the screen filter never has one.
 */
export function countActiveFilters(f: FilterCriteria): number {
  const dates = hasDateFilters(f.dates)
  return [
    f.personIds !== null,
    f.statusIds !== null,
    f.tags !== null,
    dates,
    hasMarkers(f.markers),
    f.showCompleted,
    f.searchText !== '',
    f.lens != null,
  ].filter(Boolean).length
}

/**
 * The screen (top-bar) filter composed with a list's own filter, as the two
 * stages a task must both pass:
 *
 * - Narrowing clauses (people, status, tags, markers, search, dates) AND
 *   together — strictly, even on the same field: screen `@Alice` + list
 *   `@Bob` keeps only tasks assigned to both; screen Hot + list Urgent
 *   keeps only hot tasks that are urgent. Each side keeps its own "is not"
 *   switches: screen Status is not Waiting + list Status is Waiting, Done
 *   keeps only Done.
 * - `showCompleted` ORs: completed tasks show when either side shows them.
 */
export function composeScreenFilter(
  screen: FilterCriteria,
  list: FilterCriteria,
): readonly [FilterCriteria, FilterCriteria] {
  const showCompleted = screen.showCompleted || list.showCompleted
  return [{ ...screen, showCompleted }, { ...list, showCompleted }]
}

/** Runtime clauses → stored ones (not yet normalised: the callers run `withNormalizedNegation`). */
function clausesToPredicate(c: CriteriaClauses): FilterClauses {
  const p: FilterClauses = {
    personIds: c.personIds ? Array.from(c.personIds) : null,
    statusIds: c.statusIds ? Array.from(c.statusIds) : null,
    searchText: c.searchText,
    dates: normalizeDateFilters(c.dates),
    markers: normalizeMarkersFilter(c.markers),
    tags: c.tags ? Array.from(c.tags) : null,
  }
  return c.negate ? { ...p, negate: { ...c.negate } } : p
}

/** Stored clauses → runtime ones, "is not" switches normalised. Reads date anchors through `readDateAnchor` (legacy ISO strings → fixed). */
function clausesToCriteria(c: FilterClauses): CriteriaClauses {
  const f: CriteriaClauses = {
    personIds: Array.isArray(c.personIds) ? new Set(c.personIds) : null,
    statusIds: Array.isArray(c.statusIds) ? new Set(c.statusIds) : null,
    searchText: c.searchText,
    dates: readDateFilters(c.dates),
    markers: normalizeMarkersFilter(c.markers),
    tags: Array.isArray(c.tags) ? new Set(c.tags) : null,
  }
  return withNormalizedNegation(c.negate ? { ...f, negate: { ...c.negate } } : f)
}

/**
 * Runtime (Sets) → serializable (arrays) for saved views / list definitions.
 * The "is not" switches are normalised (`withNormalizedNegation`): `negate`
 * is present only while some field reads "is not"; the or groups are in
 * their stored form (`normalizeOrGroups`): `orGroups` is present only while
 * one filters. The lens isn't part of it.
 */
export function criteriaToPredicate(f: FilterCriteria): TodoPredicate {
  const p: TodoPredicate = withNormalizedNegation({ showCompleted: f.showCompleted, ...clausesToPredicate(f) })
  const orGroups = normalizeOrGroups(f.orGroups?.map(clausesToPredicate))
  return orGroups.length > 0 ? { ...p, orGroups } : p
}

/** Serializable → runtime. Inverse of `criteriaToPredicate` (or groups that filter nothing are left out). */
export function predicateToCriteria(p: TodoPredicate): FilterCriteria {
  const f: FilterCriteria = { showCompleted: p.showCompleted, ...clausesToCriteria(p) }
  const orGroups = normalizeOrGroups(p.orGroups).map(clausesToCriteria)
  return orGroups.length > 0 ? { ...f, orGroups } : f
}
