import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, render, cleanup, fireEvent, screen } from '@testing-library/react'
import { DndContext } from '@dnd-kit/core'
import { RailContainer } from '../../../../components/canvas/rails/RailContainer'
import type { Rail } from '../../../../models/canvas-rails'
import { useCanvasRailsStore } from '../../../../stores/canvas-rails-store'
import { useUIStore } from '../../../../stores/ui-store'
import { resetRailsStore } from '../../../helpers'

// The resize handle schedules onResize through requestAnimationFrame; run it
// synchronously so assertions see the latest value without awaiting frames.
let rafSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
    cb(performance.now())
    return 0
  })
  resetRailsStore()
  useUIStore.setState({ floatDrag: null })
})

afterEach(() => {
  rafSpy.mockRestore()
  useUIStore.setState({ floatDrag: null })
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
    expect(onResize.mock.calls[onResize.mock.calls.length - 1]![0]).toBe(420)
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
    expect(onResize.mock.calls[onResize.mock.calls.length - 1]![0]).toBe(260)
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
    expect(onResize.mock.calls[onResize.mock.calls.length - 1]![0]).toBe(600)
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
    expect(onResize.mock.calls[onResize.mock.calls.length - 1]![0]).toBe(60)
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
    expect(onResize.mock.calls[onResize.mock.calls.length - 1]![0]).toBe(300)
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

/**
 * P5 (T1 facet B): when a rail collapses, `RailContainer` renders icon stubs
 * in place of `DraggableSlot` — but the slot's `rails:slot:<id>` drop zone
 * disappeared along with the body. The fix re-registers the drop id on each
 * collapsed stub so float drags + dnd-kit slot/tab drags still target the
 * slot. These tests pin the DOM contract `resolveFloatDockTarget` walks.
 */
describe('CollapsedSlotStub drop zone', () => {
  it('renders data-rails-drop-id="rails:slot:<id>" on each stub when collapsed', () => {
    const multiSlotRail: Rail = {
      orientation: 'vertical',
      slots: [
        { id: 'slot-a', tabs: [{ id: 'a-t0', type: 'lens' }], activeTabId: 'a-t0' },
        { id: 'slot-b', tabs: [{ id: 'b-t0', type: 'notes' }], activeTabId: 'b-t0' },
      ],
    }
    const { container } = render(
      <DndContext>
        <RailContainer side="right" rail={multiSlotRail} size={28} collapsed onResize={() => {}}>
          <div />
        </RailContainer>
      </DndContext>,
    )
    const rail = container.querySelector('[data-rail-side="right"]') as HTMLElement
    expect(rail.dataset.railCollapsed).toBe('true')
    const stubA = container.querySelector('[data-slot-id="slot-a"]') as HTMLElement
    const stubB = container.querySelector('[data-slot-id="slot-b"]') as HTMLElement
    expect(stubA.dataset.railsDropId).toBe('rails:slot:slot-a')
    expect(stubB.dataset.railsDropId).toBe('rails:slot:slot-b')
  })

  it('does NOT render stubs (or their drop zones) when expanded', () => {
    const { container } = render(
      <DndContext>
        <RailContainer side="right" rail={lensRail} size={340} onResize={() => {}}>
          <div />
        </RailContainer>
      </DndContext>,
    )
    // Expanded: no `data-rail-collapsed="true"`, and no stub drop zones —
    // `DraggableSlot` (rendered by the parent in production) owns the drop id.
    const rail = container.querySelector('[data-rail-side="right"]') as HTMLElement
    expect(rail.dataset.railCollapsed).toBe('false')
    expect(container.querySelector('[data-slot-id="slot-a"]')).toBeNull()
  })

  it('marks the collapsed aside as a "collapsed-side" drop zone (triage-2026-04-26 T3)', () => {
    const multiSlotRail: Rail = {
      orientation: 'vertical',
      slots: [
        { id: 'slot-a', tabs: [{ id: 'a-t0', type: 'lens' }], activeTabId: 'a-t0' },
      ],
    }
    const { container } = render(
      <DndContext>
        <RailContainer side="right" rail={multiSlotRail} size={28} collapsed onResize={() => {}}>
          <div />
        </RailContainer>
      </DndContext>,
    )
    const rail = container.querySelector('[data-rail-side="right"]') as HTMLElement
    // Whole aside is the catch-all drop target; per-stub `rails:slot:<id>`
    // zones still take priority on direct hits via resolver ordering.
    expect(rail.dataset.railsDropId).toBe('rails:collapsed-side:right')
  })

  it('does NOT mark the aside as a drop zone when expanded', () => {
    const { container } = render(
      <DndContext>
        <RailContainer side="right" rail={lensRail} size={340} onResize={() => {}}>
          <div />
        </RailContainer>
      </DndContext>,
    )
    const rail = container.querySelector('[data-rail-side="right"]') as HTMLElement
    expect(rail.dataset.railsDropId).toBeUndefined()
  })

  it('resolves a float drag onto a collapsed stub via resolveFloatDockTarget', async () => {
    const { resolveFloatDockTarget } = await import('../../../../utils/rail-dnd')
    const multiSlotRail: Rail = {
      orientation: 'vertical',
      slots: [{ id: 'slot-x', tabs: [{ id: 'x-t0', type: 'calendar' }], activeTabId: 'x-t0' }],
    }
    const { container } = render(
      <DndContext>
        <RailContainer side="right" rail={multiSlotRail} size={28} collapsed onResize={() => {}}>
          <div />
        </RailContainer>
      </DndContext>,
    )
    const stub = container.querySelector('[data-slot-id="slot-x"]') as HTMLElement
    // Stub won't lay out under jsdom (zero rect by default); patch its rect so
    // the resolver's `pointerToSplitZone` returns a deterministic 'center'.
    stub.getBoundingClientRect = (() => ({
      left: 1900, top: 80, right: 1928, bottom: 160,
      width: 28, height: 80, x: 1900, y: 80,
      toJSON() { return this },
    })) as unknown as () => DOMRect
    const target = resolveFloatDockTarget(
      { x: 1914, y: 120 },
      {
        elementsFromPoint: () => [stub],
        getSlotOrientation: () => 'vertical',
      },
    )
    expect(target).toEqual({ kind: 'slot', slotId: 'slot-x', zone: 'center' })
  })
})

/**
 * P5 (triage-2026-04-27): when a floating widget is being dragged anywhere
 * inside a collapsed rail's `<aside>`, the nearest stub by axis-distance
 * gets `.iconStubOver` so the user always sees a visible dock target —
 * including releases on margin / between stubs / outside any individual
 * stub's rect. Mirrors `nearestStubSlotId`'s resolver-side bisection so the
 * visible target and the actual dock target can never diverge.
 */
describe('Collapsed rail aside-level nearest-stub highlight', () => {
  function patchRect(el: HTMLElement, rect: { left: number; top: number; width: number; height: number }) {
    el.getBoundingClientRect = (() => ({
      left: rect.left,
      top: rect.top,
      right: rect.left + rect.width,
      bottom: rect.top + rect.height,
      width: rect.width,
      height: rect.height,
      x: rect.left,
      y: rect.top,
      toJSON() { return this },
    })) as unknown as () => DOMRect
  }

  function dispatchPointerMove(x: number, y: number) {
    act(() => {
      window.dispatchEvent(new PointerEvent('pointermove', {
        clientX: x,
        clientY: y,
        bubbles: true,
      }))
    })
  }

  const threeSlotRail: Rail = {
    orientation: 'vertical',
    slots: [
      { id: 'slot-a', tabs: [{ id: 'a-t0', type: 'lens' }], activeTabId: 'a-t0' },
      { id: 'slot-b', tabs: [{ id: 'b-t0', type: 'notes' }], activeTabId: 'b-t0' },
      { id: 'slot-c', tabs: [{ id: 'c-t0', type: 'calendar' }], activeTabId: 'c-t0' },
    ],
  }

  it('highlights only the nearest stub when pointer is between stubs during a float drag', () => {
    const { container } = render(
      <DndContext>
        <RailContainer side="left" rail={threeSlotRail} size={28} collapsed onResize={() => {}}>
          <div />
        </RailContainer>
      </DndContext>,
    )
    const aside = container.querySelector('[data-rail-side="left"]') as HTMLElement
    const stubA = container.querySelector('[data-slot-id="slot-a"]') as HTMLElement
    const stubB = container.querySelector('[data-slot-id="slot-b"]') as HTMLElement
    const stubC = container.querySelector('[data-slot-id="slot-c"]') as HTMLElement
    patchRect(aside, { left: 0, top: 0, width: 28, height: 600 })
    patchRect(stubA, { left: 0, top: 20, width: 28, height: 40 })
    patchRect(stubB, { left: 0, top: 100, width: 28, height: 40 })
    patchRect(stubC, { left: 0, top: 200, width: 28, height: 40 })

    // Set a float drag in flight — gates the aside-level pointer listener.
    act(() => {
      useUIStore.setState({ floatDrag: { kind: 'note', id: 1 } })
    })

    // Pointer at y=80 sits in the gap between stubA (mid=40) and stubB (mid=120).
    // Distance: A=40, B=40 — first hit (A) wins per nearestStubSlotId's tie rule.
    dispatchPointerMove(14, 80)
    expect(stubA.className).toMatch(/iconStubOver/)
    expect(stubB.className).not.toMatch(/iconStubOver/)
    expect(stubC.className).not.toMatch(/iconStubOver/)

    // Move the pointer further down into stubB's neighborhood; nearest flips.
    dispatchPointerMove(14, 130)
    expect(stubA.className).not.toMatch(/iconStubOver/)
    expect(stubB.className).toMatch(/iconStubOver/)
    expect(stubC.className).not.toMatch(/iconStubOver/)
  })

  it('highlights the first stub when pointer is above all stubs (top padding) during a float drag', () => {
    const { container } = render(
      <DndContext>
        <RailContainer side="left" rail={threeSlotRail} size={28} collapsed onResize={() => {}}>
          <div />
        </RailContainer>
      </DndContext>,
    )
    const aside = container.querySelector('[data-rail-side="left"]') as HTMLElement
    const stubA = container.querySelector('[data-slot-id="slot-a"]') as HTMLElement
    const stubB = container.querySelector('[data-slot-id="slot-b"]') as HTMLElement
    const stubC = container.querySelector('[data-slot-id="slot-c"]') as HTMLElement
    patchRect(aside, { left: 0, top: 0, width: 28, height: 600 })
    patchRect(stubA, { left: 0, top: 100, width: 28, height: 40 })
    patchRect(stubB, { left: 0, top: 200, width: 28, height: 40 })
    patchRect(stubC, { left: 0, top: 300, width: 28, height: 40 })
    act(() => {
      useUIStore.setState({ floatDrag: { kind: 'note', id: 1 } })
    })

    // Pointer at y=10 — well above all stubs but still inside the aside.
    dispatchPointerMove(14, 10)
    expect(stubA.className).toMatch(/iconStubOver/)
    expect(stubB.className).not.toMatch(/iconStubOver/)
    expect(stubC.className).not.toMatch(/iconStubOver/)
  })

  it('clears the highlight when pointer leaves the aside during a float drag', () => {
    const { container } = render(
      <DndContext>
        <RailContainer side="left" rail={threeSlotRail} size={28} collapsed onResize={() => {}}>
          <div />
        </RailContainer>
      </DndContext>,
    )
    const aside = container.querySelector('[data-rail-side="left"]') as HTMLElement
    const stubA = container.querySelector('[data-slot-id="slot-a"]') as HTMLElement
    const stubB = container.querySelector('[data-slot-id="slot-b"]') as HTMLElement
    const stubC = container.querySelector('[data-slot-id="slot-c"]') as HTMLElement
    patchRect(aside, { left: 0, top: 0, width: 28, height: 600 })
    patchRect(stubA, { left: 0, top: 20, width: 28, height: 40 })
    patchRect(stubB, { left: 0, top: 100, width: 28, height: 40 })
    patchRect(stubC, { left: 0, top: 200, width: 28, height: 40 })
    act(() => {
      useUIStore.setState({ floatDrag: { kind: 'note', id: 1 } })
    })

    // First, move inside the aside to highlight the nearest stub.
    dispatchPointerMove(14, 130)
    expect(stubB.className).toMatch(/iconStubOver/)

    // Then move the pointer outside the aside (x past the right edge).
    dispatchPointerMove(500, 130)
    expect(stubA.className).not.toMatch(/iconStubOver/)
    expect(stubB.className).not.toMatch(/iconStubOver/)
    expect(stubC.className).not.toMatch(/iconStubOver/)
  })

  it('does NOT highlight any stub on pointer move when no float drag is active', () => {
    const { container } = render(
      <DndContext>
        <RailContainer side="left" rail={threeSlotRail} size={28} collapsed onResize={() => {}}>
          <div />
        </RailContainer>
      </DndContext>,
    )
    const aside = container.querySelector('[data-rail-side="left"]') as HTMLElement
    const stubA = container.querySelector('[data-slot-id="slot-a"]') as HTMLElement
    const stubB = container.querySelector('[data-slot-id="slot-b"]') as HTMLElement
    const stubC = container.querySelector('[data-slot-id="slot-c"]') as HTMLElement
    patchRect(aside, { left: 0, top: 0, width: 28, height: 600 })
    patchRect(stubA, { left: 0, top: 20, width: 28, height: 40 })
    patchRect(stubB, { left: 0, top: 100, width: 28, height: 40 })
    patchRect(stubC, { left: 0, top: 200, width: 28, height: 40 })

    // floatDrag stays null — listener should not be attached, no stub highlights.
    dispatchPointerMove(14, 130)
    expect(stubA.className).not.toMatch(/iconStubOver/)
    expect(stubB.className).not.toMatch(/iconStubOver/)
    expect(stubC.className).not.toMatch(/iconStubOver/)
  })

  it('horizontal rail: highlights nearest stub by X distance during a float drag', () => {
    const horizThreeSlot: Rail = {
      orientation: 'horizontal',
      slots: [
        { id: 'h-a', tabs: [{ id: 'h-a-t0', type: 'lens' }], activeTabId: 'h-a-t0' },
        { id: 'h-b', tabs: [{ id: 'h-b-t0', type: 'notes' }], activeTabId: 'h-b-t0' },
        { id: 'h-c', tabs: [{ id: 'h-c-t0', type: 'calendar' }], activeTabId: 'h-c-t0' },
      ],
    }
    const { container } = render(
      <DndContext>
        <RailContainer side="top" rail={horizThreeSlot} size={28} collapsed onResize={() => {}}>
          <div />
        </RailContainer>
      </DndContext>,
    )
    const aside = container.querySelector('[data-rail-side="top"]') as HTMLElement
    const stubA = container.querySelector('[data-slot-id="h-a"]') as HTMLElement
    const stubB = container.querySelector('[data-slot-id="h-b"]') as HTMLElement
    const stubC = container.querySelector('[data-slot-id="h-c"]') as HTMLElement
    patchRect(aside, { left: 0, top: 0, width: 600, height: 28 })
    patchRect(stubA, { left: 20, top: 0, width: 40, height: 28 })
    patchRect(stubB, { left: 100, top: 0, width: 40, height: 28 })
    patchRect(stubC, { left: 200, top: 0, width: 40, height: 28 })
    act(() => {
      useUIStore.setState({ floatDrag: { kind: 'note', id: 1 } })
    })

    // Pointer at x=210 — closest to stubC (mid=220, dist=10).
    dispatchPointerMove(210, 14)
    expect(stubC.className).toMatch(/iconStubOver/)
    expect(stubA.className).not.toMatch(/iconStubOver/)
    expect(stubB.className).not.toMatch(/iconStubOver/)
  })
})
