/** Alignment snap logic for canvas node dragging */

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface ScopedRect extends Rect {
  nodeId: string
}

export interface AlignmentLine {
  orientation: 'horizontal' | 'vertical'
  position: number  // canvas coordinate of the line
  start: number     // start of the line extent (perpendicular axis)
  end: number       // end of the line extent
}

export interface SnapResult {
  x: number
  y: number
  lines: AlignmentLine[]
}

export interface ResizeSnapResult {
  width: number
  lines: AlignmentLine[]
}

const SNAP_THRESHOLD = 5

/**
 * Find width snap for horizontal resize (right edge snaps to other right/left edges).
 */
export function findResizeSnap(
  dragging: ScopedRect,
  newWidth: number,
  others: ScopedRect[],
  threshold = SNAP_THRESHOLD,
): ResizeSnapResult {
  const targets = others
  let snapWidth: number | null = null
  let bestDx = threshold + 1
  const lines: AlignmentLine[] = []

  const dragRight = dragging.x + newWidth

  for (const other of targets) {
    const otherLeft = other.x
    const otherRight = other.x + other.width

    // Right edge of dragging -> left/right edges of others
    for (const otherEdge of [otherLeft, otherRight]) {
      const dx = Math.abs(dragRight - otherEdge)
      if (dx <= threshold && dx < bestDx) {
        bestDx = dx
        snapWidth = otherEdge - dragging.x
      }
    }
  }

  const finalWidth = snapWidth != null ? Math.max(200, snapWidth) : newWidth

  // Build alignment lines for snapped right edge
  if (snapWidth != null) {
    const finalRight = dragging.x + finalWidth
    for (const other of targets) {
      for (const otherEdge of [other.x, other.x + other.width]) {
        if (Math.abs(finalRight - otherEdge) < 1) {
          const minY = Math.min(dragging.y, other.y)
          const maxY = Math.max(dragging.y + dragging.height, other.y + other.height)
          lines.push({ orientation: 'vertical', position: finalRight, start: minY, end: maxY })
        }
      }
    }
  }

  return { width: finalWidth, lines }
}

/**
 * Find alignment snaps for a dragging node against other nodes.
 * Returns the snapped position and alignment guide lines to render.
 */
export function findAlignments(
  dragging: Rect,
  others: Rect[],
  threshold = SNAP_THRESHOLD,
): SnapResult {
  let snapX: number | null = null
  let snapY: number | null = null
  let bestDx = threshold + 1
  let bestDy = threshold + 1
  const lines: AlignmentLine[] = []

  const dragLeft = dragging.x
  const dragRight = dragging.x + dragging.width
  const dragTop = dragging.y
  const dragBottom = dragging.y + dragging.height

  for (const other of others) {
    const otherLeft = other.x
    const otherRight = other.x + other.width
    const otherTop = other.y
    const otherBottom = other.y + other.height

    // Vertical edges (snap X): left-left, right-right, left-right, right-left
    const xPairs: [number, number][] = [
      [dragLeft, otherLeft],
      [dragRight, otherRight],
      [dragLeft, otherRight],
      [dragRight, otherLeft],
    ]

    for (const [dragEdge, otherEdge] of xPairs) {
      const dx = Math.abs(dragEdge - otherEdge)
      if (dx <= threshold && dx < bestDx) {
        bestDx = dx
        snapX = dragging.x + (otherEdge - dragEdge)
      }
    }

    // Horizontal edges (snap Y): top-top, bottom-bottom, top-bottom, bottom-top
    const yPairs: [number, number][] = [
      [dragTop, otherTop],
      [dragBottom, otherBottom],
      [dragTop, otherBottom],
      [dragBottom, otherTop],
    ]

    for (const [dragEdge, otherEdge] of yPairs) {
      const dy = Math.abs(dragEdge - otherEdge)
      if (dy <= threshold && dy < bestDy) {
        bestDy = dy
        snapY = dragging.y + (otherEdge - dragEdge)
      }
    }
  }

  const finalX = snapX ?? dragging.x
  const finalY = snapY ?? dragging.y

  // Build alignment lines for the snapped position
  const finalRight = finalX + dragging.width
  const finalTop = finalY
  const finalBottom = finalY + dragging.height

  for (const other of others) {
    const otherLeft = other.x
    const otherRight = other.x + other.width
    const otherTop = other.y
    const otherBottom = other.y + other.height

    if (snapX != null) {
      // Check which vertical edges aligned
      const vEdges: [number, number][] = [
        [finalX, otherLeft],
        [finalX, otherRight],
        [finalRight, otherLeft],
        [finalRight, otherRight],
      ]
      for (const [a, b] of vEdges) {
        if (Math.abs(a - b) < 1) {
          const minY = Math.min(finalTop, otherTop)
          const maxY = Math.max(finalBottom, otherBottom)
          lines.push({ orientation: 'vertical', position: a, start: minY, end: maxY })
        }
      }
    }

    if (snapY != null) {
      const hEdges: [number, number][] = [
        [finalTop, otherTop],
        [finalTop, otherBottom],
        [finalBottom, otherTop],
        [finalBottom, otherBottom],
      ]
      for (const [a, b] of hEdges) {
        if (Math.abs(a - b) < 1) {
          const minX = Math.min(finalX, otherLeft)
          const maxX = Math.max(finalRight, otherRight)
          lines.push({ orientation: 'horizontal', position: a, start: minX, end: maxX })
        }
      }
    }
  }

  return { x: finalX, y: finalY, lines }
}

/**
 * Scoped version of findAlignments: filters snap targets by scope rules first.
 */
export function findAlignmentsScoped(
  dragging: ScopedRect,
  others: ScopedRect[],
  threshold = SNAP_THRESHOLD,
): SnapResult {
  return findAlignments(dragging, others, threshold)
}
