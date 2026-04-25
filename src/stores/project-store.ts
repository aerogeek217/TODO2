import { create } from 'zustand'
import type { Project } from '../models'
import { projectRepository } from '../data'
import { todoRepository } from '../data/todo-repository'
import { useTodoStore } from './todo-store'
import { loadWithState, mutate, optimistic } from './store-helpers'
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
  bulkUpdatePositions: (updates: Array<{ id: number; x: number; y: number }>) => Promise<void>
  updateProjectGrouping: (
    projectId: number,
    groupBy: Project['groupBy'],
    groupOrder?: Project['groupOrder'],
  ) => Promise<void>
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
    const prev = get().projects.find((p) => p.id === project.id)
    if (!prev) return
    const snapshot = { ...prev }
    return optimistic(
      set,
      () => set({
        projects: get().projects.map((p) => (p.id === project.id ? { ...project } : p)),
      }),
      () => projectRepository.update(project),
      () => set({
        projects: get().projects.map((p) => (p.id === project.id ? snapshot : p)),
      }),
      'Failed to update project',
    )
  },

  async updatePosition(id: number, x: number, y: number) {
    const prev = get().projects.find((p) => p.id === id)
    if (!prev) return
    const prevX = prev.positionX
    const prevY = prev.positionY
    return optimistic(
      set,
      () => set({
        projects: get().projects.map((p) =>
          p.id === id ? { ...p, positionX: x, positionY: y } : p
        ),
      }),
      () => projectRepository.updatePosition(id, x, y),
      () => set({
        projects: get().projects.map((p) =>
          p.id === id ? { ...p, positionX: prevX, positionY: prevY } : p
        ),
      }),
      'Failed to update project position',
    )
  },

  async updateProjectGrouping(
    projectId: number,
    groupBy: Project['groupBy'],
    groupOrder?: Project['groupOrder'],
  ) {
    const prev = get().projects.find((p) => p.id === projectId)
    if (!prev) return
    const snapshot = { ...prev }
    return optimistic(
      set,
      () => set({
        projects: get().projects.map((p) =>
          p.id === projectId
            ? { ...p, groupBy, ...(groupOrder !== undefined ? { groupOrder } : {}) }
            : p,
        ),
      }),
      () => projectRepository.updateGrouping(projectId, groupBy, groupOrder),
      () => set({
        projects: get().projects.map((p) => (p.id === projectId ? snapshot : p)),
      }),
      'Failed to update project grouping',
    )
  },

  async bulkUpdatePositions(updates: Array<{ id: number; x: number; y: number }>) {
    if (updates.length === 0) return
    const prevPositions = new Map(
      get().projects
        .filter((p) => updates.some((u) => u.id === p.id))
        .map((p) => [p.id!, { x: p.positionX, y: p.positionY }]),
    )
    const updateMap = new Map(updates.map((u) => [u.id, u]))
    return optimistic(
      set,
      () =>
        set({
          projects: get().projects.map((p) => {
            const u = updateMap.get(p.id!)
            return u ? { ...p, positionX: u.x, positionY: u.y } : p
          }),
        }),
      () => projectRepository.bulkUpdatePositions(updates),
      () =>
        set({
          projects: get().projects.map((p) => {
            const prev = prevPositions.get(p.id!)
            return prev ? { ...p, positionX: prev.x, positionY: prev.y } : p
          }),
        }),
      'Failed to bulk update positions',
    )
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
            const firstTask = tasks[0]
            if (tasks.length > 0 && firstTask) {
              const currentTodo = await todoRepository.getById(firstTask.id)
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
