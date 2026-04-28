/**
 * triage-2026-04-27 P7: distinct rail-drop visual per outcome.
 *
 * The user reported (item 5): "Sometimes shows swap when in fact it becomes a
 * new tab. Swap should only be relevant to entire rails, not widgets."
 *
 * `DraggableSlot`'s `ZoneIndicator` now picks distinct labels + outcome
 * classes per drag kind:
 *   - slot drag, center  → swap     ("Swap")
 *   - slot drag, edge    → insert   ("Insert above/below/left/right")
 *   - float drag, center → addTab   ("Add tab")
 *   - float drag, edge   → newSlot  ("New slot above/below/left/right")
 *
 * `DockOverlay`'s `SubZone` now distinguishes corner-claim from new-slot via
 * a visible label + outcome data-attribute:
 *   - non-corner → newSlot     ("New slot {side}")
 *   - corner     → cornerClaim ("Claim {nw/ne/sw/se}")
 *
 * These tests pin the rendered DOM (test ids, labels, data-outcome) — pure
 * rendering once hover state is set, so JSDOM is authoritative.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { act, cleanup, render, fireEvent } from '@testing-library/react'
import { DndContext } from '@dnd-kit/core'
import type { ReactElement } from 'react'
import { DraggableSlot } from '../../../../components/canvas/rails/DraggableSlot'
import { DockOverlay } from '../../../../components/canvas/rails/DockOverlay'
import { useUIStore } from '../../../../stores/ui-store'
import { installBoundingRectMock } from '../../../utils/bounding-rect-mock'

const SLOT_RECT = { left: 100, top: 100, width: 400, height: 400 }

function renderSlot(): { unmount: () => void; restoreRects: () => void } {
  const restoreRects = installBoundingRectMock((el) => {
    if (el.dataset.slotId === 'slot-test') return SLOT_RECT
    return null
  })
  const header = (<header data-testid="slot-header">header</header>) as ReactElement
  const body = <div data-testid="slot-body">body</div>
  const result = render(
    <DndContext>
      <DraggableSlot slotId="slot-test" fromSide="left" header={header}>
        {body}
      </DraggableSlot>
    </DndContext>,
  )
  return { unmount: result.unmount, restoreRects }
}

beforeEach(() => {
  useUIStore.setState({ floatDrag: null })
})

afterEach(() => {
  cleanup()
  useUIStore.setState({ floatDrag: null })
})

describe('ZoneIndicator — float drag (item 5: swap should not appear for widgets)', () => {
  it('center hover during a float drag shows the addTab indicator (NOT swap)', async () => {
    const h = renderSlot()
    try {
      // Activate float drag via ui-store; DraggableSlot listens for this slice.
      await act(async () => {
        useUIStore.setState({
          floatDrag: { id: 99, kind: 'note' },
        })
        await Promise.resolve()
      })
      // Pointer at slot center (300, 300 inside the 100/100→500/500 rect).
      await act(async () => {
        fireEvent.pointerMove(window, {
          clientX: SLOT_RECT.left + SLOT_RECT.width / 2,
          clientY: SLOT_RECT.top + SLOT_RECT.height / 2,
          pointerId: 1,
          isPrimary: true,
          bubbles: true,
        })
        await Promise.resolve()
      })
      // The float-center outcome is "addTab", not "swap". Pre-fix the same
      // gesture rendered a swap-indicator labelled "Swap".
      expect(document.querySelector('[data-testid="addTab-indicator"]')).not.toBeNull()
      expect(document.querySelector('[data-testid="swap-indicator"]')).toBeNull()
      const indicator = document.querySelector<HTMLElement>('[data-testid="addTab-indicator"]')!
      expect(indicator.dataset.outcome).toBe('addTab')
      expect(indicator.dataset.dragKind).toBe('float')
      expect(indicator.textContent).toContain('Add tab')
    } finally {
      h.unmount()
      h.restoreRects()
    }
  })

  it('edge hover during a float drag shows the newSlot indicator with directional label', async () => {
    const h = renderSlot()
    try {
      await act(async () => {
        useUIStore.setState({
          floatDrag: { id: 99, kind: 'note' },
        })
        await Promise.resolve()
      })
      // Pointer near top edge of vertical slot → above zone.
      await act(async () => {
        fireEvent.pointerMove(window, {
          clientX: SLOT_RECT.left + SLOT_RECT.width / 2,
          clientY: SLOT_RECT.top + 20, // 5% from top → 'above'
          pointerId: 1,
          isPrimary: true,
          bubbles: true,
        })
        await Promise.resolve()
      })
      const indicator = document.querySelector<HTMLElement>('[data-testid="newSlot-indicator"]')
      expect(indicator).not.toBeNull()
      expect(indicator!.dataset.outcome).toBe('newSlot')
      expect(indicator!.dataset.dragKind).toBe('float')
      expect(indicator!.dataset.zone).toBe('above')
      expect(indicator!.textContent).toContain('New slot above')
      // No swap or insert leakage.
      expect(document.querySelector('[data-testid="swap-indicator"]')).toBeNull()
      expect(document.querySelector('[data-testid="insert-indicator"]')).toBeNull()
    } finally {
      h.unmount()
      h.restoreRects()
    }
  })

  it('hover clears when the pointer leaves the slot rect during a float drag', async () => {
    const h = renderSlot()
    try {
      // Two-phase: setState first (effect re-runs and registers the
      // pointermove listener), THEN dispatch the move so the listener fires.
      await act(async () => {
        useUIStore.setState({
          floatDrag: { id: 99, kind: 'note' },
        })
        await Promise.resolve()
      })
      await act(async () => {
        fireEvent.pointerMove(window, {
          clientX: SLOT_RECT.left + 200,
          clientY: SLOT_RECT.top + 200,
          pointerId: 1,
          isPrimary: true,
          bubbles: true,
        })
        await Promise.resolve()
      })
      expect(document.querySelector('[data-testid="addTab-indicator"]')).not.toBeNull()
      // Move pointer outside the slot; the gateToRect branch fires for float
      // drags and clears the hover state.
      await act(async () => {
        fireEvent.pointerMove(window, {
          clientX: SLOT_RECT.left - 50,
          clientY: SLOT_RECT.top - 50,
          pointerId: 1,
          isPrimary: true,
          bubbles: true,
        })
        await Promise.resolve()
      })
      expect(document.querySelector('[data-testid="addTab-indicator"]')).toBeNull()
      expect(document.querySelector('[data-testid="newSlot-indicator"]')).toBeNull()
    } finally {
      h.unmount()
      h.restoreRects()
    }
  })
})

describe('DockOverlay SubZone — distinct corner vs new-slot visual', () => {
  it('non-corner sub-zone renders the "New slot {side}" label and data-outcome="newSlot"', () => {
    render(
      <DndContext>
        <DockOverlay emptySides={['left']} floatDragActive />
      </DndContext>,
    )
    // Three sub-zones per side: start, center, end. The center one carries no
    // claim → outcome "newSlot".
    const subZones = document.querySelectorAll<HTMLElement>('[data-rails-drop-id^="rails:empty-side:"]')
    expect(subZones.length).toBe(3)
    const center = Array.from(subZones).find((el) => el.dataset.outcome === 'newSlot')
    const corners = Array.from(subZones).filter((el) => el.dataset.outcome === 'cornerClaim')
    expect(center).toBeDefined()
    expect(corners.length).toBe(2)
    expect(center!.textContent).toContain('New slot left')
  })

  it('corner sub-zones render a "Claim {direction}" label', () => {
    render(
      <DndContext>
        <DockOverlay emptySides={['top']} floatDragActive />
      </DndContext>,
    )
    const corners = document.querySelectorAll<HTMLElement>('[data-outcome="cornerClaim"]')
    expect(corners.length).toBe(2)
    const labels = Array.from(corners).map((el) => el.textContent ?? '')
    // Top rail's start corner → northwest, end corner → northeast.
    expect(labels.some((t) => t.includes('Claim northwest'))).toBe(true)
    expect(labels.some((t) => t.includes('Claim northeast'))).toBe(true)
  })

  it('preserves the prior aria-label "Dock to {side} rail" for the non-corner sub-zone', () => {
    // Spec safety: changing the visible label shouldn't drop the screen-reader
    // affordance. The aria-label is the assistive description; the visible
    // span is the new visual cue.
    render(
      <DndContext>
        <DockOverlay emptySides={['right']} floatDragActive />
      </DndContext>,
    )
    const center = document.querySelector<HTMLElement>('[data-outcome="newSlot"][data-rails-drop-id="rails:empty-side:right"]')
    expect(center).not.toBeNull()
    expect(center!.getAttribute('aria-label')).toBe('Dock to right rail')
    const corner = document.querySelector<HTMLElement>('[data-outcome="cornerClaim"][data-rails-drop-id="rails:empty-side:right:start"]')
    expect(corner).not.toBeNull()
    expect(corner!.getAttribute('aria-label')).toBe('Dock to right rail, claim northeast corner')
  })
})
