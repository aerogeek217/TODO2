import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '../../data/database'
import { projectRepository } from '../../data/project-repository'
import { canvasRepository } from '../../data/canvas-repository'

let canvasId: number

beforeEach(async () => {
  await db.delete()
  await db.open()
  canvasId = await canvasRepository.insert({ name: 'Test', sortOrder: 0, createdAt: new Date() })
})

describe('projectRepository', () => {
  it('inserts and retrieves a project', async () => {
    await projectRepository.insert({
      name: 'Bug Fixes',
      canvasId,
      positionX: 100,
      positionY: 200,
      isCollapsed: false,
      sortOrder: 0,
      createdAt: new Date(),
    })
    const projects = await projectRepository.getByCanvas(canvasId)
    expect(projects).toHaveLength(1)
    expect(projects[0]!.name).toBe('Bug Fixes')
    expect(projects[0]!.positionX).toBe(100)
    expect(projects[0]!.positionY).toBe(200)
  })

  it('getByCanvas returns only projects for that canvas', async () => {
    const otherCanvasId = await canvasRepository.insert({ name: 'Other', sortOrder: 1, createdAt: new Date() })
    await projectRepository.insert({
      name: 'Project A', canvasId, positionX: 0, positionY: 0,
      isCollapsed: false, sortOrder: 0, createdAt: new Date(),
    })
    await projectRepository.insert({
      name: 'Project B', canvasId: otherCanvasId, positionX: 0, positionY: 0,
      isCollapsed: false, sortOrder: 0, createdAt: new Date(),
    })

    const projects = await projectRepository.getByCanvas(canvasId)
    expect(projects).toHaveLength(1)
    expect(projects[0]!.name).toBe('Project A')
  })

  it('updatePosition changes x and y', async () => {
    const id = await projectRepository.insert({
      name: 'Movable', canvasId, positionX: 0, positionY: 0,
      isCollapsed: false, sortOrder: 0, createdAt: new Date(),
    })
    await projectRepository.updatePosition(id, 300, 400)

    const project = await projectRepository.getById(id)
    expect(project!.positionX).toBe(300)
    expect(project!.positionY).toBe(400)
  })

  it('update modifies project properties', async () => {
    const id = await projectRepository.insert({
      name: 'Original', canvasId, positionX: 0, positionY: 0,
      isCollapsed: false, sortOrder: 0, createdAt: new Date(),
    })
    const project = await projectRepository.getById(id)
    project!.name = 'Renamed'
    project!.isCollapsed = true
    await projectRepository.update(project!)

    const updated = await projectRepository.getById(id)
    expect(updated!.name).toBe('Renamed')
    expect(updated!.isCollapsed).toBe(true)
  })

  it('delete removes a project', async () => {
    const id = await projectRepository.insert({
      name: 'Temp', canvasId, positionX: 0, positionY: 0,
      isCollapsed: false, sortOrder: 0, createdAt: new Date(),
    })
    await projectRepository.delete(id)

    const project = await projectRepository.getById(id)
    expect(project).toBeUndefined()
  })
})
