import { create } from 'zustand'
import type { Project } from '../models'
import { projectRepository } from '../data'
import { todoRepository } from '../data/todo-repository'
import { useTodoStore } from './todo-store'
import { loadWithState, mutate } from './store-helpers'
import { undoable } from '../services/undoable'

interface ProjectState {
  projects: Project[]
  loading: boolean
  error: string | null

  loadAll: () => Promise<void>
  loadByCanvas: (canvasId: number) => Promise<void>
  add: (name: string, canvasId: number, x?: number, y?: number) => Promise<number>
  update: (project: Project) => Promise<void>
  updatePosition: (id: number, x: number, y: number) => Promise<void>
  remove: (id: number) => Promise<void>
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  projects: [],
  loading: false,
  error: null,

  async loadAll() {
    const projects = await loadWithState(set, () => projectRepository.getAll(), 'projects')
    if (projects) set({ projects })
  },

  async loadByCanvas(canvasId: number) {
    const projects = await loadWithState(set, () => projectRepository.getByCanvas(canvasId), 'projects')
    if (projects) set({ projects })
  },

  async add(name: string, canvasId: number, x = 0, y = 0) {
    return mutate(set, async () => {
      const { projects } = get()
      const maxSort = projects.reduce((max, p) => Math.max(max, p.sortOrder), 0)
      const id = await projectRepository.insert({
        name,
        canvasId,
        positionX: x,
        positionY: y,
        isCollapsed: false,
        sortOrder: maxSort + 1,
        createdAt: new Date(),
      })
      await get().loadByCanvas(canvasId)
      return id
    }, 'Failed to add project')
  },

  async update(project: Project) {
    return mutate(set, async () => {
      await projectRepository.update(project)
      set({
        projects: get().projects.map((p) => (p.id === project.id ? { ...project } : p)),
      })
    }, 'Failed to update project')
  },

  async updatePosition(id: number, x: number, y: number) {
    return mutate(set, async () => {
      await projectRepository.updatePosition(id, x, y)
      set({
        projects: get().projects.map((p) =>
          p.id === id ? { ...p, positionX: x, positionY: y } : p
        ),
      })
    }, 'Failed to update project position')
  },

  async remove(id: number) {
    return mutate(set, async () => {
      const project = get().projects.find((p) => p.id === id)
      const tasks = await todoRepository.getByProject(id)

      await projectRepository.delete(id)

      // Reassign orphaned tasks to a new project so they stay visible
      let orphanProjectId: number | undefined
      if (tasks.length > 0 && project) {
        orphanProjectId = await projectRepository.insert({
          name: 'Orphaned Tasks',
          canvasId: project.canvasId,
          positionX: project.positionX,
          positionY: project.positionY,
          isCollapsed: false,
          sortOrder: project.sortOrder,
          createdAt: new Date(),
        })
        await todoRepository.bulkUpdate(
          tasks.map((t) => ({ todoId: t.id, changes: { projectId: orphanProjectId } }))
        )
      }

      if (project) {
        await get().loadByCanvas(project.canvasId)
        if (tasks.length > 0) {
          await useTodoStore.getState().loadByCanvas(project.canvasId)
        }
        undoable(
          `Delete project "${project.name}"`,
          () => get().remove(id),
          async () => {
            // Find the current orphan project dynamically (may differ after redo cycles)
            if (tasks.length > 0) {
              const currentTodo = await todoRepository.getById(tasks[0].id)
              const currentProjectId = currentTodo?.projectId
              if (currentProjectId != null && currentProjectId !== id) {
                await projectRepository.delete(currentProjectId)
              }
            }
            // Restore original project
            await projectRepository.insert(project)
            // Reassign tasks back to original project
            if (tasks.length > 0) {
              await todoRepository.bulkUpdate(
                tasks.map((t) => ({ todoId: t.id, changes: { projectId: id } }))
              )
            }
            await get().loadByCanvas(project.canvasId)
            await useTodoStore.getState().loadByCanvas(project.canvasId)
          },
          true,
        )
      } else {
        set({ projects: get().projects.filter((p) => p.id !== id) })
      }
    }, 'Failed to delete project')
  },
}))
