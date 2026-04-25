import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { MutableRefObject } from 'react'
import type { Node, NodeChange, ReactFlowInstance } from '@xyflow/react'
import { useCascadeShifts } from '../../hooks/use-cascade-shifts'

/**
 * Pure-hook tests for `useCascadeShifts` (extracted from CanvasView in
 * code-review-2026-04-25 P5). The cascade hook owns three concerns: dim-
 * change detection (with prevHeights cache), set-nodes transformation
 * (snap vs cascade vs pass-through), and debounced cascade persistence.
 */

function makeNode(id: string, x = 0, y = 0): Node {
  return { id, type: 'project', position: { x, y }, data: {} } as Node
}

function makeRfInstanceRef(): MutableRefObject<ReactFlowInstance | null> {
  return { current: null } as MutableRefObject<ReactFlowInstance | null>
}

function makeGetRect() {
  return (node: Node, _all: Node[], _isDragging: boolean) => ({
    nodeId: node.id,
    x: node.position.x,
    y: node.position.y,
    width: 280,
    height: 200,
  })
}

describe('useCascadeShifts', () => {
  describe('detectAndCacheDimChanges', () => {
    it('no-op on empty change batch', () => {
      const { result } = renderHook(() => useCascadeShifts())
      const deltas = result.current.detectAndCacheDimChanges([], 0)
      expect(deltas).toEqual([])
    })

    it('returns no deltas when no prior height was cached', () => {
      const { result } = renderHook(() => useCascadeShifts())
      const changes: NodeChange[] = [
        { id: 'p1', type: 'dimensions', dimensions: { width: 280, height: 200 } } as NodeChange,
      ]
      // First-ever observation primes the cache; no prior → no delta.
      const deltas = result.current.detectAndCacheDimChanges(changes, 0)
      expect(deltas).toEqual([])
    })

    it('emits a delta when a project height grows on a subsequent batch', () => {
      const { result } = renderHook(() => useCascadeShifts())
      // Prime cache with initial dimensions.
      result.current.detectAndCacheDimChanges([
        { id: 'p1', type: 'dimensions', dimensions: { width: 280, height: 200 } } as NodeChange,
      ], 0)
      // Now the same node grows by 60px.
      const deltas = result.current.detectAndCacheDimChanges([
        { id: 'p1', type: 'dimensions', dimensions: { width: 280, height: 260 } } as NodeChange,
      ], 0)
      expect(deltas).toEqual([
        { nodeId: 'p1', previousHeight: 200, currentHeight: 260 },
      ])
    })

    it('suppresses cascade detection while a drag is active', () => {
      const { result } = renderHook(() => useCascadeShifts())
      // Prime cache.
      result.current.detectAndCacheDimChanges([
        { id: 'p1', type: 'dimensions', dimensions: { width: 280, height: 200 } } as NodeChange,
      ], 0)
      // draggingSize > 0 → skip detection but still update prevHeights.
      const deltas = result.current.detectAndCacheDimChanges([
        { id: 'p1', type: 'dimensions', dimensions: { width: 280, height: 260 } } as NodeChange,
      ], 1)
      expect(deltas).toEqual([])
      // The cache was still updated, so the next idle batch sees no delta.
      const next = result.current.detectAndCacheDimChanges([
        { id: 'p1', type: 'dimensions', dimensions: { width: 280, height: 260 } } as NodeChange,
      ], 0)
      expect(next).toEqual([])
    })

    it('skips floating-node ids (cascade only applies to projects)', () => {
      const { result } = renderHook(() => useCascadeShifts())
      result.current.detectAndCacheDimChanges([
        { id: 'note-5', type: 'dimensions', dimensions: { width: 240, height: 200 } } as NodeChange,
      ], 0)
      const deltas = result.current.detectAndCacheDimChanges([
        { id: 'note-5', type: 'dimensions', dimensions: { width: 240, height: 280 } } as NodeChange,
      ], 0)
      expect(deltas).toEqual([])
    })

    it('ignores in-flight resize frames (change.resizing === true)', () => {
      const { result } = renderHook(() => useCascadeShifts())
      result.current.detectAndCacheDimChanges([
        { id: 'p1', type: 'dimensions', dimensions: { width: 280, height: 200 } } as NodeChange,
      ], 0)
      const deltas = result.current.detectAndCacheDimChanges([
        { id: 'p1', type: 'dimensions', resizing: true, dimensions: { width: 280, height: 260 } } as NodeChange,
      ], 0)
      // resizing=true means the user is dragging the resize handle; cascade
      // fires on the final resize-stop frame, not intermediates.
      expect(deltas).toEqual([])
    })
  })

  describe('processSetNodesUpdate', () => {
    it('passes through when no drag is active and no dim deltas', () => {
      const { result } = renderHook(() => useCascadeShifts())
      const updated = [makeNode('p1', 100, 100), makeNode('p2', 100, 400)]
      const out = result.current.processSetNodesUpdate(
        updated,
        updated,
        false,
        new Set<string>(),
        [],
        makeGetRect(),
        makeRfInstanceRef(),
      )
      expect(out.nextNodes).toBe(updated)
      expect(out.alignmentLines).toEqual([])
      expect(out.cascadePersist).toEqual([])
    })

    it('returns alignmentLines=null (preserve) on multi-drag', () => {
      const { result } = renderHook(() => useCascadeShifts())
      const updated = [makeNode('p1'), makeNode('p2')]
      const out = result.current.processSetNodesUpdate(
        updated,
        updated,
        true,
        new Set(['p1', 'p2']),
        [],
        makeGetRect(),
        makeRfInstanceRef(),
      )
      // Multi-drag preserves prior alignment lines (caller sees null = "don't change").
      expect(out.alignmentLines).toBeNull()
    })
  })

  describe('persistCascadeShifts', () => {
    it('no-op when cascadePersist is empty', () => {
      const { result } = renderHook(() => useCascadeShifts())
      const droppedPositions = { current: new Map<string, { x: number; y: number; setAt: number }>() }
      let called = false
      act(() => {
        result.current.persistCascadeShifts([], droppedPositions, () => { called = true })
      })
      expect(called).toBe(false)
      expect(droppedPositions.current.size).toBe(0)
    })

    it('writes droppedPositions immediately and debounces the store callback', async () => {
      const { result } = renderHook(() => useCascadeShifts())
      const droppedPositions = { current: new Map<string, { x: number; y: number; setAt: number }>() }
      const onCascadeShift = (shifts: Array<{ projectId: number; x: number; y: number }>) => {
        droppedPositions.current.set('persisted', { x: shifts[0].x, y: shifts[0].y, setAt: 0 })
      }
      act(() => {
        result.current.persistCascadeShifts(
          [{ nodeId: '1', x: 100, y: 200 }],
          droppedPositions,
          onCascadeShift,
        )
      })
      // Visual override is immediate.
      expect(droppedPositions.current.get('1')).toMatchObject({ x: 100, y: 200 })
      // Store callback is debounced (300ms); didn't fire yet.
      expect(droppedPositions.current.get('persisted')).toBeUndefined()
    })
  })
})
