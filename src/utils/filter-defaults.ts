import type { FilterCriteria } from '../stores/filter-store'
import type { ResolvedInput } from '../services/nlp-resolver'

export interface FilterDefaults {
  personIds: number[]
  orgIds: number[]
  statusId: number | undefined
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

  return { personIds, orgIds, statusId }
}

/**
 * Supplement resolved NLP output with filter-inferred defaults.
 * Mutates `resolved` in place for person/org fields.
 */
export function supplementWithFilterDefaults(
  resolved: ResolvedInput,
  fd: FilterDefaults,
): void {
  if (resolved.personIds.length === 0) resolved.personIds = fd.personIds
  if (resolved.orgIds.length === 0) resolved.orgIds = fd.orgIds
}
