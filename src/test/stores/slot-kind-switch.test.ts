import { describe, it, expect, beforeEach } from 'vitest'
import { useCanvasRailsStore, createLensSlot, createTaskboardSlot } from '../../stores/canvas-rails-store'
import { EMPTY_RAILS } from '../../models/canvas-rails'

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
    const after = useCanvasRailsStore.getState().rails.right!.slots[0]
    expect(after.kind).toBe('notes')
    expect(after.listDefinitionId).toBeUndefined()
    expect(after.id).toBe(slot.id)
  })

  it('switches a notes slot to taskboard with a seeded taskboardId', () => {
    const slot = { id: 'slot-1', kind: 'notes' as const }
    useCanvasRailsStore.setState({
      rails: { ...EMPTY_RAILS, left: { orientation: 'vertical', slots: [slot] } },
    })
    useCanvasRailsStore.getState().setSlotKind(slot.id, 'taskboard', { taskboardId: 7 })
    const after = useCanvasRailsStore.getState().rails.left!.slots[0]
    expect(after.kind).toBe('taskboard')
    expect(after.taskboardId).toBe(7)
  })

  it('preserves slot id and rail position', () => {
    const slotA = { id: 'a', kind: 'notes' as const }
    const slotB = createTaskboardSlot(3)
    slotB.id = 'b'
    const slotC = createLensSlot(99)
    slotC.id = 'c'
    useCanvasRailsStore.setState({
      rails: { ...EMPTY_RAILS, right: { orientation: 'vertical', slots: [slotA, slotB, slotC] } },
    })
    useCanvasRailsStore.getState().setSlotKind('b', 'lens', { listDefinitionId: 11 })
    const slots = useCanvasRailsStore.getState().rails.right!.slots
    expect(slots.map((s) => s.id)).toEqual(['a', 'b', 'c'])
    expect(slots[1].kind).toBe('lens')
    expect(slots[1].listDefinitionId).toBe(11)
    expect(slots[1].taskboardId).toBeUndefined()
  })

  it('switching lens → taskboard clears listDefinitionId', () => {
    const slot = createLensSlot(42)
    useCanvasRailsStore.setState({
      rails: { ...EMPTY_RAILS, top: { orientation: 'horizontal', slots: [slot] } },
    })
    useCanvasRailsStore.getState().setSlotKind(slot.id, 'taskboard', { taskboardId: 5 })
    const after = useCanvasRailsStore.getState().rails.top!.slots[0]
    expect(after.kind).toBe('taskboard')
    expect(after.listDefinitionId).toBeUndefined()
    expect(after.taskboardId).toBe(5)
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
