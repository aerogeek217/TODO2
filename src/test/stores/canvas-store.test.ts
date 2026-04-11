import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '../../data/database'
import { useCanvasStore } from '../../stores/canvas-store'

beforeEach(async () => {
  await db.delete()
  await db.open()
  useCanvasStore.setState({ selectedCanvasId: null, loading: false })
})

describe('canvasStore', () => {
  it('ensureDefault creates a default canvas when none exist', async () => {
    await useCanvasStore.getState().ensureDefault()
    const { selectedCanvasId } = useCanvasStore.getState()
    expect(selectedCanvasId).toBeTypeOf('number')
    const canvases = await db.canvases.toArray()
    expect(canvases).toHaveLength(1)
    expect(canvases[0].name).toBe('My Canvas')
    expect(selectedCanvasId).toBe(canvases[0].id)
  })

  it('ensureDefault uses existing canvas if one exists', async () => {
    const id = await db.canvases.add({ name: 'Existing', sortOrder: 0, createdAt: new Date() })
    await useCanvasStore.getState().ensureDefault()
    expect(useCanvasStore.getState().selectedCanvasId).toBe(id)
  })

  it('ensureDefault picks first canvas when multiple exist', async () => {
    const id1 = await db.canvases.add({ name: 'Canvas 1', sortOrder: 0, createdAt: new Date() })
    await db.canvases.add({ name: 'Canvas 2', sortOrder: 0, createdAt: new Date() })
    await useCanvasStore.getState().ensureDefault()
    // Consolidation is now a DB migration (v11), not a store concern
    expect(useCanvasStore.getState().selectedCanvasId).toBe(id1)
  })
})
