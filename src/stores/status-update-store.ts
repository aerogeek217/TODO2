import { create } from 'zustand'
import { statusUpdateRepository } from '../data/status-update-repository'
import type { PersistedStatusUpdate, StatusUpdate } from '../models/status-update'
import { startOfToday } from '../utils/date'
import { compareStatusUpdates, statusUpdateDay, statusUpdateText } from '../utils/status-updates'
import { registerModuleReset } from '../utils/module-reset'
import { loadFresh, saveOrReport, trackWrite } from './store-helpers'
import { notifyTasksTouched } from './task-hooks'
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
 * task's `modifiedAt` (the task store follows through `task-hooks.onTasksTouched`). A write never rejects: a failure is logged, the
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
   * (the task's create step covers them). Resolves the rows written.
   */
  addRows: (rows: readonly StatusUpdate[]) => Promise<PersistedStatusUpdate[]>
  /** Puts deleted rows back (undo), those whose task still exists. */
  restoreRows: (rows: readonly PersistedStatusUpdate[]) => Promise<void>
  /** Drops deleted tasks' entries from memory (the repository deletes the rows). */
  forgetTodos: (todoIds: readonly number[]) => void
}

/** `byTodo` with `rows` added (or replaced, by id) — each task touched sorted again. */
function withRows(
  byTodo: ReadonlyMap<number, readonly PersistedStatusUpdate[]>,
  rows: readonly PersistedStatusUpdate[],
): Map<number, readonly PersistedStatusUpdate[]> {
  const next = new Map(byTodo)
  const ids = new Set(rows.map((r) => r.id))
  for (const todoId of new Set(rows.map((r) => r.todoId))) {
    const kept = (next.get(todoId) ?? NO_UPDATES).filter((r) => !ids.has(r.id))
    next.set(todoId, [...kept, ...rows.filter((r) => r.todoId === todoId)].sort(compareStatusUpdates))
  }
  return next
}

/** `byTodo` without the entries `ids`. */
function withoutRows(
  byTodo: ReadonlyMap<number, readonly PersistedStatusUpdate[]>,
  ids: ReadonlySet<number>,
): Map<number, readonly PersistedStatusUpdate[]> {
  const next = new Map(byTodo)
  for (const [todoId, rows] of byTodo) {
    if (!rows.some((r) => ids.has(r.id))) continue
    const kept = rows.filter((r) => !ids.has(r.id))
    if (kept.length > 0) next.set(todoId, kept)
    else next.delete(todoId)
  }
  return next
}

function group(rows: readonly PersistedStatusUpdate[]): Map<number, readonly PersistedStatusUpdate[]> {
  return withRows(new Map(), rows)
}

/** The stamp for a write touching `rows`' tasks, told to the listeners once it is stored. */
function touched(rows: readonly Pick<StatusUpdate, 'todoId'>[], at: Date): void {
  notifyTasksTouched(rows.map((r) => r.todoId), at)
}

let inflight: Promise<void> | null = null

/**
 * Forgets the load in flight, for tests that share one module instance (the
 * store's state is reset separately). That load finishes on its own.
 */
export function resetStatusUpdateLoad(): void {
  inflight = null
}
registerModuleReset(resetStatusUpdateLoad)

export const useStatusUpdateStore = create<StatusUpdateState>((set, get) => {
  const find = (id: number): PersistedStatusUpdate | undefined => {
    for (const rows of get().byTodo.values()) {
      const hit = rows.find((r) => r.id === id)
      if (hit) return hit
    }
    return undefined
  }

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

  /**
   * Puts `rows` back in the database and the store; the rows put back.
   * `touch`: the write is activity on their tasks (an undo / redo of an
   * entry edit), stamping their `modifiedAt`.
   */
  const putBack = async (rows: readonly PersistedStatusUpdate[], touch: boolean): Promise<PersistedStatusUpdate[]> => {
    const at = new Date()
    const restored = await statusUpdateRepository.restore(rows, touch ? at : undefined)
    if (restored.length > 0) set({ byTodo: withRows(get().byTodo, restored) })
    if (touch) touched(restored, at)
    return restored
  }

  /** Deletes the entries `ids` from the database and the store, stamping their tasks' `modifiedAt`. */
  const take = async (ids: readonly number[]): Promise<void> => {
    const idSet = new Set(ids)
    const rows = [...get().byTodo.values()].flatMap((list) => list.filter((r) => idSet.has(r.id)))
    const at = new Date()
    await statusUpdateRepository.deleteMany(ids, at)
    set({ byTodo: withoutRows(get().byTodo, idSet) })
    touched(rows, at)
  }

  /** Adds `rows` as one undo step (`description`), stamping their tasks' `modifiedAt`; the rows written. */
  const addAsStep = (rows: readonly StatusUpdate[], description: string): Promise<PersistedStatusUpdate[]> =>
    saveOrReport(async () => {
      const at = new Date()
      const added = await statusUpdateRepository.addMany(rows, at)
      if (added.length === 0) return added
      set({ byTodo: withRows(get().byTodo, added) })
      touched(added, at)
      const ids = added.map((r) => r.id)
      undoable(
        description,
        async () => { await trackWrite(() => putBack(added, true)) },
        () => trackWrite(() => take(ids)),
      )
      return added
    }, [], 'add the status update')

  return {
    byTodo: new Map(),
    loaded: false,

    async load() {
      // Never rejects (a refresh of every store waits on it): a failed read
      // is reported, the entries kept.
      const rows = await loadFresh(() => statusUpdateRepository.getAll(), 'the status updates')
      if (rows) set({ byTodo: group(rows), loaded: true })
    },

    ensureLoaded() {
      if (get().loaded) return Promise.resolve()
      // A failed load leaves `loaded` false: reported, and retried next time.
      if (inflight) return inflight
      const run: Promise<void> = get().load()
        .finally(() => { if (inflight === run) inflight = null })
      inflight = run
      return run
    },

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
      /** Writes `fields` to the entry (stamping its task), in the database and the store; false when it is gone. */
      const write = async (fields: Partial<Pick<StatusUpdate, 'date' | 'text'>>): Promise<boolean> => {
        const at = new Date()
        const saved = await statusUpdateRepository.update(id, fields, at)
        const current = find(id)
        if (saved && current) set({ byTodo: withRows(get().byTodo, [{ ...current, ...fields }]) })
        if (saved) touched([prev], at)
        return saved
      }
      return saveOrReport(async () => {
        const saved = await write(patch)
        if (saved) {
          undoable(
            'Edit status update',
            async () => { await trackWrite(() => write(patch)) },
            async () => { await trackWrite(() => write(before)) },
          )
        }
        return saved
      }, false, 'save the status update')
    },

    async remove(id) {
      const row = find(id)
      if (!row) return false
      return saveOrReport(async () => {
        await take([id])
        undoable(
          'Status update removed',
          () => trackWrite(() => take([id])),
          async () => { await trackWrite(() => putBack([row], true)) },
          true,
        )
        return true
      }, false, 'remove the status update')
    },

    async addRows(rows) {
      if (rows.length === 0) return []
      return trackWrite(async () => {
        const added = await statusUpdateRepository.addMany(rows)
        if (added.length > 0) set({ byTodo: withRows(get().byTodo, added) })
        return added
      })
    },

    async restoreRows(rows) {
      if (rows.length === 0) return
      await trackWrite(() => putBack(rows, false))
    },

    forgetTodos(todoIds) {
      const byTodo = get().byTodo
      const gone = todoIds.filter((id) => byTodo.has(id))
      if (gone.length === 0) return
      const next = new Map(byTodo)
      for (const id of gone) next.delete(id)
      set({ byTodo: next })
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
