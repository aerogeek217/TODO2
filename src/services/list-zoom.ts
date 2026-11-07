import type { LensTab, ListZoom } from '../models/workspace-layout'
import { useSettingsStore } from '../stores/settings-store'
import { useUIStore } from '../stores/ui-store'
import { useWorkspaceStore } from '../stores/workspace-store'
import { attrSelector, LIST_WIDGET_ATTR } from '../utils/dom-contract'
import { stepListZoom, type ZoomDirection } from '../utils/list-zoom'
import { getTab } from '../utils/workspace-layout-ops'

/**
 * A list tab's zoom (D25 C + I1) as the controls change it — Ctrl + wheel
 * over the list, the tab menu's − / +, the palette's Zoom List In / Out.
 * A tab's zoom is view state: saved at once, never an unsaved layout edit.
 */

/** The level `tab` shows: its own pick, else Settings › Appearance › Default list zoom. */
export function listTabZoom(tab: Pick<LensTab, 'viewState'>, fallback: ListZoom = useSettingsStore.getState().listZoom): ListZoom {
  return tab.viewState?.zoom ?? fallback
}

/** Saves `zoom` as list tab `tabId`'s (view state: saved at once). */
export function setListTabZoom(tabId: string, zoom: ListZoom): Promise<void> {
  return useWorkspaceStore.getState().patchTabViewState(tabId, 'lens', { zoom })
}

/** The open layout's list tab `tabId`, if it is one. */
function lensTab(tabId: string): LensTab | null {
  const layout = useWorkspaceStore.getState().working
  const tab = layout ? getTab(layout, tabId) : undefined
  return tab?.kind === 'lens' ? tab : null
}

/** The list tabs on screen (their list widgets), in page order. */
function shownListTabIds(): string[] {
  return Array.from(document.querySelectorAll(attrSelector(LIST_WIDGET_ATTR)))
    .map((el) => el.getAttribute(LIST_WIDGET_ATTR) ?? '')
    .filter((id) => id !== '')
}

/**
 * The list tab the palette's zoom commands act on: the one last pressed or
 * focused in (`ui-store.activeListTabId`), else the one holding the
 * selection, else the first on screen — while it is on screen.
 */
export function zoomTargetTab(): LensTab | null {
  const shown = shownListTabIds()
  const ui = useUIStore.getState()
  const id = [ui.activeListTabId, ui.selectionScope, shown[0]].find((t) => t != null && shown.includes(t))
  return id ? lensTab(id) : null
}

/** Steps list tab `tabId`'s zoom one level `dir` (nothing past the ends). */
export function stepListTabZoom(tabId: string, dir: ZoomDirection): Promise<void> {
  const tab = lensTab(tabId)
  if (!tab) return Promise.resolve()
  const zoom = listTabZoom(tab)
  const next = stepListZoom(zoom, dir)
  return next === zoom ? Promise.resolve() : setListTabZoom(tabId, next)
}
