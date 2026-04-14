import { Priority } from '../models'
import type { FilterCriteria } from '../stores/filter-store'

export interface FilterDefaults {
  personIds: number[]
  tagIds: number[]
  orgIds: number[]
  statusId: number | undefined
  priority: Priority | undefined
  isStarred: boolean
  isAssigned: boolean
}

/**
 * Extract task creation defaults from active filter criteria.
 * Strips sentinel value 0 (None/Unaffiliated) from entity ID sets.
 */
export function getFilterDefaults(filters: FilterCriteria): FilterDefaults {
  const personIds = filters.personIds ? [...filters.personIds].filter(id => id !== 0) : []
  const tagIds = filters.tagIds ? [...filters.tagIds].filter(id => id !== 0) : []
  const orgIds = filters.orgIds ? [...filters.orgIds].filter(id => id !== 0) : []

  // Only infer status when exactly one non-zero value is selected
  let statusId: number | undefined
  if (filters.statusIds && filters.statusIds.size === 1) {
    const [only] = filters.statusIds
    if (only !== 0) statusId = only
  }

  // Only infer priority when exactly one value is selected
  let priority: Priority | undefined
  if (filters.priorities && filters.priorities.size === 1) {
    const [only] = filters.priorities
    priority = only
  }

  const isStarred = filters.followupFilter === 'followup'
  const isAssigned = filters.assignedFilter === 'assigned'

  return { personIds, tagIds, orgIds, statusId, priority, isStarred, isAssigned }
}
