import { create } from 'zustand'
import { taskboardRepository } from '../data/taskboard-repository'
import type { TaskboardEntry } from '../models'
import { mutate, optimistic } from './store-helpers'
import { undoable } from '../services/undoable'

interface TaskboardState {
  entries: TaskboardEntry[]
  loading: boolean
  error: string | null

  load: () => Promise<void>
  add: (todoId: number) => Promise<void>
  addAt: (todoId: number, atIndex: number) => Promise<void>
  addMultipleAt: (todoIds: number[], atIndex: number) => Promise<void>
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

  async addAt(todoId: number, atIndex: number) {
    await mutate(set, async () => {
      const existing = await taskboardRepository.findByTodoId(todoId)
      if (existing) return

      let current = get().entries
      let sortOrder: number
      if (current.length === 0 || atIndex >= current.length) {
        sortOrder = current.length > 0 ? current[current.length - 1].sortOrder + 1000 : 1000
      } else if (atIndex <= 0) {
        sortOrder = current[0].sortOrder - 1000
      } else {
        const prev = current[atIndex - 1].sortOrder
        const next = current[atIndex].sortOrder
        sortOrder = Math.floor((prev + next) / 2)
        // Collision: normalize all entries and recalculate
        if (sortOrder <= prev) {
          const normalized = current.map((e, i) => ({ ...e, sortOrder: (i + 1) * 1000 }))
          await taskboardRepository.reorder(normalized.map(e => ({ id: e.id!, sortOrder: e.sortOrder })))
          current = normalized
          set({ entries: current })
          sortOrder = Math.floor((current[atIndex - 1].sortOrder + current[atIndex].sortOrder) / 2)
        }
      }

      const id = await taskboardRepository.addEntryAt(todoId, sortOrder)
      const entry = await taskboardRepository.getById(id)
      if (entry) {
        const newEntries = [...current]
        newEntries.splice(Math.max(0, Math.min(atIndex, current.length)), 0, entry)
        set({ entries: newEntries })
      }

      undoable(
        'Add to taskboard',
        () => get().addAt(todoId, atIndex),
        async () => {
          await taskboardRepository.removeByTodoId(todoId)
          set({ entries: get().entries.filter(e => e.todoId !== todoId) })
        },
        true,
      )
    }, 'Failed to add to taskboard')
  },

  async addMultipleAt(todoIds: number[], atIndex: number) {
    await mutate(set, async () => {
      // Filter out already-existing entries
      const newIds: number[] = []
      for (const id of todoIds) {
        if (!await taskboardRepository.findByTodoId(id)) newIds.push(id)
      }
      if (newIds.length === 0) return

      let current = get().entries
      const count = newIds.length

      // Normalize existing entries to ensure sufficient sortOrder gaps
      if (current.length > 0) {
        const normalized = current.map((e, i) => ({ ...e, sortOrder: (i + 1) * 1000 }))
        await taskboardRepository.reorder(normalized.map(e => ({ id: e.id!, sortOrder: e.sortOrder })))
        current = normalized
      }

      // Compute sortOrder bounds at the insertion point
      let low: number, high: number
      if (current.length === 0) {
        low = 0; high = (count + 1) * 1000
      } else if (atIndex >= current.length) {
        low = current[current.length - 1].sortOrder
        high = low + (count + 1) * 1000
      } else if (atIndex <= 0) {
        high = current[0].sortOrder
        low = high - (count + 1) * 1000
      } else {
        low = current[atIndex - 1].sortOrder
        high = current[atIndex].sortOrder
      }

      // Distribute sortOrders evenly in the gap
      const step = Math.floor((high - low) / (count + 1))
      const newEntries: TaskboardEntry[] = []
      for (let i = 0; i < newIds.length; i++) {
        const sortOrder = low + step * (i + 1)
        const id = await taskboardRepository.addEntryAt(newIds[i], sortOrder)
        const entry = await taskboardRepository.getById(id)
        if (entry) newEntries.push(entry)
      }

      const updatedEntries = [...current]
      updatedEntries.splice(Math.max(0, Math.min(atIndex, current.length)), 0, ...newEntries)
      set({ entries: updatedEntries })

      undoable(
        `Add ${newIds.length} to taskboard`,
        () => get().addMultipleAt(todoIds, atIndex),
        async () => {
          for (const todoId of newIds) await taskboardRepository.removeByTodoId(todoId)
          set({ entries: get().entries.filter(e => !newIds.includes(e.todoId)) })
        },
        true,
      )
    }, 'Failed to add to taskboard')
  },

  async remove(todoId: number) {
    const entry = get().entries.find(e => e.todoId === todoId)
    if (!entry) return
    const prevEntries = get().entries

    return optimistic(
      set,
      () => set({ entries: prevEntries.filter(e => e.todoId !== todoId) }),
      () => taskboardRepository.removeByTodoId(todoId),
      () => set({ entries: prevEntries }),
      'Failed to remove from taskboard',
      {
        description: 'Remove from taskboard',
        redo: () => get().remove(todoId),
        undo: async () => {
          await taskboardRepository.insert({ todoId: entry.todoId, sortOrder: entry.sortOrder })
          const entries = await taskboardRepository.getAll()
          set({ entries })
        },
        showSnackbar: true,
      },
    )
  },

  async clear() {
    const prev = get().entries
    if (prev.length === 0) return

    return optimistic(
      set,
      () => set({ entries: [] }),
      async () => {
        for (const e of prev) await taskboardRepository.removeByTodoId(e.todoId)
      },
      () => set({ entries: prev }),
      'Failed to clear taskboard',
      {
        description: 'Clear taskboard',
        redo: () => get().clear(),
        undo: async () => {
          for (const e of prev) await taskboardRepository.insert({ todoId: e.todoId, sortOrder: e.sortOrder })
          const entries = await taskboardRepository.getAll()
          set({ entries })
        },
        showSnackbar: true,
      },
    )
  },

  has(todoId: number) {
    return get().entries.some(e => e.todoId === todoId)
  },

  async reorder(fromIndex: number, toIndex: number) {
    const prevEntries = get().entries
    const entries = [...prevEntries]
    const [moved] = entries.splice(fromIndex, 1)
    entries.splice(toIndex, 0, moved)
    const updated = entries.map((e, i) => ({ ...e, sortOrder: (i + 1) * 1000 }))

    return optimistic(
      set,
      () => set({ entries: updated }),
      () => taskboardRepository.reorder(
        updated.map(e => ({ id: e.id!, sortOrder: e.sortOrder }))
      ),
      () => set({ entries: prevEntries }),
      'Failed to reorder taskboard',
    )
  },
}))
