import type { ListFilterField } from '../../../stores/list-widget-store'
import { MARKERS_LABEL } from '../../../utils/markers'
import { DATE_FILTER_DIALOG_LABEL } from './date-filter-popover'

/** Each filter field's picker title. */
export const PICKER_TITLE: Record<ListFilterField, string> = {
  people: 'People',
  tags: 'Tags',
  status: 'Status',
  markers: MARKERS_LABEL,
  dates: 'Dates',
  text: 'Text',
}

/** A field picker's accessible name: `Tags filter`, `Date filters`. */
export function pickerLabel(field: ListFilterField): string {
  return field === 'dates' ? DATE_FILTER_DIALOG_LABEL : `${PICKER_TITLE[field]} filter`
}
