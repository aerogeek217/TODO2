/**
 * Phase 5 float-dock (reverse): unit tests for `pointerToFlowPosition`. Pure
 * math — no DOM, no store. The helper converts client-space pointer coords
 * to React Flow (canvas-space) coords and centres the float on the pointer
 * by subtracting half the default widget width/height.
 */
import { describe, it, expect } from 'vitest'
import { pointerToFlowPosition } from '../../../../utils/rail-dnd'

// Default float dimensions used by the helper to centre on pointer.
// Exposed implicitly via the expected offsets below (half of 320×280 = 160×140).
const HALF_W = 160
const HALF_H = 140

describe('pointerToFlowPosition', () => {
  it('returns pointer-centered coords at zoom 1 with no pan and canvas origin', () => {
    const pos = pointerToFlowPosition(
      { x: 500, y: 400 },
      { left: 0, top: 0 },
      { x: 0, y: 0, zoom: 1 },
    )
    // pointer in flow space is (500, 400); centre the default-sized widget on it.
    expect(pos).toEqual({ x: 500 - HALF_W, y: 400 - HALF_H })
  })

  it('subtracts the canvas rect offset so coords are relative to the canvas', () => {
    // Canvas host starts at (100, 50) on screen — a click at (500, 400) lands
    // 400 px right / 350 px down of the canvas origin.
    const pos = pointerToFlowPosition(
      { x: 500, y: 400 },
      { left: 100, top: 50 },
      { x: 0, y: 0, zoom: 1 },
    )
    expect(pos).toEqual({ x: 400 - HALF_W, y: 350 - HALF_H })
  })

  it('inverts a viewport pan (vp.x, vp.y translate the flow origin on screen)', () => {
    // React Flow's viewport pan: the flow origin is drawn at (vp.x, vp.y) in
    // canvas-container coords. A pointer at (500, 400) in canvas-container
    // coords maps to (500 - vp.x, 400 - vp.y) in flow coords.
    const pos = pointerToFlowPosition(
      { x: 500, y: 400 },
      { left: 0, top: 0 },
      { x: 120, y: 80, zoom: 1 },
    )
    expect(pos).toEqual({ x: 500 - 120 - HALF_W, y: 400 - 80 - HALF_H })
  })

  it('divides by zoom so the flow-space distance scales inversely with zoom', () => {
    // At zoom=2, 400 screen-px of canvas distance corresponds to 200 flow-px.
    const pos = pointerToFlowPosition(
      { x: 400, y: 400 },
      { left: 0, top: 0 },
      { x: 0, y: 0, zoom: 2 },
    )
    expect(pos).toEqual({ x: 400 / 2 - HALF_W, y: 400 / 2 - HALF_H })
  })

  it('composes canvas offset + pan + zoom correctly', () => {
    // Real-world shape: canvas at (340, 260) (left rail 340 px, top rail 260 px),
    // viewport panned (50, 30) at zoom 0.5, pointer at (900, 600).
    const pos = pointerToFlowPosition(
      { x: 900, y: 600 },
      { left: 340, top: 260 },
      { x: 50, y: 30, zoom: 0.5 },
    )
    const expectedFlowX = (900 - 340 - 50) / 0.5
    const expectedFlowY = (600 - 260 - 30) / 0.5
    expect(pos).toEqual({ x: expectedFlowX - HALF_W, y: expectedFlowY - HALF_H })
  })

  it('handles zoom < 1 without sign flips (pan and centre offset still apply)', () => {
    const pos = pointerToFlowPosition(
      { x: 260, y: 200 },
      { left: 100, top: 100 },
      { x: -50, y: -40, zoom: 0.25 },
    )
    // (260 - 100 - (-50)) / 0.25 = 210 / 0.25 = 840
    // (200 - 100 - (-40)) / 0.25 = 140 / 0.25 = 560
    expect(pos).toEqual({ x: 840 - HALF_W, y: 560 - HALF_H })
  })
})
