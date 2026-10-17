import { useCallback, useLayoutEffect, useMemo, useRef } from 'react'
import type { TodoPredicate } from '../../../models'
import { usePersonStore } from '../../../stores/person-store'
import { useStatusStore } from '../../../stores/status-store'
import { useTagStore } from '../../../stores/tag-store'
import { hasDateFilters } from '../../../utils/date-filters'
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
  /** Desktop: the short `Completed` label for Show completed (narrow windows). */
  compact?: boolean
}

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
 * nothing ticked).
 */
export function narrowedPeople(
  people: readonly { id?: number; name: string }[],
  personIds: ReadonlySet<number> | null,
): { id: number; name: string }[] {
  if (personIds === null) return []
  const picked = people.flatMap((p) => (p.id != null && personIds.has(p.id) ? [{ id: p.id, name: p.name }] : []))
  if (picked.length === people.length) return []
  return picked.sort(byName)
}

export const cycleTri =(v: boolean | null): boolean | null =>
  v === null ? true : v === true ? false : null
export const triIcon = (v: boolean | null) => (v === null ? '—' : v === true ? '✓' : '✕')
export const triLabel = (v: boolean | null) =>
  v === null ? 'No filter' : v ? 'Only tasks with this field' : 'Only tasks without this field'

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

  update: (patch: Partial<TodoPredicate>) => void
  setPersonIds: (next: Set<number> | null) => void
  setStatusIds: (next: Set<number> | null) => void
  setTags: (next: Set<number> | null) => void
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

  const inflightRef = useRef<TodoPredicate>(p)
  useLayoutEffect(() => {
    inflightRef.current = p
  }, [p])
  const update = useCallback(
    (patch: Partial<TodoPredicate>) => {
      const next = { ...inflightRef.current, ...patch }
      inflightRef.current = next
      onChange(next)
    },
    [onChange],
  )

  const setPersonIds = useCallback(
    (next: Set<number> | null) =>
      update({ personIds: next ? Array.from(next) : null }),
    [update],
  )
  const setStatusIds = useCallback(
    (next: Set<number> | null) => update({ statusIds: next ? Array.from(next) : null }),
    [update],
  )
  const setTags = useCallback(
    (next: Set<number> | null) => update({ tags: next ? Array.from(next) : null }),
    [update],
  )

  const clearAll = useCallback(() => {
    resetDensityState?.()
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
    update,
    setPersonIds,
    setStatusIds,
    setTags,
    clearAll,
  }
}
