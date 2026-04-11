import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '../../data/database'
import { canvasRepository } from '../../data/canvas-repository'
import { projectRepository } from '../../data/project-repository'
import { todoRepository } from '../../data/todo-repository'
import { Priority } from '../../models/priority'

beforeEach(async () => {
  await db.delete()
  await db.open()
})

describe('canvasRepository', () => {
  it('inserts and retrieves a canvas', async () => {
    const id = await canvasRepository.insert({
      name: 'Work',
      sortOrder: 0,
      createdAt: new Date(),
    })
    const canvas = await canvasRepository.getById(id)
    expect(canvas).toBeDefined()
    expect(canvas!.name).toBe('Work')
  })

  it('getAll returns canvases sorted by sortOrder', async () => {
    await canvasRepository.insert({ name: 'B', sortOrder: 2, createdAt: new Date() })
    await canvasRepository.insert({ name: 'A', sortOrder: 1, createdAt: new Date() })

    const all = await canvasRepository.getAll()
    expect(all.map((c) => c.name)).toEqual(['A', 'B'])
  })

  it('consolidate merges duplicates into keeper', async () => {
    const id1 = await canvasRepository.insert({ name: 'Keep', sortOrder: 0, createdAt: new Date() })
    const id2 = await canvasRepository.insert({ name: 'Remove', sortOrder: 1, createdAt: new Date() })
    await projectRepository.insert({ name: 'P', canvasId: id2, positionX: 0, positionY: 0, isCollapsed: false, sortOrder: 1, createdAt: new Date() })

    await canvasRepository.consolidate(id1, [id2])

    const canvases = await canvasRepository.getAll()
    expect(canvases).toHaveLength(1)
    expect(canvases[0].id).toBe(id1)
    const projects = await projectRepository.getByCanvas(id1)
    expect(projects).toHaveLength(1)
  })

  it('delete cascades to projects and todos', async () => {
    const canvasId = await canvasRepository.insert({ name: 'Test', sortOrder: 0, createdAt: new Date() })
    const projectId = await projectRepository.insert({
      name: 'Project 1',
      canvasId,
      positionX: 0,
      positionY: 0,
      isCollapsed: false,
      sortOrder: 0,
      createdAt: new Date(),
    })
    const now = new Date()
    await todoRepository.insert({
      title: 'Task',
      priority: Priority.Normal,
      isCompleted: false,
      isStarred: false,
      createdAt: now,
      modifiedAt: now,
      sortOrder: 0,
      canvasId,
      projectId,
    })

    await canvasRepository.delete(canvasId)

    expect(await canvasRepository.getById(canvasId)).toBeUndefined()
    expect(await projectRepository.getByCanvas(canvasId)).toHaveLength(0)
    expect(await todoRepository.getByCanvas(canvasId)).toHaveLength(0)
  })
})
