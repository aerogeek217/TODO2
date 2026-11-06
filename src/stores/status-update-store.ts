import { create } from 'zustand'
import { statusUpdateRepository } from '../data/status-update-repository'
import { taskTouch } from '../data/touch-todos'
import type { PersistedStatusUpdate, StatusUpdate } from '../models/status-update'
import { startOfToday } from '../utils/date'
import { compareStatusUpdates, statusUpdateDay, statusUpdateText } from '../utils/status-updates'
import { undoStamps, type Stamp } from '../utils/task-stamps'
import { saveOrReport, trackWrite } from './store-helpers'
import { notifyTasksStamped } from './task-hooks'
import { taskChildRows } from './task-child-rows'
import { guardTasks } from './task-undo-guard'
import { undoable } from './undoable'

const NO_UPDATES: readonly PersistedStatusUpdate[] = []

/** A new entry: its day (a later one is today), its text and whether it came with a Mark followed up. */
export interface NewStatusUpdate {
  date: Date
  text: string
  followedUp?: boolean
}

/**
 * Every task's status updates (`statusUpdates`), loaded once, each task's
 * newest first (`compareStatusUpdates`). Every write saves at once and is
 * its own undo step, and counts as activity on its task: it stamps the
 * task's `modifiedAt` (the task store follows through
 * `task-hooks.onTasksStamped`); its undo puts back the stamp the task had
 * before, its redo the one it wrote — each only while the task still holds
 * the other (`utils/task-stamps`). A write never rejects: a failure is logged, the
 * snackbar says so, and it resolves as "nothing written" (`undefined` /
 * `false`). Text is stored as one trimmed line (`statusUpdateText`) — a
 * blank one is refused (no write) — and a date after today as today.
 */
interface StatusUpdateState {
  /** Task id → its entries, newest first. */
  byTodo: ReadonlyMap<number, readonly PersistedStatusUpdate[]>
  loaded: boolean

  load: () => Promise<void>
  ensureLoaded: () => Promise<void>
  /** Adds an entry to a task (undo removes it). Resolves the entry, or undefined when nothing was written. */
  add: (todoId: number, entry: NewStatusUpdate) => Promise<PersistedStatusUpdate | undefined>
  /** Adds the same entry to every task in `todoIds` as one undo step (`description`). Resolves the entries written. */
  addToMany: (todoIds: readonly number[], entry: NewStatusUpdate, description: string) => Promise<PersistedStatusUpdate[]>
  /** Changes an entry's day and / or text (undo puts them back). False when nothing was written. */
  update: (id: number, changes: { date?: Date; text?: string }) => Promise<boolean>
  /** Removes an entry, with the undo snackbar ("Status update removed"). False when nothing was removed. */
  remove: (id: number) => Promise<boolean>
  /**
   * Writes whole rows with no undo step of their own — a duplicate's copies
   * and a new task's drafts (the task's create step covers them). Each text
   * is stored as `add` stores it (`statusUpdateText`); a row left with none
   * is not written. Resolves the rows written.
   */
  addRows: (rows: readonly StatusUpdate[]) => Promise<PersistedStatusUpdate[]>
  /** Puts deleted rows back (undo), those whose task still exists. */
  restoreRows: (rows: readonly PersistedStatusUpdate[]) => Promise<void>
  /** Drops deleted tasks' entries from memory (the repository deletes the rows). */
  forgetTodos: (todoIds: readonly number[]) => void
}

export const useStatusUpdateStore = create<StatusUpdateState>((set, get) => {
  const { find, put, putBack, take, actions } = taskChildRows<StatusUpdate, PersistedStatusUpdate>({
    repository: statusUpdateRepository,
    compare: compareStatusUpdates,
    normalize: (r) => {
      const text = statusUpdateText(r.text)
      return text === '' ? null : { ...r, text }
    },
    label: 'the status updates',
    get,
    set,
  })

  /** The stored row for `todoId` and `entry`, or null for a blank text. */
  const rowOf = (todoId: number, entry: NewStatusUpdate, now: Date): StatusUpdate | null => {
    const text = statusUpdateText(entry.text)
    if (text === '') return null
    return {
      todoId,
      date: statusUpdateDay(entry.date, startOfToday()),
      text,
      createdAt: now,
      ...(entry.followedUp === true ? { followedUp: true as const } : {}),
    }
  }

  /** Adds `rows` as one undo step (`description`), stamping their tasks' `modifiedAt`; the rows written. */
  const addAsStep = (rows: readonly StatusUpdate[], description: string): Promise<PersistedStatusUpdate[]> =>
    saveOrReport(async () => {
      const touch = taskTouch(new Date())
      const added = await statusUpdateRepository.addMany(rows, touch)
      if (added.length === 0) return added
      put(added)
      notifyTasksStamped(touch.stamped)
      const step = touch.stamped
      const ids = added.map((r) => r.id)
      const tasks = added.map((r) => r.todoId)
      undoable(
        description,
        guardTasks(tasks, async () => { await trackWrite(() => putBack(added, step)) }),
        guardTasks(tasks, async () => { await trackWrite(() => take(ids, undoStamps(step))) }),
      )
      return added
    }, [], 'add the status update')

  return {
    byTodo: new Map(),
    loaded: false,

    ...actions,

    async add(todoId, entry) {
      const row = rowOf(todoId, entry, new Date())
      if (!row) return undefined
      const [added] = await addAsStep([row], 'Add status update')
      return added
    },

    async addToMany(todoIds, entry, description) {
      const now = new Date()
      const rows = [...new Set(todoIds)].flatMap((todoId) => rowOf(todoId, entry, now) ?? [])
      if (rows.length === 0) return []
      return addAsStep(rows, description)
    },

    async update(id, changes) {
      const prev = find(id)
      if (!prev) return false
      const patch: Partial<Pick<StatusUpdate, 'date' | 'text'>> = {}
      if (changes.text !== undefined) {
        const text = statusUpdateText(changes.text)
        if (text === '') return false
        if (text !== prev.text) patch.text = text
      }
      if (changes.date !== undefined) {
        const date = statusUpdateDay(changes.date, startOfToday())
        if (date.getTime() !== prev.date.getTime()) patch.date = date
      }
      if (Object.keys(patch).length === 0) return false
      const before: Partial<Pick<StatusUpdate, 'date' | 'text'>> = {
        ...(patch.text !== undefined ? { text: prev.text } : {}),
        ...(patch.date !== undefined ? { date: prev.date } : {}),
      }
      /** Writes `fields` to the entry, stamping its task by `stamp`, in the database and the store; what it stamped, or null when the entry is gone. */
      const write = async (fields: Partial<Pick<StatusUpdate, 'date' | 'text'>>, stamp: Stamp) => {
        const touch = taskTouch(stamp)
        const saved = await statusUpdateRepository.update(id, fields, touch)
        const current = find(id)
        if (saved && current) put([{ ...current, ...fields }])
        if (saved) notifyTasksStamped(touch.stamped)
        return saved ? touch.stamped : null
      }
      return saveOrReport(async () => {
        const step = await write(patch, new Date())
        if (step) {
          undoable(
            'Edit status update',
            guardTasks([prev.todoId], async () => { await trackWrite(() => write(patch, step)) }),
            guardTasks([prev.todoId], async () => { await trackWrite(() => write(before, undoStamps(step))) }),
          )
        }
        return step != null
      }, false, 'save the status update')
    },

    async remove(id) {
      const row = find(id)
      if (!row) return false
      return saveOrReport(async () => {
        const step = await take([id], new Date())
        undoable(
          'Status update removed',
          guardTasks([row.todoId], async () => { await trackWrite(() => take([id], step)) }),
          guardTasks([row.todoId], async () => { await trackWrite(() => putBack([row], undoStamps(step))) }),
          true,
        )
        return true
      }, false, 'remove the status update')
    },
  }
})

/** A task's status updates, newest first, kept current (an empty list when it has none). */
export function useStatusUpdates(todoId: number | undefined): readonly PersistedStatusUpdate[] {
  return useStatusUpdateStore((s) => (todoId != null ? s.byTodo.get(todoId) : undefined) ?? NO_UPDATES)
}

/**
 * A task's newest status update (the first in `compareStatusUpdates`
 * order), or undefined — from `byTodo` (default: the store's now), so it
 * also serves as a selector: `useStatusUpdateStore((s) => newestStatusUpdate(id, s.byTodo))`.
 */
export function newestStatusUpdate(
  todoId: number,
  byTodo: ReadonlyMap<number, readonly PersistedStatusUpdate[]> = useStatusUpdateStore.getState().byTodo,
): PersistedStatusUpdate | undefined {
  return byTodo.get(todoId)?.at(0)
}
