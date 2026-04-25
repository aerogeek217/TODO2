import type { CalendarOrientation, EmptySideClaim, Rail, RailSide, RailsState, Slot, SlotKind, Tab } from '../models/canvas-rails'
import { railOrientationForSide } from '../models/canvas-rails'
import { computeTabInsertIdx } from './rail-dnd-monitor-helpers'
import { DEFAULT_FLOAT_HEIGHT, DEFAULT_FLOAT_WIDTH } from '../constants'

export const RAILS_DRAG_TYPE = 'rails-slot' as const
export const RAILS_DROP_ID_PREFIX = 'rails:' as const
export const RAILS_DRAG_ID_TAB_PREFIX = 'rails-tab-drag:' as const
export const RAILS_DRAG_ID_SLOT_PREFIX = 'rails-slot-drag:' as const

/**
 * Re-export so existing rail consumers (harness, tests, monitor helpers) keep
 * a single rail-dnd import. Source of truth is `src/constants.ts`. CSS uses
 * `max(var(--{perp}-size, 0px), 80px)` to keep the perpendicular-side corner
 * sub-zones targettable when their adjacent rail is absent; this constant
 * mirrors that floor so the harness + production geometry stay in lock-step.
 */
export { CORNER_HIT_MIN_PX } from '../constants'

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
  /**
   * Full-canvas drop target for Phase 5 of float-dock: a tab-pill drag released
   * over the React Flow viewport (and missing every rail hotspot) materialises
   * the tab as a floating widget at pointer position. Exactly one of these is
   * registered by `CanvasView`; dnd-kit's collision detection naturally
   * prefers the higher-z rail hotspots over this catch-all, so it fires only
   * when no rail zone is hit.
   */
  | { kind: 'canvas' }

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
    case 'canvas':
      return `${RAILS_DROP_ID_PREFIX}canvas`
  }
}

export function decodeRailsDropId(id: string): RailsDropZone | null {
  if (!id.startsWith(RAILS_DROP_ID_PREFIX)) return null
  const body = id.slice(RAILS_DROP_ID_PREFIX.length)
  const parts = body.split(':')
  if (parts[0] === 'canvas' && parts.length === 1) {
    return { kind: 'canvas' }
  }
  if (parts[0] === 'empty-side' && parts.length === 2 && parts[1] != null && isSide(parts[1])) {
    return { kind: 'empty-side', side: parts[1] }
  }
  if (parts[0] === 'empty-side' && parts.length === 3 && parts[1] != null && parts[2] != null && isSide(parts[1]) && isClaim(parts[2])) {
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
    if (!slot) continue
    const nextSlots = rail.slots.slice(0, idx).concat(rail.slots.slice(idx + 1))
    const next: RailsState = { ...rails }
    if (nextSlots.length === 0) {
      next[side] = null
    } else if (nextSlots.length === 1) {
      // Sole remaining slot: strip stale flex so the rail doesn't bias a
      // later insertion (see closeSlot for the same invariant).
      const onlySlot = nextSlots[0]
      if (onlySlot) {
        const { flex: _ignore, ...rest } = onlySlot
        void _ignore
        next[side] = { ...rail, slots: [rest as Slot] }
      } else {
        next[side] = { ...rail, slots: nextSlots }
      }
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
 *
 * Drift note: this function only writes to the incoming slot; existing
 * siblings keep their flex values verbatim across repeated docks. A regression
 * test in `rail-dnd.test.ts` asserts that 5 consecutive docks hold every
 * sibling's flex within ±20% of the initial mean. If a future refactor
 * rebalances siblings on insert, tighten or re-document that band.
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
  const srcRail = rails[src.side]
  const tgtRail = rails[tgt.side]
  if (!srcRail || !tgtRail) return rails
  const srcSlot = srcRail.slots[src.index]
  const tgtSlot = tgtRail.slots[tgt.index]
  if (!srcSlot || !tgtSlot) return rails
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
  const rail = rails[loc.side]
  if (!rail) return rails
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
    const onlySlot = nextSlots[0]
    if (!onlySlot) return { ...rail, slots: nextSlots }
    const { flex: _ignore, ...rest } = onlySlot
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
  const rail = rails[loc.side]
  if (!rail) return { rails, tab: null }
  const slot = rail.slots[loc.index]
  if (!slot) return { rails, tab: null }
  const tabIdx = slot.tabs.findIndex((t) => t.id === tabId)
  if (tabIdx === -1) return { rails, tab: null }
  const tab = slot.tabs[tabIdx]
  if (!tab) return { rails, tab: null }

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
    if (fallback) activeTabId = fallback.id
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
  const rail = rails[loc.side]
  if (!rail) return rails
  const slot = rail.slots[loc.index]
  if (!slot) return rails
  const from = slot.tabs.findIndex((t) => t.id === tabId)
  if (from === -1) return rails
  const movingTab = slot.tabs[from]
  if (!movingTab) return rails
  const without = slot.tabs.slice(0, from).concat(slot.tabs.slice(from + 1))
  const clamped = Math.max(0, Math.min(insertIdx, without.length))
  if (clamped === from) return rails
  const nextTabs = without.slice(0, clamped).concat([movingTab]).concat(without.slice(clamped))
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
  const rail = afterExtract[loc.side]
  if (!rail) return rails
  const slot = rail.slots[loc.index]
  if (!slot) return rails
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
    const rail = rails[loc.side]
    if (!rail) return rails
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

// ---------------------------------------------------------------------------
// Float-dock hit-test (Phase 2 of float-dock)
// ---------------------------------------------------------------------------

/**
 * Resolved dock target for a floating-widget drag release. Mirrors
 * `TabDropTarget` (slot/tab-strip/empty-side) but carries `claim` on
 * empty-side so the caller can apply corner ownership, and `zone` on slot so
 * Phase 3 reducers can distinguish center-merge from split-new-slot.
 */
export type FloatDockTarget =
  | { kind: 'empty-side'; side: RailSide; claim?: EmptySideClaim }
  | { kind: 'slot'; slotId: string; zone: SplitZone }
  | { kind: 'tab-strip'; slotId: string; insertIdx: number }

export interface ResolveFloatDockOpts {
  /** Injectable for tests; defaults to `document.elementsFromPoint`. */
  elementsFromPoint?: (x: number, y: number) => Element[]
  /** Rail orientation (vertical/horizontal) for a given `slotId`; null → slot not resolvable, resolver returns null. */
  getSlotOrientation: (slotId: string) => 'vertical' | 'horizontal' | null
}

function defaultElementsFromPoint(x: number, y: number): Element[] {
  if (typeof document === 'undefined') return []
  return document.elementsFromPoint(x, y)
}

/**
 * Walk `elementsFromPoint(x, y)` bottom-up and return the first element
 * carrying a `data-rails-drop-id`. Decodes the id via `decodeRailsDropId`;
 * for slot hits, disambiguates center-merge vs split via `pointerToSplitZone`
 * against the element's bounding rect. For tab-strip hits, computes the
 * insertion index from pill midpoints. Returns null when the pointer misses
 * every rail hotspot (caller falls through to the float's position-persist
 * path).
 */
export function resolveFloatDockTarget(
  pointer: { x: number; y: number },
  opts: ResolveFloatDockOpts,
): FloatDockTarget | null {
  const getEls = opts.elementsFromPoint ?? defaultElementsFromPoint
  const els = getEls(pointer.x, pointer.y)
  let hit: HTMLElement | null = null
  let rawId: string | null = null
  for (const el of els) {
    if (!(el instanceof HTMLElement)) continue
    const id = el.dataset.railsDropId
    if (id) { hit = el; rawId = id; break }
  }
  if (!hit || !rawId) return null
  const zone = decodeRailsDropId(rawId)
  if (!zone) return null
  if (zone.kind === 'empty-side') {
    return zone.claim
      ? { kind: 'empty-side', side: zone.side, claim: zone.claim }
      : { kind: 'empty-side', side: zone.side }
  }
  if (zone.kind === 'tab-strip') {
    // Float dock onto a tab strip — every existing pill counts as a survivor
    // (no source pill to exclude). Intra-strip tab reorder uses the same
    // helper but passes the dragged tab's id.
    const insertIdx = computeTabInsertIdx(hit, pointer.x)
    return { kind: 'tab-strip', slotId: zone.slotId, insertIdx }
  }
  if (zone.kind === 'canvas') {
    // Float-drag releases over the canvas aren't a rail-dock target — the
    // caller falls through to the existing position-persist path.
    // `zone.kind === 'canvas'` is handled separately in `useRailsDragMonitor`
    // for the reverse gesture (rail tab-pill drag → canvas pop-out).
    return null
  }
  const orientation = opts.getSlotOrientation(zone.slotId)
  if (!orientation) return null
  const rect = hit.getBoundingClientRect()
  const splitZone = pointerToSplitZone(
    pointer,
    { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
    orientation,
  )
  return { kind: 'slot', slotId: zone.slotId, zone: splitZone }
}

// ---------------------------------------------------------------------------
// Tab-drag → canvas pop-out (Phase 5 of float-dock)
// ---------------------------------------------------------------------------

export interface FlowViewport {
  x: number
  y: number
  zoom: number
}

/**
 * Map client-space pointer coordinates to React Flow (canvas) coordinates,
 * then subtract half the default float width/height so the widget centres on
 * the pointer instead of pinning its upper-left corner there.
 *
 * Pure — caller supplies the canvas DOM rect (usually from
 * `getBoundingClientRect` on the `rails:canvas` droppable) and the persisted
 * viewport from `settings.canvasViewport`. Used by the tab-drag → canvas
 * pop-out path in `useRailsDragMonitor`. The menu pop-out path keeps using
 * `computePopOutFlowPosition` (viewport-upper-left + jitter).
 */
export function pointerToFlowPosition(
  pointer: { x: number; y: number },
  canvasRect: { left: number; top: number },
  vp: FlowViewport,
): { x: number; y: number } {
  const flowX = (pointer.x - canvasRect.left - vp.x) / vp.zoom
  const flowY = (pointer.y - canvasRect.top - vp.y) / vp.zoom
  return {
    x: flowX - DEFAULT_FLOAT_WIDTH / 2,
    y: flowY - DEFAULT_FLOAT_HEIGHT / 2,
  }
}

// ---------------------------------------------------------------------------
// Float-dock reducers (Phase 3 of float-dock)
// ---------------------------------------------------------------------------

/**
 * Minimum payload required to dock a floating widget into a rail. The
 * floating row's x/y/w/h is discarded on dock (mirrors `popTabToCanvas`
 * discarding the slot's flex on the reverse path). `calendar` threads
 * `orientation` + `weekOffset` so the user's strip orientation survives the
 * dock — these are Slot-level fields in the model, so they only apply when
 * a fresh slot is built (empty-side / split / detach paths). Center-merge
 * appends into an existing slot and cannot override the destination's
 * existing slot-level state.
 *
 * Taskboard descriptors used to carry a `taskboardId` field, but the v33
 * migration collapsed `taskboards` to a singleton — every taskboard tab
 * resolves to the same row, so threading the id was vestigial. Dropped in
 * code-review-2026-04-25 P3.
 */
export type FloatDescriptor =
  | { kind: 'note'; id: number }
  | { kind: 'calendar'; id: number; orientation?: CalendarOrientation; weekOffset?: number }
  | { kind: 'taskboard'; id: number }
  | { kind: 'lens'; id: number; listDefinitionId: number }
  | { kind: 'horizons'; id: number }

/**
 * Build a `Tab` payload from a float descriptor. Caller supplies `tabId` so
 * id generation stays co-located with slot-id generation in
 * `canvas-rails-store`. Calendar `orientation` / `weekOffset` are not carried
 * on the tab (they live on the Slot in the current model); `slotFromFloat`
 * threads them through for the fresh-slot paths.
 */
export function tabFromFloat(descriptor: FloatDescriptor, tabId: string): Tab {
  switch (descriptor.kind) {
    case 'note':      return { id: tabId, type: 'notes' }
    case 'calendar':  return { id: tabId, type: 'calendar' }
    case 'taskboard': return { id: tabId, type: 'taskboard' }
    case 'lens':      return { id: tabId, type: 'lens', listDefinitionId: descriptor.listDefinitionId }
    case 'horizons':  return { id: tabId, type: 'horizons' }
  }
}

/**
 * Build a fresh single-tab Slot from a float descriptor, threading slot-level
 * fields the descriptor carries (`orientation` + `weekOffset` for calendar).
 * Used by the empty-side and split-new-slot dock paths.
 */
export function slotFromFloat(descriptor: FloatDescriptor, slotId: string, tabId: string): Slot {
  const tab = tabFromFloat(descriptor, tabId)
  const slot: Slot = { id: slotId, tabs: [tab], activeTabId: tab.id }
  if (descriptor.kind === 'calendar') {
    if (descriptor.orientation != null) slot.orientation = descriptor.orientation
    if (descriptor.weekOffset != null) slot.weekOffset = descriptor.weekOffset
  }
  return slot
}

function appendTabToSlot(rails: RailsState, slotId: string, tab: Tab, insertIdx: number): RailsState {
  const loc = findSlotLocation(rails, slotId)
  if (!loc) return rails
  const rail = rails[loc.side]
  if (!rail) return rails
  const slot = rail.slots[loc.index]
  if (!slot) return rails
  const clamped = Math.max(0, Math.min(insertIdx, slot.tabs.length))
  const nextTabs = slot.tabs.slice(0, clamped).concat([tab]).concat(slot.tabs.slice(clamped))
  const nextSlot: Slot = { ...slot, tabs: nextTabs, activeTabId: tab.id }
  const nextSlots = rail.slots.slice()
  nextSlots[loc.index] = nextSlot
  return { ...rails, [loc.side]: { ...rail, slots: nextSlots } }
}

/**
 * Dock a floating widget into a specific existing slot. `target === 'center'`
 * merges the widget as a new tab (at `insertIndex` or end of strip, activated
 * on arrival); an edge zone splits it off into a new adjacent slot in the
 * same rail. Returns `rails` unchanged when `slotId` is unknown.
 *
 * Caller removes the source float row AFTER a successful rails update —
 * detect by `result !== rails`.
 */
export function applyDockFloatIntoSlot(
  rails: RailsState,
  descriptor: FloatDescriptor,
  slotId: string,
  target: SplitZone,
  insertIndex: number | undefined,
  genSlotId: () => string,
  genTabId: (slotId: string) => string,
): RailsState {
  const loc = findSlotLocation(rails, slotId)
  if (!loc) return rails
  if (target === 'center') {
    const tab = tabFromFloat(descriptor, genTabId(slotId))
    const destRail = rails[loc.side]
    const destSlot = destRail?.slots[loc.index]
    if (!destSlot) return rails
    return appendTabToSlot(rails, slotId, tab, insertIndex ?? destSlot.tabs.length)
  }
  const newSlotId = genSlotId()
  const newSlot = slotFromFloat(descriptor, newSlotId, genTabId(newSlotId))
  return placeNewSlot(rails, newSlot, { kind: 'slot', slotId, zone: target })
}

/**
 * Dock a floating widget as a brand-new slot — either onto an empty rail side
 * (creating the rail) or split off adjacent to an existing slot (the
 * dock-equivalent of `applyDetachTabToNewSlot`'s slot-split case). Returns
 * `rails` unchanged when the target is unresolvable (empty-side already
 * occupied, slot-split slotId unknown, slot-split zone === 'center').
 *
 * Caller removes the source float row AFTER a successful rails update.
 */
export function applyDockFloatAsNewSlot(
  rails: RailsState,
  descriptor: FloatDescriptor,
  target:
    | { kind: 'empty-side'; side: RailSide }
    | { kind: 'slot-split'; slotId: string; zone: SplitZone },
  genSlotId: () => string,
  genTabId: (slotId: string) => string,
): RailsState {
  const newSlotId = genSlotId()
  const newSlot = slotFromFloat(descriptor, newSlotId, genTabId(newSlotId))
  if (target.kind === 'empty-side') {
    return placeNewSlot(rails, newSlot, { kind: 'empty-side', side: target.side })
  }
  return placeNewSlot(rails, newSlot, { kind: 'slot', slotId: target.slotId, zone: target.zone })
}
