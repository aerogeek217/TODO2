import { useCallback, useLayoutEffect, useMemo, useRef } from 'react'
import type { TodoPredicate } from '../../../models'
import { usePersonStore } from '../../../stores/person-store'
import { useOrgStore } from '../../../stores/org-store'
import { useProjectStore } from '../../../stores/project-store'
import { useStatusStore } from '../../../stores/status-store'
import { useTagStore } from '../../../stores/tag-store'

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
}

export const DEFAULT_PREDICATE: TodoPredicate = {
  showCompleted: false,
  showHiddenStatuses: false,
  personIds: null,
  personFilterMode: 'include-orgs',
  orgIds: null,
  orgFilterMode: 'include-people',
  projectIds: null,
  statusIds: null,
  searchText: '',
  dateField: 'date',
  dateRangeStart: null,
  dateRangeEnd: null,
  dateRangeIncludeNoDate: false,
  hasScheduled: null,
  hasDeadline: null,
  tags: null,
}

export type EntityKey = 'project' | 'people' | 'org' | 'status' | 'tags'

export function hasAnyFilter(p: TodoPredicate): boolean {
  return (
    p.showCompleted ||
    p.showHiddenStatuses ||
    p.personIds !== null ||
    p.orgIds !== null ||
    p.projectIds !== null ||
    p.statusIds !== null ||
    p.searchText !== '' ||
    p.dateRangeStart !== null ||
    p.dateRangeEnd !== null ||
    p.hasScheduled !== null ||
    p.hasDeadline !== null ||
    (p.tags ?? null) !== null
  )
}

export const cycleTri = (v: boolean | null): boolean | null =>
  v === null ? true : v === true ? false : null
export const triIcon = (v: boolean | null) => (v === null ? '—' : v === true ? '✓' : '✕')
export const triLabel = (v: boolean | null) =>
  v === null ? 'No filter' : v ? 'Only tasks with this field' : 'Only tasks without this field'

export interface FilterChipBarSharedState {
  p: TodoPredicate
  people: ReturnType<typeof usePersonStore.getState>['people']
  orgs: ReturnType<typeof useOrgStore.getState>['orgs']
  projects: ReturnType<typeof useProjectStore.getState>['projects']
  statuses: ReturnType<typeof useStatusStore.getState>['statuses']
  sortedTags: ReturnType<typeof useTagStore.getState>['tags']
  allTagIds: number[]

  personIdsSet: Set<number> | null
  orgIdsSet: Set<number> | null
  projectIdsSet: Set<number> | null
  statusIdsSet: Set<number> | null
  tagIdsSet: Set<number> | null

  peopleActive: boolean
  orgsActive: boolean
  projectsActive: boolean
  statusActive: boolean
  tagsActive: boolean
  dateActive: boolean
  active: boolean

  update: (patch: Partial<TodoPredicate>) => void
  setPersonIds: (next: Set<number> | null) => void
  setOrgIds: (next: Set<number> | null) => void
  setProjectIds: (next: Set<number> | null) => void
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
 * the prop from this render — so two `update` calls in one handler (e.g.
 * the Date-field button or Date-dropdown Clear, which patch dateField +
 * anchors / anchors + tri-states) don't both close over the same stale `p`.
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
  const orgs = useOrgStore((s) => s.orgs)
  const projects = useProjectStore((s) => s.projects)
  const statuses = useStatusStore((s) => s.statuses)
  const tags = useTagStore((s) => s.tags)

  const personIdsSet = useMemo(() => (p.personIds ? new Set(p.personIds) : null), [p.personIds])
  const orgIdsSet = useMemo(() => (p.orgIds ? new Set(p.orgIds) : null), [p.orgIds])
  const projectIdsSet = useMemo(() => (p.projectIds ? new Set(p.projectIds) : null), [p.projectIds])
  const statusIdsSet = useMemo(() => (p.statusIds ? new Set(p.statusIds) : null), [p.statusIds])
  const tagIdsSet = useMemo(() => (p.tags ? new Set(p.tags) : null), [p.tags])

  const sortedTags = useMemo(() => [...tags].sort((a, b) => a.name.localeCompare(b.name)), [tags])
  const allTagIds = useMemo(() => sortedTags.map((t) => t.id!), [sortedTags])

  const peopleActive = p.personIds !== null
  const orgsActive = p.orgIds !== null
  const projectsActive = p.projectIds !== null
  const statusActive = p.statusIds !== null
  const tagsActive = (p.tags ?? null) !== null
  const dateActive =
    p.dateRangeStart !== null ||
    p.dateRangeEnd !== null ||
    p.hasScheduled !== null ||
    p.hasDeadline !== null
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
  const setOrgIds = useCallback(
    (next: Set<number> | null) => update({ orgIds: next ? Array.from(next) : null }),
    [update],
  )
  const setProjectIds = useCallback(
    (next: Set<number> | null) => update({ projectIds: next ? Array.from(next) : null }),
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
    orgs,
    projects,
    statuses,
    sortedTags,
    allTagIds,
    personIdsSet,
    orgIdsSet,
    projectIdsSet,
    statusIdsSet,
    tagIdsSet,
    peopleActive,
    orgsActive,
    projectsActive,
    statusActive,
    tagsActive,
    dateActive,
    active,
    update,
    setPersonIds,
    setOrgIds,
    setProjectIds,
    setStatusIds,
    setTags,
    clearAll,
  }
}
