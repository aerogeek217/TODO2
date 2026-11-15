import { create } from 'zustand'

/** The edited configs by tab id: a record with no prototype (see `WidgetPreviewState.configs`). */
type PreviewConfigs = Readonly<Record<string, object | undefined>>

/** `entries` as a record with no prototype: only the tab ids put in it read back. */
function previewConfigs(entries: Iterable<readonly [string, object | undefined]>): PreviewConfigs {
  const out = Object.create(null) as Record<string, object | undefined>
  for (const [tabId, config] of entries) out[tabId] = config
  return out
}

/**
 * The glance widgets' live preview while an editor is open (the Number's,
 * a chart's, Project pulse's): each tab's config as its editor holds it,
 * unsaved — the widget draws it in place of the stored one (as Edit list's
 * draft shows in its list) until Save writes it or Discard drops it. Never
 * in a layout, never kept across a reload.
 */
interface WidgetPreviewState {
  /**
   * The edited config of each tab with an open editor that changed it, by
   * tab id. A record **with no prototype**, so `configs[tabId]` is an own
   * read: a tab id naming an `Object.prototype` member (`constructor`,
   * `toString`, `__proto__`) reads `undefined`, never the inherited member —
   * which a widget took for its preview and threw on (cr34 S2).
   */
  configs: PreviewConfigs
  setPreview: (tabId: string, config: object) => void
  clearPreview: (tabId: string) => void
}

export const useWidgetPreviewStore = create<WidgetPreviewState>((set, get) => ({
  configs: previewConfigs([]),

  setPreview(tabId, config) {
    const configs = get().configs
    if (configs[tabId] === config) return
    set({ configs: previewConfigs([...Object.entries(configs), [tabId, config]]) })
  },

  clearPreview(tabId) {
    const configs = get().configs
    if (!Object.hasOwn(configs, tabId)) return
    set({ configs: previewConfigs(Object.entries(configs).filter(([id]) => id !== tabId)) })
  },
}))
