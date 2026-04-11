import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '../../data/database'
import { useProjectStore } from '../../stores/project-store'
import { useTodoStore } from '../../stores/todo-store'

let canvasId: number

beforeEach(async () => {
  await db.delete()
  await db.open()
  canvasId = (await db.canvases.add({ name: 'Canvas', sortOrder: 1, createdAt: new Date() })) as number
  useProjectStore.setState({ projects: [], loading: false, error: null })
  useTodoStore.setState({ todos: [], loading: false })
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
})
