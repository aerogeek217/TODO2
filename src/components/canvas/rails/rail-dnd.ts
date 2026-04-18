import type { Rail, RailSide, RailsState, Slot, SlotKind } from '../../../models/canvas-rails'
import { railOrientationForSide } from '../../../models/canvas-rails'

export const RAILS_DRAG_TYPE = 'rails-slot' as const
export const RAILS_DROP_ID_PREFIX = 'rails:' as const

export interface RailsDragData {
  type: typeof RAILS_DRAG_TYPE
  slotId: string
  fromSide: RailSide
}

export type SplitZone = 'above' | 'below' | 'left' | 'right' | 'center'

export type RailsDropZone =
  | { kind: 'empty-side'; side: RailSide }
  | { kind: 'edge'; side: RailSide; edge: 'head' | 'tail' }
  | { kind: 'slot'; slotId: string }

const ALL_SIDES: RailSide[] = ['left', 'right', 'top', 'bottom']

export function encodeRailsDropId(z: RailsDropZone): string {
  switch (z.kind) {
    case 'empty-side':
      return `${RAILS_DROP_ID_PREFIX}empty-side:${z.side}`
    case 'edge':
      return `${RAILS_DROP_ID_PREFIX}edge:${z.side}:${z.edge}`
    case 'slot':
      return `${RAILS_DROP_ID_PREFIX}slot:${z.slotId}`
  }
}

export function decodeRailsDropId(id: string): RailsDropZone | null {
  if (!id.startsWith(RAILS_DROP_ID_PREFIX)) return null
  const body = id.slice(RAILS_DROP_ID_PREFIX.length)
  const parts = body.split(':')
  if (parts[0] === 'empty-side' && parts.length === 2 && isSide(parts[1])) {
    return { kind: 'empty-side', side: parts[1] }
  }
  if (parts[0] === 'edge' && parts.length === 3 && isSide(parts[1]) && (parts[2] === 'head' || parts[2] === 'tail')) {
    return { kind: 'edge', side: parts[1], edge: parts[2] }
  }
  if (parts[0] === 'slot' && parts.length >= 2) {
    const slotId = parts.slice(1).join(':')
    if (slotId.length > 0) return { kind: 'slot', slotId }
  }
  return null
}

function isSide(s: string): s is RailSide {
  return s === 'left' || s === 'right' || s === 'top' || s === 'bottom'
}

export function isRailsDropId(id: string): boolean {
  return id.startsWith(RAILS_DROP_ID_PREFIX)
}

export function findSlotLocation(rails: RailsState, slotId: string): { side: RailSide; index: number } | null {
  for (const side of ALL_SIDES) {
    const rail = rails[side]
    if (!rail) continue
    const index = rail.slots.findIndex((s) => s.id === slotId)
    if (index !== -1) return { side, index }
  }
  return null
}

function removeSlot(rails: RailsState, slotId: string): { rails: RailsState; slot: Slot | null; fromSide: RailSide | null } {
  for (const side of ALL_SIDES) {
    const rail = rails[side]
    if (!rail) continue
    const idx = rail.slots.findIndex((s) => s.id === slotId)
    if (idx === -1) continue
    const slot = rail.slots[idx]
    const nextSlots = rail.slots.slice(0, idx).concat(rail.slots.slice(idx + 1))
    const next: RailsState = { ...rails }
    next[side] = nextSlots.length === 0 ? null : { ...rail, slots: nextSlots }
    return { rails: next, slot, fromSide: side }
  }
  return { rails, slot: null, fromSide: null }
}

function insertSlot(rail: Rail, slot: Slot, index: number): Rail {
  const clamped = Math.max(0, Math.min(index, rail.slots.length))
  const nextSlots = rail.slots.slice(0, clamped).concat([slot]).concat(rail.slots.slice(clamped))
  return { ...rail, slots: nextSlots }
}

export function applyDropToSide(rails: RailsState, slotId: string, toSide: RailSide): RailsState {
  const loc = findSlotLocation(rails, slotId)
  if (!loc) return rails
  // dropping to the side the slot already occupies exclusively is a no-op
  if (rails[toSide] && loc.side === toSide && rails[toSide]!.slots.length === 1) return rails
  const { rails: afterRemove, slot } = removeSlot(rails, slotId)
  if (!slot) return rails
  if (afterRemove[toSide]) return rails // target side is not empty post-removal
  const next: RailsState = { ...afterRemove }
  next[toSide] = { orientation: railOrientationForSide(toSide), slots: [slot] }
  return next
}

export function applyEdgeDrop(rails: RailsState, slotId: string, toSide: RailSide, edge: 'head' | 'tail'): RailsState {
  const { rails: afterRemove, slot } = removeSlot(rails, slotId)
  if (!slot) return rails
  const dest = afterRemove[toSide]
  const next: RailsState = { ...afterRemove }
  if (!dest) {
    next[toSide] = { orientation: railOrientationForSide(toSide), slots: [slot] }
    return next
  }
  next[toSide] = edge === 'head'
    ? { ...dest, slots: [slot, ...dest.slots] }
    : { ...dest, slots: [...dest.slots, slot] }
  return next
}

export function applySplitDrop(
  rails: RailsState,
  slotId: string,
  targetSlotId: string,
  zone: SplitZone,
): RailsState {
  if (slotId === targetSlotId) return rails
  const targetLoc = findSlotLocation(rails, targetSlotId)
  if (!targetLoc) return rails

  const { rails: afterRemove, slot } = removeSlot(rails, slotId)
  if (!slot) return rails
  const dest = afterRemove[targetLoc.side]
  if (!dest) return rails
  const targetIdx = dest.slots.findIndex((s) => s.id === targetSlotId)
  if (targetIdx === -1) return rails

  const orientation = dest.orientation
  let insertIdx: number
  if (zone === 'center') {
    // Treat center as "insert before target" — a no-data-loss fallback.
    insertIdx = targetIdx
  } else if (orientation === 'vertical') {
    // Vertical rails: above = before, below = after. left/right map to the same axis.
    insertIdx = zone === 'above' || zone === 'left' ? targetIdx : targetIdx + 1
  } else {
    // Horizontal rails: left = before, right = after. above/below map to the same axis.
    insertIdx = zone === 'left' || zone === 'above' ? targetIdx : targetIdx + 1
  }

  const next: RailsState = { ...afterRemove }
  next[targetLoc.side] = insertSlot(dest, slot, insertIdx)
  return next
}

export interface SplitButtonOptions {
  genSlotId?: () => string
  kind?: SlotKind
}

export function applySplitButton(
  rails: RailsState,
  slotId: string,
  dir: 'above' | 'below' | 'left' | 'right',
  options: SplitButtonOptions = {},
): RailsState {
  const loc = findSlotLocation(rails, slotId)
  if (!loc) return rails
  const rail = rails[loc.side]!
  const kind: SlotKind = options.kind ?? 'lens'
  const newId = (options.genSlotId ?? defaultSlotIdGen)()
  const newSlot: Slot = { id: newId, kind }

  const orientation = rail.orientation
  let insertIdx: number
  if (orientation === 'vertical') {
    insertIdx = dir === 'above' || dir === 'left' ? loc.index : loc.index + 1
  } else {
    insertIdx = dir === 'left' || dir === 'above' ? loc.index : loc.index + 1
  }

  const next: RailsState = { ...rails }
  next[loc.side] = insertSlot(rail, newSlot, insertIdx)
  return next
}

function defaultSlotIdGen(): string {
  return `slot-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * Computes which quadrant zone of a slot's bounding rectangle a pointer hit.
 * Outer 12% on each edge → above/below/left/right. Inner 28% on an axis →
 * preferred to center; the actual precedence picks the axis that matches the
 * rail's orientation when the pointer falls inside the inner region.
 */
export function pointerToSplitZone(
  pointer: { x: number; y: number },
  rect: { left: number; top: number; width: number; height: number },
  orientation: 'vertical' | 'horizontal',
): SplitZone {
  const edgeRatio = 0.28
  const rx = (pointer.x - rect.left) / rect.width
  const ry = (pointer.y - rect.top) / rect.height
  // Clamp
  const cx = Math.max(0, Math.min(1, rx))
  const cy = Math.max(0, Math.min(1, ry))
  if (orientation === 'vertical') {
    if (cy < edgeRatio) return 'above'
    if (cy > 1 - edgeRatio) return 'below'
    return 'center'
  }
  if (cx < edgeRatio) return 'left'
  if (cx > 1 - edgeRatio) return 'right'
  return 'center'
}
