import type { SlotKind } from '../models/canvas-rails'

export const KIND_ICON: Record<SlotKind, string> = {
  lens: '\u{1F4CB}',      // 📋
  notes: '\u25F0',         // ◰
  calendar: '\u{1F4C5}',   // 📅
  taskboard: '\u2630',     // ☰
}

export const KIND_LABEL: Record<SlotKind, string> = {
  lens: 'lens',
  notes: 'notes',
  calendar: 'calendar',
  taskboard: 'taskboard',
}
