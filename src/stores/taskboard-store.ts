import { create } from 'zustand'
import { taskboardRepository } from '../data/taskboard-repository'
import type { TaskboardEntry } from '../models'
import { mutate } from './store-helpers'
import { undoable } from '../services/undoable'

interface TaskboardState {
  entries: TaskboardEntry[]
  loading: boolean
  error: string | null

  load: () => Promise<void>
  add: (todoId: number) => Promise<void>
  remove: (todoId: number) => Promise<void>
  clear: () => Promise<void>
  has: (todoId: number) => boolean
  reorder: (fromIndex: number, toIndex: number) => Promise<void>
}

export const useTaskboardStore = create<TaskboardState>((set, get) => ({
  entries: [],
  loading: false,
  error: null,

  async load() {
    set({ loading: true, error: null })
    try {
      const entries = await taskboardRepository.getAll()
      set({ entries })
    } catch (e) {
      console.error('Failed to load taskboard:', e)
      set({ error: 'Failed to load taskboard' })
    } finally {
      set({ loading: false })
    }
  },

  async add(todoId: number) {
    await mutate(set, async () => {
      const existing = await taskboardRepository.findByTodoId(todoId)
      if (existing) return
      const id = await taskboardRepository.addEntry(todoId)
      const entry = await taskboardRepository.getById(id)
      if (entry) set({ entries: [...get().entries, entry] })

      undoable(
        'Add to taskboard',
        () => get().add(todoId),
        async () => {
          await taskboardRepository.removeByTodoId(todoId)
          set({ entries: get().entries.filter(e => e.todoId !== todoId) })
        },
        true,
      )
    }, 'Failed to add to taskboard')
  },

  async remove(todoId: number) {
    const entry = get().entries.find(e => e.todoId === todoId)
    if (!entry) return

    await mutate(set, async () => {
      await taskboardRepository.removeByTodoId(todoId)
      set({ entries: get().entries.filter(e => e.todoId !== todoId) })

      undoable(
        'Remove from taskboard',
        () => get().remove(todoId),
        async () => {
          await taskboardRepository.insert({ todoId: entry.todoId, sortOrder: entry.sortOrder })
          const entries = await taskboardRepository.getAll()
          set({ entries })
        },
        true,
      )
    }, 'Failed to remove from taskboard')
  },

  async clear() {
    const prev = get().entries
    if (prev.length === 0) return

    await mutate(set, async () => {
      for (const e of prev) await taskboardRepository.removeByTodoId(e.todoId)
      set({ entries: [] })

      undoable(
        'Clear taskboard',
        () => get().clear(),
        async () => {
          for (const e of prev) await taskboardRepository.insert({ todoId: e.todoId, sortOrder: e.sortOrder })
          const entries = await taskboardRepository.getAll()
          set({ entries })
        },
        true,
      )
    }, 'Failed to clear taskboard')
  },

  has(todoId: number) {
    return get().entries.some(e => e.todoId === todoId)
  },

  async reorder(fromIndex: number, toIndex: number) {
    const entries = [...get().entries]
    const [moved] = entries.splice(fromIndex, 1)
    entries.splice(toIndex, 0, moved)

    const updated = entries.map((e, i) => ({ ...e, sortOrder: (i + 1) * 1000 }))
    set({ entries: updated })

    await mutate(set, async () => {
      await taskboardRepository.reorder(
        updated.map(e => ({ id: e.id!, sortOrder: e.sortOrder }))
      )
    }, 'Failed to reorder taskboard')
  },
}))
