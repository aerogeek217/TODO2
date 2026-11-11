import { create } from 'zustand'
import { afterLeavingEditors } from './editor-leave'
import type { BreakdownSplit } from '../models/chart-widgets'

/**
 * The chart widgets' temporary state (D26 P8), never in a layout: the open
 * chart editor (one at a time, beside its chart — `ChartEditorHost`), and
 * each Breakdown's filter-row picks (per tab and split; a reload clears
 * them). Also Project pulse's open editor (G5, `PulseEditorHost`), one at a
 * time like the chart editor's.
 */
interface ChartWidgetsState {
  /** The chart tab whose editor is open. */
  editorTabId: string | null
  /** Each Breakdown tab's filter-row picks, by split: the rows' keys, in pick order. */
  rowPicks: Readonly<Record<string, Partial<Record<BreakdownSplit, readonly string[]>> | undefined>>
  openEditor: (tabId: string) => void
  closeEditor: () => void
  setRowPicks: (tabId: string, split: BreakdownSplit, keys: readonly string[]) => void
  // ── G5: Project pulse's editor ──
  /** The Project pulse tab whose editor is open. */
  pulseEditorTabId: string | null
  openPulseEditor: (tabId: string) => void
  closePulseEditor: () => void
}

export const useChartWidgetsStore = create<ChartWidgetsState>((set, get) => ({
  editorTabId: null,
  rowPicks: {},

  openEditor(tabId) {
    if (get().editorTabId === tabId) return
    // An editor with changes is asked first (`editor-leave`).
    afterLeavingEditors(() => set({ editorTabId: tabId }))
  },

  closeEditor() {
    if (get().editorTabId === null) return
    set({ editorTabId: null })
  },

  setRowPicks(tabId, split, keys) {
    const rowPicks = get().rowPicks
    set({ rowPicks: { ...rowPicks, [tabId]: { ...rowPicks[tabId], [split]: keys } } })
  },

  // ── G5: Project pulse's editor ──
  pulseEditorTabId: null,

  openPulseEditor(tabId) {
    if (get().pulseEditorTabId === tabId) return
    afterLeavingEditors(() => set({ pulseEditorTabId: tabId }))
  },

  closePulseEditor() {
    if (get().pulseEditorTabId === null) return
    set({ pulseEditorTabId: null })
  },
}))
