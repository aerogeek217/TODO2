import { create } from 'zustand'
import { PLANNER_WINDOW_DAYS, plannerOffset, type PlannerDrop, type PlannerResetScope } from '../utils/planner'

/**
 * A Planner's window as its tab shows it, in memory only: never layout
 * config or view state, gone with a reload. Kept by its layout's id and its
 * tab's id (`plannerWindowKey`) — not in the widget — so the widget popup's
 * remount (Open larger: a tab has one live widget at a time) shows the same
 * week, while the same tab id in another layout (Duplicate layout
 * keeps the tabs' ids) has a window of its own. A tab that stops being a
 * Planner loses its window (`keep`).
 */
interface PlannerTabWindow {
  /** Days from today to the window's first day: a multiple of 7, 0 or more. */
  offset: number
}

/** A tab that never moved its window: this week. */
const DEFAULT_PLANNER_WINDOW: PlannerTabWindow = { offset: 0 }

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
  /** The target's key: its day's `dayKey` (Today's group and today's tile: today's), or its tray's (`PLANNER_DELAYED_KEY`, `PLANNER_UNPLANNED_KEY`). */
  key: string
  /** What a drop there does to the task's plan (`utils/planner.plannerDrop`). */
  drop: PlannerDrop
  /**
   * Over a group: the row would land before row `index` of the group's rows
   * without it. Null: no place to show (a tile, a refused drop, a task the
   * drop wouldn't bring into the group).
   */
  index: number | null
}

/**
 * What **Reset plan** would do in a Planner as it shows now, reported by the
 * widget itself (`hooks/use-planner`, which already holds the view) for the
 * menus that offer it — its top line's button and its cell's ⋯ menu — so
 * neither builds the view again, and a cell with no Planner reads nothing.
 */
interface PlannerResetReport {
  /** How many tasks each scope would clear (`utils/planner.plannerResetCounts`). */
  counts: Record<PlannerResetScope, number>
  /** The week scope's name: `This week`, or — the window shifted — the days shown (`Nov 27 – Dec 3`). */
  week: string
  /** Clears the scope's plans in the Planner as it shows when called. */
  run: (scope: PlannerResetScope) => void
}

/** The key of a Planner's window: its tab in its layout (no layout open: the tab alone). */
export function plannerWindowKey(layoutId: number | null | undefined, tabId: string): string {
  return `${layoutId ?? ''}|${tabId}`
}

interface PlannerState {
  /** Each Planner's window, by `plannerWindowKey`. */
  windows: Record<string, PlannerTabWindow>
  /** Each mounted Planner's Reset plan report, by `plannerWindowKey`; none for a Planner that isn't drawn. */
  resets: Record<string, PlannerResetReport>
  /** Sets a Planner's Reset plan report; `null` (its widget unmounted) removes it. */
  setReset: (key: string, report: PlannerResetReport | null) => void
  /** The task drag over a Planner now; null with none. */
  drag: PlannerDragPreview | null
  /** Sets, or with `null` clears, the drag preview. */
  setDrag: (drag: PlannerDragPreview | null) => void
  /** Moves the window `key` by `weeks` (never before this week). */
  shift: (key: string, weeks: number) => void
  /** Back to this week. */
  reset: (key: string) => void
  /**
   * Drops the windows of the layout `layoutId` whose tab isn't one of
   * `tabIds` — its Planner tabs now: a tab closed, or changed to another
   * kind, starts on this week if it is a Planner again.
   */
  keep: (layoutId: number, tabIds: readonly string[]) => void
}

export const usePlannerStore = create<PlannerState>((set, get) => ({
  windows: {},
  resets: {},
  drag: null,

  setReset(key, report) {
    const { resets } = get()
    if (report) {
      set({ resets: { ...resets, [key]: report } })
    } else if (key in resets) {
      set({ resets: Object.fromEntries(Object.entries(resets).filter(([k]) => k !== key)) })
    }
  },

  setDrag(drag) {
    if (get().drag !== drag) set({ drag })
  },

  shift(key, weeks) {
    const current = get().windows[key] ?? DEFAULT_PLANNER_WINDOW
    const offset = plannerOffset(current.offset + weeks * PLANNER_WINDOW_DAYS)
    if (offset === current.offset) return
    set((s) => ({ windows: { ...s.windows, [key]: { offset } } }))
  },

  reset(key) {
    if (!(key in get().windows)) return
    set((s) => {
      const { [key]: _gone, ...rest } = s.windows
      void _gone
      return { windows: rest }
    })
  },

  keep(layoutId, tabIds) {
    const { windows } = get()
    const kept = new Set(tabIds.map((tabId) => plannerWindowKey(layoutId, tabId)))
    const ofLayout = plannerWindowKey(layoutId, '')
    const gone = Object.keys(windows).filter((key) => key.startsWith(ofLayout) && !kept.has(key))
    if (gone.length === 0) return
    set({ windows: Object.fromEntries(Object.entries(windows).filter(([key]) => !gone.includes(key))) })
  },
}))

/** The window `key` (`DEFAULT_PLANNER_WINDOW` until it is moved). */
export function usePlannerWindow(key: string): PlannerTabWindow {
  return usePlannerStore((s) => s.windows[key] ?? DEFAULT_PLANNER_WINDOW)
}
