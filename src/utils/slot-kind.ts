import type { SlotKind } from '../models/canvas-rails'

export const KIND_ICON: Record<SlotKind, string> = {
  lens: '▤',          // ▤
  notes: '◰',         // ◰
  calendar: '⊞',      // ⊞
  taskboard: '☰',     // ☰
  status: '▥',        // ▥ — stacked status bar
}

export const KIND_LABEL: Record<SlotKind, string> = {
  lens: 'List',
  notes: 'Notes',
  calendar: 'Calendar',
  taskboard: 'Taskboard',
  status: 'Status',
}
