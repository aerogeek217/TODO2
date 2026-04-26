import { describe, it, expect, beforeEach, vi } from 'vitest'
import { db } from '../../data/database'
import { useProjectStore } from '../../stores/project-store'
import { useTodoStore } from '../../stores/todo-store'
import { useSettingsStore } from '../../stores/settings-store'
import { projectRepository } from '../../data/project-repository'
import { DEFAULT_CANVAS_MAX_EXTENT } from '../../utils/canvas-bounds'

let canvasId: number

beforeEach(async () => {
  await db.delete()
  await db.open()
  canvasId = (await db.canvases.add({ name: 'Canvas', sortOrder: 1, createdAt: new Date() })) as number
  useProjectStore.setState({ projects: [], loading: false, error: null })
  useTodoStore.setState({ todos: [], loading: false })
  useSettingsStore.setState({ canvasMaxExtent: DEFAULT_CANVAS_MAX_EXTENT })
})

describe('useProjectStore', () => {
  it('loadByCanvas populates projects', async () => {
    await db.projects.add({ name: 'P1', canvasId, positionX: 0, positionY: 0, isCollapsed: false, sortOrder: 1, createdAt: new Date() })
    await db.projects.add({ name: 'P2', canvasId, positionX: 0, positionY: 0, isCollapsed: false, sortOrder: 2, createdAt: new Date() })

    await useProjectStore.getState().loadByCanvas(canvasId)
    expect(useProjectStore.getState().projects).toHaveLength(2)
  })

  it('add creates project with auto sortOrder', async () => {
    const id1 = await useProjectStore.getState().add('P1', canvasId)
    const id2 = await useProjectStore.getState().add('P2', canvasId)

    const projects = useProjectStore.getState().projects
    expect(projects).toHaveLength(2)
    const p2 = projects.find(p => p.id === id2)
    expect(p2!.sortOrder).toBeGreaterThan(projects.find(p => p.id === id1)!.sortOrder)
  })

  it('add persists optional groupBy seed', async () => {
    const id = await useProjectStore.getState().add('P-tag', canvasId, 0, 0, 'tag')
    const project = useProjectStore.getState().projects.find(p => p.id === id)
    expect(project!.groupBy).toBe('tag')
    const persisted = await db.projects.get(id)
    expect(persisted!.groupBy).toBe('tag')
  })

  it('add omits groupBy when none is supplied', async () => {
    const id = await useProjectStore.getState().add('P-plain', canvasId)
    const persisted = await db.projects.get(id)
    expect(persisted!.groupBy).toBeUndefined()
  })

  it('update modifies in store', async () => {
    const id = await useProjectStore.getState().add('P1', canvasId)
    const project = useProjectStore.getState().projects.find(p => p.id === id)!
    await useProjectStore.getState().update({ ...project, name: 'Updated' })
    expect(useProjectStore.getState().projects.find(p => p.id === id)!.name).toBe('Updated')
  })

  it('updatePosition changes x, y', async () => {
    const id = await useProjectStore.getState().add('P1', canvasId)
    await useProjectStore.getState().updatePosition(id, 100, 200)
    const project = useProjectStore.getState().projects.find(p => p.id === id)
    expect(project!.positionX).toBe(100)
    expect(project!.positionY).toBe(200)
  })

  it('remove deletes project and creates orphan project for stranded tasks', async () => {
    const id = await useProjectStore.getState().add('P1', canvasId)
    // Add a task to this project
    await useTodoStore.getState().add('Task', canvasId, id)

    await useProjectStore.getState().remove(id)

    const projects = useProjectStore.getState().projects
    // Original project gone, but orphan project created
    expect(projects.find(p => p.id === id)).toBeUndefined()
    expect(projects.find(p => p.name === 'Orphaned Tasks')).toBeDefined()
  })

  it('remove with no tasks just deletes', async () => {
    const id = await useProjectStore.getState().add('P1', canvasId)
    await useProjectStore.getState().remove(id)
    expect(useProjectStore.getState().projects.find(p => p.id === id)).toBeUndefined()
  })

  describe('canvas-bounds clamp', () => {
    it('add clamps positions outside the band to the band edge', async () => {
      const id = await useProjectStore.getState().add('Stray', canvasId, 32723, -3278)
      const project = useProjectStore.getState().projects.find((p) => p.id === id)!
      expect(project.positionX).toBe(DEFAULT_CANVAS_MAX_EXTENT)
      expect(project.positionY).toBe(-3278)
      const persisted = await db.projects.get(id)
      expect(persisted!.positionX).toBe(DEFAULT_CANVAS_MAX_EXTENT)
      expect(persisted!.positionY).toBe(-3278)
    })

    it('updatePosition clamps both axes', async () => {
      const id = await useProjectStore.getState().add('P', canvasId, 0, 0)
      await useProjectStore.getState().updatePosition(id, 999999, -999999)
      const project = useProjectStore.getState().projects.find((p) => p.id === id)!
      expect(project.positionX).toBe(DEFAULT_CANVAS_MAX_EXTENT)
      expect(project.positionY).toBe(-DEFAULT_CANVAS_MAX_EXTENT)
    })

    it('bulkUpdatePositions clamps every entry', async () => {
      const a = await useProjectStore.getState().add('A', canvasId, 0, 0)
      const b = await useProjectStore.getState().add('B', canvasId, 0, 0)
      await useProjectStore.getState().bulkUpdatePositions([
        { id: a, x: 50000, y: 0 },
        { id: b, x: -50000, y: 50 },
      ])
      const projects = useProjectStore.getState().projects
      expect(projects.find((p) => p.id === a)!.positionX).toBe(DEFAULT_CANVAS_MAX_EXTENT)
      expect(projects.find((p) => p.id === b)!.positionX).toBe(-DEFAULT_CANVAS_MAX_EXTENT)
      expect(projects.find((p) => p.id === b)!.positionY).toBe(50)
    })

    it('clamp respects the configured canvasMaxExtent', async () => {
      useSettingsStore.setState({ canvasMaxExtent: 2000 })
      const id = await useProjectStore.getState().add('P', canvasId, 5000, -5000)
      const project = useProjectStore.getState().projects.find((p) => p.id === id)!
      expect(project.positionX).toBe(2000)
      expect(project.positionY).toBe(-2000)
    })
  })

  describe('optimistic rollback', () => {
    it('updatePosition_dbRejects_revertsPositionToOriginal', async () => {
      // Arrange
      const id = await useProjectStore.getState().add('P1', canvasId, 10, 20)
      const spy = vi.spyOn(projectRepository, 'updatePosition').mockRejectedValueOnce(new Error('DB error'))

      // Act
      await expect(useProjectStore.getState().updatePosition(id, 999, 999)).rejects.toThrow('DB error')

      // Assert
      const project = useProjectStore.getState().projects.find((p) => p.id === id)
      expect(project!.positionX).toBe(10)
      expect(project!.positionY).toBe(20)

      spy.mockRestore()
    })
  })
})
