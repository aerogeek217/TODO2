import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '../../../../data/database'
import { popSlotToCanvas } from '../../../../components/canvas/rails/RailsFrame'
import { useCanvasStore } from '../../../../stores/canvas-store'
import { useNoteStore } from '../../../../stores/note-store'
import { useFloatingNoteStore } from '../../../../stores/floating-note-store'
import { useListInsetStore } from '../../../../stores/list-inset-store'
import { useFloatingCalendarStore } from '../../../../stores/floating-calendar-store'
import { useFloatingTaskboardStore } from '../../../../stores/floating-taskboard-store'
import { useTaskboardStore } from '../../../../stores/taskboard-store'
import { useListDefinitionStore } from '../../../../stores/list-definition-store'
import { useCanvasRailsStore } from '../../../../stores/canvas-rails-store'
import { EMPTY_RAILS } from '../../../../models/canvas-rails'
import type { Slot } from '../../../../models/canvas-rails'

beforeEach(async () => {
  await db.delete()
  await db.open()
  useCanvasStore.setState({ selectedCanvasId: null })
  useNoteStore.setState({ notes: new Map(), activeId: null, lastSavedAt: null })
  useListInsetStore.setState({ insets: [], loading: false, error: null })
  useFloatingCalendarStore.setState({ calendars: [], loading: false, error: null })
  useFloatingNoteStore.setState({ notes: [], loading: false, error: null })
  useFloatingTaskboardStore.setState({ taskboards: [], loading: false, error: null })
  useTaskboardStore.setState({ boards: new Map(), defaultBoardId: null, loading: false, error: null })
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
    const slot: Slot = { id: 'slot-1', kind: 'calendar' }
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

    const slot: Slot = { id: 'slot-notes', kind: 'notes' }
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

    const slot: Slot = { id: 'slot-lens', kind: 'lens', listDefinitionId: defId }
    const moved = await popSlotToCanvas(slot)
    expect(moved).toBe(true)

    const insets = useListInsetStore.getState().insets.filter((i) => i.canvasId === canvasId)
    expect(insets.length).toBe(1)
    expect(insets[0].listDefinitionId).toBe(defId)
  })

  it('skips a lens slot that has no list definition', async () => {
    await seedCanvas()
    const slot: Slot = { id: 'slot-lens', kind: 'lens' }
    const moved = await popSlotToCanvas(slot)
    expect(moved).toBe(false)
    expect(useListInsetStore.getState().insets.length).toBe(0)
  })

  it('pops a taskboard slot into a floating taskboard that references the same board', async () => {
    const canvasId = await seedCanvas()
    const boardId = await db.taskboards.add({
      name: 'Default',
      entries: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    await db.settings.put({ key: 'defaultTaskboardId', value: String(boardId) })
    await useTaskboardStore.getState().load()

    const slot: Slot = { id: 'slot-tb', kind: 'taskboard', taskboardId: boardId }
    const moved = await popSlotToCanvas(slot)
    expect(moved).toBe(true)

    const floating = useFloatingTaskboardStore.getState().taskboards.filter((t) => t.canvasId === canvasId)
    expect(floating.length).toBe(1)
    expect(floating[0].taskboardId).toBe(boardId)
  })

  it('pops a calendar slot into a floating calendar node', async () => {
    const canvasId = await seedCanvas()
    const slot: Slot = { id: 'slot-cal', kind: 'calendar' }
    const moved = await popSlotToCanvas(slot)
    expect(moved).toBe(true)

    const calendars = useFloatingCalendarStore.getState().calendars.filter((c) => c.canvasId === canvasId)
    expect(calendars.length).toBe(1)
    expect(calendars[0].width).toBeGreaterThan(0)
    expect(calendars[0].height).toBeGreaterThan(0)
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
    expect(slot?.kind).toBe('lens')
    expect(slot?.listDefinitionId).toBe(42)
  })

  it('docks a taskboard slot like any other kind', () => {
    const id = useCanvasRailsStore.getState().createAndDockSlot('taskboard')
    const { rails } = useCanvasRailsStore.getState()
    const slot = rails.right?.slots.find((s) => s.id === id)
    expect(slot?.kind).toBe('taskboard')
  })
})
