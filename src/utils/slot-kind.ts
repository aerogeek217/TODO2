import type { SlotKind } from '../models/canvas-rails'

export const KIND_ICON: Record<SlotKind, string> = {
  lens: '▤',          // ▤
  notes: '◰',         // ◰
  calendar: '⊞',      // ⊞
  taskboard: '☰',     // ☰
  horizons: '⧻',      // ⧻
}

export const KIND_LABEL: Record<SlotKind, string> = {
  lens: 'list',
  notes: 'notes',
  calendar: 'calendar',
  taskboard: 'taskboard',
  horizons: 'horizons',
}
