import { describe, it, expect, beforeEach } from 'vitest'
import { useCanvasRailsStore, createLensSlot, createSlot } from '../../stores/canvas-rails-store'
import { EMPTY_RAILS, getActiveTab } from '../../models/canvas-rails'

beforeEach(() => {
  useCanvasRailsStore.setState({ rails: EMPTY_RAILS, hydrated: false })
})

describe('canvas-rails-store', () => {
  it('starts with empty rails and unhydrated flag', () => {
    const s = useCanvasRailsStore.getState()
    expect(s.rails.left).toBeNull()
    expect(s.rails.right).toBeNull()
    expect(s.rails.top).toBeNull()
    expect(s.rails.bottom).toBeNull()
    expect(s.hydrated).toBe(false)
  })

  it('hydrate installs a RailsState and marks hydrated', () => {
    const slot = createLensSlot(42)
    useCanvasRailsStore.getState().hydrate({
      left: null,
      right: { orientation: 'vertical', slots: [slot] },
      top: null,
      bottom: null,
    })
    const s = useCanvasRailsStore.getState()
    expect(s.hydrated).toBe(true)
    expect(getActiveTab(s.rails.right!.slots[0]).listDefinitionId).toBe(42)
  })

  it('addRail on an empty side creates a rail with the right orientation', () => {
    const store = useCanvasRailsStore.getState()
    store.addRail('left', createLensSlot(1))
    expect(useCanvasRailsStore.getState().rails.left?.orientation).toBe('vertical')
    useCanvasRailsStore.getState().addRail('top', createLensSlot(2))
    expect(useCanvasRailsStore.getState().rails.top?.orientation).toBe('horizontal')
  })

  it('addRail is a no-op when the side is already occupied', () => {
    const existing = createLensSlot(1)
    useCanvasRailsStore.getState().addRail('right', existing)
    useCanvasRailsStore.getState().addRail('right', createLensSlot(2))
    const rail = useCanvasRailsStore.getState().rails.right
    expect(rail?.slots).toHaveLength(1)
    expect(getActiveTab(rail!.slots[0]).listDefinitionId).toBe(1)
  })

  it('closeSlot removes the matching slot and collapses an empty rail to null', () => {
    const a = createLensSlot(1)
    const b = createSlot('notes')
    useCanvasRailsStore.setState({
      rails: {
        left: null,
        right: { orientation: 'vertical', slots: [a, b] },
        top: null,
        bottom: null,
      },
      hydrated: true,
    })

    useCanvasRailsStore.getState().closeSlot(a.id)
    let right = useCanvasRailsStore.getState().rails.right
    expect(right?.slots).toHaveLength(1)
    expect(right?.slots[0].id).toBe(b.id)

    useCanvasRailsStore.getState().closeSlot(b.id)
    right = useCanvasRailsStore.getState().rails.right
    expect(right).toBeNull()
  })

  it('updateSlot patches the matching slot in place', () => {
    const slot = createLensSlot(1)
    useCanvasRailsStore.setState({
      rails: {
        left: null,
        right: { orientation: 'vertical', slots: [slot] },
        top: null,
        bottom: null,
      },
      hydrated: true,
    })
    useCanvasRailsStore.getState().updateSlot(slot.id, { listDefinitionId: 99 })
    const updated = useCanvasRailsStore.getState().rails.right?.slots[0]
    expect(updated?.id).toBe(slot.id)
    expect(getActiveTab(updated!).listDefinitionId).toBe(99)
  })

  it('updateSlot ignores id changes from the caller', () => {
    const slot = createLensSlot(1)
    useCanvasRailsStore.setState({
      rails: {
        left: null,
        right: { orientation: 'vertical', slots: [slot] },
        top: null,
        bottom: null,
      },
      hydrated: true,
    })
    useCanvasRailsStore.getState().updateSlot(slot.id, { id: 'malicious' } as unknown as { listDefinitionId?: number })
    expect(useCanvasRailsStore.getState().rails.right?.slots[0].id).toBe(slot.id)
  })

  it('dropSlotToSide delegates to the pure reducer', () => {
    const a = createLensSlot(1)
    useCanvasRailsStore.setState({
      rails: {
        left: null,
        right: { orientation: 'vertical', slots: [a] },
        top: null,
        bottom: null,
      },
      hydrated: true,
    })
    useCanvasRailsStore.getState().dropSlotToSide(a.id, 'left')
    const s = useCanvasRailsStore.getState().rails
    expect(s.right).toBeNull()
    expect(s.left?.slots[0].id).toBe(a.id)
  })

  it('edgeDropSlot reorders within a rail', () => {
    const a = createLensSlot(1)
    const b = createLensSlot(2)
    const c = createLensSlot(3)
    useCanvasRailsStore.setState({
      rails: {
        left: null,
        right: { orientation: 'vertical', slots: [a, b, c] },
        top: null,
        bottom: null,
      },
      hydrated: true,
    })
    useCanvasRailsStore.getState().edgeDropSlot(b.id, 'right', 'head')
    expect(useCanvasRailsStore.getState().rails.right?.slots.map((s) => s.id)).toEqual([b.id, a.id, c.id])
  })

  it('splitDropSlot inserts before a target slot', () => {
    const a = createLensSlot(1)
    const b = createLensSlot(2)
    useCanvasRailsStore.setState({
      rails: {
        left: { orientation: 'vertical', slots: [a] },
        right: { orientation: 'vertical', slots: [b] },
        top: null,
        bottom: null,
      },
      hydrated: true,
    })
    useCanvasRailsStore.getState().splitDropSlot(a.id, b.id, 'above')
    const s = useCanvasRailsStore.getState().rails
    expect(s.left).toBeNull()
    expect(s.right?.slots.map((x) => x.id)).toEqual([a.id, b.id])
  })

  it('splitSlot inserts a new adjacent slot', () => {
    const a = createLensSlot(1)
    useCanvasRailsStore.setState({
      rails: {
        left: null,
        right: { orientation: 'vertical', slots: [a] },
        top: null,
        bottom: null,
      },
      hydrated: true,
    })
    useCanvasRailsStore.getState().splitSlot(a.id, 'below')
    const slots = useCanvasRailsStore.getState().rails.right?.slots ?? []
    expect(slots).toHaveLength(2)
    expect(slots[0].id).toBe(a.id)
    expect(slots[1].id).not.toBe(a.id)
    expect(getActiveTab(slots[1]).type).toBe('lens')
  })

  it('setRailSize persists per-side widths/heights and clamps out-of-range values', () => {
    useCanvasRailsStore.setState({ rails: EMPTY_RAILS, hydrated: true })
    const store = useCanvasRailsStore.getState()
    store.setRailSize('left', 420)
    store.setRailSize('right', 9999)
    store.setRailSize('top', 10)
    store.setRailSize('bottom', 300)
    const rails = useCanvasRailsStore.getState().rails
    expect(rails.widths).toEqual({ left: 420, right: 600 })
    expect(rails.heights).toEqual({ top: 200, bottom: 300 })
  })

  it('setRailSize returns the same rails ref when the value is unchanged', () => {
    useCanvasRailsStore.setState({
      rails: { ...EMPTY_RAILS, widths: { left: 420 } },
      hydrated: true,
    })
    const before = useCanvasRailsStore.getState().rails
    useCanvasRailsStore.getState().setRailSize('left', 420)
    expect(useCanvasRailsStore.getState().rails).toBe(before)
  })

  it('closeSlot and updateSlot are no-ops when the slotId is unknown', () => {
    const slot = createLensSlot(1)
    const before = {
      left: null,
      right: { orientation: 'vertical' as const, slots: [slot] },
      top: null,
      bottom: null,
    }
    useCanvasRailsStore.setState({ rails: before, hydrated: true })
    const original = useCanvasRailsStore.getState().rails
    useCanvasRailsStore.getState().closeSlot('nope')
    useCanvasRailsStore.getState().updateSlot('nope', { listDefinitionId: 7 })
    expect(useCanvasRailsStore.getState().rails).toBe(original)
  })
})
