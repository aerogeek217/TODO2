import { describe, it, expect } from 'vitest'
import type { RailsState, Slot, Tab } from '../../../../models/canvas-rails'
import { getActiveTab } from '../../../../models/canvas-rails'
import {
  applyDockFloatAsNewSlot,
  applyDockFloatIntoSlot,
  slotFromFloat,
  tabFromFloat,
  type FloatDescriptor,
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

describe('tabFromFloat', () => {
  it('maps a note descriptor to a notes-type tab', () => {
    const t = tabFromFloat({ kind: 'note', id: 1 }, 'tab-1')
    expect(t).toEqual({ id: 'tab-1', type: 'notes' })
  })

  it('maps a calendar descriptor to a calendar-type tab (no orientation on tab)', () => {
    const t = tabFromFloat({ kind: 'calendar', id: 2, orientation: 'horizontal', weekOffset: 3 }, 'tab-2')
    expect(t).toEqual({ id: 'tab-2', type: 'calendar' })
    // orientation/weekOffset live on Slot, never on Tab
    expect(t).not.toHaveProperty('orientation')
    expect(t).not.toHaveProperty('weekOffset')
  })

  it('maps a taskboard descriptor to a taskboard-type tab', () => {
    const t = tabFromFloat({ kind: 'taskboard', id: 3, taskboardId: 7 }, 'tab-3')
    expect(t).toEqual({ id: 'tab-3', type: 'taskboard' })
  })

  it('maps a lens descriptor to a lens-type tab threading listDefinitionId', () => {
    const t = tabFromFloat({ kind: 'lens', id: 4, listDefinitionId: 42 }, 'tab-4')
    expect(t).toEqual({ id: 'tab-4', type: 'lens', listDefinitionId: 42 })
  })
})

describe('slotFromFloat', () => {
  it('builds a single-tab slot with the descriptor-derived tab', () => {
    const s = slotFromFloat({ kind: 'note', id: 1 }, 'slot-new', 'tab-new')
    expect(s).toEqual({
      id: 'slot-new',
      tabs: [{ id: 'tab-new', type: 'notes' }],
      activeTabId: 'tab-new',
    })
  })

  it('threads calendar orientation + weekOffset onto the slot', () => {
    const s = slotFromFloat(
      { kind: 'calendar', id: 1, orientation: 'horizontal', weekOffset: -2 },
      'slot-new',
      'tab-new',
    )
    expect(s.orientation).toBe('horizontal')
    expect(s.weekOffset).toBe(-2)
  })

  it('omits calendar slot-level fields when the descriptor does not carry them', () => {
    const s = slotFromFloat({ kind: 'calendar', id: 1 }, 'slot-new', 'tab-new')
    expect(s.orientation).toBeUndefined()
    expect(s.weekOffset).toBeUndefined()
  })

  it('never sets orientation/weekOffset for non-calendar kinds', () => {
    const note = slotFromFloat({ kind: 'note', id: 1 }, 'slot-a', 'tab-a')
    const lens = slotFromFloat({ kind: 'lens', id: 2, listDefinitionId: 99 }, 'slot-b', 'tab-b')
    const tb = slotFromFloat({ kind: 'taskboard', id: 3, taskboardId: 1 }, 'slot-c', 'tab-c')
    for (const s of [note, lens, tb]) {
      expect(s.orientation).toBeUndefined()
      expect(s.weekOffset).toBeUndefined()
    }
  })
})

describe('applyDockFloatIntoSlot — center (merge-as-tab)', () => {
  it('appends the new tab to the end of the slot strip and activates it', () => {
    const t1 = tab('t1', 'lens', 5)
    const rails = railsWith({
      right: { orientation: 'vertical', slots: [slotWith('s1', [t1])] },
    })
    const descriptor: FloatDescriptor = { kind: 'note', id: 42 }
    const next = applyDockFloatIntoSlot(
      rails, descriptor, 's1', 'center', undefined,
      () => 'slot-new', (pid) => `${pid}-t0`,
    )
    const dest = next.right!.slots[0]
    expect(dest.tabs.map((t) => t.id)).toEqual(['t1', 's1-t0'])
    expect(dest.tabs[1].type).toBe('notes')
    expect(dest.activeTabId).toBe('s1-t0')
  })

  it('honors insertIndex when provided', () => {
    const t1 = tab('t1')
    const t2 = tab('t2')
    const rails = railsWith({
      right: { orientation: 'vertical', slots: [slotWith('s1', [t1, t2])] },
    })
    const next = applyDockFloatIntoSlot(
      rails, { kind: 'note', id: 1 }, 's1', 'center', 1,
      () => 'slot-new', (pid) => `${pid}-x`,
    )
    expect(next.right!.slots[0].tabs.map((t) => t.id)).toEqual(['t1', 's1-x', 't2'])
  })

  it('clamps out-of-range insertIndex', () => {
    const t1 = tab('t1')
    const rails = railsWith({
      right: { orientation: 'vertical', slots: [slotWith('s1', [t1])] },
    })
    const next = applyDockFloatIntoSlot(
      rails, { kind: 'note', id: 1 }, 's1', 'center', 99,
      () => 'slot-new', (pid) => `${pid}-x`,
    )
    expect(next.right!.slots[0].tabs.map((t) => t.id)).toEqual(['t1', 's1-x'])
  })

  it('merges a lens descriptor and preserves its listDefinitionId on the appended tab', () => {
    const t1 = tab('t1', 'notes')
    const rails = railsWith({
      right: { orientation: 'vertical', slots: [slotWith('s1', [t1])] },
    })
    const next = applyDockFloatIntoSlot(
      rails, { kind: 'lens', id: 1, listDefinitionId: 77 }, 's1', 'center', undefined,
      () => 'slot-new', (pid) => `${pid}-L`,
    )
    const appended = next.right!.slots[0].tabs[1]
    expect(appended.type).toBe('lens')
    expect(appended.listDefinitionId).toBe(77)
  })

  it('cannot override the destination slot\'s existing orientation/weekOffset on a center merge', () => {
    const t1 = tab('t1', 'calendar')
    const dest: Slot = { ...slotWith('s1', [t1]), orientation: 'vertical', weekOffset: 0 }
    const rails = railsWith({
      right: { orientation: 'vertical', slots: [dest] },
    })
    const next = applyDockFloatIntoSlot(
      rails,
      { kind: 'calendar', id: 1, orientation: 'horizontal', weekOffset: 4 },
      's1', 'center', undefined,
      () => 'slot-new', (pid) => `${pid}-c`,
    )
    // Slot-level fields on the destination remain untouched — this is the
    // architectural limitation noted in slotFromFloat's doc.
    expect(next.right!.slots[0].orientation).toBe('vertical')
    expect(next.right!.slots[0].weekOffset).toBe(0)
  })

  it('is a no-op when the target slot is unknown', () => {
    const t1 = tab('t1')
    const rails = railsWith({
      right: { orientation: 'vertical', slots: [slotWith('s1', [t1])] },
    })
    const next = applyDockFloatIntoSlot(
      rails, { kind: 'note', id: 1 }, 'nope', 'center', undefined,
      () => 'slot-new', (pid) => `${pid}-x`,
    )
    expect(next).toBe(rails)
  })
})

describe('applyDockFloatIntoSlot — edge (split into new adjacent slot)', () => {
  it('inserts a new slot above the target in a vertical rail', () => {
    const t1 = tab('t1')
    const rails = railsWith({
      right: { orientation: 'vertical', slots: [slotWith('s1', [t1])] },
    })
    const next = applyDockFloatIntoSlot(
      rails, { kind: 'note', id: 1 }, 's1', 'above', undefined,
      () => 'new', (pid) => `${pid}-t`,
    )
    expect(next.right!.slots.map((s) => s.id)).toEqual(['new', 's1'])
    expect(getActiveTab(next.right!.slots[0]).type).toBe('notes')
  })

  it('inserts a new slot below the target in a vertical rail', () => {
    const t1 = tab('t1')
    const rails = railsWith({
      right: { orientation: 'vertical', slots: [slotWith('s1', [t1])] },
    })
    const next = applyDockFloatIntoSlot(
      rails, { kind: 'note', id: 1 }, 's1', 'below', undefined,
      () => 'new', (pid) => `${pid}-t`,
    )
    expect(next.right!.slots.map((s) => s.id)).toEqual(['s1', 'new'])
  })

  it('inserts a new slot left of the target in a horizontal rail', () => {
    const t1 = tab('t1')
    const rails = railsWith({
      top: { orientation: 'horizontal', slots: [slotWith('s1', [t1])] },
    })
    const next = applyDockFloatIntoSlot(
      rails, { kind: 'note', id: 1 }, 's1', 'left', undefined,
      () => 'new', (pid) => `${pid}-t`,
    )
    expect(next.top!.slots.map((s) => s.id)).toEqual(['new', 's1'])
  })

  it('threads calendar orientation/weekOffset onto the fresh slot for edge splits', () => {
    const t1 = tab('t1', 'notes')
    const rails = railsWith({
      right: { orientation: 'vertical', slots: [slotWith('s1', [t1])] },
    })
    const next = applyDockFloatIntoSlot(
      rails,
      { kind: 'calendar', id: 1, orientation: 'horizontal', weekOffset: 5 },
      's1', 'above', undefined,
      () => 'new', (pid) => `${pid}-t`,
    )
    const inserted = next.right!.slots.find((s) => s.id === 'new')!
    expect(inserted.orientation).toBe('horizontal')
    expect(inserted.weekOffset).toBe(5)
  })

  it('is a no-op when the target slot is unknown', () => {
    const rails = railsWith({})
    const next = applyDockFloatIntoSlot(
      rails, { kind: 'note', id: 1 }, 'nope', 'above', undefined,
      () => 'new', (pid) => `${pid}-t`,
    )
    expect(next).toBe(rails)
  })
})

describe('applyDockFloatAsNewSlot — empty-side', () => {
  it('creates a new rail on an empty side with the correct orientation', () => {
    const rails = railsWith({})
    const next = applyDockFloatAsNewSlot(
      rails, { kind: 'note', id: 1 }, { kind: 'empty-side', side: 'left' },
      () => 'new', (pid) => `${pid}-t`,
    )
    expect(next.left?.orientation).toBe('vertical')
    expect(next.left?.slots.map((s) => s.id)).toEqual(['new'])
    expect(getActiveTab(next.left!.slots[0]).type).toBe('notes')
  })

  it('creates a horizontal rail when docking to top', () => {
    const rails = railsWith({})
    const next = applyDockFloatAsNewSlot(
      rails, { kind: 'note', id: 1 }, { kind: 'empty-side', side: 'top' },
      () => 'new', (pid) => `${pid}-t`,
    )
    expect(next.top?.orientation).toBe('horizontal')
  })

  it('threads calendar orientation/weekOffset onto the fresh slot', () => {
    const rails = railsWith({})
    const next = applyDockFloatAsNewSlot(
      rails,
      { kind: 'calendar', id: 1, orientation: 'horizontal', weekOffset: -3 },
      { kind: 'empty-side', side: 'bottom' },
      () => 'new', (pid) => `${pid}-t`,
    )
    const slot = next.bottom!.slots[0]
    expect(slot.orientation).toBe('horizontal')
    expect(slot.weekOffset).toBe(-3)
  })

  it('threads lens listDefinitionId onto the fresh slot\'s tab', () => {
    const rails = railsWith({})
    const next = applyDockFloatAsNewSlot(
      rails, { kind: 'lens', id: 1, listDefinitionId: 123 }, { kind: 'empty-side', side: 'left' },
      () => 'new', (pid) => `${pid}-t`,
    )
    const appended = next.left!.slots[0].tabs[0]
    expect(appended.type).toBe('lens')
    expect(appended.listDefinitionId).toBe(123)
  })

  it('is a no-op when the target side is already occupied', () => {
    const t1 = tab('t1')
    const rails = railsWith({
      left: { orientation: 'vertical', slots: [slotWith('s1', [t1])] },
    })
    const next = applyDockFloatAsNewSlot(
      rails, { kind: 'note', id: 1 }, { kind: 'empty-side', side: 'left' },
      () => 'new', (pid) => `${pid}-t`,
    )
    expect(next).toBe(rails)
  })
})

describe('applyDockFloatAsNewSlot — slot-split', () => {
  it('inserts a new adjacent slot above the target', () => {
    const t1 = tab('t1')
    const rails = railsWith({
      right: { orientation: 'vertical', slots: [slotWith('s1', [t1])] },
    })
    const next = applyDockFloatAsNewSlot(
      rails, { kind: 'note', id: 1 }, { kind: 'slot-split', slotId: 's1', zone: 'above' },
      () => 'new', (pid) => `${pid}-t`,
    )
    expect(next.right!.slots.map((s) => s.id)).toEqual(['new', 's1'])
  })

  it('inserts a new adjacent slot below the target', () => {
    const t1 = tab('t1')
    const rails = railsWith({
      right: { orientation: 'vertical', slots: [slotWith('s1', [t1])] },
    })
    const next = applyDockFloatAsNewSlot(
      rails, { kind: 'note', id: 1 }, { kind: 'slot-split', slotId: 's1', zone: 'below' },
      () => 'new', (pid) => `${pid}-t`,
    )
    expect(next.right!.slots.map((s) => s.id)).toEqual(['s1', 'new'])
  })

  it('is a no-op when the target slot is unknown', () => {
    const rails = railsWith({})
    const next = applyDockFloatAsNewSlot(
      rails, { kind: 'note', id: 1 }, { kind: 'slot-split', slotId: 'nope', zone: 'above' },
      () => 'new', (pid) => `${pid}-t`,
    )
    expect(next).toBe(rails)
  })

  it('is a no-op when zone is center (center goes through dockFloatIntoSlot)', () => {
    const t1 = tab('t1')
    const rails = railsWith({
      right: { orientation: 'vertical', slots: [slotWith('s1', [t1])] },
    })
    const next = applyDockFloatAsNewSlot(
      rails, { kind: 'note', id: 1 }, { kind: 'slot-split', slotId: 's1', zone: 'center' },
      () => 'new', (pid) => `${pid}-t`,
    )
    expect(next).toBe(rails)
  })
})
