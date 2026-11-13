import { create } from 'zustand'
import { openOneEditor, registerEditorFields } from './editor-leave'

/**
 * The chart widgets' temporary state (D26 P8), never in a layout: the open
 * chart editor (beside its chart — `ChartEditorHost`), and Project pulse's
 * open editor (G5, `PulseEditorHost`) and Created vs completed's
 * (`TrendEditorHost`). One editor at a time, across every kind
 * (`editor-leave.openOneEditor`, which these fields are registered with).
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
  // ── Created vs completed's editor ──
  /** The Created vs completed tab whose editor is open. */
  trendEditorTabId: string | null
  openTrendEditor: (tabId: string) => void
  closeTrendEditor: () => void
}

export const useChartWidgetsStore = create<ChartWidgetsState>((set, get) => ({
  editorTabId: null,

  openEditor(tabId) {
    if (get().editorTabId === tabId) return
    // An editor with changes is asked first, and any other closes (`editor-leave`).
    openOneEditor(() => set({ editorTabId: tabId }))
  },

  closeEditor() {
    if (get().editorTabId === null) return
    set({ editorTabId: null })
  },

  // ── G5: Project pulse's editor ──
  pulseEditorTabId: null,

  openPulseEditor(tabId) {
    if (get().pulseEditorTabId === tabId) return
    openOneEditor(() => set({ pulseEditorTabId: tabId }))
  },

  closePulseEditor() {
    if (get().pulseEditorTabId === null) return
    set({ pulseEditorTabId: null })
  },

  // ── Created vs completed's editor ──
  trendEditorTabId: null,

  openTrendEditor(tabId) {
    if (get().trendEditorTabId === tabId) return
    openOneEditor(() => set({ trendEditorTabId: tabId }))
  },

  closeTrendEditor() {
    if (get().trendEditorTabId === null) return
    set({ trendEditorTabId: null })
  },
}))

registerEditorFields(() => {
  const s = useChartWidgetsStore.getState()
  s.closeEditor()
  s.closePulseEditor()
  s.closeTrendEditor()
})
