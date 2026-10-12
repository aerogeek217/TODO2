import type { WidgetKind } from '../models/workspace-layout'

export const KIND_LABEL: Record<WidgetKind, string> = {
  lens: 'List',
  notes: 'Notes',
  calendar: 'Calendar',
  eisenhower: 'Eisenhower',
  status: 'Status',
}
