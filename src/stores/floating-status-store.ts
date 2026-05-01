import { create } from 'zustand'
import type { FloatingStatus } from '../models'
import { floatingStatusRepository } from '../data'
import {
  createFloatPlacementMethods,
  createSetCollapsed,
  type FloatPlacementMethods,
} from './create-float-placement-store'
import { FLOAT_DEFAULT_RECTS } from '../services/float-default-rects'

/**
 * Placement-only widgets that render the open-tasks-by-status stat widget.
 * Parallels `useFloatingHorizonsStore` / `useFloatingTaskboardStore`: widget
 * content is derived from todo + status state; this store only tracks
 * x/y/w/h + collapse.
 */
interface FloatingStatusState extends FloatPlacementMethods<FloatingStatus> {
  statuses: FloatingStatus[]
  loading: boolean
  error: string | null
  setCollapsed: (id: number, collapsed: boolean) => Promise<void>
}

export const useFloatingStatusStore = create<FloatingStatusState>((set, get) => ({
  statuses: [],
  loading: false,
  error: null,
  ...createFloatPlacementMethods<FloatingStatus>(
    {
      repo: floatingStatusRepository,
      defaults: FLOAT_DEFAULT_RECTS.status,
      slice: 'statuses',
      label: 'floating status',
      removeUndoLabel: 'Close floating status',
    },
    set,
    get,
  ),
  setCollapsed: createSetCollapsed<FloatingStatus>(
    {
      repo: floatingStatusRepository,
      slice: 'statuses',
      label: 'floating status',
    },
    set,
    get,
  ),
}))
