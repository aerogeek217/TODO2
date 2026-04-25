import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { DndContext } from '@dnd-kit/core'
import type { ReactNode } from 'react'
import { useRailsDragMonitor } from '../../hooks/use-rails-drag-monitor'
import { useCanvasRailsStore } from '../../stores/canvas-rails-store'
import { EMPTY_RAILS } from '../../models/canvas-rails'

/**
 * Smoke tests for `useRailsDragMonitor` (extracted from RailsFrame in
 * code-review-2026-04-25 P5). The monitor's behavior is exercised end-to-end
 * by the harness tests in `rail-dnd-harness.test.tsx` + `rail-dnd-pointer
 * .test.tsx`; these tests cover only the no-op + initial-state contract so
 * a regression in the extraction surfaces independently.
 */

beforeEach(() => {
  useCanvasRailsStore.setState({ rails: EMPTY_RAILS, hydrated: true, pendingFocusSlotId: null })
})

function wrapInDndContext(children: ReactNode) {
  return <DndContext>{children}</DndContext>
}

describe('useRailsDragMonitor', () => {
  it('starts with no dragging slot + empty announcement', () => {
    const { result } = renderHook(() => useRailsDragMonitor(), {
      wrapper: ({ children }) => wrapInDndContext(children),
    })
    expect(result.current.draggingSlot).toBeNull()
    expect(result.current.announcement).toBe('')
  })

  it('survives mount + unmount without firing announcements', () => {
    const { result, unmount } = renderHook(() => useRailsDragMonitor(), {
      wrapper: ({ children }) => wrapInDndContext(children),
    })
    expect(result.current.announcement).toBe('')
    act(() => { unmount() })
    // Unmount-mid-idle should not throw — the cleanup ref is null when no
    // drag is in flight, and the unmount effect handles that case.
  })
})
