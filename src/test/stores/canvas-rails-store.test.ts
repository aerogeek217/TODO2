import { describe, it, expect, beforeEach } from 'vitest'
import { useCanvasRailsStore, createLensSlot, createSlot } from '../../stores/canvas-rails-store'
import { EMPTY_RAILS, getActiveTab } from '../../models/canvas-rails'
import { resetRailsStore } from '../helpers'

beforeEach(() => {
  resetRailsStore()
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
    expect(getActiveTab(s.rails.right!.slots[0]!).listDefinitionId).toBe(42)
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
    expect(getActiveTab(rail!.slots[0]!).listDefinitionId).toBe(1)
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
    expect(right?.slots[0]!.id).toBe(b.id)

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
    expect(useCanvasRailsStore.getState().rails.right?.slots[0]!.id).toBe(slot.id)
  })

  it('updateSlot with an empty patch returns the same rails ref (no re-render)', () => {
    // M2: the early-out branch — an updateSlot call whose patch doesn't
    // change any slot field must not mint a new rails object, so subscribers
    // via Zustand's referential equality skip the render cycle.
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
    const before = useCanvasRailsStore.getState().rails
    useCanvasRailsStore.getState().updateSlot(slot.id, {})
    expect(useCanvasRailsStore.getState().rails).toBe(before)
  })

  it('updateSlot with a patch matching current values returns the same rails ref', () => {
    const slot = createLensSlot(7)
    useCanvasRailsStore.setState({
      rails: {
        left: null,
        right: { orientation: 'vertical', slots: [slot] },
        top: null,
        bottom: null,
      },
      hydrated: true,
    })
    const before = useCanvasRailsStore.getState().rails
    useCanvasRailsStore.getState().updateSlot(slot.id, { listDefinitionId: 7 })
    expect(useCanvasRailsStore.getState().rails).toBe(before)
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
    expect(s.left?.slots[0]!.id).toBe(a.id)
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
    expect(slots[0]!.id).toBe(a.id)
    expect(slots[1]!.id).not.toBe(a.id)
    expect(getActiveTab(slots[1]!).type).toBe('lens')
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
    expect(rails.heights).toEqual({ top: 60, bottom: 300 })
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

  describe('tab reducers', () => {
    function seedOneSlot(slot = createLensSlot(1)) {
      useCanvasRailsStore.setState({
        rails: {
          left: null,
          right: { orientation: 'vertical', slots: [slot] },
          top: null,
          bottom: null,
        },
        hydrated: true,
      })
      return slot
    }

    it('addTab appends a tab and activates it', () => {
      const slot = seedOneSlot()
      useCanvasRailsStore.getState().addTab(slot.id, 'notes')
      const updated = useCanvasRailsStore.getState().rails.right!.slots[0]!
      expect(updated.tabs).toHaveLength(2)
      expect(updated.tabs[1]!.type).toBe('notes')
      expect(updated.activeTabId).toBe(updated.tabs[1]!.id)
    })

    it('addTab seeds listDefinitionId for lens tabs', () => {
      const slot = seedOneSlot()
      useCanvasRailsStore.getState().addTab(slot.id, 'lens', { listDefinitionId: 42 })
      const updated = useCanvasRailsStore.getState().rails.right!.slots[0]!
      expect(updated.tabs[1]!.listDefinitionId).toBe(42)
    })

    it('addTab appends a taskboard tab (no per-tab seed — singleton board)', () => {
      const slot = seedOneSlot()
      useCanvasRailsStore.getState().addTab(slot.id, 'taskboard')
      const updated = useCanvasRailsStore.getState().rails.right!.slots[0]!
      expect(updated.tabs[1]!.type).toBe('taskboard')
    })

    it('activateTab switches active tab when the id exists', () => {
      const slot = seedOneSlot()
      useCanvasRailsStore.getState().addTab(slot.id, 'notes')
      const s1 = useCanvasRailsStore.getState().rails.right!.slots[0]!
      const firstTabId = s1.tabs[0]!.id
      useCanvasRailsStore.getState().activateTab(slot.id, firstTabId)
      const s2 = useCanvasRailsStore.getState().rails.right!.slots[0]!
      expect(s2.activeTabId).toBe(firstTabId)
    })

    it('activateTab ignores unknown tabIds', () => {
      const slot = seedOneSlot()
      useCanvasRailsStore.getState().addTab(slot.id, 'notes')
      const before = useCanvasRailsStore.getState().rails
      useCanvasRailsStore.getState().activateTab(slot.id, 'unknown')
      expect(useCanvasRailsStore.getState().rails).toBe(before)
    })

    it('closeTab removes a tab and activates the left sibling', () => {
      const slot = seedOneSlot()
      useCanvasRailsStore.getState().addTab(slot.id, 'notes')
      useCanvasRailsStore.getState().addTab(slot.id, 'calendar')
      const mid = useCanvasRailsStore.getState().rails.right!.slots[0]!.tabs[1]!.id
      // Active tab is the 'calendar' tab (last added). Close the middle ('notes') tab.
      useCanvasRailsStore.getState().closeTab(slot.id, mid)
      const s = useCanvasRailsStore.getState().rails.right!.slots[0]!
      expect(s.tabs).toHaveLength(2)
      expect(s.tabs.find((t) => t.id === mid)).toBeUndefined()
    })

    it('closeTab closes the whole slot when only one tab remains', () => {
      const slot = seedOneSlot()
      const onlyTabId = slot.tabs[0]!.id
      useCanvasRailsStore.getState().closeTab(slot.id, onlyTabId)
      expect(useCanvasRailsStore.getState().rails.right).toBeNull()
    })

    it('closeTab activates the left sibling when the active tab is closed', () => {
      const slot = seedOneSlot()
      useCanvasRailsStore.getState().addTab(slot.id, 'notes') // index 1, now active
      const activeBefore = useCanvasRailsStore.getState().rails.right!.slots[0]!.activeTabId
      useCanvasRailsStore.getState().closeTab(slot.id, activeBefore)
      const s = useCanvasRailsStore.getState().rails.right!.slots[0]!
      expect(s.activeTabId).toBe(s.tabs[0]!.id)
    })

    it('closeTab on a middle tab keeps activeTabId valid (M7)', () => {
      // Seed three tabs [lens, notes, calendar]. Active is the last-added
      // (calendar, idx 2). Close the middle tab (notes). activeTabId should
      // still resolve to a real tab — this is the reasoning loophole M7
      // closes: any splice + fallback path ends with a tab that exists.
      const slot = seedOneSlot()
      useCanvasRailsStore.getState().addTab(slot.id, 'notes')
      useCanvasRailsStore.getState().addTab(slot.id, 'calendar')
      const midId = useCanvasRailsStore.getState().rails.right!.slots[0]!.tabs[1]!.id
      useCanvasRailsStore.getState().closeTab(slot.id, midId)
      const s = useCanvasRailsStore.getState().rails.right!.slots[0]!
      expect(s.tabs).toHaveLength(2)
      expect(s.tabs.some((t) => t.id === s.activeTabId)).toBe(true)
    })

    it('changeTabType rewrites a specific tab', () => {
      const slot = seedOneSlot()
      useCanvasRailsStore.getState().addTab(slot.id, 'notes')
      const firstTabId = slot.tabs[0]!.id
      useCanvasRailsStore.getState().changeTabType(slot.id, firstTabId, 'calendar')
      const s = useCanvasRailsStore.getState().rails.right!.slots[0]!
      expect(s.tabs[0]!.type).toBe('calendar')
      // Cross-kind seed cleared.
      expect(s.tabs[0]!.listDefinitionId).toBeUndefined()
    })
  })

  describe('setCornerOwner', () => {
    it('sets a corner owner and creates the corners bag on first write', () => {
      expect(useCanvasRailsStore.getState().rails.corners).toBeUndefined()
      useCanvasRailsStore.getState().setCornerOwner('nw', 'h')
      expect(useCanvasRailsStore.getState().rails.corners).toEqual({ nw: 'h' })
    })

    it('merges into an existing corners bag without touching siblings', () => {
      useCanvasRailsStore.setState({
        rails: { ...EMPTY_RAILS, corners: { nw: 'h' } },
        hydrated: true,
      })
      useCanvasRailsStore.getState().setCornerOwner('se', 'h')
      expect(useCanvasRailsStore.getState().rails.corners).toEqual({ nw: 'h', se: 'h' })
    })

    it('returns the same state when the owner already matches', () => {
      useCanvasRailsStore.setState({
        rails: { ...EMPTY_RAILS, corners: { nw: 'h' } },
        hydrated: true,
      })
      const before = useCanvasRailsStore.getState().rails
      useCanvasRailsStore.getState().setCornerOwner('nw', 'h')
      expect(useCanvasRailsStore.getState().rails).toBe(before)
    })

    it('can switch a corner back to vertical ownership', () => {
      useCanvasRailsStore.setState({
        rails: { ...EMPTY_RAILS, corners: { nw: 'h' } },
        hydrated: true,
      })
      useCanvasRailsStore.getState().setCornerOwner('nw', 'v')
      expect(useCanvasRailsStore.getState().rails.corners).toEqual({ nw: 'v' })
    })
  })

  describe('setRailCollapsed / toggleRailCollapsed', () => {
    it('setRailCollapsed(true) creates the collapsed bag on first write', () => {
      expect(useCanvasRailsStore.getState().rails.collapsed).toBeUndefined()
      useCanvasRailsStore.getState().setRailCollapsed('left', true)
      expect(useCanvasRailsStore.getState().rails.collapsed).toEqual({ left: true })
    })

    it('setRailCollapsed(false) removes the side from the bag, dropping the bag when empty', () => {
      useCanvasRailsStore.setState({
        rails: { ...EMPTY_RAILS, collapsed: { left: true } },
        hydrated: true,
      })
      useCanvasRailsStore.getState().setRailCollapsed('left', false)
      expect(useCanvasRailsStore.getState().rails.collapsed).toBeUndefined()
    })

    it('setRailCollapsed returns the same state when the value is unchanged', () => {
      useCanvasRailsStore.setState({
        rails: { ...EMPTY_RAILS, collapsed: { left: true } },
        hydrated: true,
      })
      const before = useCanvasRailsStore.getState().rails
      useCanvasRailsStore.getState().setRailCollapsed('left', true)
      expect(useCanvasRailsStore.getState().rails).toBe(before)
    })

    it('toggleRailCollapsed flips the flag on/off', () => {
      useCanvasRailsStore.getState().toggleRailCollapsed('right')
      expect(useCanvasRailsStore.getState().rails.collapsed).toEqual({ right: true })
      useCanvasRailsStore.getState().toggleRailCollapsed('right')
      expect(useCanvasRailsStore.getState().rails.collapsed).toBeUndefined()
    })

    it('preserves persisted width/height across collapse + expand', () => {
      const store = useCanvasRailsStore.getState()
      store.setRailSize('left', 420)
      store.setRailCollapsed('left', true)
      expect(useCanvasRailsStore.getState().rails.widths?.left).toBe(420)
      store.setRailCollapsed('left', false)
      expect(useCanvasRailsStore.getState().rails.widths?.left).toBe(420)
    })
  })

  describe('setAllRailsCollapsed', () => {
    it('collapses every present rail in one update; skips absent sides', () => {
      useCanvasRailsStore.setState({
        rails: {
          left: { orientation: 'vertical', slots: [createLensSlot(1)] },
          right: null,
          top: { orientation: 'horizontal', slots: [createLensSlot(2)] },
          bottom: null,
        },
        hydrated: true,
      })
      useCanvasRailsStore.getState().setAllRailsCollapsed(true)
      expect(useCanvasRailsStore.getState().rails.collapsed).toEqual({ left: true, top: true })
    })

    it('expands every present rail and drops the bag when empty', () => {
      useCanvasRailsStore.setState({
        rails: {
          left: { orientation: 'vertical', slots: [createLensSlot(1)] },
          right: { orientation: 'vertical', slots: [createLensSlot(2)] },
          top: null,
          bottom: null,
          collapsed: { left: true, right: true },
        },
        hydrated: true,
      })
      useCanvasRailsStore.getState().setAllRailsCollapsed(false)
      expect(useCanvasRailsStore.getState().rails.collapsed).toBeUndefined()
    })

    it('leaves stale flags for absent rails alone', () => {
      useCanvasRailsStore.setState({
        rails: {
          left: { orientation: 'vertical', slots: [createLensSlot(1)] },
          right: null,
          top: null,
          bottom: null,
          collapsed: { top: true },
        },
        hydrated: true,
      })
      useCanvasRailsStore.getState().setAllRailsCollapsed(true)
      expect(useCanvasRailsStore.getState().rails.collapsed).toEqual({ left: true, top: true })
      useCanvasRailsStore.getState().setAllRailsCollapsed(false)
      expect(useCanvasRailsStore.getState().rails.collapsed).toEqual({ top: true })
    })

    it('returns the same state when no present rail would change', () => {
      useCanvasRailsStore.setState({
        rails: {
          left: { orientation: 'vertical', slots: [createLensSlot(1)] },
          right: null,
          top: null,
          bottom: null,
          collapsed: { left: true },
        },
        hydrated: true,
      })
      const before = useCanvasRailsStore.getState().rails
      useCanvasRailsStore.getState().setAllRailsCollapsed(true)
      expect(useCanvasRailsStore.getState().rails).toBe(before)
    })

    it('is a no-op when no rails exist', () => {
      const before = useCanvasRailsStore.getState().rails
      useCanvasRailsStore.getState().setAllRailsCollapsed(true)
      expect(useCanvasRailsStore.getState().rails).toBe(before)
      expect(useCanvasRailsStore.getState().rails.collapsed).toBeUndefined()
    })
  })
})
