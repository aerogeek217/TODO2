import { describe, it, expect } from 'vitest'
import type { RailsState, Slot } from '../../../../models/canvas-rails'
import {
  applyCenterSwap,
  applyDropToSide,
  applyEdgeDrop,
  applySplitDrop,
  applySplitButton,
  decodeRailsDropId,
  encodeRailsDropId,
  findSlotLocation,
  isRailsDropId,
  pointerToSplitZone,
} from '../../../../components/canvas/rails/rail-dnd'

function lensSlot(id: string, listDefinitionId?: number): Slot {
  return { id, kind: 'lens', listDefinitionId }
}

function notesSlot(id: string): Slot {
  return { id, kind: 'notes' }
}

function railsWith(
  overrides: Partial<RailsState>,
): RailsState {
  return {
    left: null,
    right: null,
    top: null,
    bottom: null,
    ...overrides,
  }
}

describe('rail-dnd id encoding', () => {
  it('round-trips empty-side zones', () => {
    const z = { kind: 'empty-side' as const, side: 'left' as const }
    const id = encodeRailsDropId(z)
    expect(isRailsDropId(id)).toBe(true)
    expect(decodeRailsDropId(id)).toEqual(z)
  })

  it('round-trips edge zones', () => {
    const z = { kind: 'edge' as const, side: 'right' as const, edge: 'head' as const }
    expect(decodeRailsDropId(encodeRailsDropId(z))).toEqual(z)
  })

  it('round-trips slot zones, including ids containing colons', () => {
    const z = { kind: 'slot' as const, slotId: 'slot:abc:42' }
    expect(decodeRailsDropId(encodeRailsDropId(z))).toEqual(z)
  })

  it('rejects non-rails ids', () => {
    expect(isRailsDropId('project-12')).toBe(false)
    expect(decodeRailsDropId('project-12')).toBeNull()
    expect(decodeRailsDropId('rails:garbage')).toBeNull()
  })
})

describe('findSlotLocation', () => {
  it('returns side + index for an existing slot', () => {
    const a = lensSlot('a')
    const b = lensSlot('b')
    const rails = railsWith({ right: { orientation: 'vertical', slots: [a, b] } })
    expect(findSlotLocation(rails, 'b')).toEqual({ side: 'right', index: 1 })
  })

  it('returns null for unknown ids', () => {
    const rails = railsWith({})
    expect(findSlotLocation(rails, 'nope')).toBeNull()
  })
})

describe('applyDropToSide', () => {
  it('moves a slot to an empty opposite side, creating the rail', () => {
    const a = lensSlot('a')
    const rails = railsWith({ right: { orientation: 'vertical', slots: [a] } })
    const next = applyDropToSide(rails, 'a', 'left')
    expect(next.right).toBeNull()
    expect(next.left?.orientation).toBe('vertical')
    expect(next.left?.slots.map((s) => s.id)).toEqual(['a'])
  })

  it('moves a slot to a horizontal side and sets the correct orientation', () => {
    const a = lensSlot('a')
    const rails = railsWith({ left: { orientation: 'vertical', slots: [a] } })
    const next = applyDropToSide(rails, 'a', 'top')
    expect(next.top?.orientation).toBe('horizontal')
    expect(next.top?.slots).toHaveLength(1)
  })

  it('is a no-op if the destination side already has a rail', () => {
    const a = lensSlot('a')
    const b = lensSlot('b')
    const rails = railsWith({
      left: { orientation: 'vertical', slots: [a] },
      right: { orientation: 'vertical', slots: [b] },
    })
    const next = applyDropToSide(rails, 'a', 'right')
    expect(next).toBe(rails)
  })

  it('is a no-op if the source rail is the destination and already single-slot', () => {
    const a = lensSlot('a')
    const rails = railsWith({ right: { orientation: 'vertical', slots: [a] } })
    const next = applyDropToSide(rails, 'a', 'right')
    expect(next).toBe(rails)
  })

  it('is a no-op for unknown slot ids', () => {
    const rails = railsWith({})
    expect(applyDropToSide(rails, 'nope', 'left')).toBe(rails)
  })
})

describe('applyEdgeDrop', () => {
  it('inserts at the head of an existing rail', () => {
    const a = lensSlot('a')
    const b = lensSlot('b')
    const rails = railsWith({
      left: { orientation: 'vertical', slots: [a] },
      right: { orientation: 'vertical', slots: [b] },
    })
    const next = applyEdgeDrop(rails, 'a', 'right', 'head')
    expect(next.left).toBeNull()
    expect(next.right?.slots.map((s) => s.id)).toEqual(['a', 'b'])
  })

  it('inserts at the tail of an existing rail', () => {
    const a = lensSlot('a')
    const b = lensSlot('b')
    const rails = railsWith({
      left: { orientation: 'vertical', slots: [a] },
      right: { orientation: 'vertical', slots: [b] },
    })
    const next = applyEdgeDrop(rails, 'a', 'right', 'tail')
    expect(next.right?.slots.map((s) => s.id)).toEqual(['b', 'a'])
  })

  it('creates the destination rail when empty', () => {
    const a = lensSlot('a')
    const rails = railsWith({ right: { orientation: 'vertical', slots: [a] } })
    const next = applyEdgeDrop(rails, 'a', 'left', 'head')
    expect(next.right).toBeNull()
    expect(next.left?.orientation).toBe('vertical')
    expect(next.left?.slots.map((s) => s.id)).toEqual(['a'])
  })

  it('reorders within the same rail via head/tail', () => {
    const a = lensSlot('a')
    const b = lensSlot('b')
    const c = lensSlot('c')
    const rails = railsWith({ right: { orientation: 'vertical', slots: [a, b, c] } })
    const head = applyEdgeDrop(rails, 'b', 'right', 'head')
    expect(head.right?.slots.map((s) => s.id)).toEqual(['b', 'a', 'c'])
    const tail = applyEdgeDrop(rails, 'b', 'right', 'tail')
    expect(tail.right?.slots.map((s) => s.id)).toEqual(['a', 'c', 'b'])
  })

  it('is a no-op for unknown slot ids', () => {
    const rails = railsWith({})
    expect(applyEdgeDrop(rails, 'nope', 'right', 'head')).toBe(rails)
  })
})

describe('applySplitDrop', () => {
  it('inserts before target on "above" in a vertical rail', () => {
    const a = lensSlot('a')
    const b = lensSlot('b')
    const c = lensSlot('c')
    const rails = railsWith({ right: { orientation: 'vertical', slots: [a, b, c] } })
    const next = applySplitDrop(rails, 'a', 'c', 'above')
    expect(next.right?.slots.map((s) => s.id)).toEqual(['b', 'a', 'c'])
  })

  it('inserts after target on "below" in a vertical rail', () => {
    const a = lensSlot('a')
    const b = lensSlot('b')
    const rails = railsWith({ right: { orientation: 'vertical', slots: [a, b] } })
    const next = applySplitDrop(rails, 'a', 'b', 'below')
    expect(next.right?.slots.map((s) => s.id)).toEqual(['b', 'a'])
  })

  it('inserts before target on "left" in a horizontal rail', () => {
    const a = lensSlot('a')
    const b = lensSlot('b')
    const rails = railsWith({ top: { orientation: 'horizontal', slots: [a, b] } })
    const next = applySplitDrop(rails, 'b', 'a', 'left')
    expect(next.top?.slots.map((s) => s.id)).toEqual(['b', 'a'])
  })

  it('inserts after target on "right" in a horizontal rail', () => {
    const a = lensSlot('a')
    const b = lensSlot('b')
    const rails = railsWith({ top: { orientation: 'horizontal', slots: [a, b] } })
    const next = applySplitDrop(rails, 'a', 'b', 'right')
    expect(next.top?.slots.map((s) => s.id)).toEqual(['b', 'a'])
  })

  it('treats "center" as a swap — same-rail source and target trade positions', () => {
    const a = lensSlot('a')
    const b = lensSlot('b')
    const c = lensSlot('c')
    const rails = railsWith({ right: { orientation: 'vertical', slots: [a, b, c] } })
    const next = applySplitDrop(rails, 'a', 'c', 'center')
    expect(next.right?.slots.map((s) => s.id)).toEqual(['c', 'b', 'a'])
  })

  it('center swap across rails swaps one slot between rails, preserving counts', () => {
    const a = lensSlot('a')
    const b = lensSlot('b')
    const c = lensSlot('c')
    const rails = railsWith({
      left: { orientation: 'vertical', slots: [a, b] },
      right: { orientation: 'vertical', slots: [c] },
    })
    const next = applySplitDrop(rails, 'b', 'c', 'center')
    expect(next.left?.slots.map((s) => s.id)).toEqual(['a', 'c'])
    expect(next.right?.slots.map((s) => s.id)).toEqual(['b'])
  })

  it('moves a slot across rails', () => {
    const a = lensSlot('a')
    const b = lensSlot('b')
    const rails = railsWith({
      left: { orientation: 'vertical', slots: [a] },
      right: { orientation: 'vertical', slots: [b] },
    })
    const next = applySplitDrop(rails, 'a', 'b', 'above')
    expect(next.left).toBeNull()
    expect(next.right?.slots.map((s) => s.id)).toEqual(['a', 'b'])
  })

  it('is a no-op when source and target are the same slot', () => {
    const a = lensSlot('a')
    const rails = railsWith({ right: { orientation: 'vertical', slots: [a] } })
    expect(applySplitDrop(rails, 'a', 'a', 'above')).toBe(rails)
  })

  it('is a no-op when target is unknown', () => {
    const a = lensSlot('a')
    const rails = railsWith({ right: { orientation: 'vertical', slots: [a] } })
    expect(applySplitDrop(rails, 'a', 'nope', 'above')).toBe(rails)
  })
})

describe('applyCenterSwap', () => {
  it('swaps two slots on the same rail', () => {
    const a = lensSlot('a')
    const b = lensSlot('b')
    const c = lensSlot('c')
    const rails = railsWith({ right: { orientation: 'vertical', slots: [a, b, c] } })
    const next = applyCenterSwap(rails, 'a', 'c')
    expect(next.right?.slots.map((s) => s.id)).toEqual(['c', 'b', 'a'])
  })

  it('swaps two slots across rails without changing rail counts', () => {
    const a = lensSlot('a')
    const b = notesSlot('b')
    const rails = railsWith({
      left: { orientation: 'vertical', slots: [a] },
      right: { orientation: 'vertical', slots: [b] },
    })
    const next = applyCenterSwap(rails, 'a', 'b')
    expect(next.left?.slots.map((s) => s.id)).toEqual(['b'])
    expect(next.right?.slots.map((s) => s.id)).toEqual(['a'])
  })

  it('is a no-op when source and target are the same slot', () => {
    const a = lensSlot('a')
    const rails = railsWith({ right: { orientation: 'vertical', slots: [a] } })
    expect(applyCenterSwap(rails, 'a', 'a')).toBe(rails)
  })

  it('is a no-op when either slot id is unknown', () => {
    const a = lensSlot('a')
    const rails = railsWith({ right: { orientation: 'vertical', slots: [a] } })
    expect(applyCenterSwap(rails, 'a', 'nope')).toBe(rails)
    expect(applyCenterSwap(rails, 'nope', 'a')).toBe(rails)
  })
})

describe('applySplitButton', () => {
  it('inserts a new slot above the source in a vertical rail', () => {
    const a = lensSlot('a')
    const b = lensSlot('b')
    const rails = railsWith({ right: { orientation: 'vertical', slots: [a, b] } })
    const next = applySplitButton(rails, 'b', 'above', { genSlotId: () => 'new' })
    expect(next.right?.slots.map((s) => s.id)).toEqual(['a', 'new', 'b'])
    expect(next.right?.slots[1].kind).toBe('lens')
  })

  it('inserts below the source', () => {
    const a = lensSlot('a')
    const rails = railsWith({ right: { orientation: 'vertical', slots: [a] } })
    const next = applySplitButton(rails, 'a', 'below', { genSlotId: () => 'new' })
    expect(next.right?.slots.map((s) => s.id)).toEqual(['a', 'new'])
  })

  it('inserts with the requested kind', () => {
    const a = lensSlot('a')
    const rails = railsWith({ right: { orientation: 'vertical', slots: [a] } })
    const next = applySplitButton(rails, 'a', 'below', { genSlotId: () => 'new', kind: 'notes' })
    expect(next.right?.slots[1].kind).toBe('notes')
  })

  it('respects horizontal rail orientation (left = before, right = after)', () => {
    const a = notesSlot('a')
    const b = notesSlot('b')
    const rails = railsWith({ top: { orientation: 'horizontal', slots: [a, b] } })
    const next = applySplitButton(rails, 'b', 'left', { genSlotId: () => 'new' })
    expect(next.top?.slots.map((s) => s.id)).toEqual(['a', 'new', 'b'])
  })

  it('is a no-op for unknown slot ids', () => {
    const rails = railsWith({})
    expect(applySplitButton(rails, 'nope', 'above')).toBe(rails)
  })
})

describe('flex reconciliation on insert/remove', () => {
  it('hands a split-inserted slot the mean flex of its new siblings', () => {
    const a: Slot = { ...lensSlot('a'), flex: 160 }
    const b: Slot = { ...lensSlot('b'), flex: 140 }
    const rails = railsWith({ right: { orientation: 'vertical', slots: [a, b] } })
    const next = applySplitButton(rails, 'b', 'below', { genSlotId: () => 'c' })
    const inserted = next.right!.slots.find((s) => s.id === 'c')!
    expect(inserted.flex).toBe(150)
  })

  it('leaves split-inserted slot without flex when no sibling carries flex', () => {
    const a = lensSlot('a')
    const rails = railsWith({ right: { orientation: 'vertical', slots: [a] } })
    const next = applySplitButton(rails, 'a', 'below', { genSlotId: () => 'c' })
    expect(next.right!.slots.find((s) => s.id === 'c')!.flex).toBeUndefined()
  })

  it('reconciles flex when moving a slot to an existing rail via edge drop', () => {
    const a: Slot = { ...lensSlot('a'), flex: 200 }
    const b: Slot = { ...lensSlot('b'), flex: 100 }
    const c = lensSlot('c')
    const rails = railsWith({
      right: { orientation: 'vertical', slots: [a, b] },
      left: { orientation: 'vertical', slots: [c] },
    })
    const next = applyEdgeDrop(rails, 'c', 'right', 'tail')
    const moved = next.right!.slots.find((s) => s.id === 'c')!
    expect(moved.flex).toBe(150)
  })

  it('strips flex when a moved slot becomes the sole occupant of a fresh rail', () => {
    const a: Slot = { ...lensSlot('a'), flex: 250 }
    const rails = railsWith({ right: { orientation: 'vertical', slots: [a] } })
    const next = applyDropToSide(rails, 'a', 'left')
    expect(next.left!.slots[0].flex).toBeUndefined()
  })

  it('strips flex from the sole remaining slot after removal via split-drop', () => {
    const a: Slot = { ...lensSlot('a'), flex: 180 }
    const b: Slot = { ...lensSlot('b'), flex: 120 }
    const c = lensSlot('c')
    const rails = railsWith({
      right: { orientation: 'vertical', slots: [a, b] },
      left: { orientation: 'vertical', slots: [c] },
    })
    // Move b out to the left rail. Right should be left with only a, and a's flex should be cleared.
    const next = applySplitDrop(rails, 'b', 'c', 'above')
    expect(next.right!.slots).toHaveLength(1)
    expect(next.right!.slots[0].id).toBe('a')
    expect(next.right!.slots[0].flex).toBeUndefined()
  })
})

describe('pointerToSplitZone', () => {
  const rect = { left: 0, top: 0, width: 100, height: 100 }

  it('returns above / below on a vertical slot', () => {
    expect(pointerToSplitZone({ x: 50, y: 5 }, rect, 'vertical')).toBe('above')
    expect(pointerToSplitZone({ x: 50, y: 95 }, rect, 'vertical')).toBe('below')
    expect(pointerToSplitZone({ x: 50, y: 50 }, rect, 'vertical')).toBe('center')
  })

  it('returns left / right on a horizontal slot', () => {
    expect(pointerToSplitZone({ x: 5, y: 50 }, rect, 'horizontal')).toBe('left')
    expect(pointerToSplitZone({ x: 95, y: 50 }, rect, 'horizontal')).toBe('right')
    expect(pointerToSplitZone({ x: 50, y: 50 }, rect, 'horizontal')).toBe('center')
  })

  it('clamps out-of-bounds pointers into the nearest edge zone', () => {
    expect(pointerToSplitZone({ x: -20, y: 50 }, rect, 'horizontal')).toBe('left')
    expect(pointerToSplitZone({ x: 200, y: 50 }, rect, 'horizontal')).toBe('right')
  })
})
