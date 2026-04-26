import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { NodeChange, XYPosition } from '@xyflow/react'
import { useFloatDragLifecycle } from '../../hooks/use-float-drag-lifecycle'
import { useUIStore } from '../../stores/ui-store'
import { resolveFloatDockTarget } from '../../utils/rail-dnd'

/**
 * Pure-hook tests for `useFloatDragLifecycle` (extracted from CanvasView in
 * code-review-2026-04-25 P5). Covers: drag-id tracking, position-persist
 * dispatch on release, multi-drag flag suppression, and ui-store float-drag
 * publication. The float-dock hit-test branch is exercised end-to-end by
 * the existing canvas tests through `RailsFrame` + `useRailsDragMonitor`.
 */

vi.mock('../../utils/rail-dnd', async () => {
  const actual = await vi.importActual<typeof import('../../utils/rail-dnd')>(
    '../../utils/rail-dnd',
  )
  return { ...actual, resolveFloatDockTarget: vi.fn(() => null) }
})

beforeEach(() => {
  useUIStore.setState({ floatDrag: null, floatAnnouncement: '' })
  vi.mocked(resolveFloatDockTarget).mockReset().mockReturnValue(null)
})

function positionChange(id: string, dragging: boolean, position?: XYPosition): NodeChange {
  return { id, type: 'position', dragging, position } as NodeChange
}

function makeCallbacks() {
  return {
    onFloatDock: vi.fn(),
    onTaskboardDragStop: vi.fn(),
    onInsetDragStop: vi.fn(),
    onNoteDragStop: vi.fn(),
    onCalendarDragStop: vi.fn(),
    onHorizonsDragStop: vi.fn(),
    onNodeDragStop: vi.fn(),
  }
}

describe('useFloatDragLifecycle', () => {
  it('no-op on an empty change batch', () => {
    const callbacks = makeCallbacks()
    const { result } = renderHook(() => useFloatDragLifecycle(callbacks))
    let outcome: { hasActiveDrag: boolean } | null = null
    act(() => {
      outcome = result.current.processBatch([])
    })
    expect(outcome).toEqual({ hasActiveDrag: false })
    expect(result.current.draggingIds.current.size).toBe(0)
    for (const cb of Object.values(callbacks)) expect(cb).not.toHaveBeenCalled()
  })

  it('tracks dragging ids across drag-start frames', () => {
    const callbacks = makeCallbacks()
    const { result } = renderHook(() => useFloatDragLifecycle(callbacks))
    act(() => {
      result.current.processBatch([positionChange('1', true)])
    })
    expect(result.current.draggingIds.current.has('1')).toBe(true)
    expect(callbacks.onNodeDragStop).not.toHaveBeenCalled()
  })

  it('persists project node position on drag-end', () => {
    const callbacks = makeCallbacks()
    const { result } = renderHook(() => useFloatDragLifecycle(callbacks))
    // Drag start.
    act(() => {
      result.current.processBatch([positionChange('42', true)])
    })
    // Drag end with final position.
    act(() => {
      result.current.processBatch([positionChange('42', false, { x: 120, y: 80 })])
    })
    expect(callbacks.onNodeDragStop).toHaveBeenCalledWith(42, 120, 80)
    expect(result.current.draggingIds.current.size).toBe(0)
    // Dropped position cache holds the final coords for the sync effect.
    const dropped = result.current.droppedPositions.current.get('42')
    expect(dropped).toMatchObject({ x: 120, y: 80 })
  })

  it('routes a floating note drag-end to onNoteDragStop with the parsed float id', () => {
    const callbacks = makeCallbacks()
    const { result } = renderHook(() => useFloatDragLifecycle(callbacks))
    act(() => {
      result.current.processBatch([positionChange('note-7', true)])
    })
    act(() => {
      result.current.processBatch([positionChange('note-7', false, { x: 50, y: 60 })])
    })
    expect(callbacks.onNoteDragStop).toHaveBeenCalledWith(7, 50, 60)
    expect(callbacks.onNodeDragStop).not.toHaveBeenCalled()
  })

  it('routes a floating taskboard drag-end to onTaskboardDragStop', () => {
    const callbacks = makeCallbacks()
    const { result } = renderHook(() => useFloatDragLifecycle(callbacks))
    act(() => {
      result.current.processBatch([positionChange('taskboard-3', true)])
    })
    act(() => {
      result.current.processBatch([positionChange('taskboard-3', false, { x: 10, y: 20 })])
    })
    expect(callbacks.onTaskboardDragStop).toHaveBeenCalledWith(3, 10, 20)
  })

  it('publishes ui-store.floatDrag while a float is being dragged, clears on release', () => {
    const callbacks = makeCallbacks()
    const { result } = renderHook(() => useFloatDragLifecycle(callbacks))
    act(() => {
      result.current.processBatch([positionChange('note-9', true)])
    })
    expect(useUIStore.getState().floatDrag).toEqual({ kind: 'note', id: 9 })
    act(() => {
      result.current.processBatch([positionChange('note-9', false, { x: 0, y: 0 })])
    })
    expect(useUIStore.getState().floatDrag).toBeNull()
  })

  it('does not publish floatDrag while a project (non-float) node is dragging', () => {
    const callbacks = makeCallbacks()
    const { result } = renderHook(() => useFloatDragLifecycle(callbacks))
    act(() => {
      result.current.processBatch([positionChange('5', true)])
    })
    expect(useUIStore.getState().floatDrag).toBeNull()
  })

  // Regression — float-dock-bugs-2026-04-25 P1 (B1). The window-level
  // pointerup handler defers cleanup via `requestAnimationFrame` so RF's
  // `dragging:false` change reaches `processBatch` first; the release branch
  // must hit-test against the pointer captured before pointerup. Two
  // contracts pinned here:
  //   - Cleanup must NOT run synchronously with pointerup (older microtask
  //     impl raced ahead of `processBatch` and unmounted DockOverlay before
  //     the hit-test, so float drops onto an empty rail side missed).
  //   - After processBatch dispatches the dock, the pending rAF callback
  //     must short-circuit (no double cleanup, no wedged `floatDrag`).
  it('defers cleanup until after processBatch sees the release', async () => {
    vi.mocked(resolveFloatDockTarget).mockReturnValue({ kind: 'empty-side', side: 'left' })
    const rafCallbacks: FrameRequestCallback[] = []
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      rafCallbacks.push(cb)
      return rafCallbacks.length
    })
    try {
      const callbacks = makeCallbacks()
      const { result } = renderHook(() => useFloatDragLifecycle(callbacks))

      // Drag start — leading edge attaches the window pointermove + pointerup
      // listeners.
      act(() => {
        result.current.processBatch([positionChange('note-1', true)])
      })

      // Pointer moves — listener stashes coords into pointerRef.
      act(() => {
        const ev = new Event('pointermove')
        Object.assign(ev, { clientX: 100, clientY: 200 })
        window.dispatchEvent(ev)
      })

      // Pointer release — onUpOrCancel schedules a rAF cleanup but does NOT
      // run it. Microtask drain is a no-op — the cleanup is deferred to the
      // next animation frame.
      act(() => {
        window.dispatchEvent(new Event('pointerup'))
      })
      await Promise.resolve()
      expect(rafSpy).toHaveBeenCalledTimes(1)

      // Drag-end frame from RF — release branch hit-tests against the
      // captured pointer and dispatches the dock. processBatch's trailing-
      // edge cleanup nulls `pointerCleanupRef`.
      act(() => {
        result.current.processBatch([positionChange('note-1', false, { x: 0, y: 0 })])
      })
      expect(callbacks.onFloatDock).toHaveBeenCalledWith(
        { kind: 'note', floatId: 1 },
        { kind: 'empty-side', side: 'left' },
      )
      expect(callbacks.onNoteDragStop).not.toHaveBeenCalled()

      // Now drain the deferred rAF — it should detect that processBatch
      // already cleaned up (`pointerCleanupRef.current !== detach`) and
      // early-return without touching ui-store again.
      const announcementBefore = useUIStore.getState().floatAnnouncement
      act(() => {
        for (const cb of rafCallbacks.splice(0)) cb(performance.now())
      })
      expect(useUIStore.getState().floatAnnouncement).toBe(announcementBefore)
    } finally {
      rafSpy.mockRestore()
    }
  })
})
