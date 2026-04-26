import { useCallback, useEffect, useRef, type MutableRefObject } from 'react'
import type { NodeChange } from '@xyflow/react'
import { useCanvasRailsStore } from '../stores/canvas-rails-store'
import { useUIStore } from '../stores/ui-store'
import { resolveFloatDockTarget, type FloatDockTarget } from '../utils/rail-dnd'
import { floatKindForNodeId } from '../utils/float-kind-registry'
import type { FloatDragKind } from '../stores/ui-store'
import type { RailSide } from '../models/canvas-rails'

export interface FloatDragLifecycleCallbacks {
  onFloatDock?: (
    descriptor: { kind: FloatDragKind; floatId: number },
    target: FloatDockTarget,
  ) => void
  onTaskboardDragStop?: (id: number, x: number, y: number) => void
  onInsetDragStop?: (id: number, x: number, y: number) => void
  onNoteDragStop?: (id: number, x: number, y: number) => void
  onCalendarDragStop?: (id: number, x: number, y: number) => void
  onHorizonsDragStop?: (id: number, x: number, y: number) => void
  onStatusDragStop?: (id: number, x: number, y: number) => void
  onScoreboardDragStop?: (id: number, x: number, y: number) => void
  onSnoozeGraveyardDragStop?: (id: number, x: number, y: number) => void
  onNodeDragStop: (projectId: number, x: number, y: number) => void
}

export interface FloatDragLifecycleResult {
  /** Drag-id set, owned by the lifecycle but read by the cascade hook + setNodes sync effect. */
  draggingIds: MutableRefObject<Set<string>>
  /**
   * Just-dropped position cache keyed by node id, owned by the lifecycle
   * (writes on drag-end + dock release) but also written by the cascade hook
   * (cascade-persisted positions need the same mid-flight preservation).
   */
  droppedPositions: MutableRefObject<Map<string, { x: number; y: number; setAt: number }>>
  /**
   * Process a `handleNodesChange` batch's drag-side effects: drag-id tracking,
   * float-dock hit-test + dispatch, position-persist callbacks, ui-store
   * `floatDrag` publication, and the window-level pointer listener that
   * captures coords for `resolveFloatDockTarget`. Returns the booleans the
   * sequencer needs to drive the setNodes branch + a downstream alignment
   * cascade pass.
   */
  processBatch: (changes: NodeChange[]) => { hasActiveDrag: boolean }
}

/**
 * Owns drag-session lifecycle for canvas float widgets (note / calendar /
 * lens / taskboard / horizons) and project nodes alike. Tracks which nodes
 * are mid-drag, fires position-persist callbacks on release, runs the float-
 * dock hit-test (Phase 4 float-dock), and toggles the window-level pointer
 * listener around the leading/trailing edges of a float drag.
 *
 * Pulled out of `CanvasView.handleNodesChange` (code-review-2026-04-25 P5)
 * so the sequencer is no longer ~310 LOC of intertwined concerns. Pairs with
 * `useCascadeShifts` — the two hooks each own a slice of the change-batch's
 * side effects; the sequencer in `CanvasView` calls them in order.
 */
export function useFloatDragLifecycle(
  callbacks: FloatDragLifecycleCallbacks,
): FloatDragLifecycleResult {
  const draggingIds = useRef(new Set<string>())
  // Preserve final positions of just-dropped nodes until the store catches up.
  // `setAt` is a monotonic timestamp; the sync effect drops stale overrides
  // after DROPPED_POSITION_TTL_MS so rounding-induced near-misses can't wedge
  // forever.
  const droppedPositions = useRef(new Map<string, { x: number; y: number; setAt: number }>())
  // Phase 4: session-scoped multi-drag tracker. Any frame with ≥2 concurrent
  // drags marks the session as multi so multi-select releases (which can
  // batch into a single `handleNodesChange` call) stay position-only — even
  // for the last release, whose post-delete `draggingIds.size` would be 1.
  // Reset once `draggingIds` empties at the end of a batch.
  const wasMultiDragRef = useRef(false)
  // Phase 2 float-dock: window-level pointer capture while a float is being
  // dragged, so `processBatch`'s release branch can hit-test rail drop zones.
  const pointerRef = useRef<{ x: number; y: number } | null>(null)
  const pointerCleanupRef = useRef<(() => void) | null>(null)

  useEffect(() => () => {
    if (pointerCleanupRef.current) {
      pointerCleanupRef.current()
      pointerCleanupRef.current = null
    }
    // Clear any stale ui-store state an unmount-mid-drag would otherwise
    // leave stuck — DockOverlay reads `floatDrag` to decide visibility.
    useUIStore.getState().setFloatDrag(null)
    wasMultiDragRef.current = false
  }, [])

  const {
    onFloatDock,
    onTaskboardDragStop,
    onInsetDragStop,
    onNoteDragStop,
    onCalendarDragStop,
    onHorizonsDragStop,
    onStatusDragStop,
    onScoreboardDragStop,
    onSnoozeGraveyardDragStop,
    onNodeDragStop,
  } = callbacks

  // Captured in a stable callback so the sequencer's deps stay narrow.
  const processBatch = useCallback((changes: NodeChange[]): { hasActiveDrag: boolean } => {
    let hasActiveDrag = false
    // Phase 4 a11y: flip true when any release in this batch dispatches the
    // dock callback, so the normal detach branch below knows to leave the
    // freshly-set "Dropped in {zone}" announcement alone.
    let floatDockFired = false

    // Was any float being dragged before this batch of changes? Used to decide
    // whether to attach the Phase 2 float-dock pointer listener at the leading
    // edge of the drag, or detach at its trailing edge.
    let floatWasDragging = false
    for (const dragId of draggingIds.current) {
      if (floatKindForNodeId(dragId)) { floatWasDragging = true; break }
    }

    // Resolve rail orientation for a slot on release — walks current rails
    // state. Read `getState()` fresh per drop so changes during the drag stay
    // consistent.
    const getSlotOrientation = (slotId: string): 'vertical' | 'horizontal' | null => {
      const rails = useCanvasRailsStore.getState().rails
      for (const side of ['left', 'right', 'top', 'bottom'] as RailSide[]) {
        const rail = rails[side]
        if (!rail) continue
        if (rail.slots.some((s) => s.id === slotId)) return rail.orientation
      }
      return null
    }

    for (const change of changes) {
      if (change.type !== 'position') continue
      if (change.dragging) {
        draggingIds.current.add(change.id)
        // If any frame ever has >1 concurrent drags, flag the session as multi
        // so no release in this batch (or the final one whose post-delete
        // `draggingIds.size === 0`) slips past the hit-test gate.
        if (draggingIds.current.size > 1) wasMultiDragRef.current = true
        hasActiveDrag = true
      } else {
        draggingIds.current.delete(change.id)
        if (!change.position) continue
        const id = change.id
        const floatKind = floatKindForNodeId(id)

        // Phase 2/4 float-dock hit-test: when a float is released and the
        // pointer is over a rail drop zone, dispatch the dock action and
        // suppress the usual position persist (the float is about to be
        // replaced by a tab). Multi-drag stays position-only via
        // `wasMultiDragRef`; `draggingIds.size === 0` keeps mid-batch releases
        // from docking while sibling drags are still in flight.
        if (
          floatKind &&
          onFloatDock &&
          pointerRef.current &&
          draggingIds.current.size === 0 &&
          !wasMultiDragRef.current
        ) {
          const target = resolveFloatDockTarget(pointerRef.current, { getSlotOrientation })
          if (target) {
            onFloatDock({ kind: floatKind.kind, floatId: floatKind.floatId }, target)
            // Release dispatched → CanvasPage's handler has already replaced
            // the drag-start announcer with the dock-success string; flag it
            // so detach doesn't wipe that. Clear `wasMultiDragRef` immediately
            // so the next session starts clean.
            floatDockFired = true
            wasMultiDragRef.current = false
            continue
          }
        }

        // Remember final position so the sync effect preserves it until the
        // store updates.
        droppedPositions.current.set(change.id, { ...change.position, setAt: performance.now() })
        if (floatKind) {
          const { x, y } = change.position
          switch (floatKind.kind) {
            case 'taskboard':       onTaskboardDragStop?.(floatKind.floatId, x, y); break
            case 'lens':            onInsetDragStop?.(floatKind.floatId, x, y); break
            case 'note':            onNoteDragStop?.(floatKind.floatId, x, y); break
            case 'calendar':        onCalendarDragStop?.(floatKind.floatId, x, y); break
            case 'horizons':        onHorizonsDragStop?.(floatKind.floatId, x, y); break
            case 'status':          onStatusDragStop?.(floatKind.floatId, x, y); break
            case 'scoreboard':      onScoreboardDragStop?.(floatKind.floatId, x, y); break
            case 'snoozeGraveyard': onSnoozeGraveyardDragStop?.(floatKind.floatId, x, y); break
          }
        } else {
          onNodeDragStop(Number(id), change.position.x, change.position.y)
        }
      }
    }

    // Phase 1 float-dock: publish the currently-dragging float (if any) to
    // `ui-store` so the rail `DockOverlay` can render drop zones while a float
    // is in flight. `setFloatDrag` is idempotent on identical kind+id so
    // repeated position frames don't re-render downstream.
    const setFloatDrag = useUIStore.getState().setFloatDrag
    let floatDragNext: ReturnType<typeof floatKindForNodeId> = null
    for (const dragId of draggingIds.current) {
      const kinded = floatKindForNodeId(dragId)
      if (kinded) { floatDragNext = kinded; break }
    }
    setFloatDrag(floatDragNext ? { kind: floatDragNext.kind, id: floatDragNext.floatId } : null)

    // Phase 2 float-dock: toggle the window-level pointer listener around the
    // leading/trailing edges of a float drag. The listener stashes client
    // coords so `resolveFloatDockTarget` has a point to hit-test on release.
    // Rail/tab drags use dnd-kit's own pointer capture so this listener is
    // scoped strictly to React-Flow-driven float drags.
    const floatIsDragging = floatDragNext !== null
    if (!floatWasDragging && floatIsDragging && !pointerCleanupRef.current) {
      const onMove = (e: PointerEvent) => {
        pointerRef.current = { x: e.clientX, y: e.clientY }
      }
      // Phase 4 cancel-safety: if React Flow ever swallows the release event
      // (e.g., the dragged node unmounts, window blurs, pointer cancel), our
      // drag-end branch never runs. A deferred cleanup riding on global
      // pointerup/cancel/blur gives React Flow the first chance to emit
      // dragging:false normally; if it did, `pointerCleanupRef.current` is
      // already null by the time the deferred cleanup fires and the forced
      // cleanup is a no-op.
      //
      // Why rAF and not microtask: clearing `floatDrag` synchronously here
      // unmounts `DockOverlay` (gated on `floatDragActive` in `RailsFrame`)
      // before the release branch's hit-test sees `dragging:false`. With the
      // empty-side strips gone from the DOM, `elementsFromPoint` misses them
      // and float drops onto an empty rail side silently position-persist.
      // rAF fires after React commits the next render, so processBatch runs
      // its hit-test (and trailing-edge cleanup, which nulls
      // `pointerCleanupRef`) first; the rAF callback then early-returns. The
      // ~16 ms ceiling is a hard cap on how long a swallowed release can
      // leave `floatDrag` stuck.
      let cleaned = false
      const detach = () => {
        if (cleaned) return
        cleaned = true
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUpOrCancel)
        window.removeEventListener('pointercancel', onUpOrCancel)
        window.removeEventListener('blur', onUpOrCancel)
        // Don't null pointerRef here: detach can ride the onUpOrCancel
        // deferred path, which can run ahead of RF's `dragging:false` change.
        // If we nulled, the release branch's hit-test gate (`:146-152`) would
        // see null and skip `resolveFloatDockTarget`, so float drops onto a
        // rail would silently position-persist instead of docking. Stale
        // coords between sessions are harmless — the next drag's leading-edge
        // attach re-binds onMove and the user must move at least once before
        // a release that could hit-test.
      }
      const onUpOrCancel = () => {
        requestAnimationFrame(() => {
          if (pointerCleanupRef.current !== detach) return
          detach()
          pointerCleanupRef.current = null
          useUIStore.getState().setFloatDrag(null)
          useUIStore.getState().setFloatAnnouncement('')
          wasMultiDragRef.current = false
        })
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUpOrCancel)
      window.addEventListener('pointercancel', onUpOrCancel)
      window.addEventListener('blur', onUpOrCancel)
      pointerCleanupRef.current = detach
      // Phase 4: reuse the rails-monitor announcer pattern for a11y.
      useUIStore.getState().setFloatAnnouncement(`Dragging ${floatDragNext!.entry.label}`)
    } else if (floatWasDragging && !floatIsDragging && pointerCleanupRef.current) {
      pointerCleanupRef.current()
      pointerCleanupRef.current = null
      // Non-dock drop → clear the stale "Dragging {kind}" announcement.
      // Dock drops leave CanvasPage's "Dropped in …" string in place.
      if (!floatDockFired) useUIStore.getState().setFloatAnnouncement('')
    }

    // Phase 4 multi-drag reset: clear the session flag once every drag has
    // ended. Placed after the listener teardown so any release in this batch
    // already saw the correct (pre-reset) value.
    if (draggingIds.current.size === 0) {
      wasMultiDragRef.current = false
    }

    return { hasActiveDrag }
  }, [
    onFloatDock,
    onTaskboardDragStop,
    onInsetDragStop,
    onNoteDragStop,
    onCalendarDragStop,
    onHorizonsDragStop,
    onStatusDragStop,
    onScoreboardDragStop,
    onSnoozeGraveyardDragStop,
    onNodeDragStop,
  ])

  return { draggingIds, droppedPositions, processBatch }
}
