import type { SlotKind } from '../../models/canvas-rails'
import { useFloatingNoteStore } from '../../stores/floating-note-store'
import { useFloatingCalendarStore } from '../../stores/floating-calendar-store'
import { useFloatingTaskboardStore } from '../../stores/floating-taskboard-store'
import { useFloatingHorizonsStore } from '../../stores/floating-horizons-store'

/**
 * Kinds whose float stores share a per-canvas `add(canvasId, x, y)` factory.
 * `lens` needs a `listDefinitionId` resolver and stats kinds (`status` /
 * `scoreboard` / `snoozeGraveyard`) follow the same pattern but live in
 * separate stores; both branches have their own regression specs.
 */
export const FLOAT_SWITCHABLE_KINDS = [
  'notes',
  'calendar',
  'taskboard',
  'horizons',
] as const
export type FloatSwitchableKind = (typeof FLOAT_SWITCHABLE_KINDS)[number]

/** All ordered (from, to) pairs over `FLOAT_SWITCHABLE_KINDS`. */
export type KindPair = { from: FloatSwitchableKind; to: FloatSwitchableKind }
export const FLOAT_KIND_PAIRS: readonly KindPair[] = FLOAT_SWITCHABLE_KINDS
  .flatMap((from) => FLOAT_SWITCHABLE_KINDS.map((to) => ({ from, to })))

/** Adds one float row of the given kind through its store and returns the id. */
export async function seedFloat(
  kind: FloatSwitchableKind,
  canvasId: number,
  x: number,
  y: number,
): Promise<number> {
  switch (kind) {
    case 'notes':     return useFloatingNoteStore.getState().add(canvasId, x, y)
    case 'calendar':  return useFloatingCalendarStore.getState().add(canvasId, x, y)
    case 'taskboard': return useFloatingTaskboardStore.getState().add(canvasId, x, y)
    case 'horizons':  return useFloatingHorizonsStore.getState().add(canvasId, x, y)
  }
}

interface FloatRow {
  id?: number
  x: number
  y: number
  width: number
  height: number
}

/** Reads the live row list for a float kind. Each kind's store names its
 * collection differently (`notes` / `calendars` / `taskboards` / `horizons`);
 * this hides the difference behind one accessor. */
export function getFloatRows(kind: FloatSwitchableKind): FloatRow[] {
  switch (kind) {
    case 'notes':     return useFloatingNoteStore.getState().notes
    case 'calendar':  return useFloatingCalendarStore.getState().calendars
    case 'taskboard': return useFloatingTaskboardStore.getState().taskboards
    case 'horizons':  return useFloatingHorizonsStore.getState().horizons
  }
}

/** Slot-kind-switch matrix: source kind, target kind, optional listDefinition
 * carry-through expectation. `expectClearListDef` is `true` when the target
 * kind is non-lens and the source carried a `listDefinitionId` (which must
 * be cleared on transition). */
export interface SlotKindSwitchCase {
  from: SlotKind
  to: SlotKind
  expectClearListDef: boolean
}

export const SLOT_KIND_SWITCH_CASES: readonly SlotKindSwitchCase[] = [
  { from: 'lens', to: 'notes', expectClearListDef: true },
  { from: 'lens', to: 'taskboard', expectClearListDef: true },
  { from: 'notes', to: 'taskboard', expectClearListDef: false },
]
