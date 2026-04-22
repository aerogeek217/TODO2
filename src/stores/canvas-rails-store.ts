import { create } from 'zustand'
import type { CalendarOrientation, Corner, CornerOwner, RailSide, RailsState, Slot, SlotKind, Tab } from '../models/canvas-rails'
import {
  EMPTY_RAILS,
  WEEK_OFFSET_MAX,
  clampRailSize,
  getActiveTab,
  railOrientationForSide,
} from '../models/canvas-rails'
import {
  applyDetachTabToNewSlot,
  applyDropToSide,
  applyMoveTabToSlot,
  applyReorderTab,
  applySplitDrop,
  applySplitButton,
  type SplitZone,
  type TabDropTarget,
} from '../utils/rail-dnd'

function genSlotId(): string {
  return `slot-${Math.random().toString(36).slice(2, 10)}`
}

function genTabId(slotId: string): string {
  return `${slotId}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Build a single-tab slot of the given kind. Used by the slot-creation factories
 * below and by the split-button reducer via the `createTab` option.
 */
function buildSingleTabSlot(kind: SlotKind, listDefinitionId?: number): Slot {
  const id = genSlotId()
  const tab: Tab = { id: genTabId(id), type: kind }
  if (listDefinitionId != null) tab.listDefinitionId = listDefinitionId
  return { id, tabs: [tab], activeTabId: tab.id }
}

export function createLensSlot(listDefinitionId?: number): Slot {
  return buildSingleTabSlot('lens', listDefinitionId)
}

export function createSlot(kind: SlotKind, listDefinitionId?: number): Slot {
  return buildSingleTabSlot(kind, listDefinitionId)
}

export function createTaskboardSlot(): Slot {
  return buildSingleTabSlot('taskboard')
}

/**
 * Patch applied to `updateSlot`. Slot-level fields (`flex`, `orientation`,
 * `weekOffset`) apply to the slot; tab-level fields (`listDefinitionId`)
 * apply to the active tab.
 */
export interface SlotPatch {
  flex?: number
  orientation?: CalendarOrientation
  weekOffset?: number
  listDefinitionId?: number
}

interface CanvasRailsState {
  rails: RailsState
  hydrated: boolean
  /** Transient: id of a slot that should receive keyboard focus on next render (e.g. newly-split slot). Cleared after focus. */
  pendingFocusSlotId: string | null
  hydrate: (next: RailsState) => void
  setRails: (next: RailsState) => void
  addRail: (side: RailSide, defaultSlot?: Slot) => void
  closeSlot: (slotId: string) => void
  /**
   * Patch a slot. Slot-level fields (`flex`, `orientation`, `weekOffset`)
   * apply to the slot; tab-level fields (`listDefinitionId`, `taskboardId`)
   * apply to the active tab.
   */
  updateSlot: (slotId: string, patch: SlotPatch) => void
  /**
   * Switch the active tab's type in place. Clears seed fields that don't
   * apply to the new kind (e.g. switching from `lens → notes` drops
   * `listDefinitionId`). Callers own picking the seed when the new kind
   * requires one (lens) — this method does not auto-seed.
   * Slot-level `flex` / `orientation` / `weekOffset` are preserved.
   */
  setSlotKind: (slotId: string, nextKind: SlotKind, seed?: { listDefinitionId?: number }) => void
  /**
   * Append a new tab of the given kind to the slot and activate it. Only
   * `lens` uses `seed.listDefinitionId`; other kinds ignore seeds.
   */
  addTab: (slotId: string, kind: SlotKind, seed?: { listDefinitionId?: number }) => void
  /**
   * Remove a tab from a slot. Activation cascades to the left sibling (then
   * right) if the closed tab was active. If the last tab is closed, the whole
   * slot is closed via `closeSlot`.
   */
  closeTab: (slotId: string, tabId: string) => void
  /** Set the slot's active tab. No-op if the tabId isn't in the slot. */
  activateTab: (slotId: string, tabId: string) => void
  /**
   * Change a specific tab's type in place. Same seed semantics as
   * `setSlotKind` but targets an arbitrary tab rather than the active one.
   */
  changeTabType: (slotId: string, tabId: string, nextKind: SlotKind, seed?: { listDefinitionId?: number }) => void
  /** Calendar-slot only: set the row/column orientation. No-op when active tab is not calendar. */
  setSlotOrientation: (slotId: string, orientation: CalendarOrientation) => void
  /** Calendar-slot only: set the week offset (clamped to ±WEEK_OFFSET_MAX). */
  setSlotWeekOffset: (slotId: string, weekOffset: number) => void
  dropSlotToSide: (slotId: string, toSide: RailSide) => void
  splitDropSlot: (slotId: string, targetSlotId: string, zone: SplitZone) => void
  /** Move a tab within its slot. `insertIdx` is the desired index after removal. */
  reorderTab: (slotId: string, tabId: string, insertIdx: number) => void
  /**
   * Move a tab from one slot to another at `insertIdx`. If the source slot
   * empties, it is cascade-closed. The destination slot's active tab becomes
   * the moved tab.
   */
  moveTabToSlot: (srcSlotId: string, tabId: string, destSlotId: string, insertIdx: number) => void
  /**
   * Extract a tab from its source slot and dock it as a fresh single-tab slot
   * at the given drop target. Source cascade-closes if it had only that tab.
   */
  detachTabToNewSlot: (srcSlotId: string, tabId: string, target: TabDropTarget) => void
  splitSlot: (slotId: string, dir: 'above' | 'below' | 'left' | 'right', seed?: { listDefinitionId?: number }) => void
  /**
   * Create a new slot of the given kind and dock it into the first empty rail
   * (preference order: right, left, top, bottom). If no rails are empty, append
   * the new slot to the right rail. Used by canvas floating-node dock-back.
   * Returns the new slot's id.
   */
  createAndDockSlot: (kind: SlotKind, listDefinitionId?: number) => string
  setRailSize: (side: RailSide, px: number) => void
  /** Set the collapsed flag for a rail side. Stored width/height is preserved. */
  setRailCollapsed: (side: RailSide, collapsed: boolean) => void
  /** Flip the collapsed flag for a rail side. */
  toggleRailCollapsed: (side: RailSide) => void
  /**
   * Set the collapsed flag on every *present* rail in one atomic update.
   * Absent rails (null) are skipped — stale flags for absent sides are
   * preserved (same policy as widths/heights) so reopening a rail returns
   * to its last state.
   */
  setAllRailsCollapsed: (collapsed: boolean) => void
  /**
   * Atomically set `flex` weights for slots in a rail. Keys not present in
   * `flexBySlotId` are left unchanged. Non-positive / non-finite values are
   * skipped. Used by the slot divider so every slot's weight updates together
   * when the user drags between two siblings.
   */
  setSlotFlexBatch: (side: RailSide, flexBySlotId: Record<string, number>) => void
  /**
   * Set the owner of a frame corner. `'h'` gives the corner to the horizontal
   * rail (top/bottom), `'v'` to the vertical rail (left/right). When the new
   * owner matches the current value the store returns unchanged. Used by the
   * empty-side drop strip's start/end sub-zones and (Phase 3) the corner
   * toggle chevron. Dangling claims (owner rail absent) are preserved in state
   * and resolved at render time by `resolveCorner`.
   */
  setCornerOwner: (corner: Corner, owner: CornerOwner) => void
  /**
   * Remove a corner entry so it reverts to the default (`'v'`). Used by the
   * empty-side drop handler to wipe stale claims that would otherwise
   * resurrect when a rail is re-docked via a center sub-zone.
   */
  clearCornerOwner: (corner: Corner) => void
  clearPendingFocus: () => void
}

const DOCK_PRIORITY: RailSide[] = ['right', 'left', 'top', 'bottom']

function findSlot(rails: RailsState, slotId: string): Slot | null {
  for (const side of ['left', 'right', 'top', 'bottom'] as RailSide[]) {
    const rail = rails[side]
    if (!rail) continue
    const slot = rail.slots.find((s) => s.id === slotId)
    if (slot) return slot
  }
  return null
}

function mapSlot(rails: RailsState, slotId: string, fn: (slot: Slot) => Slot | null): RailsState {
  let touched = false
  const next: RailsState = { ...rails }
  for (const side of ['left', 'right', 'top', 'bottom'] as RailSide[]) {
    const rail = next[side]
    if (!rail) continue
    const idx = rail.slots.findIndex((s) => s.id === slotId)
    if (idx === -1) continue
    const updated = fn(rail.slots[idx])
    if (!updated || updated === rail.slots[idx]) return rails
    const nextSlots = rail.slots.slice()
    nextSlots[idx] = updated
    next[side] = { ...rail, slots: nextSlots }
    touched = true
  }
  return touched ? next : rails
}

export const useCanvasRailsStore = create<CanvasRailsState>((set, get) => ({
  rails: EMPTY_RAILS,
  hydrated: false,
  pendingFocusSlotId: null,

  hydrate: (next) => set({ rails: next, hydrated: true }),

  clearPendingFocus: () => set({ pendingFocusSlotId: null }),

  setRails: (next) => set({ rails: next }),

  addRail: (side, defaultSlot) => set((state) => {
    if (state.rails[side]) return state
    const slots: Slot[] = defaultSlot ? [defaultSlot] : []
    return {
      rails: {
        ...state.rails,
        [side]: { orientation: railOrientationForSide(side), slots },
      },
    }
  }),

  closeSlot: (slotId) => set((state) => {
    let touched = false
    const next: RailsState = { ...state.rails }
    for (const side of ['left', 'right', 'top', 'bottom'] as RailSide[]) {
      const rail = next[side]
      if (!rail) continue
      const filtered = rail.slots.filter((s) => s.id !== slotId)
      if (filtered.length === rail.slots.length) continue
      touched = true
      if (filtered.length === 0) {
        next[side] = null
      } else if (filtered.length === 1) {
        // Sole remaining slot's flex weight is meaningless for layout and
        // will bias the next sibling insertion — strip it.
        const { flex: _ignore, ...rest } = filtered[0]
        void _ignore
        next[side] = { ...rail, slots: [rest as typeof filtered[0]] }
      } else {
        next[side] = { ...rail, slots: filtered }
      }
    }
    return touched ? { rails: next } : state
  }),

  setSlotOrientation: (slotId, orientation) => {
    const s = get()
    const slot = findSlot(s.rails, slotId)
    if (!slot || getActiveTab(slot).type !== 'calendar') return
    if (slot.orientation === orientation) return
    s.updateSlot(slotId, { orientation })
  },

  setSlotWeekOffset: (slotId, weekOffset) => {
    const s = get()
    const slot = findSlot(s.rails, slotId)
    if (!slot || getActiveTab(slot).type !== 'calendar') return
    if (!Number.isFinite(weekOffset)) return
    const clamped = Math.max(-WEEK_OFFSET_MAX, Math.min(WEEK_OFFSET_MAX, Math.trunc(weekOffset)))
    if (slot.weekOffset === clamped) return
    s.updateSlot(slotId, { weekOffset: clamped })
  },

  updateSlot: (slotId, patch) => set((state) => {
    const next = mapSlot(state.rails, slotId, (current) => {
      const nextSlot: Slot = { ...current }
      if (patch.flex !== undefined) nextSlot.flex = patch.flex
      if (patch.orientation !== undefined) nextSlot.orientation = patch.orientation
      if (patch.weekOffset !== undefined) nextSlot.weekOffset = patch.weekOffset

      if (patch.listDefinitionId !== undefined) {
        const activeIdx = current.tabs.findIndex((t) => t.id === current.activeTabId)
        const resolvedIdx = activeIdx === -1 ? 0 : activeIdx
        const active = current.tabs[resolvedIdx]
        const nextTab: Tab = { ...active, listDefinitionId: patch.listDefinitionId }
        const tabs = current.tabs.slice()
        tabs[resolvedIdx] = nextTab
        nextSlot.tabs = tabs
      }
      return nextSlot
    })
    return next === state.rails ? state : { rails: next }
  }),

  setSlotKind: (slotId, nextKind, seed) => set((state) => {
    const next = mapSlot(state.rails, slotId, (current) => {
      const activeIdx = current.tabs.findIndex((t) => t.id === current.activeTabId)
      const resolvedIdx = activeIdx === -1 ? 0 : activeIdx
      const active = current.tabs[resolvedIdx]
      if (active.type === nextKind && !seed) return current

      // Rewrite the active tab's type and clear cross-kind seed fields.
      const rebuiltTab: Tab = { id: active.id, type: nextKind }
      if (nextKind === 'lens') {
        const listId = seed?.listDefinitionId ?? active.listDefinitionId
        if (listId != null) rebuiltTab.listDefinitionId = listId
      }
      const tabs = current.tabs.slice()
      tabs[resolvedIdx] = rebuiltTab

      // Preserve slot-level sizing (flex) across kind changes. Drop
      // orientation/weekOffset when moving off calendar — they were
      // calendar-specific.
      const nextSlot: Slot = { id: current.id, tabs, activeTabId: current.activeTabId }
      if (current.flex != null) nextSlot.flex = current.flex
      if (nextKind === 'calendar') {
        if (current.orientation != null) nextSlot.orientation = current.orientation
        if (current.weekOffset != null) nextSlot.weekOffset = current.weekOffset
      }
      return nextSlot
    })
    return next === state.rails ? state : { rails: next }
  }),

  addTab: (slotId, kind, seed) => set((state) => {
    const next = mapSlot(state.rails, slotId, (current) => {
      const newTab: Tab = { id: genTabId(current.id), type: kind }
      if (kind === 'lens' && seed?.listDefinitionId != null) newTab.listDefinitionId = seed.listDefinitionId
      return { ...current, tabs: [...current.tabs, newTab], activeTabId: newTab.id }
    })
    return next === state.rails ? state : { rails: next }
  }),

  closeTab: (slotId, tabId) => {
    const state = get()
    const slot = findSlot(state.rails, slotId)
    if (!slot) return
    const idx = slot.tabs.findIndex((t) => t.id === tabId)
    if (idx === -1) return
    if (slot.tabs.length === 1) {
      state.closeSlot(slotId)
      return
    }
    set((s) => {
      const next = mapSlot(s.rails, slotId, (current) => {
        const i = current.tabs.findIndex((t) => t.id === tabId)
        if (i === -1) return current
        const tabs = current.tabs.slice()
        tabs.splice(i, 1)
        let activeTabId = current.activeTabId
        if (current.activeTabId === tabId) {
          // Prefer left sibling, else right.
          const fallback = current.tabs[i - 1] ?? current.tabs[i + 1]
          activeTabId = fallback.id
        }
        return { ...current, tabs, activeTabId }
      })
      return next === s.rails ? s : { rails: next }
    })
  },

  activateTab: (slotId, tabId) => set((state) => {
    const next = mapSlot(state.rails, slotId, (current) => {
      if (current.activeTabId === tabId) return current
      if (!current.tabs.some((t) => t.id === tabId)) return current
      return { ...current, activeTabId: tabId }
    })
    return next === state.rails ? state : { rails: next }
  }),

  changeTabType: (slotId, tabId, nextKind, seed) => set((state) => {
    const next = mapSlot(state.rails, slotId, (current) => {
      const idx = current.tabs.findIndex((t) => t.id === tabId)
      if (idx === -1) return current
      const tab = current.tabs[idx]
      if (tab.type === nextKind && !seed) return current
      const rebuilt: Tab = { id: tab.id, type: nextKind }
      if (nextKind === 'lens') {
        const listId = seed?.listDefinitionId ?? tab.listDefinitionId
        if (listId != null) rebuilt.listDefinitionId = listId
      }
      const tabs = current.tabs.slice()
      tabs[idx] = rebuilt
      return { ...current, tabs }
    })
    return next === state.rails ? state : { rails: next }
  }),

  dropSlotToSide: (slotId, toSide) => set((state) => {
    const next = applyDropToSide(state.rails, slotId, toSide)
    return next === state.rails ? state : { rails: next }
  }),

  splitDropSlot: (slotId, targetSlotId, zone) => set((state) => {
    const next = applySplitDrop(state.rails, slotId, targetSlotId, zone)
    return next === state.rails ? state : { rails: next }
  }),

  reorderTab: (slotId, tabId, insertIdx) => set((state) => {
    const next = applyReorderTab(state.rails, slotId, tabId, insertIdx)
    return next === state.rails ? state : { rails: next }
  }),

  moveTabToSlot: (srcSlotId, tabId, destSlotId, insertIdx) => set((state) => {
    const next = applyMoveTabToSlot(state.rails, srcSlotId, tabId, destSlotId, insertIdx)
    return next === state.rails ? state : { rails: next }
  }),

  detachTabToNewSlot: (srcSlotId, tabId, target) => set((state) => {
    const next = applyDetachTabToNewSlot(state.rails, srcSlotId, tabId, target, (tab) => {
      const newId = genSlotId()
      // Preserve the tab's existing id so CSS animations/focus keyed by tabId
      // survive the detach — the tab's payload is already unique across rails.
      return { id: newId, tabs: [tab], activeTabId: tab.id }
    })
    return next === state.rails ? state : { rails: next }
  }),

  splitSlot: (slotId, dir, seed) => set((state) => {
    const newId = genSlotId()
    const next = applySplitButton(state.rails, slotId, dir, {
      buildSlot: (kind) => {
        const tab: Tab = { id: genTabId(newId), type: kind }
        if (kind === 'lens' && seed?.listDefinitionId != null) tab.listDefinitionId = seed.listDefinitionId
        return { id: newId, tabs: [tab], activeTabId: tab.id }
      },
    })
    if (next === state.rails) return state
    return { rails: next, pendingFocusSlotId: newId }
  }),

  createAndDockSlot: (kind, listDefinitionId) => {
    const slot = buildSingleTabSlot(kind, listDefinitionId)
    set((state) => {
      const next: RailsState = { ...state.rails }
      const emptySide = DOCK_PRIORITY.find((side) => !next[side])
      if (emptySide) {
        next[emptySide] = { orientation: railOrientationForSide(emptySide), slots: [slot] }
      } else {
        const rail = next.right
        if (!rail) {
          next.right = { orientation: railOrientationForSide('right'), slots: [slot] }
        } else {
          next.right = { ...rail, slots: [...rail.slots, slot] }
        }
      }
      return { rails: next, pendingFocusSlotId: slot.id }
    })
    return slot.id
  },

  setSlotFlexBatch: (side, flexBySlotId) => set((state) => {
    const rail = state.rails[side]
    if (!rail) return state
    let touched = false
    const nextSlots = rail.slots.map((s) => {
      const v = flexBySlotId[s.id]
      if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return s
      if (s.flex === v) return s
      touched = true
      return { ...s, flex: v }
    })
    if (!touched) return state
    return { rails: { ...state.rails, [side]: { ...rail, slots: nextSlots } } }
  }),

  setCornerOwner: (corner, owner) => set((state) => {
    const current = state.rails.corners?.[corner]
    if (current === owner) return state
    const corners: Partial<Record<Corner, CornerOwner>> = { ...(state.rails.corners ?? {}), [corner]: owner }
    return { rails: { ...state.rails, corners } }
  }),

  clearCornerOwner: (corner) => set((state) => {
    const current = state.rails.corners
    if (!current || current[corner] === undefined) return state
    const next: Partial<Record<Corner, CornerOwner>> = { ...current }
    delete next[corner]
    const hasAny = Object.keys(next).length > 0
    return { rails: { ...state.rails, corners: hasAny ? next : undefined } }
  }),

  setRailSize: (side, px) => set((state) => {
    const clamped = clampRailSize(px)
    if (side === 'left' || side === 'right') {
      const prev = state.rails.widths?.[side]
      if (prev === clamped) return state
      const widths = { ...(state.rails.widths ?? {}), [side]: clamped }
      return { rails: { ...state.rails, widths } }
    }
    const prev = state.rails.heights?.[side]
    if (prev === clamped) return state
    const heights = { ...(state.rails.heights ?? {}), [side]: clamped }
    return { rails: { ...state.rails, heights } }
  }),

  setRailCollapsed: (side, collapsed) => set((state) => {
    const prev = state.rails.collapsed?.[side] === true
    if (prev === collapsed) return state
    const nextBag: Partial<Record<RailSide, boolean>> = { ...(state.rails.collapsed ?? {}) }
    if (collapsed) nextBag[side] = true
    else delete nextBag[side]
    const hasAny = Object.keys(nextBag).length > 0
    return { rails: { ...state.rails, collapsed: hasAny ? nextBag : undefined } }
  }),

  toggleRailCollapsed: (side) => {
    const prev = get().rails.collapsed?.[side] === true
    get().setRailCollapsed(side, !prev)
  },

  setAllRailsCollapsed: (collapsed) => set((state) => {
    const nextBag: Partial<Record<RailSide, boolean>> = { ...(state.rails.collapsed ?? {}) }
    let touched = false
    for (const side of ['left', 'right', 'top', 'bottom'] as RailSide[]) {
      if (!state.rails[side]) continue
      const prev = nextBag[side] === true
      if (prev === collapsed) continue
      if (collapsed) nextBag[side] = true
      else delete nextBag[side]
      touched = true
    }
    if (!touched) return state
    const hasAny = Object.keys(nextBag).length > 0
    return { rails: { ...state.rails, collapsed: hasAny ? nextBag : undefined } }
  }),
}))
