import type { WidgetKind } from '../models/workspace-layout'

export const KIND_ICON: Record<WidgetKind, string> = {
  lens: '▤',          // ▤
  notes: '◰',         // ◰
  calendar: '⊞',      // ⊞
  status: '▥',        // ▥ — stacked status bar
}

export const KIND_LABEL: Record<WidgetKind, string> = {
  lens: 'List',
  notes: 'Notes',
  calendar: 'Calendar',
  status: 'Status',
}
