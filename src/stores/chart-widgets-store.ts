import { create } from 'zustand'
import type { BreakdownSplit } from '../models/chart-widgets'

/**
 * The chart widgets' temporary state (D26 P8), never in a layout: the open
 * chart editor (one at a time, beside its chart — `ChartEditorHost`), and
 * each Breakdown's filter-row picks (per tab and split; a reload clears
 * them).
 */
interface ChartWidgetsState {
  /** The chart tab whose editor is open. */
  editorTabId: string | null
  /** Each Breakdown tab's filter-row picks, by split: the rows' keys, in pick order. */
  rowPicks: Readonly<Record<string, Partial<Record<BreakdownSplit, readonly string[]>> | undefined>>
  openEditor: (tabId: string) => void
  closeEditor: () => void
  setRowPicks: (tabId: string, split: BreakdownSplit, keys: readonly string[]) => void
}

export const useChartWidgetsStore = create<ChartWidgetsState>((set, get) => ({
  editorTabId: null,
  rowPicks: {},

  openEditor(tabId) {
    set({ editorTabId: tabId })
  },

  closeEditor() {
    if (get().editorTabId === null) return
    set({ editorTabId: null })
  },

  setRowPicks(tabId, split, keys) {
    const rowPicks = get().rowPicks
    set({ rowPicks: { ...rowPicks, [tabId]: { ...rowPicks[tabId], [split]: keys } } })
  },
}))
