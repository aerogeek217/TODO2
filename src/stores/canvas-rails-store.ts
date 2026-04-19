import { create } from 'zustand'
import type { RailSide, RailsState, Slot, SlotKind } from '../models/canvas-rails'
import { EMPTY_RAILS, clampRailSize, railOrientationForSide } from '../models/canvas-rails'
import {
  applyDropToSide,
  applyEdgeDrop,
  applySplitDrop,
  applySplitButton,
  type SplitZone,
} from '../components/canvas/rails/rail-dnd'

function genSlotId(): string {
  return `slot-${Math.random().toString(36).slice(2, 10)}`
}

export function createLensSlot(listDefinitionId?: number): Slot {
  return { id: genSlotId(), kind: 'lens', listDefinitionId }
}

export function createSlot(kind: SlotKind, listDefinitionId?: number): Slot {
  return { id: genSlotId(), kind, listDefinitionId }
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
  updateSlot: (slotId: string, patch: Partial<Slot>) => void
  dropSlotToSide: (slotId: string, toSide: RailSide) => void
  edgeDropSlot: (slotId: string, toSide: RailSide, edge: 'head' | 'tail') => void
  splitDropSlot: (slotId: string, targetSlotId: string, zone: SplitZone) => void
  splitSlot: (slotId: string, dir: 'above' | 'below' | 'left' | 'right') => void
  /**
   * Create a new slot of the given kind and dock it into the first empty rail
   * (preference order: right, left, top, bottom). If no rails are empty, append
   * the new slot to the right rail. Used by canvas floating-node dock-back.
   * Returns the new slot's id.
   */
  createAndDockSlot: (kind: SlotKind, listDefinitionId?: number) => string
  setRailSize: (side: RailSide, px: number) => void
  clearPendingFocus: () => void
}

const DOCK_PRIORITY: RailSide[] = ['right', 'left', 'top', 'bottom']

export const useCanvasRailsStore = create<CanvasRailsState>((set) => ({
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
      if (filtered.length !== rail.slots.length) {
        touched = true
        next[side] = filtered.length === 0
          ? null
          : { ...rail, slots: filtered }
      }
    }
    return touched ? { rails: next } : state
  }),

  updateSlot: (slotId, patch) => set((state) => {
    let touched = false
    const next: RailsState = { ...state.rails }
    for (const side of ['left', 'right', 'top', 'bottom'] as RailSide[]) {
      const rail = next[side]
      if (!rail) continue
      const idx = rail.slots.findIndex((s) => s.id === slotId)
      if (idx === -1) continue
      const current = rail.slots[idx]
      const merged: Slot = { ...current, ...patch, id: current.id }
      const nextSlots = rail.slots.slice()
      nextSlots[idx] = merged
      next[side] = { ...rail, slots: nextSlots }
      touched = true
    }
    return touched ? { rails: next } : state
  }),

  dropSlotToSide: (slotId, toSide) => set((state) => {
    const next = applyDropToSide(state.rails, slotId, toSide)
    return next === state.rails ? state : { rails: next }
  }),

  edgeDropSlot: (slotId, toSide, edge) => set((state) => {
    const next = applyEdgeDrop(state.rails, slotId, toSide, edge)
    return next === state.rails ? state : { rails: next }
  }),

  splitDropSlot: (slotId, targetSlotId, zone) => set((state) => {
    const next = applySplitDrop(state.rails, slotId, targetSlotId, zone)
    return next === state.rails ? state : { rails: next }
  }),

  splitSlot: (slotId, dir) => set((state) => {
    const newId = genSlotId()
    const next = applySplitButton(state.rails, slotId, dir, { genSlotId: () => newId })
    if (next === state.rails) return state
    return { rails: next, pendingFocusSlotId: newId }
  }),

  createAndDockSlot: (kind, listDefinitionId) => {
    const slot: Slot = { id: genSlotId(), kind, ...(listDefinitionId != null ? { listDefinitionId } : {}) }
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
}))
