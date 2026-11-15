import { useContext } from 'react'
import type { ListTab } from '../../../models/workspace-layout'
import { listTabZoom, stepListTabZoom } from '../../../services/list-zoom'
import { useListWidgetStore } from '../../../stores/list-widget-store'
import { useSettingsStore } from '../../../stores/settings-store'
import { LIST_ZOOM_LABELS, stepListZoom } from '../../../utils/list-zoom'
import type { MenuEntry } from '../../shared/MenuPopover'
import { ListTabViewContext } from './list-tab-view'

/**
 * A list tab's menu item for its zoom (D25 C + I1): **Zoom − Rows +** — −
 * zooms out (towards Lines), + in (towards Stacked), each disabled at its
 * end; the menu stays open. Saved at once (view state) — on the layout's
 * tab, or where the list's view state is held (`ListTabViewContext`: the list
 * a Number follows, in the widget popup — the layout's tab of that id is the
 * Number, cr34 U3).
 */
export function useListZoomMenuEntries(tab: ListTab | undefined): MenuEntry[] {
  const setting = useSettingsStore((s) => s.listZoom)
  const host = useContext(ListTabViewContext)
  // The level the list shows (Auto resolved by its width): the stepper starts there.
  useListWidgetStore((s) => (tab ? s.zoom[tab.id] : undefined))
  if (!tab) return []
  const zoom = listTabZoom(tab, setting)
  const out = stepListZoom(zoom, 'out')
  const into = stepListZoom(zoom, 'in')
  return [{
    kind: 'stepper',
    label: 'Zoom',
    value: LIST_ZOOM_LABELS[zoom],
    decrementLabel: 'Zoom out',
    incrementLabel: 'Zoom in',
    onDecrement: out === zoom ? undefined : host ? () => host.patch({ zoom: out }) : () => void stepListTabZoom(tab, 'out'),
    onIncrement: into === zoom ? undefined : host ? () => host.patch({ zoom: into }) : () => void stepListTabZoom(tab, 'in'),
  }]
}
