export type RailSide = 'left' | 'right' | 'top' | 'bottom'
export type RailOrientation = 'vertical' | 'horizontal'
export type SlotKind = 'lens' | 'notes' | 'calendar' | 'taskboard'

export interface Slot {
  id: string
  kind: SlotKind
  listDefinitionId?: number
  taskboardId?: number
}

export interface Rail {
  orientation: RailOrientation
  slots: Slot[]
}

export interface RailsState {
  left: Rail | null
  right: Rail | null
  top: Rail | null
  bottom: Rail | null
  /**
   * Persisted widths for vertical rails (left/right). Absent = default.
   * Kept here even when the rail is null so closing/reopening preserves size.
   */
  widths?: { left?: number; right?: number }
  /** Persisted heights for horizontal rails (top/bottom). */
  heights?: { top?: number; bottom?: number }
}

export const RAIL_SIZE_MIN = 200
export const RAIL_SIZE_MAX = 600
export const DEFAULT_VERTICAL_RAIL_WIDTH = 340
export const DEFAULT_HORIZONTAL_RAIL_HEIGHT = 260

export function defaultRailSize(side: RailSide): number {
  return side === 'left' || side === 'right'
    ? DEFAULT_VERTICAL_RAIL_WIDTH
    : DEFAULT_HORIZONTAL_RAIL_HEIGHT
}

export function clampRailSize(px: number): number {
  if (!Number.isFinite(px)) return DEFAULT_VERTICAL_RAIL_WIDTH
  return Math.max(RAIL_SIZE_MIN, Math.min(RAIL_SIZE_MAX, Math.round(px)))
}

export function railSize(rails: RailsState, side: RailSide): number {
  if (side === 'left' || side === 'right') {
    const persisted = rails.widths?.[side]
    return typeof persisted === 'number' ? clampRailSize(persisted) : defaultRailSize(side)
  }
  const persisted = rails.heights?.[side]
  return typeof persisted === 'number' ? clampRailSize(persisted) : defaultRailSize(side)
}

export const EMPTY_RAILS: RailsState = {
  left: null,
  right: null,
  top: null,
  bottom: null,
}

export function railOrientationForSide(side: RailSide): RailOrientation {
  return side === 'left' || side === 'right' ? 'vertical' : 'horizontal'
}

const SLOT_KINDS: readonly SlotKind[] = ['lens', 'notes', 'calendar', 'taskboard']

function parseSlot(raw: unknown): Slot | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (typeof r.id !== 'string' || r.id.length === 0 || r.id.length > 100) return null
  if (typeof r.kind !== 'string' || !SLOT_KINDS.includes(r.kind as SlotKind)) return null
  const slot: Slot = { id: r.id, kind: r.kind as SlotKind }
  if (typeof r.listDefinitionId === 'number' && Number.isFinite(r.listDefinitionId)) {
    slot.listDefinitionId = r.listDefinitionId
  }
  if (typeof r.taskboardId === 'number' && Number.isFinite(r.taskboardId)) {
    slot.taskboardId = r.taskboardId
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

function parseSizeBag<K extends string>(raw: unknown, keys: readonly K[]): Partial<Record<K, number>> | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as Record<string, unknown>
  const out: Partial<Record<K, number>> = {}
  let touched = false
  for (const k of keys) {
    const v = r[k]
    if (typeof v === 'number' && Number.isFinite(v)) {
      out[k] = clampRailSize(v)
      touched = true
    }
  }
  return touched ? out : undefined
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
  const state: RailsState = {
    left: parseRail(r.left, 'left'),
    right: parseRail(r.right, 'right'),
    top: parseRail(r.top, 'top'),
    bottom: parseRail(r.bottom, 'bottom'),
  }
  const widths = parseSizeBag(r.widths, ['left', 'right'] as const)
  if (widths) state.widths = widths
  const heights = parseSizeBag(r.heights, ['top', 'bottom'] as const)
  if (heights) state.heights = heights
  return state
}
