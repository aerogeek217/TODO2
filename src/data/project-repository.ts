import { db } from './database'
import type { Project } from '../models'

export const projectRepository = {
  async getAll(): Promise<Project[]> {
    return db.projects.orderBy('sortOrder').toArray()
  },

  async getByCanvas(canvasId: number): Promise<Project[]> {
    return db.projects.where('canvasId').equals(canvasId).sortBy('sortOrder')
  },

  async getById(id: number): Promise<Project | undefined> {
    return db.projects.get(id)
  },

  async insert(project: Omit<Project, 'id'>): Promise<number> {
    return db.projects.add(project as Project)
  },

  async update(project: Project): Promise<void> {
    if (project.id === undefined) return
    await db.projects.put(project)
  },

  async updatePosition(id: number, x: number, y: number): Promise<void> {
    await db.projects.update(id, { positionX: x, positionY: y })
  },

  async delete(id: number): Promise<void> {
    await db.transaction('rw', [db.projects, db.todos], async () => {
      await db.todos.where('projectId').equals(id).modify({ projectId: undefined })
      await db.projects.delete(id)
    })
  },
}
