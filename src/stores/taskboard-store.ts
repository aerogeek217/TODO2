import { create } from 'zustand'
import { taskboardRepository } from '../data/taskboard-repository'
import type { Taskboard, TaskboardEntry } from '../models'
import { mutate, optimistic } from './store-helpers'
import { undoable } from '../services/undoable'

/**
 * Singleton taskboard store. Every surface (dashboard card, rail slots,
 * floating canvas widgets) reads the same underlying record. Entries live
 * inline on the row — mutations read → splice/filter → write back through
 * the repository's `writeEntries` helper.
 */

interface TaskboardState {
  board: Taskboard | null
  loading: boolean
  error: string | null

  load: () => Promise<void>
  /** Ensures the singleton row exists, returning it. Seeds an empty row on first call. */
  ensureLoaded: () => Promise<Taskboard>

  add: (todoId: number) => Promise<void>
  addAt: (todoId: number, atIndex: number) => Promise<void>
  addMultipleAt: (todoIds: number[], atIndex: number) => Promise<void>
  removeEntry: (todoId: number) => Promise<void>
  clear: () => Promise<void>
  has: (todoId: number) => boolean
  reorder: (fromIndex: number, toIndex: number) => Promise<void>
  getEntries: () => TaskboardEntry[]
}

function writeEntries(
  set: (partial: Partial<TaskboardState>) => void,
  board: Taskboard | null,
  entries: TaskboardEntry[],
): Taskboard | null {
  if (!board) return board
  const next: Taskboard = { ...board, entries, updatedAt: new Date() }
  set({ board: next })
  return next
}

function nextSortOrder(entries: TaskboardEntry[]): number {
  if (entries.length === 0) return 1000
  const last = entries[entries.length - 1]
  return last ? last.sortOrder + 1000 : 1000
}

function normalize(entries: TaskboardEntry[]): TaskboardEntry[] {
  return entries.map((e, i) => ({ ...e, sortOrder: (i + 1) * 1000 }))
}

export const useTaskboardStore = create<TaskboardState>((set, get) => ({
  board: null,
  loading: false,
  error: null,

  async load() {
    set({ loading: true, error: null })
    try {
      const row = await taskboardRepository.load()
      set({ board: row ?? null })
    } catch (e) {
      console.error('Failed to load taskboard:', e)
      set({ error: 'Failed to load taskboard' })
    } finally {
      set({ loading: false })
    }
  },

  async ensureLoaded() {
    const current = get().board
    if (current) return current
    return mutate(set, async () => {
      const row = await taskboardRepository.ensureRow()
      set({ board: row })
      return row
    }, 'Failed to create taskboard')
  },

  async add(todoId) {
    await mutate(set, async () => {
      const board = get().board ?? (await get().ensureLoaded())
      if (board.entries.some((e) => e.todoId === todoId)) return
      const entries = [...board.entries, { todoId, sortOrder: nextSortOrder(board.entries) }]
      writeEntries(set, get().board, entries)
      await taskboardRepository.writeEntries(entries)

      undoable(
        'Add to taskboard',
        () => get().add(todoId),
        async () => {
          const cur = get().board
          if (!cur) return
          const filtered = cur.entries.filter((e) => e.todoId !== todoId)
          writeEntries(set, cur, filtered)
          await taskboardRepository.writeEntries(filtered)
        },
        true,
      )
    }, 'Failed to add to taskboard')
  },

  async addAt(todoId, atIndex) {
    await mutate(set, async () => {
      const board = get().board ?? (await get().ensureLoaded())
      if (board.entries.some((e) => e.todoId === todoId)) return
      const current = board.entries
      let sortOrder: number
      if (current.length === 0 || atIndex >= current.length) {
        const last = current[current.length - 1]
        sortOrder = current.length > 0 && last ? last.sortOrder + 1000 : 1000
      } else if (atIndex <= 0) {
        const first = current[0]
        sortOrder = first ? first.sortOrder - 1000 : 1000
      } else {
        const prevEntry = current[atIndex - 1]
        const nextEntry = current[atIndex]
        if (!prevEntry || !nextEntry) return
        const prev = prevEntry.sortOrder
        const next = nextEntry.sortOrder
        sortOrder = Math.floor((prev + next) / 2)
        if (sortOrder <= prev) {
          const normalized = normalize(current)
          const nPrev = normalized[atIndex - 1]
          const nNext = normalized[atIndex]
          if (!nPrev || !nNext) return
          sortOrder = Math.floor((nPrev.sortOrder + nNext.sortOrder) / 2)
          const withInsert = [...normalized]
          withInsert.splice(atIndex, 0, { todoId, sortOrder })
          writeEntries(set, get().board, withInsert)
          await taskboardRepository.writeEntries(withInsert)
          queueAddUndo(get, set, todoId, atIndex)
          return
        }
      }
      const withInsert = [...current]
      withInsert.splice(Math.max(0, Math.min(atIndex, current.length)), 0, { todoId, sortOrder })
      writeEntries(set, get().board, withInsert)
      await taskboardRepository.writeEntries(withInsert)
      queueAddUndo(get, set, todoId, atIndex)
    }, 'Failed to add to taskboard')
  },

  async addMultipleAt(todoIds, atIndex) {
    await mutate(set, async () => {
      const board = get().board ?? (await get().ensureLoaded())
      const existing = new Set(board.entries.map((e) => e.todoId))
      const newIds = todoIds.filter((id) => !existing.has(id))
      if (newIds.length === 0) return

      let current = board.entries
      if (current.length > 0) current = normalize(current)

      const count = newIds.length
      let low: number, high: number
      if (current.length === 0) { low = 0; high = (count + 1) * 1000 }
      else if (atIndex >= current.length) {
        const last = current[current.length - 1]
        if (!last) return
        low = last.sortOrder
        high = low + (count + 1) * 1000
      } else if (atIndex <= 0) {
        const first = current[0]
        if (!first) return
        high = first.sortOrder
        low = high - (count + 1) * 1000
      } else {
        const prevEntry = current[atIndex - 1]
        const nextEntry = current[atIndex]
        if (!prevEntry || !nextEntry) return
        low = prevEntry.sortOrder
        high = nextEntry.sortOrder
      }
      const step = Math.floor((high - low) / (count + 1))
      const inserts: TaskboardEntry[] = newIds.map((todoId, i) => ({ todoId, sortOrder: low + step * (i + 1) }))
      const merged = [...current]
      merged.splice(Math.max(0, Math.min(atIndex, current.length)), 0, ...inserts)
      writeEntries(set, get().board, merged)
      await taskboardRepository.writeEntries(merged)

      undoable(
        `Add ${newIds.length} to taskboard`,
        () => get().addMultipleAt(todoIds, atIndex),
        async () => {
          const cur = get().board
          if (!cur) return
          const filtered = cur.entries.filter((e) => !newIds.includes(e.todoId))
          writeEntries(set, cur, filtered)
          await taskboardRepository.writeEntries(filtered)
        },
        true,
      )
    }, 'Failed to add to taskboard')
  },

  async removeEntry(todoId) {
    const board = get().board
    if (!board) return
    const entry = board.entries.find((e) => e.todoId === todoId)
    if (!entry) return
    const prevEntries = board.entries
    const filtered = prevEntries.filter((e) => e.todoId !== todoId)

    return optimistic(
      set,
      () => writeEntries(set, get().board, filtered),
      () => taskboardRepository.writeEntries(filtered),
      () => writeEntries(set, get().board, prevEntries),
      'Failed to remove from taskboard',
      {
        description: 'Remove from taskboard',
        redo: () => get().removeEntry(todoId),
        undo: async () => {
          writeEntries(set, get().board, prevEntries)
          await taskboardRepository.writeEntries(prevEntries)
        },
        showSnackbar: true,
      },
    )
  },

  async clear() {
    const board = get().board
    if (!board || board.entries.length === 0) return
    const prevEntries = board.entries

    return optimistic(
      set,
      () => writeEntries(set, get().board, []),
      () => taskboardRepository.writeEntries([]),
      () => writeEntries(set, get().board, prevEntries),
      'Failed to clear taskboard',
      {
        description: 'Clear taskboard',
        redo: () => get().clear(),
        undo: async () => {
          writeEntries(set, get().board, prevEntries)
          await taskboardRepository.writeEntries(prevEntries)
        },
        showSnackbar: true,
      },
    )
  },

  has(todoId) {
    const board = get().board
    return board ? board.entries.some((e) => e.todoId === todoId) : false
  },

  async reorder(fromIndex, toIndex) {
    const board = get().board
    if (!board) return
    const prevEntries = board.entries
    const reordered = [...prevEntries]
    const [moved] = reordered.splice(fromIndex, 1)
    if (!moved) return
    reordered.splice(toIndex, 0, moved)
    const updated = normalize(reordered)

    return optimistic(
      set,
      () => writeEntries(set, get().board, updated),
      () => taskboardRepository.writeEntries(updated),
      () => writeEntries(set, get().board, prevEntries),
      'Failed to reorder taskboard',
    )
  },

  getEntries() {
    return get().board?.entries ?? []
  },
}))

function queueAddUndo(
  get: () => TaskboardState,
  _set: (partial: Partial<TaskboardState>) => void,
  todoId: number,
  atIndex: number,
) {
  undoable(
    'Add to taskboard',
    () => get().addAt(todoId, atIndex),
    async () => {
      const cur = get().board
      if (!cur) return
      const filtered = cur.entries.filter((e) => e.todoId !== todoId)
      writeEntries(_set, cur, filtered)
      await taskboardRepository.writeEntries(filtered)
    },
    true,
  )
}
