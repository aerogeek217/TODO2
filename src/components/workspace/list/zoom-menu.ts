import type { LensTab } from '../../../models/workspace-layout'
import { listTabZoom, stepListTabZoom } from '../../../services/list-zoom'
import { useSettingsStore } from '../../../stores/settings-store'
import { LIST_ZOOM_LABELS, stepListZoom } from '../../../utils/list-zoom'
import type { MenuEntry } from '../../shared/MenuPopover'

/**
 * A list tab's menu item for its zoom (D25 C + I1): **Zoom − Rows +** — −
 * zooms out (towards Lines), + in (towards Stacked), each disabled at its
 * end; the menu stays open. Saved at once (view state).
 */
export function useListZoomMenuEntries(tab: LensTab | undefined): MenuEntry[] {
  const fallback = useSettingsStore((s) => s.listZoom)
  if (!tab) return []
  const zoom = listTabZoom(tab, fallback)
  const out = stepListZoom(zoom, 'out')
  const into = stepListZoom(zoom, 'in')
  return [{
    kind: 'stepper',
    label: 'Zoom',
    value: LIST_ZOOM_LABELS[zoom],
    decrementLabel: 'Zoom out',
    incrementLabel: 'Zoom in',
    onDecrement: out !== zoom ? () => void stepListTabZoom(tab, 'out') : undefined,
    onIncrement: into !== zoom ? () => void stepListTabZoom(tab, 'in') : undefined,
  }]
}
