import { create } from 'zustand'
import { type Status, type StatusIconKey, DEFAULT_STATUS_ICON } from '../models'
import { statusRepository, settingsRepository } from '../data'
import { SETTING_KEYS } from '../data/setting-keys'
import { loadFresh, optimistic, makeEnsureLoaded, trackWrite } from './store-helpers'
import { useTodoStore } from './todo-store'
import { DEFAULT_ENTITY_COLOR } from '../constants'
import { undoable } from './undoable'
import { useSettingsStore } from './settings-store'
import { bySortOrder } from '../utils/sort-order'
import { stampAfter, undoStamps, type Stamp, type StampChanges } from '../utils/task-stamps'

interface StatusState {
  statuses: Status[]
  /** A load has read the rows (a failed load leaves it false, so `ensureLoaded` retries). */
  loaded: boolean

  load: () => Promise<void>
  ensureLoaded: () => Promise<void>
  add: (name: string, color?: string, icon?: StatusIconKey) => Promise<number>
  update: (status: Status) => Promise<void>
  remove: (id: number) => Promise<void>
  reorder: (fromIndex: number, toIndex: number) => Promise<void>
  /**
   * Count todos currently assigned to `statusId`, derived from the in-memory
   * `useTodoStore.todos` cache. Replaces `statusRepository.getTodoCountForStatus`
   * for editor delete-confirmation prompts so the count comes from the same
   * data the rest of the UI is reading. Caller is responsible for ensuring
   * todos are loaded (`useTodoStore.ensureAllLoaded()`).
   */
  selectTodoCountByStatusId: (statusId: number) => number
}

export const useStatusStore = create<StatusState>((set, get) => {
  const statusEnsure = makeEnsureLoaded(() => get().load(), () => get().loaded)

  /**
   * `remove`: the status deleted and cleared from its tasks, stamping them
   * now — or, given `stamp` (a redo), the step's stamp put back. Its undo
   * puts the status back on them with their earlier `modifiedAt`
   * (`utils/task-stamps`), each only where the task still holds this one.
   */
  function removeStatus(id: number, stamp?: StampChanges): Promise<void> {
    return trackWrite(async () => {
      const status = get().statuses.find(s => s.id === id)
      // Capture affected todos and default setting before deletion
      const settingsState = useSettingsStore.getState()
      const wasDefault = settingsState.defaultStatusId === id
      const wasSeededAssigned = settingsState.seededAssignedStatusId === id

      // One stamp for the tasks it is cleared from, in the store and the DB.
      const write: Stamp = stamp ?? new Date()
      const holding = useTodoStore.getState().todos.filter((t) => t.statusId === id)
      const affectedTodoIds = await statusRepository.delete(id, write)
      set({ statuses: get().statuses.filter(s => s.id !== id) })

      // Update in-memory todo store
      const affected = new Set(affectedTodoIds)
      const step: StampChanges = new Map(holding.filter((t) => affected.has(t.id))
        .map((t) => [t.id, { before: t.modifiedAt, after: stampAfter(write, t.id, t.modifiedAt) }]))
      if (affectedTodoIds.length > 0) {
        useTodoStore.setState({
          todos: useTodoStore.getState().todos.map(t =>
            affected.has(t.id) ? { ...t, statusId: undefined, modifiedAt: stampAfter(write, t.id, t.modifiedAt) } : t
          ),
        })
      }

      if (wasDefault) {
        // Part of the delete's undo step (its undo puts the default back).
        await useSettingsStore.getState().setDefaultStatusId(null, { record: false })
      }
      if (wasSeededAssigned) {
        await settingsRepository.delete(SETTING_KEYS.seededAssignedStatusId)
        useSettingsStore.setState({ seededAssignedStatusId: null })
      }

      if (status) {
        undoable(
          `Delete status "${status.name}"`,
          () => removeStatus(id, step),
          async () => {
            await statusRepository.restoreWithTodos(status, affectedTodoIds, undoStamps(step))
            if (wasDefault) {
              await useSettingsStore.getState().setDefaultStatusId(id)
            }
            if (wasSeededAssigned) {
              await settingsRepository.put(SETTING_KEYS.seededAssignedStatusId, String(id))
              useSettingsStore.setState({ seededAssignedStatusId: id })
            }
            await get().load()
            // Reload todo store to reflect restored statusIds
            await useTodoStore.getState().loadAll()
          },
          true,
        )
      }
    })
  }

  return {
  statuses: [],
  loaded: false,

  async load() {
    const statuses = await loadFresh(() => statusRepository.getAll(), 'statuses')
    if (statuses) set({ statuses, loaded: true })
  },
  ensureLoaded: statusEnsure,

  add(name: string, color = DEFAULT_ENTITY_COLOR, icon: StatusIconKey = DEFAULT_STATUS_ICON) {
    return trackWrite(async () => {
      const entry = { name, color, icon }
      // Goes last; the repository picks the sort order and refuses a name
      // already stored, both in its transaction.
      const { id, sortOrder } = await statusRepository.insertLast(entry)
      set({ statuses: [...get().statuses, { ...entry, sortOrder, id }] })
      return id
    })
  },

  async update(status: Status) {
    const { statuses } = get()
    if (statuses.some(s => s.id !== status.id && s.name.toLowerCase() === status.name.toLowerCase())) {
      throw new Error(`Status "${status.name}" already exists`)
    }
    const prev = statuses.find(s => s.id === status.id)
    const applied = { ...status }
    const put = (next: Status) => set({ statuses: get().statuses.map(s => s.id === next.id ? next : s) })
    return optimistic(
      () => put(applied),
      () => statusRepository.update(status),
      // Only this status, and only while it still holds this edit.
      () => { if (prev && get().statuses.find(s => s.id === status.id) === applied) put(prev) },
      'Failed to update status',
    )
  },

  remove(id: number) {
    return removeStatus(id)
  },

  reorder(fromIndex: number, toIndex: number) {
    return trackWrite(async () => {
      const prev = get().statuses
      const sorted = [...prev].sort(bySortOrder)
      if (fromIndex < 0 || toIndex < 0 || fromIndex >= sorted.length || toIndex >= sorted.length) return

      const [moved] = sorted.splice(fromIndex, 1)
      if (!moved) return
      sorted.splice(toIndex, 0, moved)

      const updated = sorted.map((s, i) => ({ ...s, sortOrder: i }))
      set({ statuses: updated })

      try {
        await statusRepository.reorder(updated.map(s => s.id!))
      } catch (e) {
        console.error('Failed to reorder statuses:', e)
        set({ statuses: prev })
      }
    })
  },

  selectTodoCountByStatusId(statusId: number) {
    let count = 0
    for (const t of useTodoStore.getState().todos) {
      if (t.statusId === statusId) count++
    }
    return count
  },
  }
})
