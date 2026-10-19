import type { DateAnchor, DateFilters, FilterNegation, MarkerSet, MarkersFilter, TodoPredicate } from '../models'
import { hasDateFilters, normalizeDateFilters, readDateFilters } from './date-filters'
import { withNormalizedNegation } from './filter-negation'
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
   * Markers filter: the task must be hot (Settings' Hot rule) or have every
   * listed marker (Urgent = effective urgent, `utils/urgency.ts`). null = no
   * filter.
   */
  markers: MarkersFilter | null
  /**
   * null = no filter; Set of tag ids (into the `tags` registry) — todo must
   * have at least one assigned tag in the set (OR semantics). An empty Set
   * matches zero todos; a todo with no tag assignments is excluded whenever
   * this clause is non-null and non-empty. With `negate.tags`: only tasks
   * with none of these tags (untagged passes).
   */
  tags: Set<number> | null
  /** The "is not" switches of people / status / tags (`utils/filter-negation`); absent = every field "is". */
  negate?: FilterNegation
}

/** Wraps a Date as a fixed-ISO `DateAnchor`. */
export function fixedAnchor(d: Date): DateAnchor {
  return { kind: 'fixed', iso: d.toISOString() }
}

/**
 * Number of active screen filters, one per control: people, status,
 * tags, dates (however many date types filter), markers, show completed,
 * search.
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

/**
 * Runtime (Sets) → serializable (arrays) for saved views / list definitions.
 * The "is not" switches are normalised (`withNormalizedNegation`): `negate`
 * is present only while some field reads "is not".
 */
export function criteriaToPredicate(f: FilterCriteria): TodoPredicate {
  const p: TodoPredicate = {
    showCompleted: f.showCompleted,
    personIds: f.personIds ? Array.from(f.personIds) : null,
    statusIds: f.statusIds ? Array.from(f.statusIds) : null,
    searchText: f.searchText,
    dates: normalizeDateFilters(f.dates),
    markers: normalizeMarkers(f.markers),
    tags: f.tags ? Array.from(f.tags) : null,
  }
  return withNormalizedNegation(f.negate ? { ...p, negate: { ...f.negate } } : p)
}

/** Serializable → runtime. Inverse of `criteriaToPredicate`. Reads date anchors through `readDateAnchor` (legacy ISO strings → fixed). */
export function predicateToCriteria(p: TodoPredicate): FilterCriteria {
  const f: FilterCriteria = {
    showCompleted: p.showCompleted,
    personIds: Array.isArray(p.personIds) ? new Set(p.personIds) : null,
    statusIds: Array.isArray(p.statusIds) ? new Set(p.statusIds) : null,
    searchText: p.searchText,
    dates: readDateFilters(p.dates),
    markers: normalizeMarkers(p.markers),
    tags: Array.isArray(p.tags) ? new Set(p.tags) : null,
  }
  return withNormalizedNegation(p.negate ? { ...f, negate: { ...p.negate } } : f)
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
