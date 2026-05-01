import { create } from 'zustand'
import type { FloatingCalendar } from '../models'
import type { CalendarOrientation } from '../models/canvas-rails'
import { WEEK_OFFSET_MAX } from '../models/canvas-rails'
import { floatingCalendarRepository } from '../data'
import { optimistic, updateItemInList } from './store-helpers'
import { createFloatPlacementMethods, type FloatPlacementMethods } from './create-float-placement-store'
import { FLOAT_DEFAULT_RECTS } from '../services/float-default-rects'

interface FloatingCalendarState extends FloatPlacementMethods<FloatingCalendar> {
  calendars: FloatingCalendar[]
  loading: boolean
  error: string | null
  updateOrientation: (id: number, orientation: CalendarOrientation) => Promise<void>
  updateWeekOffset: (id: number, weekOffset: number) => Promise<void>
}

export const useFloatingCalendarStore = create<FloatingCalendarState>((set, get) => ({
  calendars: [],
  loading: false,
  error: null,
  ...createFloatPlacementMethods<FloatingCalendar>(
    {
      repo: floatingCalendarRepository,
      defaults: FLOAT_DEFAULT_RECTS.calendar,
      slice: 'calendars',
      label: 'floating calendars',
      removeUndoLabel: 'Delete floating calendar',
    },
    set,
    get,
  ),

  async updateOrientation(id, orientation) {
    const prev = get().calendars.find((c) => c.id === id)
    if (!prev) return
    if (prev.orientation === orientation) return
    return optimistic(
      set,
      () => set({ calendars: updateItemInList(get().calendars, id, { orientation }) }),
      () => floatingCalendarRepository.update({ ...prev, orientation }),
      () => set({ calendars: updateItemInList(get().calendars, id, { orientation: prev.orientation }) }),
      'Failed to update floating calendar orientation',
    )
  },

  async updateWeekOffset(id, weekOffset) {
    const prev = get().calendars.find((c) => c.id === id)
    if (!prev) return
    if (!Number.isFinite(weekOffset)) return
    const clamped = Math.max(-WEEK_OFFSET_MAX, Math.min(WEEK_OFFSET_MAX, Math.trunc(weekOffset)))
    if (prev.weekOffset === clamped) return
    return optimistic(
      set,
      () => set({ calendars: updateItemInList(get().calendars, id, { weekOffset: clamped }) }),
      () => floatingCalendarRepository.update({ ...prev, weekOffset: clamped }),
      () => set({ calendars: updateItemInList(get().calendars, id, { weekOffset: prev.weekOffset }) }),
      'Failed to update floating calendar week offset',
    )
  },
}))
