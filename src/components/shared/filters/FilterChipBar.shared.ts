import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { NegatableField, TodoPredicate } from '../../../models'
import { usePersonStore } from '../../../stores/person-store'
import { useStatusStore } from '../../../stores/status-store'
import { useTagStore } from '../../../stores/tag-store'
import { hasDateFilters } from '../../../utils/date-filters'
import { clearChipField, type FilterChipField } from '../../../utils/filter-chips'
import { isNegated, withIdFilter } from '../../../utils/filter-negation'
import { hasMarkers } from '../../../utils/markers'
import { byName } from '../../../utils/sort-order'

export type FilterChipDensity = 'desktop' | 'mobile'

export interface FilterChipBarProps {
  predicate: TodoPredicate
  onChange: (next: TodoPredicate) => void
  density?: FilterChipDensity
  /**
   * If `true` and an active filter is in effect, the Clear-all button is
   * rendered. Default `true`. Mobile callers may set `onClearExtra` to do
   * additional work after clearAll fires (e.g., close the sheet).
   */
  showClearAll?: boolean
  /** Optional follow-on after the user clicks Clear all (e.g., close the sheet). */
  onClearExtra?: () => void
  /**
   * Optional clear-all override. When provided, the Clear-all button calls
   * this instead of `onChange({...defaultPredicate})`. Used by callers that
   * route changes through a store carrying non-predicate state (e.g.
   * runtime-filter spec/value) — those callers prefer their dedicated clear
   * path so the extra slots get reset along with the predicate.
   */
  onClearAll?: () => void
  /** Desktop: fold the filter buttons into one Filters menu (narrow windows). */
  fold?: boolean
  /**
   * Desktop: also lay out both folds hidden and inert, at their natural
   * widths (no `valueWidths`), so a host that folds by measure (the top bar)
   * knows both widths and each value's at all times. The shown buttons / menu
   * and each hidden fold sit in a `FOLD_VARIANT_ATTR` wrapper, the hidden
   * ones marked `FOLD_HIDDEN_ATTR`.
   */
  measureFold?: boolean
  /**
   * Desktop: the widths (px) some filter values are cut to with an ellipsis,
   * by field (`people`, `tags`, …) — a host short of room (the top bar).
   * A cut value's button shows the whole value in its tooltip.
   */
  valueWidths?: Readonly<Partial<Record<string, number>>>
  /** Desktop: the Esc that closes a picker (or the Filters menu) stops there, so nothing behind also takes it. */
  consumeEscape?: boolean
}

/** A `measureFold` filter bar's wrapper around its filter buttons (`open`) or its Filters menu (`folded`). */
export const FOLD_VARIANT_ATTR = 'data-fold-variant'
export type FoldVariant = 'open' | 'folded'
/** On the wrappers of the folds laid out only to be measured (their boxes' widths). */
export const FOLD_HIDDEN_ATTR = 'data-fold-hidden'
/** On a filter button's value text while the filter is on: the field (`people`, …). */
export const FOLD_VALUE_ATTR = 'data-fold-value'

export const DEFAULT_PREDICATE: TodoPredicate = {
  showCompleted: false,
  personIds: null,
  statusIds: null,
  searchText: '',
  dates: {},
  markers: null,
  tags: null,
}

export type EntityKey = 'people' | 'status' | 'tags'

/** The predicate field of each entity filter. */
export const ENTITY_ID_FIELD: Record<EntityKey, NegatableField> = {
  people: 'personIds',
  status: 'statusIds',
  tags: 'tags',
}

export function hasAnyFilter(p: TodoPredicate): boolean {
  return (
    p.showCompleted ||
    p.personIds !== null ||
    p.statusIds !== null ||
    p.searchText !== '' ||
    hasDateFilters(p.dates) ||
    hasMarkers(p.markers) ||
    (p.tags ?? null) !== null
  )
}

/**
 * The people a People filter is narrowed to, by name — empty when it shows
 * everyone (no filter, or every person ticked) or no one (only None, or
 * nothing ticked). An "is not" filter is narrowed to the people not ticked.
 */
export function narrowedPeople(
  people: readonly { id?: number; name: string }[],
  personIds: ReadonlySet<number> | null,
  negated = false,
): { id: number; name: string }[] {
  if (personIds === null) return []
  const picked = people.flatMap((p) => (p.id != null && personIds.has(p.id) !== negated ? [{ id: p.id, name: p.name }] : []))
  if (picked.length === people.length) return []
  return picked.sort(byName)
}

export interface FilterChipBarSharedState {
  p: TodoPredicate
  people: ReturnType<typeof usePersonStore.getState>['people']
  statuses: ReturnType<typeof useStatusStore.getState>['statuses']
  sortedTags: ReturnType<typeof useTagStore.getState>['tags']
  allTagIds: number[]

  personIdsSet: Set<number> | null
  statusIdsSet: Set<number> | null
  tagIdsSet: Set<number> | null

  peopleActive: boolean
  statusActive: boolean
  tagsActive: boolean
  dateActive: boolean
  active: boolean
  /**
   * Each entity picker's Is / Is not mode: the field's stored switch, or an
   * "is not" picked with nothing ticked yet (held here until the first tick).
   */
  negated: Record<EntityKey, boolean>

  update: (patch: Partial<TodoPredicate>) => void
  /** Sets an entity filter's ids, keeping its picker's mode. */
  setPersonIds: (next: Set<number> | null) => void
  setStatusIds: (next: Set<number> | null) => void
  setTags: (next: Set<number> | null) => void
  /** Switches an entity picker between Is and Is not, keeping its ticks. */
  setNegated: (key: EntityKey, negated: boolean) => void
  /** Forgets an "is not" picked with nothing ticked (its picker closed). */
  dropPendingMode: (key: EntityKey) => void
  /** Clears one field (its × in the top bar); People / Status / Tags lose their switch too. */
  clearField: (field: FilterChipField) => void
  clearAll: () => void
}

/**
 * Predicate-management layer shared by the desktop and mobile FilterChipBar
 * variants. Owns predicate normalization, store reads, derived `*IdsSet` /
 * `*Active` flags, and the `update` / setter callbacks. Density-specific
 * state (`previewEmpty` for desktop, `openSection` / `entitySearch` for
 * mobile) lives in the per-density component.
 *
 * `update` composes patches against the latest predicate we've sent — not
 * the prop from this render — so two `update` calls in one handler don't
 * both close over the same stale `p`.
 * The ref sync via useLayoutEffect keeps the in-flight value coherent
 * across renders triggered by external store updates.
 */
export function useFilterChipBarState(
  rawPredicate: TodoPredicate,
  onChange: (next: TodoPredicate) => void,
  onClearAll: (() => void) | undefined,
  onClearExtra: (() => void) | undefined,
  resetDensityState?: () => void,
): FilterChipBarSharedState {
  const p = useMemo<TodoPredicate>(
    () => ({ ...DEFAULT_PREDICATE, ...rawPredicate }),
    [rawPredicate],
  )

  const people = usePersonStore((s) => s.people)
  const statuses = useStatusStore((s) => s.statuses)
  const tags = useTagStore((s) => s.tags)

  const personIdsSet = useMemo(() => (p.personIds ? new Set(p.personIds) : null), [p.personIds])
  const statusIdsSet = useMemo(() => (p.statusIds ? new Set(p.statusIds) : null), [p.statusIds])
  const tagIdsSet = useMemo(() => (p.tags ? new Set(p.tags) : null), [p.tags])

  const sortedTags = useMemo(() => [...tags].sort(byName), [tags])
  const allTagIds = useMemo(() => sortedTags.map((t) => t.id!), [sortedTags])

  const peopleActive = p.personIds !== null
  const statusActive = p.statusIds !== null
  const tagsActive = (p.tags ?? null) !== null
  const dateActive = hasDateFilters(p.dates)
  const active = hasAnyFilter(p)

  // "Is not" picked on a field with nothing ticked: no filter is stored, so
  // the picker holds the mode until the first tick.
  const [pendingNot, setPendingNot] = useState<ReadonlySet<EntityKey>>(() => new Set())
  const negated = useMemo<Record<EntityKey, boolean>>(() => {
    const modeOf = (key: EntityKey): boolean => {
      const field = ENTITY_ID_FIELD[key]
      return isNegated(p, field) || (pendingNot.has(key) && (p[field] ?? null) === null)
    }
    return { people: modeOf('people'), status: modeOf('status'), tags: modeOf('tags') }
  }, [p, pendingNot])
  const negatedRef = useRef(negated)
  useLayoutEffect(() => {
    negatedRef.current = negated
  }, [negated])

  const inflightRef = useRef<TodoPredicate>(p)
  useLayoutEffect(() => {
    inflightRef.current = p
  }, [p])
  const send = useCallback(
    (next: TodoPredicate) => {
      inflightRef.current = next
      onChange(next)
    },
    [onChange],
  )
  const update = useCallback(
    (patch: Partial<TodoPredicate>) => send({ ...inflightRef.current, ...patch }),
    [send],
  )

  const setPending = useCallback((key: EntityKey, on: boolean) => {
    setPendingNot((cur) => {
      if (cur.has(key) === on) return cur
      const next = new Set(cur)
      if (on) next.add(key)
      else next.delete(key)
      return next
    })
  }, [])

  // The ids and the switch are written together (`withIdFilter` drops the
  // switch with the last tick), so the predicate is replaced, not patched.
  // An "is not" picker stays on Is not when its last tick goes.
  const setIds = useCallback(
    (key: EntityKey, next: Set<number> | null) => {
      const not = negatedRef.current[key]
      if (not) setPending(key, true)
      send(withIdFilter(inflightRef.current, ENTITY_ID_FIELD[key], next ? Array.from(next) : null, not))
    },
    [send, setPending],
  )
  const setPersonIds = useCallback((next: Set<number> | null) => setIds('people', next), [setIds])
  const setStatusIds = useCallback((next: Set<number> | null) => setIds('status', next), [setIds])
  const setTags = useCallback((next: Set<number> | null) => setIds('tags', next), [setIds])
  const setNegated = useCallback(
    (key: EntityKey, on: boolean) => {
      negatedRef.current = { ...negatedRef.current, [key]: on }
      setPending(key, on)
      const field = ENTITY_ID_FIELD[key]
      const ids = inflightRef.current[field] ?? null
      if (ids !== null) send(withIdFilter(inflightRef.current, field, ids, on))
    },
    [send, setPending],
  )
  const dropPendingMode = useCallback((key: EntityKey) => setPending(key, false), [setPending])
  // Replaced, not patched: a cleared People / Status / Tags filter drops its
  // switch, and a patch would keep the `negate` key it no longer has.
  const clearField = useCallback(
    (field: FilterChipField) => send(clearChipField(inflightRef.current, field)),
    [send],
  )

  const clearAll = useCallback(() => {
    resetDensityState?.()
    setPendingNot(new Set())
    if (onClearAll) onClearAll()
    else onChange({ ...DEFAULT_PREDICATE })
    onClearExtra?.()
  }, [onChange, onClearAll, onClearExtra, resetDensityState])

  return {
    p,
    people,
    statuses,
    sortedTags,
    allTagIds,
    personIdsSet,
    statusIdsSet,
    tagIdsSet,
    peopleActive,
    statusActive,
    tagsActive,
    dateActive,
    active,
    negated,
    update,
    setPersonIds,
    setStatusIds,
    setTags,
    setNegated,
    dropPendingMode,
    clearField,
    clearAll,
  }
}
