import { create } from 'zustand'
import type { FloatingSnoozeGraveyard } from '../models'
import { floatingSnoozeGraveyardRepository } from '../data'
import {
  createFloatPlacementMethods,
  createSetCollapsed,
  type FloatPlacementMethods,
} from './create-float-placement-store'
import { FLOAT_DEFAULT_RECTS } from '../services/float-default-rects'

/**
 * Placement-only widgets that render the snooze-graveyard stat widget (top-N
 * most-rescheduled open todos). Parallels `useFloatingHorizonsStore`: content
 * is derived from todo + todoEvents state; this store only tracks
 * x/y/w/h + collapse.
 */
interface FloatingSnoozeGraveyardState extends FloatPlacementMethods<FloatingSnoozeGraveyard> {
  graveyards: FloatingSnoozeGraveyard[]
  loading: boolean
  error: string | null
  setCollapsed: (id: number, collapsed: boolean) => Promise<void>
}

export const useFloatingSnoozeGraveyardStore = create<FloatingSnoozeGraveyardState>((set, get) => ({
  graveyards: [],
  loading: false,
  error: null,
  ...createFloatPlacementMethods<FloatingSnoozeGraveyard>(
    {
      repo: floatingSnoozeGraveyardRepository,
      defaults: FLOAT_DEFAULT_RECTS.snoozeGraveyard,
      slice: 'graveyards',
      label: 'floating snooze graveyard',
      removeUndoLabel: 'Close floating snooze graveyard',
    },
    set,
    get,
  ),
  setCollapsed: createSetCollapsed<FloatingSnoozeGraveyard>(
    {
      repo: floatingSnoozeGraveyardRepository,
      slice: 'graveyards',
      label: 'floating snooze graveyard',
    },
    set,
    get,
  ),
}))
