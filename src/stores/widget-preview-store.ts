import { create } from 'zustand'

/**
 * The glance widgets' live preview while an editor is open (the Number's,
 * a chart's, Project pulse's): each tab's config as its editor holds it,
 * unsaved — the widget draws it in place of the stored one (as Edit list's
 * draft shows in its list) until Save writes it or Discard drops it. Never
 * in a layout, never kept across a reload.
 */
interface WidgetPreviewState {
  /** The edited config of each tab with an open editor that changed it, by tab id. */
  configs: Readonly<Record<string, object | undefined>>
  setPreview: (tabId: string, config: object) => void
  clearPreview: (tabId: string) => void
}

export const useWidgetPreviewStore = create<WidgetPreviewState>((set, get) => ({
  configs: {},

  setPreview(tabId, config) {
    if (get().configs[tabId] === config) return
    set({ configs: { ...get().configs, [tabId]: config } })
  },

  clearPreview(tabId) {
    const configs = get().configs
    if (!(tabId in configs)) return
    set({ configs: Object.fromEntries(Object.entries(configs).filter(([id]) => id !== tabId)) })
  },
}))
