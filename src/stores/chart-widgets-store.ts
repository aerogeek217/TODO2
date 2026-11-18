import { create } from 'zustand'
import { openOneEditor, registerEditorFields } from './editor-leave'

/**
 * The chart widgets' temporary state (D26 P8), never in a layout: the open
 * chart editor (beside its chart — `ChartEditorHost`) and Created vs
 * completed's (`TrendEditorHost`). One editor at a time, across every kind
 * (`editor-leave.openOneEditor`, which these fields are registered with).
 */
interface ChartWidgetsState {
  /** The chart tab whose editor is open. */
  editorTabId: string | null
  openEditor: (tabId: string) => void
  closeEditor: () => void
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
  s.closeTrendEditor()
})
