import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '../../data/database'
import { convertFloatingKind } from '../../services/float-kind-switch'
import { useFloatingNoteStore } from '../../stores/floating-note-store'
import { useFloatingCalendarStore } from '../../stores/floating-calendar-store'
import { useFloatingTaskboardStore } from '../../stores/floating-taskboard-store'
import { useFloatingHorizonsStore } from '../../stores/floating-horizons-store'
import { useListInsetStore } from '../../stores/list-inset-store'
import { useListDefinitionStore } from '../../stores/list-definition-store'

const RECT = { x: 100, y: 200, width: 480, height: 320 }
const CANVAS_ID = 1

beforeEach(async () => {
  await db.delete()
  await db.open()
  useFloatingNoteStore.setState({ notes: [], loading: false, error: null })
  useFloatingCalendarStore.setState({ calendars: [], loading: false, error: null })
  useFloatingTaskboardStore.setState({ taskboards: [], loading: false, error: null })
  useFloatingHorizonsStore.setState({ horizons: [], loading: false, error: null })
  useListInsetStore.setState({ insets: [], loading: false, error: null })
  useListDefinitionStore.setState({ listDefinitions: [] })
})

describe('convertFloatingKind — horizons branches', () => {
  it('horizons → horizons is a no-op (returns the same id)', async () => {
    const sourceId = await useFloatingHorizonsStore.getState().add(CANVAS_ID, RECT.x, RECT.y)
    const result = await convertFloatingKind({
      sourceKind: 'horizons',
      sourceId,
      canvasId: CANVAS_ID,
      rect: RECT,
      nextKind: 'horizons',
    })
    expect(result).toBe(sourceId)
    // Source row still present, no extra row created.
    expect(useFloatingHorizonsStore.getState().horizons.map((h) => h.id)).toEqual([sourceId])
  })

  it('horizons → notes deletes the source horizons and creates a note at the same rect', async () => {
    const sourceId = await useFloatingHorizonsStore.getState().add(CANVAS_ID, RECT.x, RECT.y)
    const noteId = await convertFloatingKind({
      sourceKind: 'horizons',
      sourceId,
      canvasId: CANVAS_ID,
      rect: RECT,
      nextKind: 'notes',
    })
    expect(noteId).not.toBeNull()
    // Source removed.
    expect(useFloatingHorizonsStore.getState().horizons).toHaveLength(0)
    // Note created at the source rect, sized to the source rect.
    const note = useFloatingNoteStore.getState().notes.find((n) => n.id === noteId)
    expect(note).toBeDefined()
    expect(note).toMatchObject({ x: RECT.x, y: RECT.y, width: RECT.width, height: RECT.height })
  })

  it('notes → horizons creates a horizons widget at the source rect', async () => {
    const sourceId = await useFloatingNoteStore.getState().add(CANVAS_ID, RECT.x, RECT.y)
    const horizonsId = await convertFloatingKind({
      sourceKind: 'notes',
      sourceId,
      canvasId: CANVAS_ID,
      rect: RECT,
      nextKind: 'horizons',
    })
    expect(horizonsId).not.toBeNull()
    expect(useFloatingNoteStore.getState().notes).toHaveLength(0)
    const horizons = useFloatingHorizonsStore.getState().horizons.find((h) => h.id === horizonsId)
    expect(horizons).toBeDefined()
    expect(horizons).toMatchObject({ x: RECT.x, y: RECT.y, width: RECT.width, height: RECT.height })
  })

  it('horizons → calendar deletes the source horizons and creates a calendar', async () => {
    const sourceId = await useFloatingHorizonsStore.getState().add(CANVAS_ID, RECT.x, RECT.y)
    const calId = await convertFloatingKind({
      sourceKind: 'horizons',
      sourceId,
      canvasId: CANVAS_ID,
      rect: RECT,
      nextKind: 'calendar',
    })
    expect(calId).not.toBeNull()
    expect(useFloatingHorizonsStore.getState().horizons).toHaveLength(0)
    const cal = useFloatingCalendarStore.getState().calendars.find((c) => c.id === calId)
    expect(cal).toBeDefined()
  })

  it('horizons → taskboard deletes the source horizons and creates a taskboard widget', async () => {
    const sourceId = await useFloatingHorizonsStore.getState().add(CANVAS_ID, RECT.x, RECT.y)
    const tbId = await convertFloatingKind({
      sourceKind: 'horizons',
      sourceId,
      canvasId: CANVAS_ID,
      rect: RECT,
      nextKind: 'taskboard',
    })
    expect(tbId).not.toBeNull()
    expect(useFloatingHorizonsStore.getState().horizons).toHaveLength(0)
    const tb = useFloatingTaskboardStore.getState().taskboards.find((t) => t.id === tbId)
    expect(tb).toBeDefined()
  })
})
