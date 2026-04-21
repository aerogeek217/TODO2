import type { EmptySideClaim, Rail, RailSide, RailsState, Slot, SlotKind, Tab } from '../models/canvas-rails'
import { railOrientationForSide } from '../models/canvas-rails'

export const RAILS_DRAG_TYPE = 'rails-slot' as const
export const RAILS_DROP_ID_PREFIX = 'rails:' as const

/**
 * Drag payload carried on `active.data.current` for rail drags. Discriminated
 * by `kind`: slot drags move an entire slot; tab drags move a single tab
 * (pill) within or out of its source slot. Both share `type` + `fromSide` so
 * the monitor can filter by `type === RAILS_DRAG_TYPE` first.
 */
export type RailsDragData =
  | {
      type: typeof RAILS_DRAG_TYPE
      kind: 'slot'
      slotId: string
      fromSide: RailSide
    }
  | {
      type: typeof RAILS_DRAG_TYPE
      kind: 'tab'
      slotId: string
      tabId: string
      fromSide: RailSide
    }

export type SplitZone = 'above' | 'below' | 'left' | 'right' | 'center'

export type RailsDropZone =
  | { kind: 'empty-side'; side: RailSide; claim?: EmptySideClaim }
  | { kind: 'slot'; slotId: string }
  | { kind: 'tab-strip'; slotId: string }

const ALL_SIDES: RailSide[] = ['left', 'right', 'top', 'bottom']

export function encodeRailsDropId(z: RailsDropZone): string {
  switch (z.kind) {
    case 'empty-side':
      return z.claim
        ? `${RAILS_DROP_ID_PREFIX}empty-side:${z.side}:${z.claim}`
        : `${RAILS_DROP_ID_PREFIX}empty-side:${z.side}`
    case 'slot':
      return `${RAILS_DROP_ID_PREFIX}slot:${z.slotId}`
    case 'tab-strip':
      return `${RAILS_DROP_ID_PREFIX}tab-strip:${z.slotId}`
  }
}

export function decodeRailsDropId(id: string): RailsDropZone | null {
  if (!id.startsWith(RAILS_DROP_ID_PREFIX)) return null
  const body = id.slice(RAILS_DROP_ID_PREFIX.length)
  const parts = body.split(':')
  if (parts[0] === 'empty-side' && parts.length === 2 && isSide(parts[1])) {
    return { kind: 'empty-side', side: parts[1] }
  }
  if (parts[0] === 'empty-side' && parts.length === 3 && isSide(parts[1]) && isClaim(parts[2])) {
    return { kind: 'empty-side', side: parts[1], claim: parts[2] }
  }
  if (parts[0] === 'slot' && parts.length >= 2) {
    const slotId = parts.slice(1).join(':')
    if (slotId.length > 0) return { kind: 'slot', slotId }
  }
  if (parts[0] === 'tab-strip' && parts.length >= 2) {
    const slotId = parts.slice(1).join(':')
    if (slotId.length > 0) return { kind: 'tab-strip', slotId }
  }
  return null
}

function isSide(s: string): s is RailSide {
  return s === 'left' || s === 'right' || s === 'top' || s === 'bottom'
}

function isClaim(s: string): s is EmptySideClaim {
  return s === 'start' || s === 'end'
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
    if (nextSlots.length === 0) {
      next[side] = null
    } else if (nextSlots.length === 1) {
      // Sole remaining slot: strip stale flex so the rail doesn't bias a
      // later insertion (see closeSlot for the same invariant).
      const { flex: _ignore, ...rest } = nextSlots[0]
      void _ignore
      next[side] = { ...rail, slots: [rest as Slot] }
    } else {
      next[side] = { ...rail, slots: nextSlots }
    }
    return { rails: next, slot, fromSide: side }
  }
  return { rails, slot: null, fromSide: null }
}

/**
 * Ensure a slot joining `rail` has a flex weight comparable to its new
 * siblings. Rails are maintained with an all-or-nothing flex invariant: either
 * every slot has a pixel-derived flex (after a divider drag) or none do (the
 * default `flex-grow: 1` state). When joining a flex-ed rail, we hand the
 * incoming slot the mean of sibling weights so it lands at an equal share;
 * when joining a no-flex rail, we strip the incoming slot's stale flex so it
 * defaults to `flex-grow: 1` alongside its siblings. Without the strip a slot
 * carrying a pixel-valued flex from a prior rail would dwarf its new neighbors
 * (flex-grow: 180 vs 1) and collapse them to a sliver.
 */
function reconcileIncomingFlex(rail: Rail, slot: Slot): Slot {
  const values: number[] = []
  for (const s of rail.slots) {
    if (typeof s.flex === 'number' && Number.isFinite(s.flex) && s.flex > 0) values.push(s.flex)
  }
  if (values.length === 0) {
    if (slot.flex == null) return slot
    const { flex: _ignore, ...rest } = slot
    void _ignore
    return rest as Slot
  }
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  return { ...slot, flex: mean }
}

function insertSlot(rail: Rail, slot: Slot, index: number): Rail {
  const clamped = Math.max(0, Math.min(index, rail.slots.length))
  const reconciled = reconcileIncomingFlex(rail, slot)
  const nextSlots = rail.slots.slice(0, clamped).concat([reconciled]).concat(rail.slots.slice(clamped))
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
  // Slot is becoming the sole occupant of a fresh rail — drop any stale flex
  // weight it was carrying so later additions start from an unbiased state.
  const { flex: _ignore, ...rest } = slot
  void _ignore
  next[toSide] = { orientation: railOrientationForSide(toSide), slots: [rest as Slot] }
  return next
}

export function applySplitDrop(
  rails: RailsState,
  slotId: string,
  targetSlotId: string,
  zone: SplitZone,
): RailsState {
  if (slotId === targetSlotId) return rails
  if (zone === 'center') return applyCenterSwap(rails, slotId, targetSlotId)
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
  if (orientation === 'vertical') {
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

/**
 * Center-quadrant drop: swap source and target slots in place. Both slot
 * payloads trade positions; rail identities and orientations stay put. If
 * the slots live on different rails, each rail keeps its own slot count —
 * we just exchange one element between them.
 */
export function applyCenterSwap(
  rails: RailsState,
  slotId: string,
  targetSlotId: string,
): RailsState {
  if (slotId === targetSlotId) return rails
  const src = findSlotLocation(rails, slotId)
  const tgt = findSlotLocation(rails, targetSlotId)
  if (!src || !tgt) return rails
  const srcRail = rails[src.side]!
  const tgtRail = rails[tgt.side]!
  const srcSlot = srcRail.slots[src.index]
  const tgtSlot = tgtRail.slots[tgt.index]
  const next: RailsState = { ...rails }
  if (src.side === tgt.side) {
    const slots = srcRail.slots.slice()
    slots[src.index] = tgtSlot
    slots[tgt.index] = srcSlot
    next[src.side] = { ...srcRail, slots }
    return next
  }
  const srcSlots = srcRail.slots.slice()
  srcSlots[src.index] = tgtSlot
  const tgtSlots = tgtRail.slots.slice()
  tgtSlots[tgt.index] = srcSlot
  next[src.side] = { ...srcRail, slots: srcSlots }
  next[tgt.side] = { ...tgtRail, slots: tgtSlots }
  return next
}

export interface SplitButtonOptions {
  genSlotId?: () => string
  kind?: SlotKind
  /**
   * Factory for the inserted slot. When provided, overrides `genSlotId` + `kind`
   * and is responsible for producing a complete `Slot` (including `tabs[]` +
   * `activeTabId`). The store uses this to keep tab-id generation co-located
   * with slot-id generation in `canvas-rails-store.ts`.
   */
  buildSlot?: (kind: SlotKind) => Slot
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
  let newSlot: Slot
  if (options.buildSlot) {
    newSlot = options.buildSlot(kind)
  } else {
    const newId = (options.genSlotId ?? defaultSlotIdGen)()
    const tabId = `${newId}-t0`
    newSlot = { id: newId, tabs: [{ id: tabId, type: kind }], activeTabId: tabId }
  }

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

// ---------------------------------------------------------------------------
// Tab reducers (Phase 3 of rail-tabs)
// ---------------------------------------------------------------------------

/**
 * Drop target for a tab drag. Unlike slot drags where the pointer-quadrant is
 * computed inside the monitor, tab-strip drops carry their insertion index
 * explicitly (computed from cursor X vs. pill midpoints by the strip).
 */
export type TabDropTarget =
  | { kind: 'tab-strip'; slotId: string; insertIdx: number }
  | { kind: 'empty-side'; side: RailSide }
  | { kind: 'slot'; slotId: string; zone: SplitZone }

function cascadeRailAfterSlotRemoval(rail: Rail, nextSlots: Slot[]): Rail | null {
  if (nextSlots.length === 0) return null
  if (nextSlots.length === 1) {
    // Sole remaining slot — strip stale flex so it doesn't bias the next
    // insertion (mirrors closeSlot/removeSlot invariants).
    const { flex: _ignore, ...rest } = nextSlots[0]
    void _ignore
    return { ...rail, slots: [rest as Slot] }
  }
  return { ...rail, slots: nextSlots }
}

/**
 * Remove a single tab from a slot. If the slot's last tab is removed, the
 * slot itself is removed from its rail (cascade-close). Returns the updated
 * rails and the extracted Tab (or null when slot/tab not found).
 *
 * Exported for unit testing; callers that need to reinsert the tab elsewhere
 * are expected to compose this with one of the `applyReorderTab` /
 * `applyMoveTabToSlot` / `applyDetachTabToNewSlot` helpers.
 */
export function extractTab(
  rails: RailsState,
  slotId: string,
  tabId: string,
): { rails: RailsState; tab: Tab | null } {
  const loc = findSlotLocation(rails, slotId)
  if (!loc) return { rails, tab: null }
  const rail = rails[loc.side]!
  const slot = rail.slots[loc.index]
  const tabIdx = slot.tabs.findIndex((t) => t.id === tabId)
  if (tabIdx === -1) return { rails, tab: null }
  const tab = slot.tabs[tabIdx]

  if (slot.tabs.length === 1) {
    const nextSlots = rail.slots.slice(0, loc.index).concat(rail.slots.slice(loc.index + 1))
    const next: RailsState = { ...rails }
    next[loc.side] = cascadeRailAfterSlotRemoval(rail, nextSlots)
    return { rails: next, tab }
  }

  const nextTabs = slot.tabs.slice(0, tabIdx).concat(slot.tabs.slice(tabIdx + 1))
  let activeTabId = slot.activeTabId
  if (activeTabId === tabId) {
    const fallback = slot.tabs[tabIdx - 1] ?? slot.tabs[tabIdx + 1]
    activeTabId = fallback.id
  }
  const nextSlot: Slot = { ...slot, tabs: nextTabs, activeTabId }
  const nextSlots = rail.slots.slice()
  nextSlots[loc.index] = nextSlot
  return { rails: { ...rails, [loc.side]: { ...rail, slots: nextSlots } }, tab }
}

/**
 * Reorder a tab within its slot. `insertIdx` is the desired index in the
 * tabs array *after* removal of the source tab — i.e. the visual position
 * among the surviving tabs. Out-of-range values clamp to [0, length].
 */
export function applyReorderTab(
  rails: RailsState,
  slotId: string,
  tabId: string,
  insertIdx: number,
): RailsState {
  const loc = findSlotLocation(rails, slotId)
  if (!loc) return rails
  const rail = rails[loc.side]!
  const slot = rail.slots[loc.index]
  const from = slot.tabs.findIndex((t) => t.id === tabId)
  if (from === -1) return rails
  const without = slot.tabs.slice(0, from).concat(slot.tabs.slice(from + 1))
  const clamped = Math.max(0, Math.min(insertIdx, without.length))
  if (clamped === from) return rails
  const nextTabs = without.slice(0, clamped).concat([slot.tabs[from]]).concat(without.slice(clamped))
  const nextSlot: Slot = { ...slot, tabs: nextTabs }
  const nextSlots = rail.slots.slice()
  nextSlots[loc.index] = nextSlot
  return { ...rails, [loc.side]: { ...rail, slots: nextSlots } }
}

/**
 * Move a tab from one slot to another at a specific insertion index. The
 * destination slot's active tab becomes the moved tab. If the source slot
 * empties, it is cascade-closed (via `extractTab`).
 */
export function applyMoveTabToSlot(
  rails: RailsState,
  srcSlotId: string,
  tabId: string,
  destSlotId: string,
  insertIdx: number,
): RailsState {
  if (srcSlotId === destSlotId) {
    // The caller passes an insertIdx relative to the *post-removal* tab array
    // — which matches `applyReorderTab`'s contract exactly.
    return applyReorderTab(rails, srcSlotId, tabId, insertIdx)
  }
  const { rails: afterExtract, tab } = extractTab(rails, srcSlotId, tabId)
  if (!tab) return rails
  const loc = findSlotLocation(afterExtract, destSlotId)
  if (!loc) return rails
  const rail = afterExtract[loc.side]!
  const slot = rail.slots[loc.index]
  const clamped = Math.max(0, Math.min(insertIdx, slot.tabs.length))
  const nextTabs = slot.tabs.slice(0, clamped).concat([tab]).concat(slot.tabs.slice(clamped))
  const nextSlot: Slot = { ...slot, tabs: nextTabs, activeTabId: tab.id }
  const nextSlots = rail.slots.slice()
  nextSlots[loc.index] = nextSlot
  return { ...afterExtract, [loc.side]: { ...rail, slots: nextSlots } }
}

/**
 * Insert an already-built (not-yet-in-rails) slot per a drop target,
 * mirroring the slot-drag dock reducers but without the "find + remove"
 * prelude. Used to place the fresh slot produced by a tab detach operation.
 */
function placeNewSlot(rails: RailsState, slot: Slot, target: TabDropTarget): RailsState {
  if (target.kind === 'empty-side') {
    if (rails[target.side]) return rails
    const { flex: _ignore, ...rest } = slot
    void _ignore
    return {
      ...rails,
      [target.side]: { orientation: railOrientationForSide(target.side), slots: [rest as Slot] },
    }
  }
  if (target.kind === 'slot') {
    const loc = findSlotLocation(rails, target.slotId)
    if (!loc) return rails
    const rail = rails[loc.side]!
    // Center drop on a slot quadrant would mean "merge as tab" — tab drags
    // reach that case via the tab-strip drop zone, so treat center here as
    // a no-op to avoid unexpected merges on a generic slot body.
    if (target.zone === 'center') return rails
    const orientation = rail.orientation
    let insertIdx: number
    if (orientation === 'vertical') {
      insertIdx = target.zone === 'above' || target.zone === 'left' ? loc.index : loc.index + 1
    } else {
      insertIdx = target.zone === 'left' || target.zone === 'above' ? loc.index : loc.index + 1
    }
    return { ...rails, [loc.side]: insertSlot(rail, slot, insertIdx) }
  }
  // tab-strip is the one drop kind that never produces a "new slot" case —
  // it's handled by applyMoveTabToSlot / applyReorderTab upstream.
  return rails
}

/**
 * Extract a tab from its source slot and dock it as a fresh single-tab slot
 * at the given drop target. Caller provides `buildSlot(tab)` so slot + tab
 * id generation stays co-located with the rest of the store's id factories.
 */
export function applyDetachTabToNewSlot(
  rails: RailsState,
  srcSlotId: string,
  tabId: string,
  target: TabDropTarget,
  buildSlot: (tab: Tab) => Slot,
): RailsState {
  if (target.kind === 'tab-strip') return rails // guard: tab-strip drops don't detach
  const { rails: afterExtract, tab } = extractTab(rails, srcSlotId, tabId)
  if (!tab) return rails
  const newSlot = buildSlot(tab)
  // Safety: ensure the new slot contains exactly the extracted tab.
  const normalized: Slot = { ...newSlot, tabs: [tab], activeTabId: tab.id }
  return placeNewSlot(afterExtract, normalized, target)
}

/**
 * Computes which quadrant zone of a slot's bounding rectangle a pointer hit.
 * Outer 22% on each end along the rail axis → above/below/left/right.
 * Inner ~56% → center (swap). Wide center keeps swap easy to target on tall
 * single-slot rails where equal-thirds would make the insert bands feel
 * large enough to hit by accident.
 */
export function pointerToSplitZone(
  pointer: { x: number; y: number },
  rect: { left: number; top: number; width: number; height: number },
  orientation: 'vertical' | 'horizontal',
): SplitZone {
  const edgeRatio = 0.22
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
