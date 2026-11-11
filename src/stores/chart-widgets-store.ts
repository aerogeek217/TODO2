import { create } from 'zustand'
import { afterLeavingEditors } from './editor-leave'

/**
 * The chart widgets' temporary state (D26 P8), never in a layout: the open
 * chart editor (one at a time, beside its chart — `ChartEditorHost`), and
 * Project pulse's open editor (G5, `PulseEditorHost`), one at a time like
 * the chart editor's.
 */
interface ChartWidgetsState {
  /** The chart tab whose editor is open. */
  editorTabId: string | null
  openEditor: (tabId: string) => void
  closeEditor: () => void
  // ── G5: Project pulse's editor ──
  /** The Project pulse tab whose editor is open. */
  pulseEditorTabId: string | null
  openPulseEditor: (tabId: string) => void
  closePulseEditor: () => void
}

export const useChartWidgetsStore = create<ChartWidgetsState>((set, get) => ({
  editorTabId: null,

  openEditor(tabId) {
    if (get().editorTabId === tabId) return
    // An editor with changes is asked first (`editor-leave`).
    afterLeavingEditors(() => set({ editorTabId: tabId }))
  },

  closeEditor() {
    if (get().editorTabId === null) return
    set({ editorTabId: null })
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
