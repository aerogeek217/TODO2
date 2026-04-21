import { describe, it, expect } from 'vitest'
import type { RailsState, Slot, Tab } from '../../../../models/canvas-rails'
import { getActiveTab } from '../../../../models/canvas-rails'
import {
  applyDetachTabToNewSlot,
  applyMoveTabToSlot,
  applyReorderTab,
  extractTab,
  encodeRailsDropId,
  decodeRailsDropId,
  isRailsDropId,
} from '../../../../utils/rail-dnd'

function tab(id: string, type: Tab['type'] = 'lens', listDefinitionId?: number): Tab {
  const t: Tab = { id, type }
  if (listDefinitionId != null) t.listDefinitionId = listDefinitionId
  return t
}

function slotWith(id: string, tabs: Tab[], activeIdx = 0): Slot {
  return { id, tabs, activeTabId: tabs[activeIdx].id }
}

function railsWith(overrides: Partial<RailsState>): RailsState {
  return { left: null, right: null, top: null, bottom: null, ...overrides }
}

const buildSlot = (newId: string) => (extracted: Tab): Slot => ({
  id: newId,
  tabs: [extracted],
  activeTabId: extracted.id,
})

describe('tab-strip drop id encoding', () => {
  it('round-trips tab-strip zones', () => {
    const z = { kind: 'tab-strip' as const, slotId: 'slot:abc' }
    const id = encodeRailsDropId(z)
    expect(isRailsDropId(id)).toBe(true)
    expect(decodeRailsDropId(id)).toEqual(z)
  })
})

describe('extractTab', () => {
  it('removes a non-active tab and leaves activeTabId untouched', () => {
    const t1 = tab('t1')
    const t2 = tab('t2')
    const t3 = tab('t3')
    const rails = railsWith({
      right: { orientation: 'vertical', slots: [slotWith('s1', [t1, t2, t3], 0)] },
    })
    const { rails: next, tab: out } = extractTab(rails, 's1', 't2')
    expect(out).toEqual(t2)
    expect(next.right!.slots[0].tabs.map((t) => t.id)).toEqual(['t1', 't3'])
    expect(next.right!.slots[0].activeTabId).toBe('t1')
  })

  it('cascades activeTabId to the left sibling when removing the active tab', () => {
    const t1 = tab('t1')
    const t2 = tab('t2')
    const t3 = tab('t3')
    const rails = railsWith({
      right: { orientation: 'vertical', slots: [slotWith('s1', [t1, t2, t3], 1)] },
    })
    const { rails: next } = extractTab(rails, 's1', 't2')
    expect(next.right!.slots[0].activeTabId).toBe('t1')
  })

  it('cascade-closes the slot when the last tab is removed', () => {
    const t1 = tab('t1')
    const rails = railsWith({
      right: { orientation: 'vertical', slots: [slotWith('s1', [t1])] },
    })
    const { rails: next, tab: out } = extractTab(rails, 's1', 't1')
    expect(out).toEqual(t1)
    expect(next.right).toBeNull()
  })

  it('cascade-closes the rail to null when removing the only tab of the only slot', () => {
    const t1 = tab('t1')
    const rails = railsWith({
      right: { orientation: 'vertical', slots: [slotWith('s1', [t1])] },
    })
    const { rails: next } = extractTab(rails, 's1', 't1')
    expect(next.right).toBeNull()
  })

  it('strips flex from the sole remaining slot after cascade-close of a sibling', () => {
    const t1 = tab('t1')
    const t2 = tab('t2')
    const a: Slot = { ...slotWith('a', [t1]), flex: 200 }
    const b: Slot = { ...slotWith('b', [t2]), flex: 100 }
    const rails = railsWith({ right: { orientation: 'vertical', slots: [a, b] } })
    // Removing a's only tab cascades the slot away, leaving b alone — its flex should clear.
    const { rails: next } = extractTab(rails, 'a', 't1')
    expect(next.right!.slots).toHaveLength(1)
    expect(next.right!.slots[0].id).toBe('b')
    expect(next.right!.slots[0].flex).toBeUndefined()
  })

  it('is a no-op for unknown slot or tab ids', () => {
    const t1 = tab('t1')
    const rails = railsWith({
      right: { orientation: 'vertical', slots: [slotWith('s1', [t1])] },
    })
    expect(extractTab(rails, 'nope', 't1').rails).toBe(rails)
    expect(extractTab(rails, 's1', 'nope').rails).toBe(rails)
  })
})

describe('applyReorderTab', () => {
  it('moves a tab forward within the same slot', () => {
    const t1 = tab('t1')
    const t2 = tab('t2')
    const t3 = tab('t3')
    const rails = railsWith({
      right: { orientation: 'vertical', slots: [slotWith('s1', [t1, t2, t3])] },
    })
    const next = applyReorderTab(rails, 's1', 't1', 2)
    expect(next.right!.slots[0].tabs.map((t) => t.id)).toEqual(['t2', 't3', 't1'])
  })

  it('moves a tab backward within the same slot', () => {
    const t1 = tab('t1')
    const t2 = tab('t2')
    const t3 = tab('t3')
    const rails = railsWith({
      right: { orientation: 'vertical', slots: [slotWith('s1', [t1, t2, t3])] },
    })
    const next = applyReorderTab(rails, 's1', 't3', 0)
    expect(next.right!.slots[0].tabs.map((t) => t.id)).toEqual(['t3', 't1', 't2'])
  })

  it('preserves activeTabId across reorder', () => {
    const t1 = tab('t1')
    const t2 = tab('t2')
    const rails = railsWith({
      right: { orientation: 'vertical', slots: [slotWith('s1', [t1, t2], 1)] },
    })
    const next = applyReorderTab(rails, 's1', 't1', 1)
    expect(next.right!.slots[0].activeTabId).toBe('t2')
  })

  it('clamps out-of-range insertIdx', () => {
    const t1 = tab('t1')
    const t2 = tab('t2')
    const rails = railsWith({
      right: { orientation: 'vertical', slots: [slotWith('s1', [t1, t2])] },
    })
    const next = applyReorderTab(rails, 's1', 't1', 99)
    expect(next.right!.slots[0].tabs.map((t) => t.id)).toEqual(['t2', 't1'])
  })

  it('is a no-op when source position equals target position', () => {
    const t1 = tab('t1')
    const t2 = tab('t2')
    const rails = railsWith({
      right: { orientation: 'vertical', slots: [slotWith('s1', [t1, t2])] },
    })
    expect(applyReorderTab(rails, 's1', 't1', 0)).toBe(rails)
  })
})

describe('applyMoveTabToSlot', () => {
  it('moves a tab from one slot to another and activates it on dest', () => {
    const a1 = tab('a1', 'lens', 7)
    const b1 = tab('b1', 'notes')
    const b2 = tab('b2', 'notes')
    const rails = railsWith({
      right: {
        orientation: 'vertical',
        slots: [slotWith('a', [a1]), slotWith('b', [b1, b2], 0)],
      },
    })
    const next = applyMoveTabToSlot(rails, 'a', 'a1', 'b', 1)
    // 'a' cascade-closed because it had only one tab
    expect(next.right!.slots.find((s) => s.id === 'a')).toBeUndefined()
    const dest = next.right!.slots.find((s) => s.id === 'b')!
    expect(dest.tabs.map((t) => t.id)).toEqual(['b1', 'a1', 'b2'])
    expect(dest.activeTabId).toBe('a1')
    // payload preserved
    expect(dest.tabs.find((t) => t.id === 'a1')!.listDefinitionId).toBe(7)
  })

  it('falls back to applyReorderTab when src and dest are the same slot', () => {
    const t1 = tab('t1')
    const t2 = tab('t2')
    const rails = railsWith({
      right: { orientation: 'vertical', slots: [slotWith('s1', [t1, t2])] },
    })
    const next = applyMoveTabToSlot(rails, 's1', 't1', 's1', 1)
    expect(next.right!.slots[0].tabs.map((t) => t.id)).toEqual(['t2', 't1'])
  })

  it('is a no-op when src or dest slot is unknown', () => {
    const t1 = tab('t1')
    const rails = railsWith({
      right: { orientation: 'vertical', slots: [slotWith('s1', [t1])] },
    })
    expect(applyMoveTabToSlot(rails, 'nope', 't1', 's1', 0)).toBe(rails)
    expect(applyMoveTabToSlot(rails, 's1', 't1', 'nope', 0)).toBe(rails)
  })
})

describe('applyDetachTabToNewSlot', () => {
  it('detaches to an empty side, leaving the source slot with remaining tabs', () => {
    const t1 = tab('t1')
    const t2 = tab('t2')
    const rails = railsWith({
      right: { orientation: 'vertical', slots: [slotWith('s1', [t1, t2])] },
    })
    const next = applyDetachTabToNewSlot(rails, 's1', 't2', { kind: 'empty-side', side: 'left' }, buildSlot('new'))
    expect(next.right!.slots[0].tabs.map((t) => t.id)).toEqual(['t1'])
    expect(next.left!.slots.map((s) => s.id)).toEqual(['new'])
    expect(getActiveTab(next.left!.slots[0]).id).toBe('t2')
  })

  it('cascade-closes the source slot when its only tab is detached into a slot quadrant', () => {
    const t1 = tab('t1')
    const t2 = tab('t2')
    const rails = railsWith({
      right: { orientation: 'vertical', slots: [slotWith('s1', [t1])] },
      left: { orientation: 'vertical', slots: [slotWith('s2', [t2])] },
    })
    const next = applyDetachTabToNewSlot(
      rails,
      's1',
      't1',
      { kind: 'slot', slotId: 's2', zone: 'below' },
      buildSlot('new'),
    )
    expect(next.right).toBeNull()
    expect(next.left!.slots.map((s) => s.id)).toEqual(['s2', 'new'])
  })

  it('detaches into a slot quadrant via "above" zone', () => {
    const t1 = tab('t1')
    const t2 = tab('t2')
    const t3 = tab('t3')
    const rails = railsWith({
      right: {
        orientation: 'vertical',
        slots: [slotWith('a', [t1, t2]), slotWith('b', [t3])],
      },
    })
    const next = applyDetachTabToNewSlot(
      rails,
      'a',
      't2',
      { kind: 'slot', slotId: 'b', zone: 'above' },
      buildSlot('new'),
    )
    expect(next.right!.slots.map((s) => s.id)).toEqual(['a', 'new', 'b'])
    expect(next.right!.slots.find((s) => s.id === 'a')!.tabs.map((t) => t.id)).toEqual(['t1'])
  })

  it('refuses tab-strip drop targets (those go through move/reorder)', () => {
    const t1 = tab('t1')
    const t2 = tab('t2')
    const rails = railsWith({
      right: { orientation: 'vertical', slots: [slotWith('s1', [t1, t2])] },
    })
    const next = applyDetachTabToNewSlot(
      rails,
      's1',
      't1',
      { kind: 'tab-strip', slotId: 's1', insertIdx: 0 },
      buildSlot('new'),
    )
    expect(next).toBe(rails)
  })

  it('is a no-op when the source tab does not exist', () => {
    const t1 = tab('t1')
    const rails = railsWith({
      right: { orientation: 'vertical', slots: [slotWith('s1', [t1])] },
    })
    expect(
      applyDetachTabToNewSlot(rails, 's1', 'nope', { kind: 'empty-side', side: 'left' }, buildSlot('new')),
    ).toBe(rails)
  })
})
