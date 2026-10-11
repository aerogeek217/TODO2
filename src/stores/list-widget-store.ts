import { create } from 'zustand'

/**
 * Per-tab state of workspace list widgets that is never saved. Keyed by
 * layout tab id, so it follows a tab that is moved to another cell.
 */
interface ListWidgetState {
  /**
   * Picks of a list's runtime prompt by tab id. Temporary by design: never
   * saved, so a reload starts with nothing picked. Absent = nothing picked.
   */
  picks: Readonly<Record<string, number[]>>

  /** Sets a tab's prompt picks; an empty list clears them. */
  setPicks: (tabId: string, ids: readonly number[]) => void
}

export const useListWidgetStore = create<ListWidgetState>((set, get) => ({
  picks: {},

  setPicks(tabId, ids) {
    const next = { ...get().picks }
    if (ids.length > 0) next[tabId] = [...ids]
    else delete next[tabId]
    set({ picks: next })
  },
}))
