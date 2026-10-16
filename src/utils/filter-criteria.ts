import type { DateAnchor, DateField, MarkerSet, MarkersFilter, TodoPredicate } from '../models'
import { readDateAnchor } from './date-anchor'
import { activeMarkers, hasMarkers, isHotFilter } from './markers'

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

/** Wraps a Date as a fixed-ISO `DateAnchor`. */
export function fixedAnchor(d: Date): DateAnchor {
  return { kind: 'fixed', iso: d.toISOString() }
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
