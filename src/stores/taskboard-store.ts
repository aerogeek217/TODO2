import { create } from 'zustand'
import { taskboardRepository } from '../data/taskboard-repository'
import { db } from '../data/database'
import type { Taskboard, TaskboardEntry } from '../models'
import { mutate, optimistic } from './store-helpers'
import { undoable } from '../services/undoable'

/**
 * Instance-indexed taskboard store. Every action takes a `taskboardId`; the
 * store holds a `boards` map keyed by id. Entries live inline on each
 * Taskboard — mutations read → splice/filter → write back through the
 * repository's `writeEntries` helper.
 */

const DEFAULT_NAME = 'Default'

interface TaskboardState {
  boards: Map<number, Taskboard>
  defaultBoardId: number | null
  loading: boolean
  error: string | null

  load: () => Promise<void>
  ensureDefault: () => Promise<number>
  createBoard: (name: string) => Promise<number>
  renameBoard: (id: number, name: string) => Promise<void>
  removeBoard: (id: number) => Promise<void>

  add: (taskboardId: number, todoId: number) => Promise<void>
  addAt: (taskboardId: number, todoId: number, atIndex: number) => Promise<void>
  addMultipleAt: (taskboardId: number, todoIds: number[], atIndex: number) => Promise<void>
  removeEntry: (taskboardId: number, todoId: number) => Promise<void>
  clear: (taskboardId: number) => Promise<void>
  has: (taskboardId: number, todoId: number) => boolean
  reorder: (taskboardId: number, fromIndex: number, toIndex: number) => Promise<void>
  getEntries: (taskboardId: number) => TaskboardEntry[]
}

function writeBoard(
  set: (partial: Partial<TaskboardState>) => void,
  boards: Map<number, Taskboard>,
  taskboardId: number,
  entries: TaskboardEntry[],
): Map<number, Taskboard> {
  const prev = boards.get(taskboardId)
  if (!prev) return boards
  const next = new Map(boards)
  next.set(taskboardId, { ...prev, entries, updatedAt: new Date() })
  set({ boards: next })
  return next
}

function nextSortOrder(entries: TaskboardEntry[]): number {
  return entries.length === 0 ? 1000 : entries[entries.length - 1].sortOrder + 1000
}

function normalize(entries: TaskboardEntry[]): TaskboardEntry[] {
  return entries.map((e, i) => ({ ...e, sortOrder: (i + 1) * 1000 }))
}

export const useTaskboardStore = create<TaskboardState>((set, get) => ({
  boards: new Map(),
  defaultBoardId: null,
  loading: false,
  error: null,

  async load() {
    set({ loading: true, error: null })
    try {
      const rows = await taskboardRepository.getAll()
      const map = new Map<number, Taskboard>()
      for (const r of rows) if (r.id != null) map.set(r.id, r)
      const setting = await db.settings.get('defaultTaskboardId')
      let defaultId: number | null = null
      if (setting) {
        const parsed = Number(setting.value)
        if (Number.isFinite(parsed) && map.has(parsed)) defaultId = parsed
      }
      if (defaultId == null) {
        const first = rows[0]
        if (first?.id != null) defaultId = first.id
      }
      set({ boards: map, defaultBoardId: defaultId })
    } catch (e) {
      console.error('Failed to load taskboards:', e)
      set({ error: 'Failed to load taskboards' })
    } finally {
      set({ loading: false })
    }
  },

  async ensureDefault() {
    const current = get().defaultBoardId
    if (current != null && get().boards.has(current)) return current
    return mutate(set, async () => {
      const id = await taskboardRepository.create(DEFAULT_NAME)
      await db.settings.put({ key: 'defaultTaskboardId', value: String(id) })
      const row = await taskboardRepository.getById(id)
      if (row) {
        const next = new Map(get().boards)
        next.set(id, row)
        set({ boards: next, defaultBoardId: id })
      }
      return id
    }, 'Failed to create default taskboard')
  },

  async createBoard(name: string) {
    return mutate(set, async () => {
      const id = await taskboardRepository.create(name)
      const row = await taskboardRepository.getById(id)
      if (row) {
        const next = new Map(get().boards)
        next.set(id, row)
        set({ boards: next })
      }
      return id
    }, 'Failed to create taskboard')
  },

  async renameBoard(id, name) {
    const prev = get().boards.get(id)
    if (!prev) return
    return optimistic(
      set,
      () => {
        const next = new Map(get().boards)
        next.set(id, { ...prev, name, updatedAt: new Date() })
        set({ boards: next })
      },
      () => taskboardRepository.rename(id, name),
      () => {
        const next = new Map(get().boards)
        next.set(id, prev)
        set({ boards: next })
      },
      'Failed to rename taskboard',
    )
  },

  async removeBoard(id) {
    const prev = get().boards.get(id)
    if (!prev) return
    return optimistic(
      set,
      () => {
        const next = new Map(get().boards)
        next.delete(id)
        set({ boards: next })
      },
      () => taskboardRepository.remove(id),
      () => {
        const next = new Map(get().boards)
        next.set(id, prev)
        set({ boards: next })
      },
      'Failed to remove taskboard',
    )
  },

  async add(taskboardId, todoId) {
    await mutate(set, async () => {
      const board = get().boards.get(taskboardId)
      if (!board) return
      if (board.entries.some((e) => e.todoId === todoId)) return
      const entries = [...board.entries, { todoId, sortOrder: nextSortOrder(board.entries) }]
      writeBoard(set, get().boards, taskboardId, entries)
      await taskboardRepository.writeEntries(taskboardId, entries)

      undoable(
        'Add to taskboard',
        () => get().add(taskboardId, todoId),
        async () => {
          const cur = get().boards.get(taskboardId)
          if (!cur) return
          const filtered = cur.entries.filter((e) => e.todoId !== todoId)
          writeBoard(set, get().boards, taskboardId, filtered)
          await taskboardRepository.writeEntries(taskboardId, filtered)
        },
        true,
      )
    }, 'Failed to add to taskboard')
  },

  async addAt(taskboardId, todoId, atIndex) {
    await mutate(set, async () => {
      const board = get().boards.get(taskboardId)
      if (!board) return
      if (board.entries.some((e) => e.todoId === todoId)) return
      const current = board.entries
      let sortOrder: number
      if (current.length === 0 || atIndex >= current.length) {
        sortOrder = current.length > 0 ? current[current.length - 1].sortOrder + 1000 : 1000
      } else if (atIndex <= 0) {
        sortOrder = current[0].sortOrder - 1000
      } else {
        const prev = current[atIndex - 1].sortOrder
        const next = current[atIndex].sortOrder
        sortOrder = Math.floor((prev + next) / 2)
        if (sortOrder <= prev) {
          const normalized = normalize(current)
          sortOrder = Math.floor((normalized[atIndex - 1].sortOrder + normalized[atIndex].sortOrder) / 2)
          const withInsert = [...normalized]
          withInsert.splice(atIndex, 0, { todoId, sortOrder })
          writeBoard(set, get().boards, taskboardId, withInsert)
          await taskboardRepository.writeEntries(taskboardId, withInsert)
          queueAddUndo(get, set, taskboardId, todoId, atIndex)
          return
        }
      }
      const withInsert = [...current]
      withInsert.splice(Math.max(0, Math.min(atIndex, current.length)), 0, { todoId, sortOrder })
      writeBoard(set, get().boards, taskboardId, withInsert)
      await taskboardRepository.writeEntries(taskboardId, withInsert)
      queueAddUndo(get, set, taskboardId, todoId, atIndex)
    }, 'Failed to add to taskboard')
  },

  async addMultipleAt(taskboardId, todoIds, atIndex) {
    await mutate(set, async () => {
      const board = get().boards.get(taskboardId)
      if (!board) return
      const existing = new Set(board.entries.map((e) => e.todoId))
      const newIds = todoIds.filter((id) => !existing.has(id))
      if (newIds.length === 0) return

      let current = board.entries
      if (current.length > 0) current = normalize(current)

      const count = newIds.length
      let low: number, high: number
      if (current.length === 0) { low = 0; high = (count + 1) * 1000 }
      else if (atIndex >= current.length) {
        low = current[current.length - 1].sortOrder
        high = low + (count + 1) * 1000
      } else if (atIndex <= 0) {
        high = current[0].sortOrder
        low = high - (count + 1) * 1000
      } else {
        low = current[atIndex - 1].sortOrder
        high = current[atIndex].sortOrder
      }
      const step = Math.floor((high - low) / (count + 1))
      const inserts: TaskboardEntry[] = newIds.map((todoId, i) => ({ todoId, sortOrder: low + step * (i + 1) }))
      const merged = [...current]
      merged.splice(Math.max(0, Math.min(atIndex, current.length)), 0, ...inserts)
      writeBoard(set, get().boards, taskboardId, merged)
      await taskboardRepository.writeEntries(taskboardId, merged)

      undoable(
        `Add ${newIds.length} to taskboard`,
        () => get().addMultipleAt(taskboardId, todoIds, atIndex),
        async () => {
          const cur = get().boards.get(taskboardId)
          if (!cur) return
          const filtered = cur.entries.filter((e) => !newIds.includes(e.todoId))
          writeBoard(set, get().boards, taskboardId, filtered)
          await taskboardRepository.writeEntries(taskboardId, filtered)
        },
        true,
      )
    }, 'Failed to add to taskboard')
  },

  async removeEntry(taskboardId, todoId) {
    const board = get().boards.get(taskboardId)
    if (!board) return
    const entry = board.entries.find((e) => e.todoId === todoId)
    if (!entry) return
    const prevEntries = board.entries
    const filtered = prevEntries.filter((e) => e.todoId !== todoId)

    return optimistic(
      set,
      () => writeBoard(set, get().boards, taskboardId, filtered),
      () => taskboardRepository.writeEntries(taskboardId, filtered),
      () => writeBoard(set, get().boards, taskboardId, prevEntries),
      'Failed to remove from taskboard',
      {
        description: 'Remove from taskboard',
        redo: () => get().removeEntry(taskboardId, todoId),
        undo: async () => {
          writeBoard(set, get().boards, taskboardId, prevEntries)
          await taskboardRepository.writeEntries(taskboardId, prevEntries)
        },
        showSnackbar: true,
      },
    )
  },

  async clear(taskboardId) {
    const board = get().boards.get(taskboardId)
    if (!board || board.entries.length === 0) return
    const prevEntries = board.entries

    return optimistic(
      set,
      () => writeBoard(set, get().boards, taskboardId, []),
      () => taskboardRepository.writeEntries(taskboardId, []),
      () => writeBoard(set, get().boards, taskboardId, prevEntries),
      'Failed to clear taskboard',
      {
        description: 'Clear taskboard',
        redo: () => get().clear(taskboardId),
        undo: async () => {
          writeBoard(set, get().boards, taskboardId, prevEntries)
          await taskboardRepository.writeEntries(taskboardId, prevEntries)
        },
        showSnackbar: true,
      },
    )
  },

  has(taskboardId, todoId) {
    const board = get().boards.get(taskboardId)
    return board ? board.entries.some((e) => e.todoId === todoId) : false
  },

  async reorder(taskboardId, fromIndex, toIndex) {
    const board = get().boards.get(taskboardId)
    if (!board) return
    const prevEntries = board.entries
    const reordered = [...prevEntries]
    const [moved] = reordered.splice(fromIndex, 1)
    if (!moved) return
    reordered.splice(toIndex, 0, moved)
    const updated = normalize(reordered)

    return optimistic(
      set,
      () => writeBoard(set, get().boards, taskboardId, updated),
      () => taskboardRepository.writeEntries(taskboardId, updated),
      () => writeBoard(set, get().boards, taskboardId, prevEntries),
      'Failed to reorder taskboard',
    )
  },

  getEntries(taskboardId) {
    return get().boards.get(taskboardId)?.entries ?? []
  },
}))

function queueAddUndo(
  get: () => TaskboardState,
  _set: (partial: Partial<TaskboardState>) => void,
  taskboardId: number,
  todoId: number,
  atIndex: number,
) {
  undoable(
    'Add to taskboard',
    () => get().addAt(taskboardId, todoId, atIndex),
    async () => {
      const cur = get().boards.get(taskboardId)
      if (!cur) return
      const filtered = cur.entries.filter((e) => e.todoId !== todoId)
      writeBoard(_set, get().boards, taskboardId, filtered)
      await taskboardRepository.writeEntries(taskboardId, filtered)
    },
    true,
  )
}
