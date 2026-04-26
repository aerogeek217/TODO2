import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '../../data/database'
import { useFloatingNoteStore } from '../../stores/floating-note-store'
import { useSettingsStore } from '../../stores/settings-store'
import { DEFAULT_CANVAS_MAX_EXTENT } from '../../utils/canvas-bounds'

beforeEach(async () => {
  await db.delete()
  await db.open()
  useFloatingNoteStore.setState({ notes: [], loading: false, error: null })
  useSettingsStore.setState({ canvasMaxExtent: DEFAULT_CANVAS_MAX_EXTENT })
})

describe('useFloatingNoteStore', () => {
  it('loads by canvas', async () => {
    await db.floatingNotes.bulkAdd([
      { canvasId: 1, x: 0, y: 0, width: 240, height: 200 },
      { canvasId: 1, x: 50, y: 50, width: 200, height: 160 },
      { canvasId: 99, x: 0, y: 0, width: 240, height: 200 },
    ])

    await useFloatingNoteStore.getState().loadByCanvas(1)

    expect(useFloatingNoteStore.getState().notes).toHaveLength(2)
  })

  it('creates placement-only rows on add', async () => {
    const id = await useFloatingNoteStore.getState().add(1, 100, 200)
    const row = useFloatingNoteStore.getState().notes.find((n) => n.id === id)
    expect(row).toMatchObject({ canvasId: 1, x: 100, y: 200 })
    expect(row?.width).toBeGreaterThan(0)
    expect(row?.height).toBeGreaterThan(0)
  })

  it('updates position optimistically', async () => {
    const id = await useFloatingNoteStore.getState().add(1, 0, 0)
    await useFloatingNoteStore.getState().updatePosition(id, 42, 84)
    const row = useFloatingNoteStore.getState().notes.find((n) => n.id === id)
    expect(row?.x).toBe(42)
    expect(row?.y).toBe(84)
    // Persisted too
    const dbRow = await db.floatingNotes.get(id)
    expect(dbRow?.x).toBe(42)
  })

  it('remove deletes the row', async () => {
    const id = await useFloatingNoteStore.getState().add(1, 0, 0)
    await useFloatingNoteStore.getState().remove(id)
    expect(useFloatingNoteStore.getState().notes).toHaveLength(0)
    expect(await db.floatingNotes.count()).toBe(0)
  })

  describe('canvas-bounds clamp (placement factory)', () => {
    it('add clamps positions outside the band', async () => {
      const id = await useFloatingNoteStore.getState().add(1, 99999, -99999)
      const row = useFloatingNoteStore.getState().notes.find((n) => n.id === id)!
      expect(row.x).toBe(DEFAULT_CANVAS_MAX_EXTENT)
      expect(row.y).toBe(-DEFAULT_CANVAS_MAX_EXTENT)
    })

    it('updatePosition clamps to the band edge', async () => {
      const id = await useFloatingNoteStore.getState().add(1, 0, 0)
      await useFloatingNoteStore.getState().updatePosition(id, 999999, 100)
      const row = useFloatingNoteStore.getState().notes.find((n) => n.id === id)!
      expect(row.x).toBe(DEFAULT_CANVAS_MAX_EXTENT)
      expect(row.y).toBe(100)
    })
  })
})
