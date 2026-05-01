import { describe, it, expect, beforeEach } from 'vitest'
import { useCanvasRailsStore, createLensSlot, createSlot, createTaskboardSlot } from '../../stores/canvas-rails-store'
import { EMPTY_RAILS, getActiveTab } from '../../models/canvas-rails'
import type { SlotKind } from '../../models/canvas-rails'
import { SLOT_KIND_SWITCH_CASES } from '../utils/kind-switch-table'
import { resetRailsStore } from '../helpers'

function seedSlot(kind: SlotKind) {
  if (kind === 'lens') return createLensSlot(42)
  if (kind === 'taskboard') return createTaskboardSlot()
  return createSlot(kind)
}

describe('canvas-rails-store.setSlotKind', () => {
  beforeEach(() => resetRailsStore({ hydrated: true }))

  it.each(SLOT_KIND_SWITCH_CASES)('$from → $to', ({ from, to, expectClearListDef }) => {
    const slot = seedSlot(from)
    useCanvasRailsStore.setState({
      rails: { ...EMPTY_RAILS, right: { orientation: 'vertical', slots: [slot] } },
    })
    useCanvasRailsStore.getState().setSlotKind(slot.id, to)
    const after = useCanvasRailsStore.getState().rails.right!.slots[0]!
    const tab = getActiveTab(after)
    expect(tab.type).toBe(to)
    expect(after.id).toBe(slot.id)
    if (expectClearListDef) expect(tab.listDefinitionId).toBeUndefined()
  })

  it('preserves slot id and rail position across a 3-slot rail', () => {
    const slotA = createSlot('notes')
    slotA.id = 'a'
    const slotB = createTaskboardSlot()
    slotB.id = 'b'
    const slotC = createLensSlot(99)
    slotC.id = 'c'
    useCanvasRailsStore.setState({
      rails: { ...EMPTY_RAILS, right: { orientation: 'vertical', slots: [slotA, slotB, slotC] } },
    })
    useCanvasRailsStore.getState().setSlotKind('b', 'lens', { listDefinitionId: 11 })
    const slots = useCanvasRailsStore.getState().rails.right!.slots
    expect(slots.map((s) => s.id)).toEqual(['a', 'b', 'c'])
    const tab = getActiveTab(slots[1]!)
    expect(tab.type).toBe('lens')
    expect(tab.listDefinitionId).toBe(11)
  })

  it('is a no-op when the slotId is not found', () => {
    const slot = createLensSlot(1)
    useCanvasRailsStore.setState({
      rails: { ...EMPTY_RAILS, right: { orientation: 'vertical', slots: [slot] } },
    })
    const before = useCanvasRailsStore.getState().rails
    useCanvasRailsStore.getState().setSlotKind('nonexistent', 'notes')
    expect(useCanvasRailsStore.getState().rails).toBe(before)
  })
})
