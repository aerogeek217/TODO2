import type { DateField } from '../models/app-view'

export const DATE_FIELD_LABELS: Record<DateField, string> = {
  deadline: 'Due date',
  followup: 'Next follow-up',
  created: 'Created',
  modified: 'Modified',
}

/** The id filters' "none" choice (id 0) by field: a task with no person, no status, no tag. */
export const UNASSIGNED_LABEL = 'Unassigned'
export const NO_STATUS_LABEL = 'No status'
export const NO_TAGS_LABEL = 'No tags'

export const DATE_FIELD_LABELS_SHORT: Record<DateField, string> = {
  deadline: 'Due',
  followup: 'Follow-up',
  created: 'Created',
  modified: 'Modified',
}
