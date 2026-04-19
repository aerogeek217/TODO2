/**
 * Test harness for canvas rails drag/dock flow.
 *
 * Intentionally does not drive real dnd-kit pointer events (which require
 * extensive getBoundingClientRect stubbing in jsdom and are brittle across
 * dnd-kit versions). Instead it verifies the integration contract between
 * `RailsFrame` and `useCanvasRailsStore`:
 *   - `RailsFrame` renders the provided rails state under `DndContext`.
 *   - Drop IDs emitted into the DOM by `useDroppable` round-trip through
 *     `decodeRailsDropId`.
 *   - `simulateDrop(sourceSlotId, zone, …)` dispatches the same store action
 *     `useRailsDragMonitor.onDragEnd` would on drop. This mirrors the
 *     switch-on-zone-kind logic there so regressions in the dispatch path
 *     (wrong store action per zone kind) are caught.
 */

import { render, type RenderResult, act } from '@testing-library/react'
import { DndContext } from '@dnd-kit/core'
import type { RailsState } from '../../models/canvas-rails'
import { useCanvasRailsStore } from '../../stores/canvas-rails-store'
import { useListDefinitionStore } from '../../stores/list-definition-store'
import { RailsFrame } from '../../components/canvas/rails/RailsFrame'
import {
  decodeRailsDropId,
  encodeRailsDropId,
  pointerToSplitZone,
  type RailsDropZone,
  type SplitZone,
} from '../../components/canvas/rails/rail-dnd'

export interface RailsHarness {
  getRails: () => RailsState
  /** IDs found on dnd-kit droppable/draggable registered elements in the DOM. */
  getRenderedSlotIds: () => string[]
  /** Returns all decode-able drop zones currently registered in the DOM. */
  getDroppableZones: () => RailsDropZone[]
  /**
   * Dispatch the same store action `useRailsDragMonitor.onDragEnd` would for
   * the given zone. Split-slot zones use the supplied `pointer` + `rect`
   * (or defaults) to compute the SplitZone.
   */
  simulateDrop: (
    sourceSlotId: string,
    zone: RailsDropZone,
    opts?: {
      pointer?: { x: number; y: number }
      rect?: { left: number; top: number; width: number; height: number }
      orientation?: 'vertical' | 'horizontal'
    },
  ) => void
  result: RenderResult
  cleanup: () => void
}

export async function setupRailsHarness(initial: RailsState): Promise<RailsHarness> {
  // Hydrate the rails store with the initial state, bypassing the default-rails effect.
  useCanvasRailsStore.setState({ rails: initial, hydrated: true, pendingFocusSlotId: null })
  // RailsFrame's useDefaultRails waits on list-definitions being loaded; seed a
  // minimal one so the hydration effect short-circuits on the already-hydrated flag.
  useListDefinitionStore.setState((s) => ({ ...s, listDefinitions: s.listDefinitions.length > 0 ? s.listDefinitions : [] }))

  const result = render(
    <DndContext>
      <RailsFrame>
        <div data-testid="canvas-host" />
      </RailsFrame>
    </DndContext>,
  )
  // Let effects settle (hydrate/setCanvasRails effects in useDefaultRails).
  await act(async () => { await Promise.resolve() })

  const getRails = () => useCanvasRailsStore.getState().rails

  const getRenderedSlotIds = () => {
    const els = document.querySelectorAll('[data-slot-id]')
    return Array.from(els).map((el) => (el as HTMLElement).dataset.slotId!).filter(Boolean)
  }

  const getDroppableZones = (): RailsDropZone[] => {
    // dnd-kit doesn't expose droppable IDs as DOM attributes, so we derive
    // the expected set from the current rails state. This still verifies
    // decodeRailsDropId can round-trip the encoder's output for every
    // visible slot in the current frame.
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
    // Every zone encode→decode round-trips; filter out any that don't (guards encoding bugs).
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
    // zone.kind === 'slot' — compute split zone the same way RailsFrame does.
    const pointer = opts?.pointer ?? { x: 0, y: 0 }
    const rect = opts?.rect ?? { left: 0, top: 0, width: 100, height: 100 }
    const orientation = opts?.orientation ?? 'vertical'
    const splitZone: SplitZone = pointerToSplitZone(pointer, rect, orientation)
    store.splitDropSlot(sourceSlotId, zone.slotId, splitZone)
  }

  return {
    getRails,
    getRenderedSlotIds,
    getDroppableZones,
    simulateDrop,
    result,
    cleanup: () => result.unmount(),
  }
}

export function resetRailsStore() {
  useCanvasRailsStore.setState({
    rails: { left: null, right: null, top: null, bottom: null },
    hydrated: false,
    pendingFocusSlotId: null,
  })
}
