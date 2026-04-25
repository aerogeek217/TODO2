import type { DateField } from '../models/app-view'

export const DATE_FIELD_LABELS: Record<DateField, string> = {
  date: 'Effective Date',
  scheduled: 'Scheduled',
  deadline: 'Deadline',
  created: 'Created',
  modified: 'Modified',
}

export const DATE_FIELD_LABELS_SHORT: Record<DateField, string> = {
  date: 'Effective',
  scheduled: 'Sched.',
  deadline: 'Deadline',
  created: 'Created',
  modified: 'Modified',
}
