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
 *   `data-rail-side`      → rails (`<aside>`)
 *   `data-slot-id`        → slot wrappers (draggable + droppable)
 *   `data-rails-drop-id`  → DockOverlay empty-side zones + slot/tab-strip drop zones
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
} from '../../utils/rail-dnd'
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

export type DragTarget =
  | { kind: 'empty-side'; side: RailSide; claim?: 'start' | 'end' }
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

  // Install rect mock up front so elements that mount later (DockOverlay)
  // resolve to real rects the moment they register with dnd-kit.
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
    // `tab-strip` and `canvas` zones aren't slot-drag targets — the harness's
    // `simulateDrop` models the slot-drag reducer path only, so they're no-ops.
    if (zone.kind === 'tab-strip' || zone.kind === 'canvas') return
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
    const dropId = el.dataset.railsDropId
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
  if (zone.kind === 'empty-side') return rectForEmptySideSubzone(zone.side, zone.claim, layout)
  // The `canvas` drop zone lives on the React Flow area, not in the rails
  // frame — the harness doesn't render it, so treat as non-resolvable here.
  if (zone.kind === 'canvas') return null
  const slotRect = rectForSlot(zone.slotId, layout)
  if (!slotRect) return null
  // Tab strip is a narrow band at the top of the slot — roughly 32 px in prod.
  // Return a proportional strip so split-quadrant drops (upper/lower/center of
  // the slot body) don't collide with the tab-strip droppable in jsdom.
  if (zone.kind === 'tab-strip') {
    const stripHeight = Math.min(32, slotRect.height * 0.15)
    return { left: slotRect.left, top: slotRect.top, width: slotRect.width, height: stripHeight }
  }
  return slotRect
}

/**
 * Resolve the rect for an empty-side sub-zone (start / center / end). The
 * strip itself is a narrow band at the frame edge (`STRIP_THICKNESS` px,
 * matching production's 12% min 60 max 120 CSS rule), split along the rail
 * axis into three sub-zones:
 *   - center: middle of the strip, between the perpendicular rails
 *   - start:  "leading" corner cell (NW for top/left, SW for bottom, NE for
 *             right); collapses to 0 when the perpendicular rail is absent
 *   - end:    opposite corner cell; same collapse rule
 * Keeping the strip narrow (not the full rail-cell height) mirrors the
 * production CSS and keeps the corner sub-zones from swallowing pointer hits
 * that should go to the perpendicular rail's slot bodies during split drops.
 */
const STRIP_THICKNESS = 100

function rectForEmptySideSubzone(
  side: RailSide,
  claim: 'start' | 'end' | undefined,
  layout: Required<RailsLayout>,
): TestRect {
  const rails = useCanvasRailsStore.getState().rails
  // Layout encodes the full viewport geometry regardless of which rails exist;
  // frame width/height fall out of the right/bottom rail's far edge.
  const frameWidth = layout.right.left + layout.right.width
  const frameHeight = layout.bottom.top + layout.bottom.height
  const leftSize = rails.left ? layout.left.width : 0
  const rightSize = rails.right ? layout.right.width : 0
  const topSize = rails.top ? layout.top.height : 0
  const bottomSize = rails.bottom ? layout.bottom.height : 0

  if (side === 'top' || side === 'bottom') {
    const y = side === 'top' ? 0 : frameHeight - STRIP_THICKNESS
    if (claim === 'start') {
      if (leftSize === 0) return { left: 0, top: 0, width: 0, height: 0 }
      return { left: 0, top: y, width: leftSize, height: STRIP_THICKNESS }
    }
    if (claim === 'end') {
      if (rightSize === 0) return { left: 0, top: 0, width: 0, height: 0 }
      return { left: frameWidth - rightSize, top: y, width: rightSize, height: STRIP_THICKNESS }
    }
    // center
    return { left: leftSize, top: y, width: frameWidth - leftSize - rightSize, height: STRIP_THICKNESS }
  }
  const x = side === 'left' ? 0 : frameWidth - STRIP_THICKNESS
  if (claim === 'start') {
    if (topSize === 0) return { left: 0, top: 0, width: 0, height: 0 }
    return { left: x, top: 0, width: STRIP_THICKNESS, height: topSize }
  }
  if (claim === 'end') {
    if (bottomSize === 0) return { left: 0, top: 0, width: 0, height: 0 }
    return { left: x, top: frameHeight - bottomSize, width: STRIP_THICKNESS, height: bottomSize }
  }
  // center
  return { left: x, top: topSize, width: STRIP_THICKNESS, height: frameHeight - topSize - bottomSize }
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
    const r = rectForEmptySideSubzone(target.side, target.claim, layout)
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  }
  const rect = rectForSlot(target.slotId, layout)
  if (!rect) throw new Error(`dragSlot: target slot ${target.slotId} not in rails state`)
  const cx = rect.left + rect.width / 2
  const cy = rect.top + rect.height / 2
  const q = target.quadrant ?? 'center'
  // 0.2 / 0.8 stays inside the target slot's split edge band (22% per
  // pointerToSplitZone) while clearing the empty-side drop-strip sub-zones
  // that overlap the slot's corners post-rail-corners Phase 2.
  if (q === 'upper') return { x: cx, y: rect.top + rect.height * 0.2 }
  if (q === 'lower') return { x: cx, y: rect.top + rect.height * 0.8 }
  if (q === 'left') return { x: rect.left + rect.width * 0.2, y: cy }
  if (q === 'right') return { x: rect.left + rect.width * 0.8, y: cy }
  return { x: cx, y: cy }
}
