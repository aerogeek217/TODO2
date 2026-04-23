/**
 * Phase 2 float-dock: unit tests for `resolveFloatDockTarget`. The helper is
 * pure given a pointer + two dependencies: an `elementsFromPoint` stub and a
 * `getSlotOrientation` lookup. Tests stub both and construct real HTMLElements
 * (so the helper's `instanceof HTMLElement` gate passes) with overridden
 * `getBoundingClientRect` to drive the slot-split-zone math.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { encodeRailsDropId, resolveFloatDockTarget } from '../../../../utils/rail-dnd'

/**
 * Create a detached div with the given `data-rails-drop-id` attribute and a
 * fixed `getBoundingClientRect` result. Ownership stays with the caller — the
 * element is not appended to the DOM (resolveFloatDockTarget reads via the
 * injected `elementsFromPoint`, not via DOM traversal).
 */
function makeDropEl(dropId: string, rect: { left: number; top: number; width: number; height: number }): HTMLElement {
  const el = document.createElement('div')
  el.dataset.railsDropId = dropId
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
  return el
}

/** Append pill children with `data-tab-id` + fixed rects for tab-strip tests. */
function addPill(parent: HTMLElement, tabId: string, rect: { left: number; top: number; width: number; height: number }): void {
  const pill = document.createElement('div')
  pill.dataset.tabId = tabId
  pill.getBoundingClientRect = (() => ({
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
  parent.appendChild(pill)
}

describe('resolveFloatDockTarget', () => {
  beforeEach(() => {
    // Clean slate for each test — no leaked appended elements from prior runs.
  })

  it('returns null when elementsFromPoint is empty', () => {
    const target = resolveFloatDockTarget(
      { x: 0, y: 0 },
      {
        elementsFromPoint: () => [],
        getSlotOrientation: () => null,
      },
    )
    expect(target).toBeNull()
  })

  it('returns null when no element carries data-rails-drop-id', () => {
    const el = document.createElement('div')
    const target = resolveFloatDockTarget(
      { x: 0, y: 0 },
      {
        elementsFromPoint: () => [el],
        getSlotOrientation: () => null,
      },
    )
    expect(target).toBeNull()
  })

  it('returns null when drop-id fails to decode', () => {
    const el = document.createElement('div')
    el.dataset.railsDropId = 'rails:bogus-zone'
    const target = resolveFloatDockTarget(
      { x: 0, y: 0 },
      {
        elementsFromPoint: () => [el],
        getSlotOrientation: () => null,
      },
    )
    expect(target).toBeNull()
  })

  it('resolves an empty-side zone without a claim', () => {
    const id = encodeRailsDropId({ kind: 'empty-side', side: 'left' })
    const el = makeDropEl(id, { left: 0, top: 0, width: 100, height: 800 })
    const target = resolveFloatDockTarget(
      { x: 50, y: 400 },
      {
        elementsFromPoint: () => [el],
        getSlotOrientation: () => null,
      },
    )
    expect(target).toEqual({ kind: 'empty-side', side: 'left' })
  })

  it('resolves an empty-side zone with a start claim', () => {
    const id = encodeRailsDropId({ kind: 'empty-side', side: 'top', claim: 'start' })
    const el = makeDropEl(id, { left: 0, top: 0, width: 200, height: 60 })
    const target = resolveFloatDockTarget(
      { x: 100, y: 30 },
      {
        elementsFromPoint: () => [el],
        getSlotOrientation: () => null,
      },
    )
    expect(target).toEqual({ kind: 'empty-side', side: 'top', claim: 'start' })
  })

  it('resolves an empty-side zone with an end claim', () => {
    const id = encodeRailsDropId({ kind: 'empty-side', side: 'right', claim: 'end' })
    const el = makeDropEl(id, { left: 1800, top: 700, width: 200, height: 100 })
    const target = resolveFloatDockTarget(
      { x: 1900, y: 750 },
      {
        elementsFromPoint: () => [el],
        getSlotOrientation: () => null,
      },
    )
    expect(target).toEqual({ kind: 'empty-side', side: 'right', claim: 'end' })
  })

  describe('slot zones', () => {
    const slotId = 'slot-abc'
    const id = encodeRailsDropId({ kind: 'slot', slotId })

    it('resolves slot center on a vertical rail (pointer in middle band)', () => {
      const el = makeDropEl(id, { left: 0, top: 0, width: 340, height: 400 })
      const target = resolveFloatDockTarget(
        { x: 170, y: 200 },
        {
          elementsFromPoint: () => [el],
          getSlotOrientation: () => 'vertical',
        },
      )
      expect(target).toEqual({ kind: 'slot', slotId, zone: 'center' })
    })

    it('resolves slot above on a vertical rail (pointer near top edge)', () => {
      const el = makeDropEl(id, { left: 0, top: 0, width: 340, height: 400 })
      const target = resolveFloatDockTarget(
        { x: 170, y: 20 },
        {
          elementsFromPoint: () => [el],
          getSlotOrientation: () => 'vertical',
        },
      )
      expect(target).toEqual({ kind: 'slot', slotId, zone: 'above' })
    })

    it('resolves slot below on a vertical rail (pointer near bottom edge)', () => {
      const el = makeDropEl(id, { left: 0, top: 0, width: 340, height: 400 })
      const target = resolveFloatDockTarget(
        { x: 170, y: 380 },
        {
          elementsFromPoint: () => [el],
          getSlotOrientation: () => 'vertical',
        },
      )
      expect(target).toEqual({ kind: 'slot', slotId, zone: 'below' })
    })

    it('resolves slot left on a horizontal rail (pointer near left edge)', () => {
      const el = makeDropEl(id, { left: 0, top: 0, width: 400, height: 260 })
      const target = resolveFloatDockTarget(
        { x: 20, y: 130 },
        {
          elementsFromPoint: () => [el],
          getSlotOrientation: () => 'horizontal',
        },
      )
      expect(target).toEqual({ kind: 'slot', slotId, zone: 'left' })
    })

    it('resolves slot right on a horizontal rail (pointer near right edge)', () => {
      const el = makeDropEl(id, { left: 0, top: 0, width: 400, height: 260 })
      const target = resolveFloatDockTarget(
        { x: 380, y: 130 },
        {
          elementsFromPoint: () => [el],
          getSlotOrientation: () => 'horizontal',
        },
      )
      expect(target).toEqual({ kind: 'slot', slotId, zone: 'right' })
    })

    it('resolves slot center on a horizontal rail (pointer in middle band)', () => {
      const el = makeDropEl(id, { left: 0, top: 0, width: 400, height: 260 })
      const target = resolveFloatDockTarget(
        { x: 200, y: 130 },
        {
          elementsFromPoint: () => [el],
          getSlotOrientation: () => 'horizontal',
        },
      )
      expect(target).toEqual({ kind: 'slot', slotId, zone: 'center' })
    })

    it('returns null for a slot when orientation lookup fails', () => {
      const el = makeDropEl(id, { left: 0, top: 0, width: 340, height: 400 })
      const target = resolveFloatDockTarget(
        { x: 170, y: 200 },
        {
          elementsFromPoint: () => [el],
          getSlotOrientation: () => null,
        },
      )
      expect(target).toBeNull()
    })
  })

  describe('tab-strip zones', () => {
    const slotId = 'slot-xyz'
    const id = encodeRailsDropId({ kind: 'tab-strip', slotId })

    it('returns insertIdx=0 when pointer is before the first pill midpoint', () => {
      const el = makeDropEl(id, { left: 0, top: 0, width: 300, height: 32 })
      addPill(el, 'a', { left: 0, top: 0, width: 80, height: 32 })
      addPill(el, 'b', { left: 80, top: 0, width: 80, height: 32 })
      addPill(el, 'c', { left: 160, top: 0, width: 80, height: 32 })
      const target = resolveFloatDockTarget(
        { x: 10, y: 16 },
        {
          elementsFromPoint: () => [el],
          getSlotOrientation: () => null,
        },
      )
      expect(target).toEqual({ kind: 'tab-strip', slotId, insertIdx: 0 })
    })

    it('returns insertIdx=N when pointer is past the last pill midpoint', () => {
      const el = makeDropEl(id, { left: 0, top: 0, width: 300, height: 32 })
      addPill(el, 'a', { left: 0, top: 0, width: 80, height: 32 })
      addPill(el, 'b', { left: 80, top: 0, width: 80, height: 32 })
      addPill(el, 'c', { left: 160, top: 0, width: 80, height: 32 })
      const target = resolveFloatDockTarget(
        { x: 280, y: 16 },
        {
          elementsFromPoint: () => [el],
          getSlotOrientation: () => null,
        },
      )
      expect(target).toEqual({ kind: 'tab-strip', slotId, insertIdx: 3 })
    })

    it('returns insertIdx between pills based on pointer X vs midpoints', () => {
      const el = makeDropEl(id, { left: 0, top: 0, width: 300, height: 32 })
      addPill(el, 'a', { left: 0, top: 0, width: 80, height: 32 })
      addPill(el, 'b', { left: 80, top: 0, width: 80, height: 32 })
      addPill(el, 'c', { left: 160, top: 0, width: 80, height: 32 })
      // Mid of pill b is at x=120; pointer at x=110 → inserts before b (idx=1).
      const target = resolveFloatDockTarget(
        { x: 110, y: 16 },
        {
          elementsFromPoint: () => [el],
          getSlotOrientation: () => null,
        },
      )
      expect(target).toEqual({ kind: 'tab-strip', slotId, insertIdx: 1 })
    })

    it('returns insertIdx=0 on an empty tab-strip (no pills)', () => {
      const el = makeDropEl(id, { left: 0, top: 0, width: 300, height: 32 })
      const target = resolveFloatDockTarget(
        { x: 150, y: 16 },
        {
          elementsFromPoint: () => [el],
          getSlotOrientation: () => null,
        },
      )
      expect(target).toEqual({ kind: 'tab-strip', slotId, insertIdx: 0 })
    })
  })

  it('picks the first hit element (top of z-stack wins)', () => {
    const topId = encodeRailsDropId({ kind: 'empty-side', side: 'top' })
    const leftId = encodeRailsDropId({ kind: 'empty-side', side: 'left' })
    const topEl = makeDropEl(topId, { left: 0, top: 0, width: 2000, height: 60 })
    const leftEl = makeDropEl(leftId, { left: 0, top: 0, width: 60, height: 800 })
    // elementsFromPoint returns deepest (topmost) first — our helper must pick
    // that one, not walk past it to a lower-stacked candidate.
    const target = resolveFloatDockTarget(
      { x: 30, y: 30 },
      {
        elementsFromPoint: () => [topEl, leftEl],
        getSlotOrientation: () => null,
      },
    )
    expect(target).toEqual({ kind: 'empty-side', side: 'top' })
  })

  it('skips non-HTMLElement entries in the hit stack', () => {
    const id = encodeRailsDropId({ kind: 'empty-side', side: 'bottom' })
    const el = makeDropEl(id, { left: 0, top: 740, width: 2000, height: 60 })
    // A synthetic SVGElement-like object mixed in (e.g. a guide line from
    // AlignmentGuides). Helper should skip until it reaches the div.
    const svgLike = document.createElementNS('http://www.w3.org/2000/svg', 'line') as unknown as Element
    const target = resolveFloatDockTarget(
      { x: 100, y: 770 },
      {
        elementsFromPoint: () => [svgLike, el],
        getSlotOrientation: () => null,
      },
    )
    expect(target).toEqual({ kind: 'empty-side', side: 'bottom' })
  })
})
