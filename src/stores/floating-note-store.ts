import { create } from 'zustand'
import type { FloatingNote } from '../models'
import { floatingNoteRepository } from '../data'
import { createFloatPlacementMethods, type FloatPlacementMethods } from './create-float-placement-store'

/**
 * Placement-only widgets that render the single global note on a canvas.
 * Parallels `useFloatingCalendarStore` / `useFloatingTaskboardStore` /
 * `useFloatingHorizonsStore`: content lives elsewhere (the `notes` global
 * row); this store only tracks x/y/w/h. Built on the
 * `createFloatPlacementMethods` factory.
 */
interface FloatingNoteState extends FloatPlacementMethods<FloatingNote> {
  notes: FloatingNote[]
  loading: boolean
  error: string | null
}

export const useFloatingNoteStore = create<FloatingNoteState>((set, get) => ({
  notes: [],
  loading: false,
  error: null,
  ...createFloatPlacementMethods<FloatingNote>(
    {
      repo: floatingNoteRepository,
      defaults: { width: 240, height: 200 },
      slice: 'notes',
      label: 'floating notes',
      removeUndoLabel: 'Close floating note',
    },
    set,
    get,
  ),
}))
