import type { SlotKind } from '../models/canvas-rails'

export const KIND_ICON: Record<SlotKind, string> = {
  lens: '▤',          // ▤
  notes: '◰',         // ◰
  calendar: '⊞',      // ⊞
  taskboard: '☰',     // ☰
  horizons: '⧻',      // ⧻
  status: '▥',        // ▥ — stacked status bar
  scoreboard: '◑',    // ◑ — scoreboard / metrics
  snoozeGraveyard: '◊', // ◊ — deferred / snoozed
}

export const KIND_LABEL: Record<SlotKind, string> = {
  lens: 'List',
  notes: 'Notes',
  calendar: 'Calendar',
  taskboard: 'Taskboard',
  horizons: 'Horizons',
  status: 'Status',
  scoreboard: 'Discipline',
  snoozeGraveyard: 'Snooze graveyard',
}
