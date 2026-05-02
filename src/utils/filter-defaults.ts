import type { FilterCriteria } from '../stores/filter-store'
import { predicateToCriteria } from '../stores/filter-store'
import type { ResolvedInput } from '../services/nlp-resolver'
import type { TodoPredicate } from '../models'

export interface FilterDefaults {
  personIds: number[]
  orgIds: number[]
  tagIds: number[]
  statusId: number | undefined
  projectId: number | undefined
}

/**
 * Extract task creation defaults from active filter criteria.
 * Strips sentinel value 0 (None/Unaffiliated) from entity ID sets.
 * Tags use OR semantics in the filter so all picked tag ids become defaults.
 */
export function getFilterDefaults(filters: FilterCriteria): FilterDefaults {
  const personIds = filters.personIds ? [...filters.personIds].filter(id => id !== 0) : []
  const orgIds = filters.orgIds ? [...filters.orgIds].filter(id => id !== 0) : []
  const tagIds = filters.tags ? [...filters.tags].filter(id => id !== 0) : []

  let statusId: number | undefined
  if (filters.statusIds && filters.statusIds.size === 1) {
    const [only] = filters.statusIds
    if (only !== 0) statusId = only
  }

  let projectId: number | undefined
  if (filters.projectIds && filters.projectIds.size === 1) {
    const [only] = filters.projectIds
    if (only !== 0) projectId = only
  }

  return { personIds, orgIds, tagIds, statusId, projectId }
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
 * Mutates `resolved` in place for person/org/project fields.
 * Tags merge: filter-default tag ids are appended to any user-typed `#tag`
 * slugs as a parallel `seedTagIds` channel — applied at submit by the
 * caller (resolved.tags stays string-typed).
 */
export function supplementWithFilterDefaults(
  resolved: ResolvedInput,
  fd: FilterDefaults,
): void {
  if (resolved.personIds.length === 0) resolved.personIds = fd.personIds
  if (resolved.orgIds.length === 0) resolved.orgIds = fd.orgIds
  if (resolved.projectId === undefined && fd.projectId !== undefined) {
    resolved.projectId = fd.projectId
  }
  if (resolved.statusId === undefined && fd.statusId !== undefined) {
    resolved.statusId = fd.statusId
  }
}
