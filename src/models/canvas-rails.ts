export type RailSide = 'left' | 'right' | 'top' | 'bottom'
export type RailOrientation = 'vertical' | 'horizontal'
export type SlotKind = 'lens' | 'notes' | 'calendar'

export interface Slot {
  id: string
  kind: SlotKind
  listDefinitionId?: number
}

export interface Rail {
  orientation: RailOrientation
  slots: Slot[]
}

export type RailsState = Record<RailSide, Rail | null>

export const EMPTY_RAILS: RailsState = {
  left: null,
  right: null,
  top: null,
  bottom: null,
}

export function railOrientationForSide(side: RailSide): RailOrientation {
  return side === 'left' || side === 'right' ? 'vertical' : 'horizontal'
}

const SLOT_KINDS: readonly SlotKind[] = ['lens', 'notes', 'calendar']

function parseSlot(raw: unknown): Slot | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (typeof r.id !== 'string' || r.id.length === 0 || r.id.length > 100) return null
  if (typeof r.kind !== 'string' || !SLOT_KINDS.includes(r.kind as SlotKind)) return null
  const slot: Slot = { id: r.id, kind: r.kind as SlotKind }
  if (typeof r.listDefinitionId === 'number' && Number.isFinite(r.listDefinitionId)) {
    slot.listDefinitionId = r.listDefinitionId
  }
  return slot
}

function parseRail(raw: unknown, side: RailSide): Rail | null {
  if (raw == null) return null
  if (typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const expected = railOrientationForSide(side)
  const orientation = r.orientation === 'vertical' || r.orientation === 'horizontal' ? r.orientation : expected
  if (orientation !== expected) return null
  const rawSlots = Array.isArray(r.slots) ? r.slots : []
  const slots: Slot[] = []
  for (const s of rawSlots) {
    const parsed = parseSlot(s)
    if (parsed) slots.push(parsed)
  }
  if (slots.length === 0) return null
  return { orientation, slots }
}

export function serializeRailsState(rails: RailsState): string {
  return JSON.stringify(rails)
}

/** Parse a persisted rails blob. Returns null on any shape failure. */
export function parseRailsState(value: string | undefined | null): RailsState | null {
  if (!value) return null
  let parsed: unknown
  try { parsed = JSON.parse(value) } catch { return null }
  if (!parsed || typeof parsed !== 'object') return null
  const r = parsed as Record<string, unknown>
  return {
    left: parseRail(r.left, 'left'),
    right: parseRail(r.right, 'right'),
    top: parseRail(r.top, 'top'),
    bottom: parseRail(r.bottom, 'bottom'),
  }
}
