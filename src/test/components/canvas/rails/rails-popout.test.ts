import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '../../../../data/database'
import { popSlotToCanvas } from '../../../../components/canvas/rails/RailsFrame'
import { useCanvasStore } from '../../../../stores/canvas-store'
import { useNoteStore } from '../../../../stores/note-store'
import { useListInsetStore } from '../../../../stores/list-inset-store'
import { useFloatingCalendarStore } from '../../../../stores/floating-calendar-store'
import { useListDefinitionStore } from '../../../../stores/list-definition-store'
import type { Slot } from '../../../../models/canvas-rails'

beforeEach(async () => {
  await db.delete()
  await db.open()
  useCanvasStore.setState({ selectedCanvasId: null })
  useNoteStore.setState({ notes: new Map(), activeId: null, lastSavedAt: null })
  useListInsetStore.setState({ insets: [], loading: false, error: null })
  useFloatingCalendarStore.setState({ calendars: [], loading: false, error: null })
  useListDefinitionStore.setState({ listDefinitions: [], loading: false, error: null })
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

  it('pops a notes slot into a floating note with copied content', async () => {
    const canvasId = await seedCanvas()
    const now = new Date()
    const globalId = await db.notes.add({ content: 'RAIL NOTES COPY', createdAt: now, modifiedAt: now })
    await useNoteStore.getState().load()
    expect(useNoteStore.getState().activeId).toBe(globalId)

    const slot: Slot = { id: 'slot-notes', kind: 'notes' }
    const moved = await popSlotToCanvas(slot)
    expect(moved).toBe(true)

    const floating = Array.from(useNoteStore.getState().notes.values()).filter((n) => n.canvasId === canvasId)
    expect(floating.length).toBe(1)
    expect(floating[0].content).toBe('RAIL NOTES COPY')
    // Global note survives unchanged
    const global = useNoteStore.getState().notes.get(globalId)
    expect(global?.content).toBe('RAIL NOTES COPY')
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
        tagIds: null,
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
