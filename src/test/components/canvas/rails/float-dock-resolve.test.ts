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

  // Phase 6.5.2 (real-browser-testing): slot drops outrank empty-side drops
  // when both share the pointer. The DockOverlay corner sub-zones extend along
  // the perpendicular rail's width and stack above the rail's slot stub /
  // expanded slot body — without this preference, dropping on a collapsed-rail
  // stub at the top of a perp rail resolves to corner-claim, not slot-merge.
  describe('priority ordering (slot > tab-strip > empty-side)', () => {
    it('prefers a slot hit over an empty-side hit at the same pointer (collapsed-rail stub case)', () => {
      const slotId = 'collapsed-stub'
      const slotElId = encodeRailsDropId({ kind: 'slot', slotId })
      const cornerId = encodeRailsDropId({ kind: 'empty-side', side: 'top', claim: 'start' })
      // Corner sub-zone paints on top (z-index 1000) and is returned first by
      // `elementsFromPoint`. Slot stub is below in z-order.
      const cornerEl = makeDropEl(cornerId, { left: 0, top: 0, width: 28, height: 80 })
      const slotEl = makeDropEl(slotElId, { left: 0, top: 0, width: 28, height: 200 })
      const target = resolveFloatDockTarget(
        { x: 14, y: 40 },
        {
          elementsFromPoint: () => [cornerEl, slotEl],
          getSlotOrientation: () => 'vertical',
        },
      )
      // Without the preference the resolver would have returned the corner
      // (first in stack); 6.5.2 picks the slot instead.
      expect(target?.kind).toBe('slot')
      if (target?.kind === 'slot') {
        expect(target.slotId).toBe(slotId)
      }
    })

    it('prefers a tab-strip hit over an empty-side hit at the same pointer', () => {
      const slotId = 'slot-with-pills'
      const tabStripElId = encodeRailsDropId({ kind: 'tab-strip', slotId })
      const cornerId = encodeRailsDropId({ kind: 'empty-side', side: 'top', claim: 'start' })
      const cornerEl = makeDropEl(cornerId, { left: 0, top: 0, width: 80, height: 80 })
      const stripEl = makeDropEl(tabStripElId, { left: 0, top: 0, width: 200, height: 32 })
      addPill(stripEl, 'a', { left: 0, top: 0, width: 100, height: 32 })
      addPill(stripEl, 'b', { left: 100, top: 0, width: 100, height: 32 })
      const target = resolveFloatDockTarget(
        { x: 50, y: 16 },
        {
          elementsFromPoint: () => [cornerEl, stripEl],
          getSlotOrientation: () => null,
        },
      )
      expect(target?.kind).toBe('tab-strip')
    })

    it('prefers a slot hit over a tab-strip hit at the same pointer (slot is most specific)', () => {
      const slotId = 'slot-z'
      const slotElId = encodeRailsDropId({ kind: 'slot', slotId })
      const tabStripElId = encodeRailsDropId({ kind: 'tab-strip', slotId })
      const stripEl = makeDropEl(tabStripElId, { left: 0, top: 0, width: 200, height: 32 })
      addPill(stripEl, 'a', { left: 0, top: 0, width: 100, height: 32 })
      const slotEl = makeDropEl(slotElId, { left: 0, top: 0, width: 200, height: 200 })
      const target = resolveFloatDockTarget(
        { x: 50, y: 100 },
        {
          elementsFromPoint: () => [stripEl, slotEl],
          getSlotOrientation: () => 'vertical',
        },
      )
      expect(target?.kind).toBe('slot')
    })

    it('falls back to empty-side when no slot or tab-strip is in the stack', () => {
      const cornerId = encodeRailsDropId({ kind: 'empty-side', side: 'top', claim: 'start' })
      const cornerEl = makeDropEl(cornerId, { left: 0, top: 0, width: 80, height: 80 })
      const target = resolveFloatDockTarget(
        { x: 40, y: 40 },
        {
          elementsFromPoint: () => [cornerEl],
          getSlotOrientation: () => null,
        },
      )
      expect(target).toEqual({ kind: 'empty-side', side: 'top', claim: 'start' })
    })
  })

  // triage-2026-04-26 T3: when the pointer lands on a collapsed rail's `<aside>`
  // but misses every individual stub (e.g. release on the margin between two
  // stubs, above the first, or below the last), the resolver routes the dock
  // to the stub nearest the pointer along the rail axis.
  describe('collapsed-side fallback', () => {
    /** Build a fake collapsed rail aside with N stubs at fixed rects. */
    function makeCollapsedAside(side: 'left' | 'right' | 'top' | 'bottom', stubs: Array<{ slotId: string; rect: { left: number; top: number; width: number; height: number } }>): HTMLElement {
      const asideId = encodeRailsDropId({ kind: 'collapsed-side', side })
      const aside = makeDropEl(asideId, { left: 0, top: 0, width: 28, height: 600 })
      for (const stub of stubs) {
        const stubEl = document.createElement('div')
        stubEl.dataset.slotId = stub.slotId
        // Stubs in production also carry `data-rails-drop-id` of kind `slot`,
        // but the bisection helper uses `data-slot-id` so we omit it here to
        // keep the test focused on the fallback path.
        stubEl.getBoundingClientRect = (() => ({
          left: stub.rect.left,
          top: stub.rect.top,
          right: stub.rect.left + stub.rect.width,
          bottom: stub.rect.top + stub.rect.height,
          width: stub.rect.width,
          height: stub.rect.height,
          x: stub.rect.left,
          y: stub.rect.top,
          toJSON() { return this },
        })) as unknown as () => DOMRect
        aside.appendChild(stubEl)
      }
      return aside
    }

    it('vertical rail: picks the stub whose Y midpoint is closest to the pointer', () => {
      // Stubs stacked vertically at y=20-60, y=80-120, y=140-180.
      // Pointer at y=70 (between first and second stub) is closer to first (mid=40, dist=30)
      // than to second (mid=100, dist=30) — tie broken in favor of the first hit.
      const aside = makeCollapsedAside('left', [
        { slotId: 'a', rect: { left: 0, top: 20, width: 28, height: 40 } },
        { slotId: 'b', rect: { left: 0, top: 80, width: 28, height: 40 } },
        { slotId: 'c', rect: { left: 0, top: 140, width: 28, height: 40 } },
      ])
      const target = resolveFloatDockTarget(
        { x: 14, y: 90 },
        {
          elementsFromPoint: () => [aside],
          getSlotOrientation: () => 'vertical',
        },
      )
      expect(target).toEqual({ kind: 'slot', slotId: 'b', zone: 'center' })
    })

    it('vertical rail: pointer above all stubs picks the first stub', () => {
      const aside = makeCollapsedAside('right', [
        { slotId: 'a', rect: { left: 0, top: 100, width: 28, height: 40 } },
        { slotId: 'b', rect: { left: 0, top: 200, width: 28, height: 40 } },
      ])
      const target = resolveFloatDockTarget(
        { x: 14, y: 10 },
        {
          elementsFromPoint: () => [aside],
          getSlotOrientation: () => 'vertical',
        },
      )
      expect(target).toEqual({ kind: 'slot', slotId: 'a', zone: 'center' })
    })

    it('horizontal rail: picks the stub whose X midpoint is closest to the pointer', () => {
      // Stubs stacked horizontally at x=20-60, x=80-120, x=140-180.
      const aside = makeCollapsedAside('top', [
        { slotId: 'a', rect: { left: 20, top: 0, width: 40, height: 28 } },
        { slotId: 'b', rect: { left: 80, top: 0, width: 40, height: 28 } },
        { slotId: 'c', rect: { left: 140, top: 0, width: 40, height: 28 } },
      ])
      const target = resolveFloatDockTarget(
        { x: 150, y: 14 },
        {
          elementsFromPoint: () => [aside],
          getSlotOrientation: () => 'horizontal',
        },
      )
      expect(target).toEqual({ kind: 'slot', slotId: 'c', zone: 'center' })
    })

    it('returns null when the aside has no stubs (rail collapsed but empty — should not happen, but guard anyway)', () => {
      const aside = makeCollapsedAside('bottom', [])
      const target = resolveFloatDockTarget(
        { x: 100, y: 14 },
        {
          elementsFromPoint: () => [aside],
          getSlotOrientation: () => null,
        },
      )
      expect(target).toBeNull()
    })

    it('an individual stub hit (slot kind) wins over the aside catch-all', () => {
      // When the pointer lands directly on a stub, we get both the slot drop-id
      // (on the stub itself) and the collapsed-side drop-id (on the aside) in
      // the elementsFromPoint stack. Slot wins — same priority order that
      // already handles the corner-overlap case.
      const slotElId = encodeRailsDropId({ kind: 'slot', slotId: 'b' })
      const stubEl = makeDropEl(slotElId, { left: 0, top: 80, width: 28, height: 40 })
      const aside = makeCollapsedAside('left', [
        { slotId: 'a', rect: { left: 0, top: 20, width: 28, height: 40 } },
        { slotId: 'b', rect: { left: 0, top: 80, width: 28, height: 40 } },
      ])
      const target = resolveFloatDockTarget(
        { x: 14, y: 100 },
        {
          elementsFromPoint: () => [stubEl, aside],
          getSlotOrientation: () => 'vertical',
        },
      )
      // Slot zone, not collapsed-side — center because the pointer is in the
      // middle band of the stub's rect.
      expect(target?.kind).toBe('slot')
      if (target?.kind === 'slot') {
        expect(target.slotId).toBe('b')
      }
    })
  })
})
