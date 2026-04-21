import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '../../../../data/database'
import { popSlotToCanvas, popTabToCanvas } from '../../../../components/canvas/rails/RailsFrame'
import { useCanvasStore } from '../../../../stores/canvas-store'
import { useNoteStore } from '../../../../stores/note-store'
import { useFloatingNoteStore } from '../../../../stores/floating-note-store'
import { useListInsetStore } from '../../../../stores/list-inset-store'
import { useFloatingCalendarStore } from '../../../../stores/floating-calendar-store'
import { useFloatingTaskboardStore } from '../../../../stores/floating-taskboard-store'
import { useTaskboardStore } from '../../../../stores/taskboard-store'
import { useListDefinitionStore } from '../../../../stores/list-definition-store'
import { useCanvasRailsStore } from '../../../../stores/canvas-rails-store'
import { EMPTY_RAILS, getActiveTab } from '../../../../models/canvas-rails'
import type { Slot, SlotKind } from '../../../../models/canvas-rails'

function makeSlot(id: string, kind: SlotKind, extra?: { listDefinitionId?: number }): Slot {
  const tab = { id: `${id}-t0`, type: kind, ...(extra ?? {}) }
  return { id, tabs: [tab], activeTabId: tab.id }
}

beforeEach(async () => {
  await db.delete()
  await db.open()
  useCanvasStore.setState({ selectedCanvasId: null })
  useNoteStore.setState({ notes: new Map(), activeId: null, lastSavedAt: null })
  useListInsetStore.setState({ insets: [], loading: false, error: null })
  useFloatingCalendarStore.setState({ calendars: [], loading: false, error: null })
  useFloatingNoteStore.setState({ notes: [], loading: false, error: null })
  useFloatingTaskboardStore.setState({ taskboards: [], loading: false, error: null })
  useTaskboardStore.setState({ board: null, loading: false, error: null })
  useListDefinitionStore.setState({ listDefinitions: [], loading: false, error: null })
  useCanvasRailsStore.setState({ rails: EMPTY_RAILS, hydrated: true, pendingFocusSlotId: null })
})

async function seedCanvas(): Promise<number> {
  const id = await db.canvases.add({ name: 'Test', sortOrder: 0, createdAt: new Date() })
  useCanvasStore.setState({ selectedCanvasId: id })
  return id
}

describe('popSlotToCanvas', () => {
  it('no-ops when no canvas is selected', async () => {
    const slot = makeSlot('slot-1', 'calendar')
    const moved = await popSlotToCanvas(slot)
    expect(moved).toBe(false)
    expect(useFloatingCalendarStore.getState().calendars.length).toBe(0)
  })

  it('pops a notes slot into a placement-only floating note (no content fork)', async () => {
    const canvasId = await seedCanvas()
    const now = new Date()
    const globalId = await db.notes.add({ content: 'GLOBAL NOTE STAYS PUT', createdAt: now, modifiedAt: now })
    await useNoteStore.getState().load()
    expect(useNoteStore.getState().activeId).toBe(globalId)

    const slot = makeSlot('slot-notes', 'notes')
    const moved = await popSlotToCanvas(slot)
    expect(moved).toBe(true)

    // A placement row was created — no content, just x/y/w/h.
    const floating = useFloatingNoteStore.getState().notes.filter((n) => n.canvasId === canvasId)
    expect(floating.length).toBe(1)
    expect(floating[0].width).toBeGreaterThan(0)
    expect(floating[0].height).toBeGreaterThan(0)
    // The global note is unchanged; the floating widget will view it via NotesBody.
    expect(useNoteStore.getState().notes.get(globalId)?.content).toBe('GLOBAL NOTE STAYS PUT')
    // And no per-floating content row was created in the notes table.
    expect(await db.notes.where('id').notEqual(globalId).count()).toBe(0)
  })

  it('pops a lens slot into a list inset pointing at the same definition', async () => {
    const canvasId = await seedCanvas()
    const defId = await db.listDefinitions.add({
      name: 'Test list',
      sortOrder: 0,
      pinnedToDashboard: false,
      membership: { kind: 'custom', predicate: {
        showCompleted: false,
        showHiddenStatuses: false,
        personIds: null,
        personFilterMode: 'include-orgs',
        orgIds: null,
        orgFilterMode: 'include-people',
        projectIds: null,
        statusIds: null,
        searchText: '',
        dateField: 'date',
        dateRangeStart: null,
        dateRangeEnd: null,
        dateRangeIncludeNoDate: false,
        hasScheduled: null,
        hasDeadline: null,
      } },
      sort: { kind: 'sort-order' },
      grouping: { kind: 'none' },
    })

    const slot = makeSlot('slot-lens', 'lens', { listDefinitionId: defId })
    const moved = await popSlotToCanvas(slot)
    expect(moved).toBe(true)

    const insets = useListInsetStore.getState().insets.filter((i) => i.canvasId === canvasId)
    expect(insets.length).toBe(1)
    expect(insets[0].listDefinitionId).toBe(defId)
  })

  it('skips a lens slot that has no list definition', async () => {
    await seedCanvas()
    const slot = makeSlot('slot-lens', 'lens')
    const moved = await popSlotToCanvas(slot)
    expect(moved).toBe(false)
    expect(useListInsetStore.getState().insets.length).toBe(0)
  })

  it('pops a taskboard slot into a floating taskboard (singleton board)', async () => {
    const canvasId = await seedCanvas()

    const slot = makeSlot('slot-tb', 'taskboard')
    const moved = await popSlotToCanvas(slot)
    expect(moved).toBe(true)

    const floating = useFloatingTaskboardStore.getState().taskboards.filter((t) => t.canvasId === canvasId)
    expect(floating.length).toBe(1)
  })

  it('pops a calendar slot into a floating calendar node', async () => {
    const canvasId = await seedCanvas()
    const slot = makeSlot('slot-cal', 'calendar')
    const moved = await popSlotToCanvas(slot)
    expect(moved).toBe(true)

    const calendars = useFloatingCalendarStore.getState().calendars.filter((c) => c.canvasId === canvasId)
    expect(calendars.length).toBe(1)
    expect(calendars[0].width).toBeGreaterThan(0)
    expect(calendars[0].height).toBeGreaterThan(0)
  })
})

describe('popTabToCanvas', () => {
  it('returns false when tabId is not in the slot', async () => {
    await seedCanvas()
    const slot = makeSlot('slot-x', 'calendar')
    const moved = await popTabToCanvas(slot, 'nonexistent-tab')
    expect(moved).toBe(false)
    expect(useFloatingCalendarStore.getState().calendars.length).toBe(0)
  })

  it('dispatches by the tab\'s own type, not the active tab\'s', async () => {
    const canvasId = await seedCanvas()
    // Build a multi-tab slot where the active tab is notes, but we pop the
    // non-active calendar tab. The calendar floating store should get the add.
    const notesTab = { id: 'slot-mt-t0', type: 'notes' as const }
    const calTab = { id: 'slot-mt-t1', type: 'calendar' as const }
    const slot = { id: 'slot-mt', tabs: [notesTab, calTab], activeTabId: notesTab.id }
    const moved = await popTabToCanvas(slot, calTab.id)
    expect(moved).toBe(true)
    // Calendar got an add.
    const cals = useFloatingCalendarStore.getState().calendars.filter((c) => c.canvasId === canvasId)
    expect(cals.length).toBe(1)
    // Notes did not.
    expect(useFloatingNoteStore.getState().notes.filter((n) => n.canvasId === canvasId).length).toBe(0)
  })

  it('skips a lens tab without a listDefinitionId', async () => {
    await seedCanvas()
    const tab = { id: 'slot-x-t0', type: 'lens' as const }
    const slot = { id: 'slot-x', tabs: [tab], activeTabId: tab.id }
    const moved = await popTabToCanvas(slot, tab.id)
    expect(moved).toBe(false)
    expect(useListInsetStore.getState().insets.length).toBe(0)
  })
})

describe('pop-out + closeTab cascade', () => {
  it('popping the active tab of a 2-tab slot leaves the slot open with one tab', async () => {
    const canvasId = await seedCanvas()

    // Seed a 2-tab slot: calendar (active) + notes.
    const activeTab = { id: 'slot-m-t0', type: 'calendar' as const }
    const otherTab = { id: 'slot-m-t1', type: 'notes' as const }
    useCanvasRailsStore.setState({
      rails: {
        left: null,
        right: { orientation: 'vertical', slots: [{
          id: 'slot-m',
          tabs: [activeTab, otherTab],
          activeTabId: activeTab.id,
        }] },
        top: null,
        bottom: null,
      },
      hydrated: true,
    })

    const slot = useCanvasRailsStore.getState().rails.right!.slots[0]
    const moved = await popTabToCanvas(slot, activeTab.id)
    expect(moved).toBe(true)
    // Floating calendar got the add.
    expect(useFloatingCalendarStore.getState().calendars.filter((c) => c.canvasId === canvasId).length).toBe(1)

    // Caller is responsible for closing the tab after a successful pop.
    useCanvasRailsStore.getState().closeTab(slot.id, activeTab.id)

    // Slot survives, now with only the notes tab; activation moved to it.
    const right = useCanvasRailsStore.getState().rails.right
    expect(right?.slots.length).toBe(1)
    const remaining = right!.slots[0]
    expect(remaining.tabs.length).toBe(1)
    expect(remaining.tabs[0].id).toBe(otherTab.id)
    expect(remaining.activeTabId).toBe(otherTab.id)
  })

  it('popping the only tab of a slot cascade-closes the slot', async () => {
    const canvasId = await seedCanvas()

    const tab = { id: 'slot-s-t0', type: 'calendar' as const }
    useCanvasRailsStore.setState({
      rails: {
        left: null,
        right: { orientation: 'vertical', slots: [{ id: 'slot-s', tabs: [tab], activeTabId: tab.id }] },
        top: null,
        bottom: null,
      },
      hydrated: true,
    })

    const slot = useCanvasRailsStore.getState().rails.right!.slots[0]
    const moved = await popTabToCanvas(slot, tab.id)
    expect(moved).toBe(true)
    expect(useFloatingCalendarStore.getState().calendars.filter((c) => c.canvasId === canvasId).length).toBe(1)

    useCanvasRailsStore.getState().closeTab(slot.id, tab.id)
    // Rail collapsed to null because the sole slot's sole tab was closed.
    expect(useCanvasRailsStore.getState().rails.right).toBeNull()
  })
})

describe('createAndDockSlot', () => {
  it('docks into the first empty rail, preferring right', () => {
    const id = useCanvasRailsStore.getState().createAndDockSlot('calendar')
    const { rails } = useCanvasRailsStore.getState()
    expect(rails.right?.slots.map((s) => s.id)).toEqual([id])
    expect(rails.left).toBeNull()
    expect(rails.top).toBeNull()
    expect(rails.bottom).toBeNull()
  })

  it('falls back to left when right is occupied', () => {
    useCanvasRailsStore.getState().createAndDockSlot('calendar')
    const id = useCanvasRailsStore.getState().createAndDockSlot('notes')
    const { rails } = useCanvasRailsStore.getState()
    expect(rails.left?.slots.map((s) => s.id)).toEqual([id])
  })

  it('appends to the right rail when all four rails are occupied', () => {
    const store = useCanvasRailsStore.getState()
    store.createAndDockSlot('calendar')
    store.createAndDockSlot('notes')
    store.createAndDockSlot('calendar')
    store.createAndDockSlot('notes')
    // All four rails now each have one slot. Next dock appends to right.
    const id = useCanvasRailsStore.getState().createAndDockSlot('calendar')
    const { rails } = useCanvasRailsStore.getState()
    expect(rails.right?.slots.length).toBe(2)
    expect(rails.right?.slots[1].id).toBe(id)
  })

  it('carries listDefinitionId through for lens slots', () => {
    const id = useCanvasRailsStore.getState().createAndDockSlot('lens', 42)
    const { rails } = useCanvasRailsStore.getState()
    const slot = rails.right?.slots.find((s) => s.id === id)
    expect(slot).toBeDefined()
    const tab = getActiveTab(slot!)
    expect(tab.type).toBe('lens')
    expect(tab.listDefinitionId).toBe(42)
  })

  it('docks a taskboard slot like any other kind', () => {
    const id = useCanvasRailsStore.getState().createAndDockSlot('taskboard')
    const { rails } = useCanvasRailsStore.getState()
    const slot = rails.right?.slots.find((s) => s.id === id)
    expect(slot).toBeDefined()
    expect(getActiveTab(slot!).type).toBe('taskboard')
  })
})
