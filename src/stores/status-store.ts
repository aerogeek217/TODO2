import { create } from 'zustand'
import type { Status } from '../models'
import { db, statusRepository } from '../data'
import { loadWithState, optimistic } from './store-helpers'
import { DEFAULT_ENTITY_COLOR } from '../constants'
import { undoable } from '../services/undoable'

interface StatusState {
  statuses: Status[]
  loading: boolean
  error: string | null

  load: () => Promise<void>
  add: (name: string, color?: string) => Promise<number>
  update: (status: Status) => Promise<void>
  remove: (id: number) => Promise<void>
}

export const useStatusStore = create<StatusState>((set, get) => ({
  statuses: [],
  loading: false,
  error: null,

  async load() {
    const statuses = await loadWithState(set, () => statusRepository.getAll(), 'statuses')
    if (statuses) set({ statuses })
  },

  async add(name: string, color = DEFAULT_ENTITY_COLOR) {
    const { statuses } = get()
    const maxSort = statuses.reduce((max, s) => Math.max(max, s.sortOrder), 0)
    const id = await statusRepository.insert({ name, color, sortOrder: maxSort + 1 })
    set({ statuses: [...statuses, { id, name, color, sortOrder: maxSort + 1 }] })
    return id
  },

  async update(status: Status) {
    const prev = get().statuses
    return optimistic(
      set,
      () => set({ statuses: prev.map(s => s.id === status.id ? { ...status } : s) }),
      () => statusRepository.update(status),
      () => set({ statuses: prev }),
      'Failed to update status',
    )
  },

  async remove(id: number) {
    const status = get().statuses.find(s => s.id === id)
    // Capture affected todos and default setting before deletion
    const affectedTodoIds = await db.todos.where('statusId').equals(id).primaryKeys()
    const { useSettingsStore } = await import('./settings-store')
    const wasDefault = useSettingsStore.getState().defaultStatusId === id

    await statusRepository.delete(id)
    set({ statuses: get().statuses.filter(s => s.id !== id) })

    // Update in-memory todo store
    if (affectedTodoIds.length > 0) {
      const { useTodoStore } = await import('./todo-store')
      useTodoStore.setState({
        todos: useTodoStore.getState().todos.map(t =>
          affectedTodoIds.includes(t.id) ? { ...t, statusId: undefined } : t
        ),
      })
    }

    // Clear default if it was pointing to this status
    if (wasDefault) {
      await useSettingsStore.getState().setDefaultStatusId(null)
    }

    if (status) {
      undoable(
        `Delete status "${status.name}"`,
        () => get().remove(id),
        async () => {
          // Restore the status entity with original ID
          await db.statuses.add(status)
          // Re-assign statusId to affected todos
          if (affectedTodoIds.length > 0) {
            await db.transaction('rw', db.todos, async () => {
              for (const todoId of affectedTodoIds) {
                await db.todos.update(todoId, { statusId: id })
              }
            })
          }
          // Restore default if it was set
          if (wasDefault) {
            await useSettingsStore.getState().setDefaultStatusId(id)
          }
          await get().load()
          // Reload todo store to reflect restored statusIds
          const { useTodoStore } = await import('./todo-store')
          await useTodoStore.getState().loadAll()
        },
        true,
      )
    }
  },
}))
