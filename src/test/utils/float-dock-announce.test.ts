/**
 * Phase 4 float-dock: unit tests for the pure a11y + corner helpers. These
 * are shelled-out of `CanvasPage.tsx` so the rail-tab drag and float-dock
 * paths can share identical screen-reader phrasing and corner-claim math.
 */
import { describe, it, expect } from 'vitest'
import type { RailsState, Slot, Tab } from '../../models/canvas-rails'
import {
  computeEmptySideCornerClaim,
  describeFloatDockTarget,
  findSlotKindById,
} from '../../utils/float-dock-announce'

function tab(id: string, type: Tab['type']): Tab {
  return { id, type }
}

function slotWith(id: string, kind: Tab['type']): Slot {
  return { id, tabs: [tab(`${id}-t0`, kind)], activeTabId: `${id}-t0` }
}

function rails(overrides: Partial<RailsState>): RailsState {
  return { left: null, right: null, top: null, bottom: null, ...overrides }
}

describe('findSlotKindById', () => {
  it('returns the active tab type of the matching slot', () => {
    const state = rails({
      left: { orientation: 'vertical', slots: [slotWith('A', 'lens'), slotWith('B', 'notes')] },
    })
    expect(findSlotKindById(state, 'A')).toBe('lens')
    expect(findSlotKindById(state, 'B')).toBe('notes')
  })

  it('returns null when the slot is not in any rail', () => {
    const state = rails({
      left: { orientation: 'vertical', slots: [slotWith('A', 'lens')] },
    })
    expect(findSlotKindById(state, 'missing')).toBeNull()
  })

  it('respects the active tab when the slot carries multiple tabs', () => {
    const multi: Slot = {
      id: 'M',
      tabs: [tab('M-t0', 'notes'), tab('M-t1', 'calendar')],
      activeTabId: 'M-t1',
    }
    const state = rails({
      right: { orientation: 'vertical', slots: [multi] },
    })
    expect(findSlotKindById(state, 'M')).toBe('calendar')
  })
})

describe('describeFloatDockTarget', () => {
  const state = rails({
    left: { orientation: 'vertical', slots: [slotWith('A', 'lens')] },
  })

  it('phrases empty-side drops by rail side', () => {
    expect(describeFloatDockTarget({ kind: 'empty-side', side: 'top' }, state))
      .toBe('Dropped in top rail')
    expect(describeFloatDockTarget({ kind: 'empty-side', side: 'right', claim: 'start' }, state))
      .toBe('Dropped in right rail')
  })

  it('phrases slot drops by active-tab kind', () => {
    expect(describeFloatDockTarget({ kind: 'slot', slotId: 'A', zone: 'center' }, state))
      .toBe('Dropped in lens slot')
    expect(describeFloatDockTarget({ kind: 'slot', slotId: 'A', zone: 'above' }, state))
      .toBe('Dropped in lens slot')
  })

  it('phrases tab-strip drops by active-tab kind', () => {
    expect(describeFloatDockTarget({ kind: 'tab-strip', slotId: 'A', insertIdx: 0 }, state))
      .toBe('Dropped in lens tab strip')
  })

  it('falls back to `slot` when the target slotId is unresolvable', () => {
    expect(describeFloatDockTarget({ kind: 'slot', slotId: 'zzz', zone: 'center' }, state))
      .toBe('Dropped in slot slot')
    expect(describeFloatDockTarget({ kind: 'tab-strip', slotId: 'zzz', insertIdx: 0 }, state))
      .toBe('Dropped in slot tab strip')
  })
})

describe('computeEmptySideCornerClaim', () => {
  it('claim=start on left rail: start corner gets `v` (→ null clear), end corner pinched to `h`', () => {
    // left rail is vertical → claimedOwner='v', pinchedOwner='h'
    // start corner = NW, end corner = SW.
    expect(computeEmptySideCornerClaim('left', 'start')).toEqual([
      { corner: 'nw', owner: null },
      { corner: 'sw', owner: 'h' },
    ])
  })

  it('claim=end on left rail: start corner pinched to `h`, end corner claimed as `v` → null', () => {
    expect(computeEmptySideCornerClaim('left', 'end')).toEqual([
      { corner: 'nw', owner: 'h' },
      { corner: 'sw', owner: null },
    ])
  })

  it('claim=start on top rail: claimed=`h`, pinched=`v` → null', () => {
    // top rail is horizontal → claimedOwner='h', pinchedOwner='v'.
    // start corner = NW, end corner = NE.
    expect(computeEmptySideCornerClaim('top', 'start')).toEqual([
      { corner: 'nw', owner: 'h' },
      { corner: 'ne', owner: null },
    ])
  })

  it('claim=end on bottom rail: end corner claimed as `h`, start corner pinched → null', () => {
    expect(computeEmptySideCornerClaim('bottom', 'end')).toEqual([
      { corner: 'sw', owner: null },
      { corner: 'se', owner: 'h' },
    ])
  })

  it('claim=start on right rail: start corner=NE claimed as `v` → null, end corner=SE pinched to `h`', () => {
    expect(computeEmptySideCornerClaim('right', 'start')).toEqual([
      { corner: 'ne', owner: null },
      { corner: 'se', owner: 'h' },
    ])
  })
})
