import { create } from 'zustand'
import type { FloatingScoreboard } from '../models'
import { floatingScoreboardRepository } from '../data'
import {
  createFloatPlacementMethods,
  createSetCollapsed,
  type FloatPlacementMethods,
} from './create-float-placement-store'
import { FLOAT_DEFAULT_RECTS } from '../services/float-default-rects'

/**
 * Placement-only widgets that render the discipline scoreboard stat widget
 * (defer / completion / lag metric cards). Parallels `useFloatingHorizonsStore`:
 * content is derived from todo + todoEvents state; this store only tracks
 * x/y/w/h + collapse.
 */
interface FloatingScoreboardState extends FloatPlacementMethods<FloatingScoreboard> {
  scoreboards: FloatingScoreboard[]
  loading: boolean
  error: string | null
  setCollapsed: (id: number, collapsed: boolean) => Promise<void>
}

export const useFloatingScoreboardStore = create<FloatingScoreboardState>((set, get) => ({
  scoreboards: [],
  loading: false,
  error: null,
  ...createFloatPlacementMethods<FloatingScoreboard>(
    {
      repo: floatingScoreboardRepository,
      defaults: FLOAT_DEFAULT_RECTS.scoreboard,
      slice: 'scoreboards',
      label: 'floating scoreboard',
      removeUndoLabel: 'Close floating scoreboard',
    },
    set,
    get,
  ),
  setCollapsed: createSetCollapsed<FloatingScoreboard>(
    {
      repo: floatingScoreboardRepository,
      slice: 'scoreboards',
      label: 'floating scoreboard',
    },
    set,
    get,
  ),
}))
