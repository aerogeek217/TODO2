import { create } from 'zustand'
import type { FloatingHorizons } from '../models'
import { floatingHorizonsRepository } from '../data'
import {
  createFloatPlacementMethods,
  createSetCollapsed,
  type FloatPlacementMethods,
} from './create-float-placement-store'
import { FLOAT_DEFAULT_RECTS } from '../services/float-default-rects'

/**
 * Placement-only widgets that render the global horizon ribbon + selected
 * horizon's list. Parallels `useFloatingCalendarStore` /
 * `useFloatingTaskboardStore`: ribbon state lives in settings; this store
 * only tracks x/y/w/h + collapse.
 */
interface FloatingHorizonsState extends FloatPlacementMethods<FloatingHorizons> {
  horizons: FloatingHorizons[]
  loading: boolean
  error: string | null
  setCollapsed: (id: number, collapsed: boolean) => Promise<void>
}

export const useFloatingHorizonsStore = create<FloatingHorizonsState>((set, get) => ({
  horizons: [],
  loading: false,
  error: null,
  ...createFloatPlacementMethods<FloatingHorizons>(
    {
      repo: floatingHorizonsRepository,
      defaults: FLOAT_DEFAULT_RECTS.horizons,
      slice: 'horizons',
      label: 'floating horizons',
      removeUndoLabel: 'Close floating horizons',
    },
    set,
    get,
  ),
  setCollapsed: createSetCollapsed<FloatingHorizons>(
    {
      repo: floatingHorizonsRepository,
      slice: 'horizons',
      label: 'floating horizons',
    },
    set,
    get,
  ),
}))
