import { create } from 'zustand'
import type { RailSide, RailsState, Slot, SlotKind } from '../models/canvas-rails'
import { EMPTY_RAILS, railOrientationForSide } from '../models/canvas-rails'

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
  hydrate: (next: RailsState) => void
  setRails: (next: RailsState) => void
  addRail: (side: RailSide, defaultSlot?: Slot) => void
  closeSlot: (slotId: string) => void
  updateSlot: (slotId: string, patch: Partial<Slot>) => void
}

export const useCanvasRailsStore = create<CanvasRailsState>((set) => ({
  rails: EMPTY_RAILS,
  hydrated: false,

  hydrate: (next) => set({ rails: next, hydrated: true }),

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
}))
