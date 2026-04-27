import { useEffect, useRef, useState } from 'react'
import { useDndMonitor } from '@dnd-kit/core'
import { useCanvasRailsStore } from '../stores/canvas-rails-store'
import { useCanvasStore } from '../stores/canvas-store'
import { useSettingsStore } from '../stores/settings-store'
import { popTabAtPosition } from '../services/rail-pop-out'
import {
  decodeRailsDropId,
  encodeRailsDropId,
  pointerToFlowPosition,
  pointerToSplitZone,
  RAILS_DRAG_TYPE,
  type RailsDragData,
  type TabDropTarget,
} from '../utils/rail-dnd'
import { computeTabInsertIdx, describeDropZone, findSlotKind, findTabLabel } from '../utils/rail-dnd-monitor-helpers'
import { applyEmptySideCorners } from '../utils/rail-corner-claim'
import { dndLog } from '../utils/debug-flags'
import type { RailSide, Slot } from '../models/canvas-rails'

export interface RailsDragMonitorResult {
  draggingSlot: RailsDragData | null
  announcement: string
}

const ALL_SIDES: RailSide[] = ['left', 'right', 'top', 'bottom']

/**
 * Wires `useDndMonitor` to the rails store: routes slot/tab drag-end events to
 * the appropriate reducer (`dropSlotToSide`, `splitDropSlot`, `reorderTab`,
 * `moveTabToSlot`, `detachTabToNewSlot`) and dispatches corner ownership for
 * empty-side drops via `applyEmptySideCorners`. Tab releases over the canvas
 * pop the tab out as a free-floating widget (Phase 5 float-dock reverse path).
 *
 * Returns `{ draggingSlot, announcement }` for the parent to render the
 * `DockOverlay` + `aria-live` region.
 */
export function useRailsDragMonitor(): RailsDragMonitorResult {
  const [draggingSlot, setDraggingSlot] = useState<RailsDragData | null>(null)
  const [announcement, setAnnouncement] = useState<string>('')
  const pointerRef = useRef<{ x: number; y: number } | null>(null)
  // Holds the active pointer-listener cleanup between onDragStart and
  // onDragEnd/Cancel. A ref + an unmount effect covers the case where the dnd
  // provider unmounts mid-drag without firing end/cancel.
  const cleanupRef = useRef<(() => void) | null>(null)
  useEffect(() => () => { cleanupRef.current?.(); cleanupRef.current = null }, [])
  const dropSlotToSide = useCanvasRailsStore((s) => s.dropSlotToSide)
  const splitDropSlot = useCanvasRailsStore((s) => s.splitDropSlot)
  const reorderTab = useCanvasRailsStore((s) => s.reorderTab)
  const moveTabToSlot = useCanvasRailsStore((s) => s.moveTabToSlot)
  const detachTabToNewSlot = useCanvasRailsStore((s) => s.detachTabToNewSlot)
  const closeTab = useCanvasRailsStore((s) => s.closeTab)
  const setCornerOwner = useCanvasRailsStore((s) => s.setCornerOwner)
  const clearCornerOwner = useCanvasRailsStore((s) => s.clearCornerOwner)
  const rails = useCanvasRailsStore((s) => s.rails)

  useDndMonitor({
    onDragStart: ({ active }) => {
      const data = active.data.current as RailsDragData | undefined
      if (data?.type !== RAILS_DRAG_TYPE) {
        dndLog('rails-monitor.onDragStart.non-rails-drag', { activeId: active.id, dragType: data?.type ?? null })
        return
      }
      setDraggingSlot(data)
      if (data.kind === 'tab') {
        const label = findTabLabel(rails, data.slotId, data.tabId) ?? 'tab'
        dndLog('rails-monitor.onDragStart.tab', { slotId: data.slotId, tabId: data.tabId, fromSide: data.fromSide, label })
        setAnnouncement(`Dragging tab ${label}`)
      } else {
        const kind = findSlotKind(rails, data.slotId)
        dndLog('rails-monitor.onDragStart.slot', { slotId: data.slotId, fromSide: data.fromSide, kind: kind ?? null })
        setAnnouncement(`Dragging ${kind ?? 'slot'}`)
      }
      const onMove = (e: PointerEvent) => {
        pointerRef.current = { x: e.clientX, y: e.clientY }
      }
      window.addEventListener('pointermove', onMove)
      cleanupRef.current = () => {
        window.removeEventListener('pointermove', onMove)
        cleanupRef.current = null
      }
    },
    onDragEnd: ({ active, over }) => {
      const data = active.data.current as RailsDragData | undefined
      cleanupRef.current?.()
      if (data?.type !== RAILS_DRAG_TYPE) {
        dndLog('rails-monitor.onDragEnd.non-rails-drag', { activeId: active.id, overId: over?.id ?? null })
        setDraggingSlot(null); return
      }
      setDraggingSlot(null)
      if (!over) {
        dndLog('rails-monitor.onDragEnd.no-over', { kind: data.kind, slotId: data.slotId })
        setAnnouncement('Drop cancelled'); return
      }
      const zone = decodeRailsDropId(String(over.id))
      if (!zone) {
        dndLog('rails-monitor.onDragEnd.unknown-drop-id', { overId: over.id })
        setAnnouncement('Drop cancelled'); return
      }
      dndLog('rails-monitor.onDragEnd.resolved', {
        kind: data.kind,
        slotId: data.slotId,
        tabId: data.kind === 'tab' ? data.tabId : null,
        zoneKind: zone.kind,
      })
      setAnnouncement(`Dropped in ${describeDropZone(zone, rails)}`)

      if (data.kind === 'tab') {
        // Tab drag: route by drop zone kind.
        if (zone.kind === 'canvas') {
          // Phase 5 float-dock (reverse): pop the tab out to a free-floating
          // node at pointer position. Mirrors the menu pop-out flow, but uses
          // `pointerToFlowPosition` instead of `computePopOutFlowPosition` so
          // the widget lands under the cursor.
          const pointer = pointerRef.current
          if (!pointer) {
            dndLog('rails-monitor.canvas.abort.no-pointer', { slotId: data.slotId, tabId: data.tabId })
            return
          }
          const canvasEl = document.querySelector<HTMLElement>(
            `[data-rails-drop-id="${encodeRailsDropId({ kind: 'canvas' })}"]`,
          )
          if (!canvasEl) {
            dndLog('rails-monitor.canvas.abort.no-canvas-el', { slotId: data.slotId, tabId: data.tabId })
            return
          }
          // P5 fix: `canvasViewport` is null until the user pans/zooms (it's
          // populated by React Flow's `onViewportChange`, which doesn't fire
          // on initial render). Without a fallback, the pop-out path silently
          // aborts on a fresh canvas — fall back to identity so the widget
          // still lands under the cursor in flow coords (= canvas coords when
          // no transform has been applied).
          const vp = useSettingsStore.getState().canvasViewport ?? { x: 0, y: 0, zoom: 1 }
          const srcSlot = ALL_SIDES
            .map((s) => rails[s]?.slots.find((sl) => sl.id === data.slotId))
            .find((s): s is Slot => Boolean(s))
          if (!srcSlot) {
            dndLog('rails-monitor.canvas.abort.no-src-slot', { slotId: data.slotId })
            return
          }
          const srcTab = srcSlot.tabs.find((t) => t.id === data.tabId)
          if (!srcTab) {
            dndLog('rails-monitor.canvas.abort.no-src-tab', { slotId: data.slotId, tabId: data.tabId })
            return
          }
          const canvasId = useCanvasStore.getState().selectedCanvasId
          if (canvasId == null) {
            dndLog('rails-monitor.canvas.abort.no-canvas-id', { slotId: data.slotId, tabId: data.tabId })
            return
          }
          const canvasRect = canvasEl.getBoundingClientRect()
          const pos = pointerToFlowPosition(
            pointer,
            { left: canvasRect.left, top: canvasRect.top },
            { x: vp.x, y: vp.y, zoom: vp.zoom },
          )
          dndLog('rails-monitor.canvas.popout', {
            slotId: data.slotId, tabId: data.tabId, tabType: srcTab.type, pos,
          })
          void popTabAtPosition(srcTab, canvasId, pos.x, pos.y, {
            orientation: srcSlot.orientation,
            weekOffset: srcSlot.weekOffset,
          }).then((moved) => {
            if (moved) closeTab(data.slotId, data.tabId)
          })
          return
        }
        if (zone.kind === 'tab-strip') {
          const pointer = pointerRef.current
          const stripEl = document.querySelector(`[data-rails-drop-id="${String(over.id)}"]`)
          let insertIdx = 0
          if (pointer && stripEl) {
            insertIdx = computeTabInsertIdx(stripEl, pointer.x, data.tabId)
          }
          if (zone.slotId === data.slotId) {
            reorderTab(data.slotId, data.tabId, insertIdx)
          } else {
            moveTabToSlot(data.slotId, data.tabId, zone.slotId, insertIdx)
          }
          return
        }
        // Tab dropped onto a slot-level zone → detach to a new slot.
        if (zone.kind === 'empty-side') {
          detachTabToNewSlot(data.slotId, data.tabId, { kind: 'empty-side', side: zone.side })
          applyEmptySideCorners(zone.side, zone.claim, { setCornerOwner, clearCornerOwner })
        } else if (zone.kind === 'slot') {
          const pointer = pointerRef.current
          const rect = over.rect
          if (!pointer || !rect) return
          let orientation: 'vertical' | 'horizontal' = 'vertical'
          for (const side of ALL_SIDES) {
            const rail = rails[side]
            if (!rail) continue
            if (rail.slots.some((s) => s.id === zone.slotId)) {
              orientation = rail.orientation
              break
            }
          }
          const splitZone = pointerToSplitZone(pointer, {
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
          }, orientation)
          // Same-slot drop: only a split-edge quadrant splits the tab off into
          // a new adjacent slot. A center drop on own body is a no-op (would
          // otherwise try to merge the tab back into itself).
          if (zone.slotId === data.slotId) {
            if (splitZone === 'center') return
            // Single-tab source → detaching would remove the source before
            // placing relative to it; skip rather than losing the tab.
            const srcLoc = ALL_SIDES
              .map((s) => rails[s]?.slots.find((sl) => sl.id === data.slotId))
              .find(Boolean)
            if (!srcLoc || srcLoc.tabs.length <= 1) return
            const target: TabDropTarget = { kind: 'slot', slotId: zone.slotId, zone: splitZone }
            detachTabToNewSlot(data.slotId, data.tabId, target)
            return
          }
          // Center on another slot → merge as tab into that slot's strip (resolved decision).
          if (splitZone === 'center') {
            const dest = rails[ALL_SIDES.find((side) => rails[side]?.slots.some((s) => s.id === zone.slotId)) ?? 'right']
            const insertIdx = dest?.slots.find((s) => s.id === zone.slotId)?.tabs.length ?? 0
            moveTabToSlot(data.slotId, data.tabId, zone.slotId, insertIdx)
            return
          }
          const target: TabDropTarget = { kind: 'slot', slotId: zone.slotId, zone: splitZone }
          detachTabToNewSlot(data.slotId, data.tabId, target)
        }
        return
      }

      // Slot drag (existing behavior, unchanged).
      if (zone.kind === 'empty-side') {
        dndLog('rails-monitor.slot.empty-side', { slotId: data.slotId, side: zone.side, claim: zone.claim ?? null })
        dropSlotToSide(data.slotId, zone.side)
        applyEmptySideCorners(zone.side, zone.claim, { setCornerOwner, clearCornerOwner })
      } else if (zone.kind === 'slot') {
        const pointer = pointerRef.current
        const rect = over.rect
        if (!pointer || !rect) {
          dndLog('rails-monitor.slot.abort.no-pointer-or-rect', {
            slotId: data.slotId, targetSlotId: zone.slotId, hasPointer: pointer != null, hasRect: rect != null,
          })
          return
        }
        let orientation: 'vertical' | 'horizontal' = 'vertical'
        for (const side of ALL_SIDES) {
          const rail = rails[side]
          if (!rail) continue
          if (rail.slots.some((s) => s.id === zone.slotId)) {
            orientation = rail.orientation
            break
          }
        }
        const splitZone = pointerToSplitZone(pointer, {
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
        }, orientation)
        dndLog('rails-monitor.slot.split-drop', {
          slotId: data.slotId, targetSlotId: zone.slotId, splitZone, orientation,
        })
        splitDropSlot(data.slotId, zone.slotId, splitZone)
      }
      // Slot drag onto a tab-strip drop zone is intentionally ignored — slots
      // don't merge into other slots' strips (that'd be a destructive op).
    },
    onDragCancel: () => {
      cleanupRef.current?.()
      setDraggingSlot(null)
      setAnnouncement('Drop cancelled')
    },
  })

  return { draggingSlot, announcement }
}
