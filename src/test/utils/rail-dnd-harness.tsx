/**
 * Test harness for canvas rails drag/dock flow.
 *
 * Two entry points:
 *   - `simulateDrop(sourceSlotId, zone, …)` — dispatches the same store
 *     action `useRailsDragMonitor.onDragEnd` would, without going through
 *     dnd-kit. Useful for reducer-focused tests.
 *   - `dragSlot(sourceSlotId, target)` — drives real `pointerdown` →
 *     `pointermove` → `pointerup` events through the `DndContext`'s
 *     `PointerSensor`. A layout-aware rect resolver lets dnd-kit's
 *     collision detection run against deterministic coordinates in jsdom.
 *
 * Layout model. The resolver reads an element's data-attributes to decide
 * its rect:
 *   `data-rail-side` → rails (`<aside>`)
 *   `data-slot-id`   → slot wrappers (draggable + droppable)
 *   `data-drop-id`   → edge drops + DockOverlay empty-side zones
 * Rects are laid out from a single `RailsLayout` so the test expresses
 * intent ("top rail is 1320×260") rather than numbers per element.
 */

import { render, type RenderResult, act, fireEvent } from '@testing-library/react'
import { DndContext, pointerWithin, type CollisionDetection } from '@dnd-kit/core'
import type { RailSide, RailsState } from '../../models/canvas-rails'
import { useCanvasRailsStore } from '../../stores/canvas-rails-store'
import { useListDefinitionStore } from '../../stores/list-definition-store'
import { RailsFrame } from '../../components/canvas/rails/RailsFrame'
import {
  decodeRailsDropId,
  encodeRailsDropId,
  isRailsDropId,
  pointerToSplitZone,
  RAILS_DRAG_TYPE,
  type RailsDropZone,
  type SplitZone,
} from '../../components/canvas/rails/rail-dnd'
import { installBoundingRectMock, type RectResolver } from './bounding-rect-mock'

export interface TestRect {
  left: number
  top: number
  width: number
  height: number
}

export interface RailsLayout {
  left?: TestRect
  right?: TestRect
  top?: TestRect
  bottom?: TestRect
  /** Canvas host rect — parent for the DockOverlay empty-side zones. */
  canvasHost?: TestRect
}

const DEFAULT_LAYOUT: Required<RailsLayout> = {
  // 2000×900 viewport.
  left: { left: 0, top: 0, width: 340, height: 900 },
  right: { left: 1660, top: 0, width: 340, height: 900 },
  top: { left: 340, top: 0, width: 1320, height: 260 },
  bottom: { left: 340, top: 640, width: 1320, height: 260 },
  canvasHost: { left: 340, top: 260, width: 1320, height: 380 },
}

const EDGE_PX = 14

export type DragTarget =
  | { kind: 'empty-side'; side: RailSide }
  | { kind: 'edge'; side: RailSide; edge: 'head' | 'tail' }
  | { kind: 'slot'; slotId: string; quadrant?: 'upper' | 'lower' | 'left' | 'right' | 'center' }
  | { kind: 'cancel' }

export interface RailsHarness {
  getRails: () => RailsState
  getRenderedSlotIds: () => string[]
  getDroppableZones: () => RailsDropZone[]
  simulateDrop: (
    sourceSlotId: string,
    zone: RailsDropZone,
    opts?: {
      pointer?: { x: number; y: number }
      rect?: { left: number; top: number; width: number; height: number }
      orientation?: 'vertical' | 'horizontal'
    },
  ) => void
  dragSlot: (sourceSlotId: string, target: DragTarget, opts?: { layout?: RailsLayout }) => Promise<void>
  result: RenderResult
  cleanup: () => void
}

export async function setupRailsHarness(initial: RailsState): Promise<RailsHarness> {
  useCanvasRailsStore.setState({ rails: initial, hydrated: true, pendingFocusSlotId: null })
  useListDefinitionStore.setState((s) => ({
    ...s,
    listDefinitions: s.listDefinitions.length > 0 ? s.listDefinitions : [],
  }))

  // Install rect mock up front so elements that mount later (edge drops,
  // DockOverlay) resolve to real rects the moment they register with dnd-kit.
  const restoreRects = installBoundingRectMock(makeDefaultResolver(DEFAULT_LAYOUT))

  // Mirror CanvasPage's production collision detection: pointerWithin
  // filtered to rails droppables. Default rectIntersection would favor the
  // source slot's own droppable (translated active rect still overlaps it
  // at small pointer deltas), making near-source drops no-op.
  const railsCollisionDetection: CollisionDetection = (args) => {
    const type = args.active?.data.current?.type
    const hits = pointerWithin(args)
    if (type === RAILS_DRAG_TYPE) return hits.filter((h) => isRailsDropId(String(h.id)))
    return hits.filter((h) => !isRailsDropId(String(h.id)))
  }

  const result = render(
    <DndContext collisionDetection={railsCollisionDetection}>
      <RailsFrame>
        <div data-testid="canvas-host" />
      </RailsFrame>
    </DndContext>,
  )
  await act(async () => { await Promise.resolve() })

  const getRails = () => useCanvasRailsStore.getState().rails

  const getRenderedSlotIds = () => {
    const els = document.querySelectorAll('[data-slot-id]')
    return Array.from(els).map((el) => (el as HTMLElement).dataset.slotId!).filter(Boolean)
  }

  const getDroppableZones = (): RailsDropZone[] => {
    const rails = useCanvasRailsStore.getState().rails
    const zones: RailsDropZone[] = []
    for (const side of ['left', 'right', 'top', 'bottom'] as const) {
      const rail = rails[side]
      if (!rail) {
        zones.push({ kind: 'empty-side', side })
        continue
      }
      zones.push({ kind: 'edge', side, edge: 'head' })
      zones.push({ kind: 'edge', side, edge: 'tail' })
      for (const slot of rail.slots) {
        zones.push({ kind: 'slot', slotId: slot.id })
      }
    }
    return zones.filter((z) => {
      const encoded = encodeRailsDropId(z)
      const decoded = decodeRailsDropId(encoded)
      return decoded !== null && decoded.kind === z.kind
    })
  }

  const simulateDrop: RailsHarness['simulateDrop'] = (sourceSlotId, zone, opts) => {
    const store = useCanvasRailsStore.getState()
    if (zone.kind === 'empty-side') {
      store.dropSlotToSide(sourceSlotId, zone.side)
      return
    }
    if (zone.kind === 'edge') {
      store.edgeDropSlot(sourceSlotId, zone.side, zone.edge)
      return
    }
    const pointer = opts?.pointer ?? { x: 0, y: 0 }
    const rect = opts?.rect ?? { left: 0, top: 0, width: 100, height: 100 }
    const orientation = opts?.orientation ?? 'vertical'
    const splitZone: SplitZone = pointerToSplitZone(pointer, rect, orientation)
    store.splitDropSlot(sourceSlotId, zone.slotId, splitZone)
  }

  const dragSlot: RailsHarness['dragSlot'] = async (sourceSlotId, target, opts) => {
    const layout = { ...DEFAULT_LAYOUT, ...(opts?.layout ?? {}) }
    // Swap resolver if the caller overrode the layout. Same mock patch, new
    // resolver — no need to re-install.
    installBoundingRectMock(makeDefaultResolver(layout))

    const sourceEl = document.querySelector<HTMLElement>(`[data-slot-id="${sourceSlotId}"]`)
    if (!sourceEl) throw new Error(`dragSlot: source slot ${sourceSlotId} not rendered`)
    const handle = sourceEl.querySelector<HTMLElement>('[aria-label^="Reorder slot:"]')
    if (!handle) throw new Error(`dragSlot: drag handle for slot ${sourceSlotId} not found`)

    const srcRect = sourceEl.getBoundingClientRect()
    const srcCenter = { x: srcRect.left + srcRect.width / 2, y: srcRect.top + srcRect.height / 2 }

    await act(async () => {
      fireEvent.pointerDown(handle, {
        clientX: srcCenter.x,
        clientY: srcCenter.y,
        pointerId: 1,
        isPrimary: true,
        button: 0,
        bubbles: true,
      })
      await Promise.resolve()
    })

    const moveCoord = computeTargetPoint(target, layout)

    await act(async () => {
      fireEvent.pointerMove(document, {
        clientX: moveCoord.x,
        clientY: moveCoord.y,
        pointerId: 1,
        isPrimary: true,
        bubbles: true,
      })
      await Promise.resolve()
    })

    await act(async () => {
      fireEvent.pointerUp(document, {
        clientX: moveCoord.x,
        clientY: moveCoord.y,
        pointerId: 1,
        isPrimary: true,
        bubbles: true,
      })
      await Promise.resolve()
    })
  }

  return {
    getRails,
    getRenderedSlotIds,
    getDroppableZones,
    simulateDrop,
    dragSlot,
    result,
    cleanup: () => {
      result.unmount()
      restoreRects()
    },
  }
}

export function resetRailsStore() {
  useCanvasRailsStore.setState({
    rails: { left: null, right: null, top: null, bottom: null },
    hydrated: false,
    pendingFocusSlotId: null,
  })
}

// ── Layout resolver ────────────────────────────────────────────────────────

function makeDefaultResolver(layout: Required<RailsLayout>): RectResolver {
  return (el) => {
    const dropId = el.dataset.dropId
    if (dropId) {
      const decoded = decodeRailsDropId(dropId)
      if (decoded) return rectForZone(decoded, layout)
    }
    const side = el.dataset.railSide as RailSide | undefined
    if (side) return layout[side]
    const slotId = el.dataset.slotId
    if (slotId) return rectForSlot(slotId, layout)
    return null
  }
}

function rectForZone(zone: RailsDropZone, layout: Required<RailsLayout>): TestRect | null {
  if (zone.kind === 'empty-side') return layout[zone.side]
  if (zone.kind === 'edge') {
    const r = layout[zone.side]
    const rails = useCanvasRailsStore.getState().rails
    const orientation = rails[zone.side]?.orientation
      ?? (zone.side === 'left' || zone.side === 'right' ? 'vertical' : 'horizontal')
    if (orientation === 'vertical') {
      return zone.edge === 'head'
        ? { left: r.left, top: r.top, width: r.width, height: EDGE_PX }
        : { left: r.left, top: r.top + r.height - EDGE_PX, width: r.width, height: EDGE_PX }
    }
    return zone.edge === 'head'
      ? { left: r.left, top: r.top, width: EDGE_PX, height: r.height }
      : { left: r.left + r.width - EDGE_PX, top: r.top, width: EDGE_PX, height: r.height }
  }
  return rectForSlot(zone.slotId, layout)
}

function rectForSlot(slotId: string, layout: Required<RailsLayout>): TestRect | null {
  const rails = useCanvasRailsStore.getState().rails
  for (const side of ['left', 'right', 'top', 'bottom'] as RailSide[]) {
    const rail = rails[side]
    if (!rail) continue
    const idx = rail.slots.findIndex((s) => s.id === slotId)
    if (idx === -1) continue
    const railRect = layout[side]
    const n = rail.slots.length
    if (rail.orientation === 'vertical') {
      const h = railRect.height / n
      return { left: railRect.left, top: railRect.top + idx * h, width: railRect.width, height: h }
    }
    const w = railRect.width / n
    return { left: railRect.left + idx * w, top: railRect.top, width: w, height: railRect.height }
  }
  return null
}

function computeTargetPoint(target: DragTarget, layout: Required<RailsLayout>): { x: number; y: number } {
  if (target.kind === 'cancel') {
    // Deep off-screen negative — the active rect translated this far overlaps
    // no rail/drop-zone in any reasonable layout.
    return { x: -10_000, y: -10_000 }
  }
  if (target.kind === 'empty-side') {
    const r = layout[target.side]
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  }
  if (target.kind === 'edge') {
    const rect = rectForZone({ kind: 'edge', side: target.side, edge: target.edge }, layout)!
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
  }
  const rect = rectForSlot(target.slotId, layout)
  if (!rect) throw new Error(`dragSlot: target slot ${target.slotId} not in rails state`)
  const cx = rect.left + rect.width / 2
  const cy = rect.top + rect.height / 2
  const q = target.quadrant ?? 'center'
  if (q === 'upper') return { x: cx, y: rect.top + rect.height * 0.1 }
  if (q === 'lower') return { x: cx, y: rect.top + rect.height * 0.9 }
  if (q === 'left') return { x: rect.left + rect.width * 0.1, y: cy }
  if (q === 'right') return { x: rect.left + rect.width * 0.9, y: cy }
  return { x: cx, y: cy }
}
