import type { FilterCriteria } from '../stores/filter-store'
import type { ResolvedInput } from '../services/nlp-resolver'

export interface FilterDefaults {
  personIds: number[]
  orgIds: number[]
  statusId: number | undefined
  projectId: number | undefined
}

/**
 * Extract task creation defaults from active filter criteria.
 * Strips sentinel value 0 (None/Unaffiliated) from entity ID sets.
 */
export function getFilterDefaults(filters: FilterCriteria): FilterDefaults {
  const personIds = filters.personIds ? [...filters.personIds].filter(id => id !== 0) : []
  const orgIds = filters.orgIds ? [...filters.orgIds].filter(id => id !== 0) : []

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

  return { personIds, orgIds, statusId, projectId }
}

/**
 * Supplement resolved NLP output with filter-inferred defaults.
 * Mutates `resolved` in place for person/org/project fields.
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
}
