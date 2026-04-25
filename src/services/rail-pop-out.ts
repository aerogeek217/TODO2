import { useCanvasStore } from '../stores/canvas-store'
import { useFloatingCalendarStore } from '../stores/floating-calendar-store'
import { useFloatingHorizonsStore } from '../stores/floating-horizons-store'
import { useFloatingNoteStore } from '../stores/floating-note-store'
import { useFloatingTaskboardStore } from '../stores/floating-taskboard-store'
import { useListInsetStore } from '../stores/list-inset-store'
import { useSettingsStore } from '../stores/settings-store'
import type { CalendarOrientation, Slot, Tab } from '../models/canvas-rails'

/**
 * Compute a flow-space position in the upper-left of the current viewport for
 * placing a popped-out node. Reads the persisted viewport from settings; if
 * absent (fresh install), falls back to origin. Adds a small random jitter so
 * successive pop-outs don't stack perfectly on top of each other.
 */
export function computePopOutFlowPosition(): { x: number; y: number } {
  const vp = useSettingsStore.getState().canvasViewport
  const baseX = vp ? -vp.x / vp.zoom : 50
  const baseY = vp ? -vp.y / vp.zoom : 50
  const jitterX = Math.round(Math.random() * 40)
  const jitterY = Math.round(Math.random() * 40)
  return { x: baseX + 40 + jitterX, y: baseY + 40 + jitterY }
}

/**
 * Pure pop-out dispatcher: given a tab, a canvas id, and a flow-space
 * position, create the corresponding floating widget and return whether the
 * caller should follow up with `closeTab`. Resolves to `false` for no-op
 * cases (lens tab without a list definition). The `init` opts only apply to
 * calendar tabs — they thread slot-level orientation/weekOffset so the user's
 * strip orientation survives tab → float (the reverse of `slotFromFloat`'s
 * threading for the float → slot direction).
 *
 * Two call paths:
 *   - Menu pop-out (`popTabToCanvas` / `popSlotToCanvas`) uses
 *     `computePopOutFlowPosition()` for upper-left-of-viewport placement.
 *   - Drag pop-out (Phase 5 of float-dock, dispatched from
 *     `useRailsDragMonitor`) uses `pointerToFlowPosition` so the widget lands
 *     near the cursor.
 */
export async function popTabAtPosition(
  tab: Tab,
  canvasId: number,
  x: number,
  y: number,
  init?: { orientation?: CalendarOrientation; weekOffset?: number },
): Promise<boolean> {
  if (tab.type === 'notes') {
    await useFloatingNoteStore.getState().add(canvasId, x, y)
    return true
  }
  if (tab.type === 'lens') {
    if (tab.listDefinitionId == null) return false
    await useListInsetStore.getState().add(tab.listDefinitionId, canvasId, x, y)
    return true
  }
  if (tab.type === 'calendar') {
    await useFloatingCalendarStore.getState().add(canvasId, x, y, {
      orientation: init?.orientation,
      weekOffset: init?.weekOffset,
    })
    return true
  }
  if (tab.type === 'taskboard') {
    await useFloatingTaskboardStore.getState().add(canvasId, x, y)
    return true
  }
  if (tab.type === 'horizons') {
    await useFloatingHorizonsStore.getState().add(canvasId, x, y)
    return true
  }
  return false
}

/**
 * Pop one tab out of a rail slot to the canvas as a free-floating node.
 * Resolves to true when a node was created (and the caller should remove the
 * tab via `closeTab`), false if the operation was a no-op (no canvas selected
 * / lens without a list definition / tabId not found in slot).
 */
export async function popTabToCanvas(slot: Slot, tabId: string): Promise<boolean> {
  const tab = slot.tabs.find((t) => t.id === tabId)
  if (!tab) return false
  const canvasId = useCanvasStore.getState().selectedCanvasId
  if (canvasId == null) return false
  const pos = computePopOutFlowPosition()
  return popTabAtPosition(tab, canvasId, pos.x, pos.y, {
    orientation: slot.orientation,
    weekOffset: slot.weekOffset,
  })
}

/**
 * Pop the slot's active tab out to the canvas. Retained as a thin wrapper
 * over `popTabToCanvas` so existing callers keep working; new code that
 * targets a specific tab should call `popTabToCanvas` directly.
 */
export function popSlotToCanvas(slot: Slot): Promise<boolean> {
  return popTabToCanvas(slot, slot.activeTabId)
}
