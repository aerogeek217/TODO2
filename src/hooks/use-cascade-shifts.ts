import { useCallback, useEffect, useRef, type MutableRefObject } from 'react'
import type { Node, NodeChange, ReactFlowInstance } from '@xyflow/react'
import { findAlignmentsScoped, type AlignmentLine, type ScopedRect } from '../components/canvas/alignment'
import { computeCascadeShifts, CASCADE_GAP_THRESHOLD, type HeightDelta } from '../components/canvas/cascade-shift'
import { isFloatNodeId } from '../utils/float-kind-registry'

export interface CascadeShiftsResult {
  /**
   * Detect height-change deltas in this batch + update the per-node height
   * cache. Caller invokes this BEFORE running `applyNodeChanges` in `setNodes`,
   * so the deltas are computed against the pre-change heights.
   */
  detectAndCacheDimChanges: (changes: NodeChange[], draggingSize: number) => HeightDelta[]
  /**
   * Pure transform run inside the `setNodes` updater. Picks between three
   * branches:
   *   - Single-node drag: snap-align the dragged node, return new alignment
   *     lines + (possibly) a position-shifted nodes array.
   *   - Idle + dim deltas: compute cascade shifts, return shifted nodes +
   *     a `cascadePersist` array for the post-update debounced persist call.
   *   - Otherwise: pass through unchanged.
   */
  processSetNodesUpdate: (
    nds: Node[],
    updated: Node[],
    hasActiveDrag: boolean,
    draggingIds: ReadonlySet<string>,
    dimChanges: HeightDelta[],
    getNodeAbsoluteRect: (node: Node, allNodes: Node[], isDragging: boolean) => ScopedRect | null,
    rfInstanceRef: MutableRefObject<ReactFlowInstance | null>,
  ) => {
    nextNodes: Node[]
    /** `null` means "leave alignmentLines unchanged" (multi-drag preserves prior lines). */
    alignmentLines: AlignmentLine[] | null
    cascadePersist: Array<{ nodeId: string; x: number; y: number }>
  }
  /**
   * Persist cascade shifts post-`setNodes`: writes to `droppedPositions` for
   * the visual sync, then debounces the store callback so a stream of
   * intermediate height changes only commits the final positions. Releases
   * the cascade guard once the debounced callback runs.
   */
  persistCascadeShifts: (
    cascadePersist: Array<{ nodeId: string; x: number; y: number }>,
    droppedPositions: MutableRefObject<Map<string, { x: number; y: number; setAt: number }>>,
    onCascadeShift: ((shifts: Array<{ projectId: number; x: number; y: number }>) => void) | undefined,
  ) => void
}

/**
 * Owns project-cascade detection for canvas: when a project's measured
 * height changes (e.g. a row was inserted, an inline edit grew the node), the
 * other projects in the same column slide up/down to maintain the user's
 * vertical spacing. Also owns the alignment-line snap that runs during a
 * single-node drag.
 *
 * Pulled out of `CanvasView.handleNodesChange` (code-review-2026-04-25 P5)
 * so the sequencer is no longer ~310 LOC of intertwined concerns. Pairs with
 * `useFloatDragLifecycle` — the two hooks each own a slice of the change-
 * batch's side effects.
 */
export function useCascadeShifts(): CascadeShiftsResult {
  // Track measured heights for cascade shift detection.
  const prevHeightsRef = useRef(new Map<string, number>())
  const cascadingRef = useRef(false)
  // Debounce cascade persistence to avoid store-update re-renders during
  // InsertTrigger transitions.
  const cascadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (cascadeTimerRef.current) clearTimeout(cascadeTimerRef.current) }, [])
  const pendingCascadeRef = useRef<Array<{ projectId: number; x: number; y: number }> | null>(null)

  const detectAndCacheDimChanges = useCallback((changes: NodeChange[], draggingSize: number): HeightDelta[] => {
    const dimChanges: HeightDelta[] = []
    if (!cascadingRef.current && draggingSize === 0) {
      for (const change of changes) {
        if (change.type === 'dimensions' && !change.resizing && change.dimensions) {
          const id = change.id
          if (isFloatNodeId(id)) continue
          const prevH = prevHeightsRef.current.get(id)
          const newH = change.dimensions.height
          if (prevH != null && Math.abs(newH - prevH) > 1) {
            dimChanges.push({ nodeId: id, previousHeight: prevH, currentHeight: newH })
          }
        }
      }
    }
    // Always update prevHeightsRef for all dimension changes
    for (const change of changes) {
      if (change.type === 'dimensions' && change.dimensions) {
        prevHeightsRef.current.set(change.id, change.dimensions.height)
      }
    }
    return dimChanges
  }, [])

  const processSetNodesUpdate: CascadeShiftsResult['processSetNodesUpdate'] = useCallback((
    _nds,
    updated,
    hasActiveDrag,
    draggingIds,
    dimChanges,
    getNodeAbsoluteRect,
    rfInstanceRef,
  ) => {
    let alignmentLines: AlignmentLine[] | null = null
    let cascadePersist: Array<{ nodeId: string; x: number; y: number }> = []

    if (!hasActiveDrag || draggingIds.size > 1) {
      if (draggingIds.size === 0) {
        alignmentLines = []

        if (dimChanges.length > 0) {
          const allRects: ScopedRect[] = []
          const projectIds = new Set<string>()
          for (const n of updated) {
            const internal = rfInstanceRef.current?.getInternalNode(n.id)
            allRects.push({
              nodeId: n.id,
              x: n.position.x,
              y: n.position.y,
              width: internal?.measured?.width ?? 280,
              height: internal?.measured?.height ?? 200,
            })
            if (!isFloatNodeId(n.id)) {
              projectIds.add(n.id)
            }
          }

          const shifts = computeCascadeShifts(dimChanges, allRects, CASCADE_GAP_THRESHOLD, projectIds)
          if (shifts.length > 0) {
            cascadingRef.current = true
            const shiftMap = new Map(shifts.map((s) => [s.nodeId, s.newY]))

            cascadePersist = shifts
              .map((s) => {
                const node = updated.find((n) => n.id === s.nodeId)
                return node
                  ? { nodeId: s.nodeId, x: node.position.x, y: s.newY }
                  : { nodeId: s.nodeId, x: 0, y: s.newY }
              })
              .filter((s) => updated.find((n) => n.id === s.nodeId) != null)

            return {
              nextNodes: updated.map((n) => {
                const newY = shiftMap.get(n.id)
                return newY != null ? { ...n, position: { ...n.position, y: newY } } : n
              }),
              alignmentLines,
              cascadePersist,
            }
          }
        }
      }
      return { nextNodes: updated, alignmentLines, cascadePersist }
    }

    // Single-node drag: compute snap.
    const dragId = [...draggingIds][0]
    const dragNode = updated.find((n) => n.id === dragId)
    if (!dragNode) return { nextNodes: updated, alignmentLines, cascadePersist }

    const dragRect = getNodeAbsoluteRect(dragNode, updated, true)
    if (!dragRect) return { nextNodes: updated, alignmentLines, cascadePersist }

    const otherRects: ScopedRect[] = []
    for (const n of updated) {
      if (draggingIds.has(n.id)) continue
      const rect = getNodeAbsoluteRect(n, updated, false)
      if (rect) otherRects.push(rect)
    }

    const snap = findAlignmentsScoped(dragRect, otherRects)
    alignmentLines = snap.lines

    if (snap.x !== dragRect.x || snap.y !== dragRect.y) {
      return {
        nextNodes: updated.map((n) =>
          n.id === dragId ? { ...n, position: { x: snap.x, y: snap.y } } : n,
        ),
        alignmentLines,
        cascadePersist,
      }
    }
    return { nextNodes: updated, alignmentLines, cascadePersist }
  }, [])

  const persistCascadeShifts: CascadeShiftsResult['persistCascadeShifts'] = useCallback((
    cascadePersist,
    droppedPositions,
    onCascadeShift,
  ) => {
    if (cascadePersist.length === 0) return
    for (const { nodeId, x, y } of cascadePersist) {
      droppedPositions.current.set(nodeId, { x, y, setAt: performance.now() })
    }
    // Debounce store persistence — if another cascade fires within 300ms
    // (e.g. InsertTrigger opening then closing), only the final positions
    // are written.
    pendingCascadeRef.current = cascadePersist.map((s) => ({
      projectId: Number(s.nodeId), x: s.x, y: s.y,
    }))
    if (cascadeTimerRef.current) clearTimeout(cascadeTimerRef.current)
    cascadeTimerRef.current = setTimeout(() => {
      const pending = pendingCascadeRef.current
      if (pending && pending.length > 0) {
        onCascadeShift?.(pending)
      }
      pendingCascadeRef.current = null
      cascadeTimerRef.current = null
      // Release cascade guard only after the debounced persistence runs —
      // keeps dimension-change cascade detection suppressed for the whole
      // 300ms window so in-flight height changes don't trigger a second
      // cascade mid-debounce.
      queueMicrotask(() => { cascadingRef.current = false })
    }, 300)
  }, [])

  return { detectAndCacheDimChanges, processSetNodesUpdate, persistCascadeShifts }
}
