import { create } from 'zustand'
import { subtaskRepository, type SubtaskPatch } from '../data/subtask-repository'
import type { PersistedSubtask, Subtask } from '../models/subtask'
import { compareSubtasks, nextSubtaskOrder, subtaskTitle } from '../utils/subtasks'
import { registerModuleReset } from '../utils/module-reset'
import { loadFresh, trackWrite } from './store-helpers'
import { completeTask, notifyTasksTouched } from './task-hooks'
import { undoable } from './undoable'
import { useUndoStore } from './undo-store'

const NO_SUBTASKS: readonly PersistedSubtask[] = []

type ByTodo = ReadonlyMap<number, readonly PersistedSubtask[]>

/**
 * Every task's checklist (`subtasks`), loaded once, each task's in order
 * (`compareSubtasks`). Every write saves at once, is its own undo step and
 * counts as activity on its task: it stamps the task's `modifiedAt` (the
 * task store follows through `onTasksTouched`). A write never rejects: a
 * failure is logged, the snackbar says so, and it resolves as "nothing
 * written". A title is stored as one trimmed line (`subtaskTitle`) — a
 * blank one is refused (no write).
 *
 * Checking the last open subtask of an open task offers to complete the
 * task from the undo snackbar (an action button; never automatic).
 */
interface SubtaskState {
  /** Task id → its checklist, in order. */
  byTodo: ByTodo
  loaded: boolean

  load: () => Promise<void>
  ensureLoaded: () => Promise<void>
  /** Adds a subtask last on a task's checklist (undo removes it). Resolves it, or undefined when nothing was written. */
  add: (todoId: number, title: string) => Promise<PersistedSubtask | undefined>
  /** Renames a subtask (undo puts the title back). False when nothing was written. */
  rename: (id: number, title: string) => Promise<boolean>
  /** Checks (`true`) or unchecks a subtask. False when nothing was written. */
  setDone: (id: number, done: boolean) => Promise<boolean>
  /** Moves a subtask to `index` (0-based) in its task's checklist. False when nothing moved. */
  move: (id: number, index: number) => Promise<boolean>
  /** Moves a subtask to the end of another task's checklist (undo puts it back where it was). */
  moveToTask: (id: number, todoId: number) => Promise<boolean>
  /** Removes a subtask, with the undo snackbar ("Subtask removed"). False when nothing was removed. */
  remove: (id: number) => Promise<boolean>
  /**
   * Unchecks every subtask of a task — a recurring task's completion rolled
   * its due date, the checklist starts over. Its undo entry has no snackbar
   * (the caller's group names the step).
   */
  resetDone: (todoId: number) => Promise<void>
  /**
   * Writes whole rows with no undo step of their own — a duplicate's copies,
   * a new task's drafts (the task's create step covers them). Resolves the
   * rows written.
   */
  addRows: (rows: readonly Subtask[]) => Promise<PersistedSubtask[]>
  /** Puts deleted rows back (undo), those whose task still exists. */
  restoreRows: (rows: readonly PersistedSubtask[]) => Promise<void>
  /** Drops deleted tasks' checklists from memory (the repository deletes the rows). */
  forgetTodos: (todoIds: readonly number[]) => void
}

/** `byTodo` with `rows` added (or replaced, by id) — each task touched sorted again. */
function withRows(byTodo: ByTodo, rows: readonly PersistedSubtask[]): Map<number, readonly PersistedSubtask[]> {
  const next = new Map(byTodo)
  const ids = new Set(rows.map((r) => r.id))
  // A row moved to another task leaves its old one.
  for (const [todoId, list] of byTodo) {
    if (!list.some((r) => ids.has(r.id))) continue
    const kept = list.filter((r) => !ids.has(r.id))
    if (kept.length > 0) next.set(todoId, kept)
    else next.delete(todoId)
  }
  for (const todoId of new Set(rows.map((r) => r.todoId))) {
    const kept = next.get(todoId) ?? NO_SUBTASKS
    next.set(todoId, [...kept, ...rows.filter((r) => r.todoId === todoId)].sort(compareSubtasks))
  }
  return next
}

/** `byTodo` without the subtasks `ids`. */
function withoutRows(byTodo: ByTodo, ids: ReadonlySet<number>): Map<number, readonly PersistedSubtask[]> {
  const next = new Map(byTodo)
  for (const [todoId, rows] of byTodo) {
    if (!rows.some((r) => ids.has(r.id))) continue
    const kept = rows.filter((r) => !ids.has(r.id))
    if (kept.length > 0) next.set(todoId, kept)
    else next.delete(todoId)
  }
  return next
}

let inflight: Promise<void> | null = null

/** Forgets the load in flight, for tests that share one module instance (the store's state is reset separately). */
export function resetSubtaskLoad(): void {
  inflight = null
}
registerModuleReset(resetSubtaskLoad)

/** Runs a write; on failure logs it, tells the user and resolves `fallback`. */
async function saveOrReport<T>(write: () => Promise<T>, fallback: T, label: string): Promise<T> {
  try {
    return await trackWrite(write)
  } catch (e) {
    console.error(`Failed to ${label}:`, e)
    useUndoStore.getState().notify(`Couldn't ${label}.`)
    return fallback
  }
}

/** Shortens a title for an undo entry's name. */
function short(title: string): string {
  return title.length > 40 ? `${title.slice(0, 39)}…` : title
}

export const useSubtaskStore = create<SubtaskState>((set, get) => {
  const find = (id: number): PersistedSubtask | undefined => {
    for (const rows of get().byTodo.values()) {
      const hit = rows.find((r) => r.id === id)
      if (hit) return hit
    }
    return undefined
  }

  /** Puts `rows` back in the database and the store; `touch`: stamp their tasks (an undo / redo of a write). */
  const putBack = async (rows: readonly PersistedSubtask[], touch: boolean): Promise<PersistedSubtask[]> => {
    const at = new Date()
    const restored = await subtaskRepository.restore(rows, touch ? at : undefined)
    if (restored.length > 0) set({ byTodo: withRows(get().byTodo, restored) })
    if (touch) notifyTasksTouched(restored.map((r) => r.todoId), at)
    return restored
  }

  /** Deletes the subtasks `ids` from the database and the store, stamping their tasks. */
  const take = async (ids: readonly number[]): Promise<void> => {
    const idSet = new Set(ids)
    const rows = [...get().byTodo.values()].flatMap((list) => list.filter((r) => idSet.has(r.id)))
    const at = new Date()
    await subtaskRepository.deleteMany(ids, at)
    set({ byTodo: withoutRows(get().byTodo, idSet) })
    notifyTasksTouched(rows.map((r) => r.todoId), at)
  }

  /**
   * Writes `patches` to the database and the store, stamping every task
   * touched (a move: the one left and the one joined). Resolves how many
   * rows were written.
   */
  const write = async (patches: readonly SubtaskPatch[]): Promise<number> => {
    const at = new Date()
    const written = await subtaskRepository.updateMany(patches, at)
    if (written === 0) return 0
    const touched: number[] = []
    const next = patches.flatMap((p) => {
      const current = find(p.id)
      if (!current) return []
      touched.push(current.todoId)
      if (p.changes.todoId != null) touched.push(p.changes.todoId)
      return [{ ...current, ...p.changes }]
    })
    set({ byTodo: withRows(get().byTodo, next) })
    notifyTasksTouched(touched, at)
    return written
  }

  /** The patches that put each row of `rows` back to its own values of `fields`. */
  const revert = (rows: readonly PersistedSubtask[], fields: readonly (keyof SubtaskPatch['changes'])[]): SubtaskPatch[] =>
    rows.map((r) => ({ id: r.id, changes: Object.fromEntries(fields.map((f) => [f, r[f]])) }))

  /** An edit as one undo step: `patches` now, `before` on undo. False when nothing was written. */
  const editAsStep = (description: string, patches: readonly SubtaskPatch[], before: readonly SubtaskPatch[], label: string, snackbar = false): Promise<boolean> =>
    saveOrReport(async () => {
      const written = await write(patches)
      if (written === 0) return false
      undoable(
        description,
        async () => { await trackWrite(() => write(patches)) },
        async () => { await trackWrite(() => write(before)) },
        snackbar,
      )
      return true
    }, false, label)

  return {
    byTodo: new Map(),
    loaded: false,

    async load() {
      // Never rejects (a refresh of every store waits on it): a failed read is reported, the checklists kept.
      const rows = await loadFresh(() => subtaskRepository.getAll(), 'the subtasks')
      if (rows) set({ byTodo: withRows(new Map(), rows), loaded: true })
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

    async add(todoId, title) {
      const clean = subtaskTitle(title)
      if (clean === '') return undefined
      const row: Subtask = {
        todoId,
        title: clean,
        isCompleted: false,
        sortOrder: nextSubtaskOrder(get().byTodo.get(todoId) ?? NO_SUBTASKS),
        createdAt: new Date(),
      }
      return saveOrReport(async () => {
        const at = new Date()
        const added = await subtaskRepository.add(row, at)
        if (!added) return undefined
        set({ byTodo: withRows(get().byTodo, [added]) })
        notifyTasksTouched([todoId], at)
        undoable(
          `Add subtask “${short(clean)}”`,
          async () => { await trackWrite(() => putBack([added], true)) },
          () => trackWrite(() => take([added.id])),
        )
        return added
      }, undefined, 'add the subtask')
    },

    async rename(id, title) {
      const prev = find(id)
      if (!prev) return false
      const clean = subtaskTitle(title)
      if (clean === '' || clean === prev.title) return false
      return editAsStep(
        `Rename subtask “${short(prev.title)}”`,
        [{ id, changes: { title: clean } }],
        [{ id, changes: { title: prev.title } }],
        'rename the subtask',
      )
    },

    async setDone(id, done) {
      const prev = find(id)
      if (!prev || prev.isCompleted === done) return false
      const siblings = get().byTodo.get(prev.todoId) ?? NO_SUBTASKS
      // The check that finishes the checklist: the snackbar offers to complete the task.
      const last = done && siblings.every((s) => s.id === id || s.isCompleted)
      const description = done ? `Check “${short(prev.title)}”` : `Uncheck “${short(prev.title)}”`
      return saveOrReport(async () => {
        const written = await write([{ id, changes: { isCompleted: done } }])
        if (written === 0) return false
        undoable(
          description,
          async () => { await trackWrite(() => write([{ id, changes: { isCompleted: done } }])) },
          async () => { await trackWrite(() => write([{ id, changes: { isCompleted: prev.isCompleted } }])) },
          last,
          last ? `All ${siblings.length === 1 ? 'its subtasks are' : `${siblings.length} subtasks are`} done` : undefined,
          last ? { label: 'Complete task', run: () => { void completeTask(prev.todoId) } } : undefined,
        )
        return true
      }, false, done ? 'check the subtask' : 'uncheck the subtask')
    },

    async move(id, index) {
      const row = find(id)
      if (!row) return false
      const list = get().byTodo.get(row.todoId) ?? NO_SUBTASKS
      const from = list.findIndex((r) => r.id === id)
      const to = Math.max(0, Math.min(index, list.length - 1))
      if (from === -1 || from === to) return false
      const reordered = [...list]
      reordered.splice(from, 1)
      reordered.splice(to, 0, row)
      // Every row whose place changed takes its index as its order.
      const changed = reordered.flatMap((r, i) => (r.sortOrder === i ? [] : [{ r, i }]))
      if (changed.length === 0) return false
      return editAsStep(
        `Move subtask “${short(row.title)}”`,
        changed.map(({ r, i }) => ({ id: r.id, changes: { sortOrder: i } })),
        revert(changed.map(({ r }) => r), ['sortOrder']),
        'move the subtask',
      )
    },

    async moveToTask(id, todoId) {
      const row = find(id)
      if (!row || row.todoId === todoId) return false
      const sortOrder = nextSubtaskOrder(get().byTodo.get(todoId) ?? NO_SUBTASKS)
      return editAsStep(
        `Move subtask “${short(row.title)}” to another task`,
        [{ id, changes: { todoId, sortOrder } }],
        [{ id, changes: { todoId: row.todoId, sortOrder: row.sortOrder } }],
        'move the subtask',
      )
    },

    async remove(id) {
      const row = find(id)
      if (!row) return false
      return saveOrReport(async () => {
        await take([id])
        undoable(
          'Subtask removed',
          () => trackWrite(() => take([id])),
          async () => { await trackWrite(() => putBack([row], true)) },
          true,
        )
        return true
      }, false, 'remove the subtask')
    },

    async resetDone(todoId) {
      const done = (get().byTodo.get(todoId) ?? NO_SUBTASKS).filter((r) => r.isCompleted)
      if (done.length === 0) return
      await editAsStep(
        'Uncheck the subtasks',
        done.map((r) => ({ id: r.id, changes: { isCompleted: false } })),
        revert(done, ['isCompleted']),
        'uncheck the subtasks',
      )
    },

    async addRows(rows) {
      if (rows.length === 0) return []
      return trackWrite(async () => {
        const added = await subtaskRepository.addMany(rows)
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

/** A task's checklist, in order, kept current (an empty list when it has none). */
export function useSubtasks(todoId: number | undefined): readonly PersistedSubtask[] {
  return useSubtaskStore((s) => (todoId != null ? s.byTodo.get(todoId) : undefined) ?? NO_SUBTASKS)
}
