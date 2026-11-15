import { create } from 'zustand'
import type { FilterExpr, NegatableField } from '../models'
import { withDateMatch } from '../utils/date-filters'
import { countActiveFilters, criteriaToPredicate, fixedAnchor, predicateToCriteria, type FilterCriteria } from '../utils/filter-criteria'
import { normalizeExpression, splitTopLevel, wholeExpression } from '../utils/filter-expression'
import { isNegated, withIdFilter, withNormalizedNegation } from '../utils/filter-negation'
import {
  sameSearchField,
  searchFieldValue,
  withSearchClause,
  withSearchFieldValue,
  type SearchClause,
  type SearchField,
  type SearchFieldValue,
} from '../utils/search-clause'

/**
 * The screen (top-bar) filter. The criteria type, its converters and the
 * evaluators are in `utils/filter-criteria` / `utils/filter-match`.
 */

/**
 * A chip the search box made from a token (`applySearchTokens`): the token
 * as typed, and its field as it was before — what Backspace in the empty
 * box puts back (`unwindSearchToken`).
 */
interface BoxChip {
  token: string
  field: SearchField
  before: SearchFieldValue
}

/** The screen filter as one expression: what the top bar's field shows and edits (`fieldFilter`). */
interface ScreenFieldFilter {
  expression: FilterExpr | null
  showCompleted: boolean
}

/**
 * The filter as the top bar's field last wrote it (`applyExpression`) — its
 * terms in the order typed — and the filters that made: while those are
 * still the store's, the field shows it as typed.
 */
interface TypedFilter extends ScreenFieldFilter {
  filters: FilterCriteria
}

interface FilterState {
  filters: FilterCriteria
  /** Derived: true when any filter is active. Use useFilterStore(s => s.isActive) or getState().isActive. */
  readonly isActive: boolean

  setShowCompleted: (show: boolean) => void
  setPersonIds: (personIds: Set<number> | null) => void
  setStatusIds: (statusIds: Set<number> | null) => void
  setSearchText: (text: string) => void
  /** The due-date range, Date endpoints as `{kind:'fixed', iso}` anchors; both `null` = no due-date filter. */
  setDateRange: (start: Date | null, end: Date | null) => void
  setTags: (tags: Set<number> | null) => void
  /**
   * Turns a People / Status / Tags filter's "is not" switch on or off,
   * keeping its ticks. A field that doesn't filter has no switch to keep
   * (the pickers hold an "is not" with nothing ticked themselves).
   */
  setNegated: (field: NegatableField, negated: boolean) => void
  setAllFilters: (filters: FilterCriteria) => void
  clearAll: () => void
  /**
   * The chips the search box made, oldest first. A field set any other way
   * (its picker, ×, Clear all) drops its own: Backspace leaves chips set
   * from their pickers alone.
   */
  boxChips: readonly BoxChip[]
  /** The search box's complete tokens become chips (`utils/search-clause.withSearchClause`), in order. */
  applySearchTokens: (tokens: readonly { raw: string; clause: SearchClause }[]) => void
  /** Takes the last chip the box made off its field (back as it was); its token, or null when there is none. */
  unwindSearchToken: () => string | null
  /**
   * The top bar's field (P2): `expression` and Show completed become the
   * whole screen filter — each top-level `and` term a chip can say one chip
   * (`splitTopLevel`: one per field, one Priority chip, as the top bar
   * holds), the other terms the screen filter's `expression`, ANDed with
   * them. Not persisted, as the chips aren't.
   */
  applyExpression: (expression: FilterExpr | null, showCompleted: boolean) => void
  /** What the field last wrote (`applyExpression`), or null. */
  typed: TypedFilter | null
}

const defaultFilters: FilterCriteria = {
  showCompleted: false,
  personIds: null,
  statusIds: null,
  searchText: '',
  dates: {},
  markers: null,
  tags: null,
}

const NO_BOX_CHIPS: readonly BoxChip[] = []

function isFilterActive(f: FilterCriteria): boolean {
  return countActiveFilters(f) > 0
}

/**
 * Stores `filters` with its "is not" switches normalised (an "is not" with
 * nothing ticked = no filter). The box's chips are `boxChips` when given
 * (the box's own edits), else those whose field this edit leaves as it was.
 */
function commit(
  set: (s: Partial<FilterState>) => void,
  get: () => FilterState,
  filters: FilterCriteria,
  boxChips?: readonly BoxChip[],
) {
  const normalized = withNormalizedNegation(filters)
  const prev = get()
  const kept = boxChips ?? (prev.boxChips.length === 0
    ? prev.boxChips
    : prev.boxChips.filter((c) => sameSearchField(prev.filters, normalized, c.field)))
  set({ filters: normalized, isActive: isFilterActive(normalized), boxChips: kept })
}

export const useFilterStore = create<FilterState>((set, get) => ({
  filters: { ...defaultFilters },
  isActive: false,
  boxChips: NO_BOX_CHIPS,
  typed: null,

  setShowCompleted(showCompleted: boolean) {
    commit(set, get, { ...get().filters, showCompleted })
  },

  setPersonIds(personIds: Set<number> | null) {
    const filters = get().filters
    commit(set, get, withIdFilter(filters, 'personIds', personIds, isNegated(filters, 'personIds')))
  },

  setStatusIds(statusIds: Set<number> | null) {
    const filters = get().filters
    commit(set, get, withIdFilter(filters, 'statusIds', statusIds, isNegated(filters, 'statusIds')))
  },

  setSearchText(searchText: string) {
    commit(set, get, { ...get().filters, searchText })
  },

  setDateRange(start: Date | null, end: Date | null) {
    const filters = get().filters
    commit(set, get, {
      ...filters,
      dates: withDateMatch(filters.dates, 'deadline', {
        match: 'range',
        start: start ? fixedAnchor(start) : null,
        end: end ? fixedAnchor(end) : null,
      }),
    })
  },

  setTags(tags: Set<number> | null) {
    const filters = get().filters
    commit(set, get, withIdFilter(filters, 'tags', tags, isNegated(filters, 'tags')))
  },

  setNegated(field: NegatableField, negated: boolean) {
    const filters = get().filters
    commit(set, get, withIdFilter(filters, field, filters[field], negated))
  },

  setAllFilters(filters: FilterCriteria) {
    commit(set, get, { ...filters })
  },

  clearAll() {
    set({
      filters: { ...defaultFilters },
      isActive: false,
      boxChips: NO_BOX_CHIPS,
      typed: null,
    })
  },

  applyExpression(expression, showCompleted) {
    commit(set, get, screenFilterOf(expression, showCompleted), NO_BOX_CHIPS)
    set({ typed: { expression, showCompleted, filters: get().filters } })
  },

  applySearchTokens(tokens) {
    if (tokens.length === 0) return
    let filters = get().filters
    const chips = [...get().boxChips]
    for (const { raw, clause } of tokens) {
      chips.push({ token: raw, field: clause.field, before: searchFieldValue(filters, clause.field) })
      filters = withNormalizedNegation(withSearchClause(filters, clause))
    }
    commit(set, get, filters, chips)
  },

  unwindSearchToken() {
    const chips = get().boxChips
    const last = chips.at(-1)
    if (!last) return null
    commit(set, get, withSearchFieldValue(get().filters, last.before), chips.slice(0, -1))
    return last.token
  },
}))

/** The top bar holds one Priority chip (its picker edits one condition). */
const SCREEN_MARKER_CHIPS = 1

/** `expression` and Show completed as the screen filter: its chips, and the terms no chip says as its expression (`applyExpression`). */
export function screenFilterOf(expression: FilterExpr | null, showCompleted: boolean): FilterCriteria {
  const { clauses, rest } = splitTopLevel(expression, { markerChips: SCREEN_MARKER_CHIPS })
  const criteria = predicateToCriteria({ showCompleted, ...clauses })
  const [only] = rest
  if (!only) return criteria
  return { ...criteria, expression: rest.length === 1 ? only : normalizeExpression({ kind: 'and', items: rest }) }
}

/**
 * The screen filter as the top bar's field shows it: as the field last
 * wrote it while that is still the filter (`typed`), else its chips and
 * expression as one expression (`wholeExpression`: the chips in their
 * order, then the expression).
 */
export function fieldFilter(filters: FilterCriteria, typed: TypedFilter | null): ScreenFieldFilter {
  if (typed && typed.filters === filters) return { expression: typed.expression, showCompleted: typed.showCompleted }
  return { expression: wholeExpression(criteriaToPredicate(filters)), showCompleted: filters.showCompleted }
}
