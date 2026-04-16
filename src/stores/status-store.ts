import { create } from 'zustand'
import type { Status } from '../models'
import { db, statusRepository, settingsRepository } from '../data'
import { loadWithState, optimistic } from './store-helpers'
import { DEFAULT_ENTITY_COLOR } from '../constants'
import { undoable } from '../services/undoable'

interface StatusState {
  statuses: Status[]
  loading: boolean
  error: string | null

  load: () => Promise<void>
  add: (name: string, color?: string, icon?: string, hideByDefault?: boolean) => Promise<number>
  update: (status: Status) => Promise<void>
  remove: (id: number) => Promise<void>
  reorder: (fromIndex: number, toIndex: number) => Promise<void>
}

export const useStatusStore = create<StatusState>((set, get) => ({
  statuses: [],
  loading: false,
  error: null,

  async load() {
    const statuses = await loadWithState(set, () => statusRepository.getAll(), 'statuses')
    if (statuses) set({ statuses })
  },

  async add(name: string, color = DEFAULT_ENTITY_COLOR, icon = 'circle', hideByDefault?: boolean) {
    const { statuses } = get()
    if (statuses.some(s => s.name.toLowerCase() === name.toLowerCase())) {
      throw new Error(`Status "${name}" already exists`)
    }
    const maxSort = statuses.reduce((max, s) => Math.max(max, s.sortOrder), 0)
    const entry: Status = { name, color, sortOrder: maxSort + 1, icon, ...(hideByDefault ? { hideByDefault } : {}) }
    const id = await statusRepository.insert(entry)
    set({ statuses: [...statuses, { ...entry, id }] })
    return id
  },

  async update(status: Status) {
    const { statuses } = get()
    if (statuses.some(s => s.id !== status.id && s.name.toLowerCase() === status.name.toLowerCase())) {
      throw new Error(`Status "${status.name}" already exists`)
    }
    const prev = statuses
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
    const settingsState = useSettingsStore.getState()
    const wasDefault = settingsState.defaultStatusId === id
    const wasSeededAssigned = settingsState.seededAssignedStatusId === id
    const wasSeededFollowup = settingsState.seededFollowupStatusId === id

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

    if (wasDefault) {
      await useSettingsStore.getState().setDefaultStatusId(null)
    }
    if (wasSeededAssigned) {
      await settingsRepository.delete('seededAssignedStatusId')
      useSettingsStore.setState({ seededAssignedStatusId: null })
    }
    if (wasSeededFollowup) {
      await settingsRepository.delete('seededFollowupStatusId')
      useSettingsStore.setState({ seededFollowupStatusId: null })
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
          if (wasDefault) {
            await useSettingsStore.getState().setDefaultStatusId(id)
          }
          if (wasSeededAssigned) {
            await settingsRepository.put('seededAssignedStatusId', String(id))
            useSettingsStore.setState({ seededAssignedStatusId: id })
          }
          if (wasSeededFollowup) {
            await settingsRepository.put('seededFollowupStatusId', String(id))
            useSettingsStore.setState({ seededFollowupStatusId: id })
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

  async reorder(fromIndex: number, toIndex: number) {
    const prev = get().statuses
    const sorted = [...prev].sort((a, b) => a.sortOrder - b.sortOrder)
    if (fromIndex < 0 || toIndex < 0 || fromIndex >= sorted.length || toIndex >= sorted.length) return

    const [moved] = sorted.splice(fromIndex, 1)
    sorted.splice(toIndex, 0, moved)

    const updated = sorted.map((s, i) => ({ ...s, sortOrder: i }))
    set({ statuses: updated })

    try {
      await db.transaction('rw', db.statuses, async () => {
        for (const s of updated) {
          await db.statuses.update(s.id!, { sortOrder: s.sortOrder })
        }
      })
    } catch (e) {
      console.error('Failed to reorder statuses:', e)
      set({ statuses: prev, error: 'Failed to reorder statuses' })
    }
  },
}))
