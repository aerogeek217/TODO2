import type { ListZoom } from '../../../models/workspace-layout'
import { stepListZoom } from '../../../utils/list-zoom'

/** Wheel travel (px) that steps the zoom one level: one notch of a mouse wheel; a trackpad pinch gathers it. */
export const ZOOM_WHEEL_STEP_PX = 50
/** A pause this long (ms) starts the gathering afresh. */
const ZOOM_WHEEL_IDLE_MS = 300
/** One line of a line-mode wheel, px. */
const WHEEL_LINE_PX = 16

/**
 * Ctrl + wheel over `el` (a list's body) steps its zoom (D25 I1): up / a
 * pinch out zooms in (towards Stacked), down zooms out. The event's default
 * — the browser's page zoom — is prevented, so the page never scales. The
 * travel is gathered until it makes a step (`ZOOM_WHEEL_STEP_PX`), one level
 * per step, clamped at the ends. `current` reads the list's level now
 * (`null`: no zooming here, e.g. on a phone — the wheel is left alone).
 * Returns the listener's removal.
 */
export function zoomOnCtrlWheel(
  el: HTMLElement,
  current: () => ListZoom | null,
  onZoom: (zoom: ListZoom) => void,
): () => void {
  let travel = 0
  let last = -Infinity
  const onWheel = (e: WheelEvent) => {
    if (!e.ctrlKey) return
    const zoom = current()
    if (zoom == null) return
    e.preventDefault()
    if (e.timeStamp - last > ZOOM_WHEEL_IDLE_MS) travel = 0
    last = e.timeStamp
    travel += e.deltaMode === WheelEvent.DOM_DELTA_LINE ? e.deltaY * WHEEL_LINE_PX : e.deltaY
    if (Math.abs(travel) < ZOOM_WHEEL_STEP_PX) return
    const next = stepListZoom(zoom, travel < 0 ? 'in' : 'out')
    travel = 0
    if (next !== zoom) onZoom(next)
  }
  // Not passive: `preventDefault` keeps the browser from zooming the page.
  el.addEventListener('wheel', onWheel, { passive: false })
  return () => el.removeEventListener('wheel', onWheel)
}
