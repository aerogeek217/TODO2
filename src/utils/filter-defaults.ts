import type { FilterCriteria } from '../stores/filter-store'
import { predicateToCriteria } from '../stores/filter-store'
import type { ResolvedInput } from '../services/nlp-resolver'
import type { MarkerSet, TodoItem, TodoPredicate } from '../models'
import { activeMarkers } from './markers'

export interface FilterDefaults {
  personIds: number[]
  tagIds: number[]
  statusId: number | undefined
  /**
   * The markers the filter requires (Urgent / Important / Focus): new tasks
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
 * filter seeds none.
 */
export function getFilterDefaults(filters: FilterCriteria): FilterDefaults {
  const personIds = filters.personIds ? [...filters.personIds].filter(id => id !== 0) : []
  const tagIds = filters.tags ? [...filters.tags].filter(id => id !== 0) : []

  let statusId: number | undefined
  if (filters.statusIds && filters.statusIds.size === 1) {
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

/** Whether a filter's defaults seed any marker flag. */
export function seedsMarkers(fd: Pick<FilterDefaults, 'markers'> | null | undefined): boolean {
  return activeMarkers(fd?.markers).length > 0
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
 * Same shape as `getFilterDefaults` but reads from a serializable
 * `TodoPredicate` — the form a `ListDefinition` stores on disk. Used to seed
 * a "+ Add task" affordance from the predicate of a list widget / saved list,
 * post any runtime-filter merge.
 */
export function predicateToFilterDefaults(predicate: TodoPredicate): FilterDefaults {
  return getFilterDefaults(predicateToCriteria(predicate))
}

/**
 * Supplement resolved NLP output with filter-inferred defaults.
 * Mutates `resolved` in place for person/status fields; person defaults
 * apply only when the input names nobody (matched or new).
 * Tags merge: filter-default tag ids are appended to any user-typed `#tag`
 * slugs as a parallel `seedTagIds` channel — applied at submit by the
 * caller (resolved.tags stays string-typed).
 */
export function supplementWithFilterDefaults(
  resolved: ResolvedInput,
  fd: FilterDefaults,
): void {
  // Any typed `@person` wins — including a new name, created on submit.
  if (resolved.personIds.length === 0 && resolved.unmatchedPersons.length === 0) {
    resolved.personIds = fd.personIds
  }
  if (resolved.statusId === undefined && fd.statusId !== undefined) {
    resolved.statusId = fd.statusId
  }
}
