import { describe, it, expect } from 'vitest'
import {
  CASCADE_GAP_THRESHOLD,
  computeCascadeShifts,
  type HeightDelta,
} from '../../components/canvas/cascade-shift'
import type { ScopedRect } from '../../components/canvas/alignment'

function makeRect(nodeId: string, x: number, y: number, width = 280, height = 200): ScopedRect {
  return { nodeId, x, y, width, height }
}

function makeDelta(nodeId: string, previousHeight: number, currentHeight: number): HeightDelta {
  return { nodeId, previousHeight, currentHeight }
}

// ─── CASCADE_GAP_THRESHOLD constant ──────────────────────────────────────────

describe('CASCADE_GAP_THRESHOLD', () => {
  it('equals 40', () => {
    expect(CASCADE_GAP_THRESHOLD).toBe(40)
  })
})

// ─── computeCascadeShifts ─────────────────────────────────────────────────────

describe('computeCascadeShifts', () => {
  describe('empty inputs', () => {
    it('computeCascadeShifts_emptyDeltas_returnsEmptyArray', () => {
      // Arrange
      const rects = [makeRect('a', 0, 0), makeRect('b', 0, 220)]
      const projectIds = new Set(['a', 'b'])

      // Act
      const result = computeCascadeShifts([], rects, CASCADE_GAP_THRESHOLD, projectIds)

      // Assert
      expect(result).toHaveLength(0)
    })

    it('computeCascadeShifts_emptyRects_returnsEmptyArray', () => {
      // Arrange
      const deltas = [makeDelta('a', 200, 250)]
      const projectIds = new Set(['a'])

      // Act
      const result = computeCascadeShifts(deltas, [], CASCADE_GAP_THRESHOLD, projectIds)

      // Assert
      expect(result).toHaveLength(0)
    })
  })

  describe('horizontal overlap checks', () => {
    it('computeCascadeShifts_projectsSideBySideNoHorizontalOverlap_noShift', () => {
      // Arrange — A is at x=0 w=280, B is at x=300 w=280; same Y range, no horizontal overlap
      const rects = [
        makeRect('a', 0, 0, 280, 200),
        makeRect('b', 300, 220, 280, 200),
      ]
      const deltas = [makeDelta('a', 200, 250)]
      const projectIds = new Set(['a', 'b'])

      // Act
      const result = computeCascadeShifts(deltas, rects, CASCADE_GAP_THRESHOLD, projectIds)

      // Assert
      expect(result).toHaveLength(0)
    })

    it('computeCascadeShifts_partialHorizontalOverlap_cascades', () => {
      // Arrange — A at x=0 w=200, B at x=150 w=200 (50px overlap); B stacked below A
      const rects = [
        makeRect('a', 0, 0, 200, 200),
        makeRect('b', 150, 220, 200, 200),
      ]
      const deltas = [makeDelta('a', 200, 250)]
      const projectIds = new Set(['a', 'b'])

      // Act
      const result = computeCascadeShifts(deltas, rects, CASCADE_GAP_THRESHOLD, projectIds)

      // Assert — B has horizontal overlap so it shifts
      expect(result).toHaveLength(1)
      expect(result[0].nodeId).toBe('b')
      expect(result[0].newY).toBe(270) // 220 + 50
    })
  })

  describe('basic push-down', () => {
    it('computeCascadeShifts_nodeGrows_stackedNodeShiftsDown', () => {
      // Arrange — A(y=0, h=200) grows to h=250; B(y=220) is 20px below A's old bottom
      const rects = [
        makeRect('a', 0, 0, 280, 200),
        makeRect('b', 0, 220, 280, 200),
      ]
      const deltas = [makeDelta('a', 200, 250)]
      const projectIds = new Set(['a', 'b'])

      // Act
      const result = computeCascadeShifts(deltas, rects, CASCADE_GAP_THRESHOLD, projectIds)

      // Assert — B shifts down by 50
      expect(result).toHaveLength(1)
      expect(result[0].nodeId).toBe('b')
      expect(result[0].newY).toBe(270) // 220 + 50
    })
  })

  describe('basic pull-up', () => {
    it('computeCascadeShifts_nodeShrinks_stackedNodeShiftsUp', () => {
      // Arrange — A(y=0, h=200) shrinks to h=150; B(y=220) gap=20 below old bottom
      const rects = [
        makeRect('a', 0, 0, 280, 200),
        makeRect('b', 0, 220, 280, 200),
      ]
      const deltas = [makeDelta('a', 200, 150)]
      const projectIds = new Set(['a', 'b'])

      // Act
      const result = computeCascadeShifts(deltas, rects, CASCADE_GAP_THRESHOLD, projectIds)

      // Assert — B shifts up by 50
      expect(result).toHaveLength(1)
      expect(result[0].nodeId).toBe('b')
      expect(result[0].newY).toBe(170) // 220 - 50
    })
  })

  describe('cascade chain', () => {
    it('computeCascadeShifts_chainABC_allShiftByDelta', () => {
      // Arrange — A(y=0 h=200), B(y=220 gap=20), C(y=440 gap=20); A grows +50
      const rects = [
        makeRect('a', 0, 0,   280, 200),
        makeRect('b', 0, 220, 280, 200),
        makeRect('c', 0, 440, 280, 200),
      ]
      const deltas = [makeDelta('a', 200, 250)]
      const projectIds = new Set(['a', 'b', 'c'])

      // Act
      const result = computeCascadeShifts(deltas, rects, CASCADE_GAP_THRESHOLD, projectIds)

      // Assert — both B and C shift by +50
      const shiftB = result.find(r => r.nodeId === 'b')
      const shiftC = result.find(r => r.nodeId === 'c')
      expect(shiftB?.newY).toBe(270) // 220 + 50
      expect(shiftC?.newY).toBe(490) // 440 + 50
    })
  })

  describe('gap threshold', () => {
    it('computeCascadeShifts_gapExceedsThreshold_noShift', () => {
      // Arrange — A bottom=200, B top=260: gap=60 > threshold=40
      const rects = [
        makeRect('a', 0, 0,   280, 200),
        makeRect('b', 0, 260, 280, 200),
      ]
      const deltas = [makeDelta('a', 200, 250)]
      const projectIds = new Set(['a', 'b'])

      // Act
      const result = computeCascadeShifts(deltas, rects, CASCADE_GAP_THRESHOLD, projectIds)

      // Assert — gap is too large; no shift
      expect(result).toHaveLength(0)
    })

    it('computeCascadeShifts_gapAtExactThreshold_shifts', () => {
      // Arrange — A bottom=200, B top=240: gap=40 == threshold=40
      const rects = [
        makeRect('a', 0, 0,   280, 200),
        makeRect('b', 0, 240, 280, 200),
      ]
      const deltas = [makeDelta('a', 200, 250)]
      const projectIds = new Set(['a', 'b'])

      // Act
      const result = computeCascadeShifts(deltas, rects, CASCADE_GAP_THRESHOLD, projectIds)

      // Assert — gap exactly at threshold; condition is "> gapThreshold" so this does cascade
      expect(result).toHaveLength(1)
      expect(result[0].nodeId).toBe('b')
    })
  })

  describe('non-project nodes', () => {
    it('computeCascadeShifts_nonProjectNodeBelow_doesNotShift', () => {
      // Arrange — B is not in projectNodeIds (e.g. a list-inset widget)
      const rects = [
        makeRect('a',      0, 0,   280, 200),
        makeRect('inset-1', 0, 220, 280, 200),
      ]
      const deltas = [makeDelta('a', 200, 250)]
      // Only 'a' is a project node; 'inset-1' is excluded
      const projectIds = new Set(['a'])

      // Act
      const result = computeCascadeShifts(deltas, rects, CASCADE_GAP_THRESHOLD, projectIds)

      // Assert — inset-1 should not appear in the result
      expect(result.find(r => r.nodeId === 'inset-1')).toBeUndefined()
    })

    it('computeCascadeShifts_mixedNodes_onlyProjectNodesShift', () => {
      // Arrange — B is a project, inset-1 is not; both stacked below A
      const rects = [
        makeRect('a',      0,   0, 280, 200),
        makeRect('b',      0, 220, 280, 200),
        makeRect('inset-1', 0, 220, 280, 200),
      ]
      const deltas = [makeDelta('a', 200, 250)]
      const projectIds = new Set(['a', 'b'])

      // Act
      const result = computeCascadeShifts(deltas, rects, CASCADE_GAP_THRESHOLD, projectIds)

      // Assert
      const nodeIds = result.map(r => r.nodeId)
      expect(nodeIds).toContain('b')
      expect(nodeIds).not.toContain('inset-1')
    })
  })

  describe('multiple simultaneous deltas', () => {
    it('computeCascadeShifts_twoDeltasIndependentColumns_eachShiftsSeparately', () => {
      // Arrange — two independent vertical stacks, no horizontal overlap (x=0 vs x=400)
      // Stack 1: A(x=0,y=0,h=200) → grows +30; B(x=0,y=220) stacked below A (gap=20)
      // Stack 2: C(x=400,y=0,h=200) → grows +20; D(x=400,y=220) stacked below C (gap=20)
      const rects2 = [
        makeRect('a', 0,   0,   280, 200),
        makeRect('b', 0,   220, 280, 200),
        makeRect('c', 400, 0,   280, 200),
        makeRect('d', 400, 220, 280, 200),
      ]
      const deltas = [
        makeDelta('a', 200, 230), // grows +30
        makeDelta('c', 200, 220), // grows +20
      ]
      const projectIds = new Set(['a', 'b', 'c', 'd'])

      // Act
      const result = computeCascadeShifts(deltas, rects2, CASCADE_GAP_THRESHOLD, projectIds)

      // Assert
      const shiftB = result.find(r => r.nodeId === 'b')
      const shiftD = result.find(r => r.nodeId === 'd')
      expect(shiftB?.newY).toBe(250) // 220 + 30
      expect(shiftD?.newY).toBe(240) // 220 + 20
    })
  })

  describe('node position relative to source', () => {
    it('computeCascadeShifts_nodeAboveChangedNode_doesNotShift', () => {
      // Arrange — B is ABOVE A (B.y < A.y); only nodes below A's bottom should shift
      const rects = [
        makeRect('a', 0, 200, 280, 200), // A bottom=400
        makeRect('b', 0, 0,   280, 200), // B top=0, entirely above A
      ]
      const deltas = [makeDelta('a', 200, 250)]
      const projectIds = new Set(['a', 'b'])

      // Act
      const result = computeCascadeShifts(deltas, rects, CASCADE_GAP_THRESHOLD, projectIds)

      // Assert — B is above A's bottom; it must not shift
      expect(result.find(r => r.nodeId === 'b')).toBeUndefined()
    })

    it('computeCascadeShifts_nodeAboveChangedNodeBottom_doesNotShift', () => {
      // Arrange — B.y is within the body of A (below A.y but above A's bottom)
      const rects = [
        makeRect('a', 0, 0,   280, 200), // A bottom=200
        makeRect('b', 0, 100, 280, 200), // B top=100 < 200 (A's previous bottom)
      ]
      const deltas = [makeDelta('a', 200, 250)]
      const projectIds = new Set(['a', 'b'])

      // Act
      const result = computeCascadeShifts(deltas, rects, CASCADE_GAP_THRESHOLD, projectIds)

      // Assert — B is not below A's previous bottom; no shift
      expect(result.find(r => r.nodeId === 'b')).toBeUndefined()
    })
  })

  describe('near-zero delta', () => {
    it('computeCascadeShifts_deltaLessThan1_skipped', () => {
      // Arrange — sub-pixel height change of 0.5
      const rects = [
        makeRect('a', 0, 0,   280, 200),
        makeRect('b', 0, 220, 280, 200),
      ]
      const deltas = [makeDelta('a', 200, 200.5)] // deltaY = 0.5
      const projectIds = new Set(['a', 'b'])

      // Act
      const result = computeCascadeShifts(deltas, rects, CASCADE_GAP_THRESHOLD, projectIds)

      // Assert — delta < 1 is ignored
      expect(result).toHaveLength(0)
    })

    it('computeCascadeShifts_deltaOfExactly1_isApplied', () => {
      // Arrange — exactly 1px height change
      const rects = [
        makeRect('a', 0, 0,   280, 200),
        makeRect('b', 0, 220, 280, 200),
      ]
      const deltas = [makeDelta('a', 200, 201)] // deltaY = 1.0
      const projectIds = new Set(['a', 'b'])

      // Act
      const result = computeCascadeShifts(deltas, rects, CASCADE_GAP_THRESHOLD, projectIds)

      // Assert — delta == 1 passes the Math.abs(deltaY) < 1 guard and is applied
      expect(result).toHaveLength(1)
      expect(result[0].nodeId).toBe('b')
      expect(result[0].newY).toBe(221) // 220 + 1
    })
  })
})
