import { create } from 'zustand'
import type { FloatingTaskboard } from '../models'
import { floatingTaskboardRepository } from '../data'
import {
  createFloatPlacementMethods,
  createSetCollapsed,
  type FloatPlacementMethods,
} from './create-float-placement-store'
import { FLOAT_DEFAULT_RECTS } from '../services/float-default-rects'

/**
 * Placement-only widgets that render the singleton `Taskboard` on a canvas.
 * Parallels `useFloatingCalendarStore` / `useFloatingNoteStore` /
 * `useFloatingHorizonsStore`: entries live on the singleton `Taskboard` row;
 * this store only tracks x/y/w/h + collapse.
 */
interface FloatingTaskboardState extends FloatPlacementMethods<FloatingTaskboard> {
  taskboards: FloatingTaskboard[]
  loading: boolean
  error: string | null
  setCollapsed: (id: number, collapsed: boolean) => Promise<void>
}

export const useFloatingTaskboardStore = create<FloatingTaskboardState>((set, get) => ({
  taskboards: [],
  loading: false,
  error: null,
  ...createFloatPlacementMethods<FloatingTaskboard>(
    {
      repo: floatingTaskboardRepository,
      defaults: FLOAT_DEFAULT_RECTS.taskboard,
      slice: 'taskboards',
      label: 'floating taskboards',
      removeUndoLabel: 'Close floating taskboard',
    },
    set,
    get,
  ),
  setCollapsed: createSetCollapsed<FloatingTaskboard>(
    {
      repo: floatingTaskboardRepository,
      slice: 'taskboards',
      label: 'floating taskboard',
    },
    set,
    get,
  ),
}))
