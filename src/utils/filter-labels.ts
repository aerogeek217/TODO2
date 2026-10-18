import type { DateField } from '../models/app-view'

export const DATE_FIELD_LABELS: Record<DateField, string> = {
  deadline: 'Due date',
  followup: 'Next follow-up',
  created: 'Created',
  modified: 'Modified',
}

export const DATE_FIELD_LABELS_SHORT: Record<DateField, string> = {
  deadline: 'Due',
  followup: 'Follow-up',
  created: 'Created',
  modified: 'Modified',
}
