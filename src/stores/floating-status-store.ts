import { create } from 'zustand'
import type { FloatingStatus } from '../models'
import { floatingStatusRepository } from '../data'
import {
  createFloatPlacementMethods,
  createSetCollapsed,
  type FloatPlacementMethods,
} from './create-float-placement-store'

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
      defaults: { width: 380, height: 240 },
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
