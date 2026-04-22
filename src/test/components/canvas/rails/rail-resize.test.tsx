import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, cleanup, fireEvent, screen } from '@testing-library/react'
import { DndContext } from '@dnd-kit/core'
import { RailContainer } from '../../../../components/canvas/rails/RailContainer'
import type { Rail } from '../../../../models/canvas-rails'
import { EMPTY_RAILS } from '../../../../models/canvas-rails'
import { useCanvasRailsStore } from '../../../../stores/canvas-rails-store'

// The resize handle schedules onResize through requestAnimationFrame; run it
// synchronously so assertions see the latest value without awaiting frames.
let rafSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
    cb(performance.now())
    return 0
  })
  useCanvasRailsStore.setState({ rails: EMPTY_RAILS, hydrated: false })
})

afterEach(() => {
  rafSpy.mockRestore()
  cleanup()
})

const lensRail: Rail = {
  orientation: 'vertical',
  slots: [{ id: 'slot-a', tabs: [{ id: 'slot-a-t0', type: 'lens' }], activeTabId: 'slot-a-t0' }],
}

const topRail: Rail = {
  orientation: 'horizontal',
  slots: [{ id: 'slot-b', tabs: [{ id: 'slot-b-t0', type: 'notes' }], activeTabId: 'slot-b-t0' }],
}

function getResizeHandle(side: string) {
  // Unified edge handle: click toggles collapse, drag resizes. The role is
  // still `separator` with an `aria-label` that documents both affordances.
  return screen.getByRole('separator', { name: new RegExp(`${side} rail`) })
}

function dispatchPointer(
  el: Element,
  type: 'pointerdown' | 'pointermove' | 'pointerup',
  coords: { clientX: number; clientY: number },
) {
  const fn = type === 'pointerdown' ? fireEvent.pointerDown
    : type === 'pointermove' ? fireEvent.pointerMove
    : fireEvent.pointerUp
  fn(el, {
    pointerId: 1,
    isPrimary: true,
    button: 0,
    bubbles: true,
    ...coords,
  })
}

describe('RailContainer resize handle', () => {
  it('calls onResize with the new clamped width when dragging the left rail', () => {
    const onResize = vi.fn()
    render(
      <DndContext>
        <RailContainer side="left" rail={lensRail} size={340} onResize={onResize}>
          <div />
        </RailContainer>
      </DndContext>,
    )
    const handle = getResizeHandle('left')
    dispatchPointer(handle, 'pointerdown', { clientX: 340, clientY: 100 })
    dispatchPointer(handle, 'pointermove', { clientX: 420, clientY: 100 })
    dispatchPointer(handle, 'pointerup', { clientX: 420, clientY: 100 })
    expect(onResize).toHaveBeenCalled()
    expect(onResize.mock.calls[onResize.mock.calls.length - 1][0]).toBe(420)
  })

  it('inverts the delta for right rails (canvas sits to the left)', () => {
    const onResize = vi.fn()
    render(
      <DndContext>
        <RailContainer side="right" rail={lensRail} size={340} onResize={onResize}>
          <div />
        </RailContainer>
      </DndContext>,
    )
    const handle = getResizeHandle('right')
    dispatchPointer(handle, 'pointerdown', { clientX: 1000, clientY: 100 })
    // Move the handle 80px to the RIGHT; right-rail width should SHRINK by 80.
    dispatchPointer(handle, 'pointermove', { clientX: 1080, clientY: 100 })
    dispatchPointer(handle, 'pointerup', { clientX: 1080, clientY: 100 })
    expect(onResize.mock.calls[onResize.mock.calls.length - 1][0]).toBe(260)
  })

  it('clamps drags past the 600 px maximum', () => {
    const onResize = vi.fn()
    render(
      <DndContext>
        <RailContainer side="left" rail={lensRail} size={340} onResize={onResize}>
          <div />
        </RailContainer>
      </DndContext>,
    )
    const handle = getResizeHandle('left')
    dispatchPointer(handle, 'pointerdown', { clientX: 340, clientY: 100 })
    dispatchPointer(handle, 'pointermove', { clientX: 2000, clientY: 100 })
    dispatchPointer(handle, 'pointerup', { clientX: 2000, clientY: 100 })
    expect(onResize.mock.calls[onResize.mock.calls.length - 1][0]).toBe(600)
  })

  it('dragging inward shrinks the rail, clamped at RAIL_SIZE_MIN (no auto-collapse)', () => {
    const onResize = vi.fn()
    render(
      <DndContext>
        <RailContainer side="left" rail={lensRail} size={340} onResize={onResize}>
          <div />
        </RailContainer>
      </DndContext>,
    )
    expect(useCanvasRailsStore.getState().rails.collapsed?.left).toBeUndefined()
    const handle = getResizeHandle('left')
    dispatchPointer(handle, 'pointerdown', { clientX: 340, clientY: 100 })
    // Pull well past the 60 px minimum — should clamp, NOT collapse.
    dispatchPointer(handle, 'pointermove', { clientX: 0, clientY: 100 })
    dispatchPointer(handle, 'pointerup', { clientX: 0, clientY: 100 })
    expect(onResize.mock.calls[onResize.mock.calls.length - 1][0]).toBe(60)
    expect(useCanvasRailsStore.getState().rails.collapsed?.left).toBeUndefined()
  })

  it('resizes a horizontal (top) rail via Y-axis delta', () => {
    const onResize = vi.fn()
    render(
      <DndContext>
        <RailContainer side="top" rail={topRail} size={260} onResize={onResize}>
          <div />
        </RailContainer>
      </DndContext>,
    )
    const handle = getResizeHandle('top')
    dispatchPointer(handle, 'pointerdown', { clientX: 500, clientY: 260 })
    dispatchPointer(handle, 'pointermove', { clientX: 500, clientY: 300 })
    dispatchPointer(handle, 'pointerup', { clientX: 500, clientY: 300 })
    expect(onResize.mock.calls[onResize.mock.calls.length - 1][0]).toBe(300)
  })

  it('applies the size as an inline width/height on the rail aside', () => {
    const { container } = render(
      <DndContext>
        <RailContainer side="left" rail={lensRail} size={420} onResize={() => {}}>
          <div />
        </RailContainer>
      </DndContext>,
    )
    const rail = container.querySelector('[data-rail-side="left"]') as HTMLElement
    expect(rail.style.width).toBe('420px')
  })
})
