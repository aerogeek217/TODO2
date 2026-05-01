/** Cascade shift logic for stacked canvas project nodes */

import type { ScopedRect } from './alignment'

export const CASCADE_GAP_THRESHOLD = 40

export interface HeightDelta {
  nodeId: string
  previousHeight: number
  currentHeight: number
}

export interface PositionShift {
  nodeId: string
  newY: number
}

/** Check if two rects overlap horizontally */
function horizontallyOverlaps(a: ScopedRect, b: ScopedRect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x
}

/**
 * Compute position shifts for projects stacked below nodes whose height changed.
 *
 * When a project grows/shrinks, projects directly below it (within gapThreshold
 * and horizontally overlapping) shift by the same delta. This cascades through
 * all transitively stacked projects.
 */
export function computeCascadeShifts(
  deltas: HeightDelta[],
  allRects: ScopedRect[],
  gapThreshold: number,
  projectNodeIds: Set<string>,
): PositionShift[] {
  if (deltas.length === 0 || allRects.length === 0) return []

  // Working copy of Y positions (modified as cascades accumulate across deltas)
  const positions = new Map<string, number>()
  const rectMap = new Map<string, ScopedRect>()
  for (const rect of allRects) {
    positions.set(rect.nodeId, rect.y)
    rectMap.set(rect.nodeId, rect)
  }

  // Track total shift per node across all deltas
  const totalShifts = new Map<string, number>()

  // Process deltas top-to-bottom so earlier shifts are visible to later deltas
  const sortedDeltas = [...deltas].sort(
    (a, b) => (positions.get(a.nodeId) ?? 0) - (positions.get(b.nodeId) ?? 0),
  )

  for (const delta of sortedDeltas) {
    const deltaY = delta.currentHeight - delta.previousHeight
    if (Math.abs(deltaY) < 1) continue

    const changedRect = rectMap.get(delta.nodeId)
    if (!changedRect) continue

    // BFS: find all transitively stacked project nodes below the changed node
    const toShift = new Set<string>()
    const queue: string[] = [delta.nodeId]

    while (queue.length > 0) {
      const sourceId = queue.shift()!
      const sourceRect = rectMap.get(sourceId)
      if (!sourceRect) continue

      const sourceY = positions.get(sourceId) ?? sourceRect.y
      // Changed node uses previousHeight for bottom (gap evaluated relative to old size).
      // Other nodes use their current measured height.
      const sourceBottom =
        sourceId === delta.nodeId
          ? sourceY + delta.previousHeight
          : sourceY + sourceRect.height

      for (const candidate of allRects) {
        if (candidate.nodeId === delta.nodeId) continue
        if (toShift.has(candidate.nodeId)) continue
        if (!projectNodeIds.has(candidate.nodeId)) continue

        const candidateY = positions.get(candidate.nodeId) ?? candidate.y

        // Must be at or below source bottom
        if (candidateY < sourceBottom) continue

        // Gap must be within threshold
        if (candidateY - sourceBottom > gapThreshold) continue

        // Must horizontally overlap
        if (!horizontallyOverlaps(sourceRect, candidate)) continue

        toShift.add(candidate.nodeId)
        queue.push(candidate.nodeId)
      }
    }

    // Apply shift to working positions
    for (const nodeId of toShift) {
      positions.set(nodeId, positions.get(nodeId)! + deltaY)
      totalShifts.set(nodeId, (totalShifts.get(nodeId) ?? 0) + deltaY)
    }
  }

  // Build result: only include nodes with meaningful shift
  const result: PositionShift[] = []
  for (const [nodeId, totalDelta] of totalShifts) {
    if (Math.abs(totalDelta) < 1) continue
    const originalRect = rectMap.get(nodeId)!
    result.push({ nodeId, newY: originalRect.y + totalDelta })
  }

  return result
}
