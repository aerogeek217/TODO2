import { create } from 'zustand'
import { startOfDay } from '../utils/date'
import { PLANNER_WINDOW_DAYS, plannerOffset, type PlannerDrop } from '../utils/planner'

/**
 * A Planner's window as its tab shows it, in memory only: never layout
 * config or view state, gone with a reload. Kept by tab id — not in the
 * widget — so the widget popup's remount (Open larger: a tab has one live
 * widget at a time) shows the same week and day.
 */
interface PlannerTabWindow {
  /** Days from today to the window's first day: a multiple of 7, 0 or more. */
  offset: number
  /** The day the days-ahead list starts at (local midnight, ms); null: the window's first. */
  picked: number | null
}

/** A tab that never moved its window: this week, no day picked. */
const DEFAULT_PLANNER_WINDOW: PlannerTabWindow = { offset: 0, picked: null }

/**
 * A task dragged over a Planner's tile or group: what a drop there would do.
 * In memory, while the drag is over that Planner (`use-planner-drag` sets and
 * clears it): its tiles and groups mark the target from it, the page's drag
 * overlay labels the lifted row from it, and the drop reads the place from it.
 */
export interface PlannerDragPreview {
  /** The Planner under the pointer (its tab id). */
  tabId: string
  /** What is hovered: a day's tile, or a group. */
  over: 'tile' | 'group'
  /** The target's key: its day's `dayKey` (Today's group and today's tile: today's); `PLANNER_NO_DAY_KEY` for Focus, no day. */
  key: string
  /** What a drop there writes (`utils/planner.plannerDrop`). */
  drop: PlannerDrop
  /**
   * Over a group: the row would land before row `index` of the group's rows
   * without it. Null: no place to show (a tile, a refused drop, a task the
   * drop wouldn't bring into the group).
   */
  index: number | null
}

interface PlannerState {
  windows: Record<string, PlannerTabWindow>
  /** The task drag over a Planner now; null with none. */
  drag: PlannerDragPreview | null
  /** Sets, or with `null` clears, the drag preview. */
  setDrag: (drag: PlannerDragPreview | null) => void
  /** Moves the tab's window by `weeks` (never before this week); the pick, a day of the old window, goes. */
  shift: (tabId: string, weeks: number) => void
  /** Back to this week, no day picked. */
  reset: (tabId: string) => void
  /** Picks the day the days-ahead list starts at; `null` — or the day already picked — clears it. */
  pick: (tabId: string, day: Date | null) => void
}

export const usePlannerStore = create<PlannerState>((set, get) => ({
  windows: {},
  drag: null,

  setDrag(drag) {
    if (get().drag !== drag) set({ drag })
  },

  shift(tabId, weeks) {
    const current = get().windows[tabId] ?? DEFAULT_PLANNER_WINDOW
    const offset = plannerOffset(current.offset + weeks * PLANNER_WINDOW_DAYS)
    if (offset === current.offset) return
    set((s) => ({ windows: { ...s.windows, [tabId]: { offset, picked: null } } }))
  },

  reset(tabId) {
    if (!(tabId in get().windows)) return
    set((s) => {
      const { [tabId]: _gone, ...rest } = s.windows
      void _gone
      return { windows: rest }
    })
  },

  pick(tabId, day) {
    const current = get().windows[tabId] ?? DEFAULT_PLANNER_WINDOW
    const at = day ? startOfDay(day).getTime() : null
    const picked = at === current.picked ? null : at
    if (picked === current.picked) return
    set((s) => ({ windows: { ...s.windows, [tabId]: { ...current, picked } } }))
  },
}))

/** The tab's window (`DEFAULT_PLANNER_WINDOW` until it moves it). */
export function usePlannerWindow(tabId: string): PlannerTabWindow {
  return usePlannerStore((s) => s.windows[tabId] ?? DEFAULT_PLANNER_WINDOW)
}
