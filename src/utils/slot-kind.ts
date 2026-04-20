import type { SlotKind } from '../models/canvas-rails'

export const KIND_ICON: Record<SlotKind, string> = {
  lens: '\u25A4',          // ▤
  notes: '\u25F0',         // ◰
  calendar: '\u229E',      // ⊞
  taskboard: '\u2630',     // ☰
}

export const KIND_LABEL: Record<SlotKind, string> = {
  lens: 'list',
  notes: 'notes',
  calendar: 'calendar',
  taskboard: 'taskboard',
}
