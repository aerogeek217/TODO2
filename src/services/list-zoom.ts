import type { LensTab, ListZoom } from '../models/workspace-layout'
import { useListWidgetStore } from '../stores/list-widget-store'
import { useSettingsStore } from '../stores/settings-store'
import { useUIStore } from '../stores/ui-store'
import { useWorkspaceStore } from '../stores/workspace-store'
import { attrSelector, LIST_WIDGET_ATTR } from '../utils/dom-contract'
import { defaultListZoom, stepListZoom, type ListZoomSetting, type ZoomDirection } from '../utils/list-zoom'
import { getTab } from '../utils/workspace-layout-queries'

/**
 * A list tab's zoom (D25 C + I1) as the controls change it — Ctrl + wheel
 * over the list, the tab menu's − / +, the palette's Zoom List In / Out.
 * A tab's zoom is view state: saved at once, never an unsaved layout edit.
 */

/**
 * The level `tab` shows — the one every zoom control steps from: its own
 * pick, else the level its widget shows now
 * (`list-widget-store.zoom`: Settings › Appearance › Default list zoom, Auto
 * resolved by the list's width), else that default (Auto unmeasured: Rows).
 */
export function listTabZoom(
  tab: Pick<LensTab, 'id' | 'viewState'>,
  setting: ListZoomSetting = useSettingsStore.getState().listZoom,
): ListZoom {
  return tab.viewState?.zoom ?? useListWidgetStore.getState().zoom[tab.id] ?? defaultListZoom(setting)
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

/**
 * Steps a list tab's zoom one level `dir` (nothing past the ends) — every
 * control's step (the wheel, the tab menu's − / +, the palette): `tab` as
 * the control shows it, or the open layout's list tab of that id.
 */
export function stepListTabZoom(tab: string | Pick<LensTab, 'id' | 'viewState'>, dir: ZoomDirection): Promise<void> {
  const shown = typeof tab === 'string' ? lensTab(tab) : tab
  if (!shown) return Promise.resolve()
  const zoom = listTabZoom(shown)
  const next = stepListZoom(zoom, dir)
  return next === zoom ? Promise.resolve() : setListTabZoom(shown.id, next)
}
