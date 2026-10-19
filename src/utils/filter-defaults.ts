import { predicateToCriteria, type FilterCriteria } from './filter-criteria'
import type { MarkerKey, MarkerSet, TodoItem, TodoPredicate } from '../models'
import { activeMarkers } from './markers'
import { isNegated } from './filter-negation'

export interface FilterDefaults {
  personIds: number[]
  tagIds: number[]
  statusId: number | undefined
  /**
   * The markers the filter requires (Focus / Urgent / Important): new tasks
   * start with those flags, so they show where they were added. A Hot filter
   * seeds nothing (no single set of flags makes a task hot under every rule).
   */
  markers?: MarkerSet
}

/**
 * Extract task creation defaults from active filter criteria.
 * Strips sentinel value 0 (None/Unaffiliated) from entity ID sets.
 * Tags use OR semantics in the filter so all picked tag ids become defaults.
 * A Markers filter makes new tasks start with those markers flagged; a Hot
 * filter seeds none. An "is not" People / Status / Tags filter seeds nothing
 * (the new task simply has none of the excluded values).
 */
export function getFilterDefaults(filters: FilterCriteria): FilterDefaults {
  const seeds = (field: 'personIds' | 'tags') => {
    const ids = filters[field]
    return ids && !isNegated(filters, field) ? [...ids].filter(id => id !== 0) : []
  }
  const personIds = seeds('personIds')
  const tagIds = seeds('tags')

  let statusId: number | undefined
  if (filters.statusIds && filters.statusIds.size === 1 && !isNegated(filters, 'statusIds')) {
    const [only] = filters.statusIds
    if (only !== 0) statusId = only
  }

  const markers = activeMarkers(filters.markers)
  return markers.length > 0
    ? { personIds, tagIds, statusId, markers: Object.fromEntries(markers.map((k) => [k, true])) }
    : { personIds, tagIds, statusId }
}

/** The task flags a filter's markers seed (`{}` when none): spread into a new task. */
export function markerFlags(fd: Pick<FilterDefaults, 'markers'> | null | undefined): Pick<TodoItem, 'urgent' | 'important' | 'focus'> {
  const out: Pick<TodoItem, 'urgent' | 'important' | 'focus'> = {}
  for (const k of activeMarkers(fd?.markers)) out[k] = true
  return out
}

/**
 * `fd` with its Urgent / Important seeds replaced by `flags` (an Eisenhower
 * quadrant's "+": Do → both, Schedule → Important, Delegate → Urgent, Drop →
 * neither). Other markers (Focus) and the people / tags / status stay.
 */
export function withUrgentImportant(fd: FilterDefaults, flags: { urgent: boolean; important: boolean }): FilterDefaults {
  const markers: MarkerSet = {}
  if (fd.markers?.focus === true) markers.focus = true
  if (flags.urgent) markers.urgent = true
  if (flags.important) markers.important = true
  const base: FilterDefaults = { personIds: fd.personIds, tagIds: fd.tagIds, statusId: fd.statusId }
  return activeMarkers(markers).length > 0 ? { ...base, markers } : base
}

/**
 * `fd` without the given marker seeds (Quick Add: a preset marker chip
 * removed with its ×). The people / tags / status and other markers stay.
 */
export function withoutMarkers(fd: FilterDefaults, keys: readonly MarkerKey[]): FilterDefaults {
  if (keys.length === 0 || !fd.markers) return fd
  const markers: MarkerSet = { ...fd.markers }
  for (const k of keys) delete markers[k]
  const base: FilterDefaults = { personIds: fd.personIds, tagIds: fd.tagIds, statusId: fd.statusId }
  return activeMarkers(markers).length > 0 ? { ...base, markers } : base
}

/**
 * Same shape as `getFilterDefaults` but reads from a serializable
 * `TodoPredicate` — the form a `ListDefinition` stores on disk. Used to seed
 * a "+ Add task" affordance from the predicate of a list widget / saved list,
 * post any runtime-filter merge.
 */
export function predicateToFilterDefaults(predicate: TodoPredicate): FilterDefaults {
  return getFilterDefaults(predicateToCriteria(predicate))
}
