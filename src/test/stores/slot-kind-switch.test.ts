import { describe, it, expect, beforeEach } from 'vitest'
import { useCanvasRailsStore, createLensSlot, createSlot, createTaskboardSlot } from '../../stores/canvas-rails-store'
import { EMPTY_RAILS, getActiveTab } from '../../models/canvas-rails'

function resetRails() {
  useCanvasRailsStore.setState({ rails: EMPTY_RAILS, hydrated: true })
}

describe('canvas-rails-store.setSlotKind', () => {
  beforeEach(resetRails)

  it('switches a lens slot to notes and clears listDefinitionId', () => {
    const slot = createLensSlot(42)
    useCanvasRailsStore.setState({
      rails: { ...EMPTY_RAILS, right: { orientation: 'vertical', slots: [slot] } },
    })
    useCanvasRailsStore.getState().setSlotKind(slot.id, 'notes')
    const after = useCanvasRailsStore.getState().rails.right!.slots[0]!
    const tab = getActiveTab(after)
    expect(tab.type).toBe('notes')
    expect(tab.listDefinitionId).toBeUndefined()
    expect(after.id).toBe(slot.id)
  })

  it('switches a notes slot to taskboard (no per-tab seed — singleton board)', () => {
    const slot = createSlot('notes')
    slot.id = 'slot-1'
    useCanvasRailsStore.setState({
      rails: { ...EMPTY_RAILS, left: { orientation: 'vertical', slots: [slot] } },
    })
    useCanvasRailsStore.getState().setSlotKind(slot.id, 'taskboard')
    const after = useCanvasRailsStore.getState().rails.left!.slots[0]!
    const tab = getActiveTab(after)
    expect(tab.type).toBe('taskboard')
  })

  it('preserves slot id and rail position', () => {
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

  it('switching lens → taskboard clears listDefinitionId', () => {
    const slot = createLensSlot(42)
    useCanvasRailsStore.setState({
      rails: { ...EMPTY_RAILS, top: { orientation: 'horizontal', slots: [slot] } },
    })
    useCanvasRailsStore.getState().setSlotKind(slot.id, 'taskboard')
    const after = useCanvasRailsStore.getState().rails.top!.slots[0]!
    const tab = getActiveTab(after)
    expect(tab.type).toBe('taskboard')
    expect(tab.listDefinitionId).toBeUndefined()
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
