import { create } from 'zustand'
import { subtaskRepository, type SubtaskPatch } from '../data/subtask-repository'
import type { PersistedSubtask, Subtask } from '../models/subtask'
import { compareSubtasks, nextSubtaskOrder, subtaskTitle } from '../utils/subtasks'
import { shortTitle as short } from '../utils/text'
import { saveOrReport, trackWrite } from './store-helpers'
import { completeTask, isTaskOpen, notifyTasksTouched } from './task-hooks'
import { taskChildRows } from './task-child-rows'
import { guardTasks } from './task-undo-guard'
import { undoable } from './undoable'

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
  /** Adds a subtask last on a task's checklist (undo removes it), done when `done` (a converted task's state). Resolves it, or undefined when nothing was written. */
  add: (todoId: number, title: string, opts?: { done?: boolean }) => Promise<PersistedSubtask | undefined>
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
   * a new task's drafts (the task's create step covers them). Each title is
   * stored as `add` stores it (`subtaskTitle`); a row left with none is not
   * written. Resolves the rows written.
   */
  addRows: (rows: readonly Subtask[]) => Promise<PersistedSubtask[]>
  /** Puts deleted rows back (undo), those whose task still exists. */
  restoreRows: (rows: readonly PersistedSubtask[]) => Promise<void>
  /** Drops deleted tasks' checklists from memory (the repository deletes the rows). */
  forgetTodos: (todoIds: readonly number[]) => void
}

export const useSubtaskStore = create<SubtaskState>((set, get) => {
  const { find, put, putBack, take, actions } = taskChildRows<Subtask, PersistedSubtask>({
    repository: subtaskRepository,
    compare: compareSubtasks,
    normalize: (r) => {
      const title = subtaskTitle(r.title)
      return title === '' ? null : { ...r, title }
    },
    label: 'the subtasks',
    get,
    set,
  })

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
    put(next)
    notifyTasksTouched(touched, at)
    return written
  }

  /** The patches that put each row of `rows` back to its own values of `fields`. */
  const revert = (rows: readonly PersistedSubtask[], fields: readonly (keyof SubtaskPatch['changes'])[]): SubtaskPatch[] =>
    rows.map((r) => ({ id: r.id, changes: Object.fromEntries(fields.map((f) => [f, r[f]])) }))

  /** An edit as one undo step: `patches` now, `before` on undo. False when nothing was written. */
  const editAsStep = (description: string, patches: readonly SubtaskPatch[], before: readonly SubtaskPatch[], label: string, snackbar = false): Promise<boolean> =>
    saveOrReport(async () => {
      // The tasks the edit touches: each row's, and a move's target.
      const tasks = patches.flatMap((p) => [find(p.id)?.todoId ?? [], p.changes.todoId ?? []].flat())
      const written = await write(patches)
      if (written === 0) return false
      undoable(
        description,
        guardTasks(tasks, async () => { await trackWrite(() => write(patches)) }),
        guardTasks(tasks, async () => { await trackWrite(() => write(before)) }),
        snackbar,
      )
      return true
    }, false, label)

  return {
    byTodo: new Map(),
    loaded: false,

    ...actions,

    async add(todoId, title, opts = {}) {
      const clean = subtaskTitle(title)
      if (clean === '') return undefined
      const row: Subtask = {
        todoId,
        title: clean,
        isCompleted: opts.done === true,
        sortOrder: nextSubtaskOrder(get().byTodo.get(todoId) ?? NO_SUBTASKS),
        createdAt: new Date(),
      }
      return saveOrReport(async () => {
        const at = new Date()
        const added = await subtaskRepository.add(row, at)
        if (!added) return undefined
        put([added])
        notifyTasksTouched([todoId], at)
        undoable(
          `Add subtask “${short(clean)}”`,
          guardTasks([todoId], async () => { await trackWrite(() => putBack([added], true)) }),
          guardTasks([todoId], () => trackWrite(() => take([added.id]))),
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
      // The check that finishes an open task's checklist: the snackbar offers to complete the task.
      const last = done && isTaskOpen(prev.todoId) && siblings.every((s) => s.id === id || s.isCompleted)
      const description = done ? `Check “${short(prev.title)}”` : `Uncheck “${short(prev.title)}”`
      return saveOrReport(async () => {
        const written = await write([{ id, changes: { isCompleted: done } }])
        if (written === 0) return false
        undoable(
          description,
          guardTasks([prev.todoId], async () => { await trackWrite(() => write([{ id, changes: { isCompleted: done } }])) }),
          guardTasks([prev.todoId], async () => { await trackWrite(() => write([{ id, changes: { isCompleted: prev.isCompleted } }])) }),
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
          guardTasks([row.todoId], () => trackWrite(() => take([id]))),
          guardTasks([row.todoId], async () => { await trackWrite(() => putBack([row], true)) }),
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
  }
})

/** A task's checklist, in order, kept current (an empty list when it has none). */
export function useSubtasks(todoId: number | undefined): readonly PersistedSubtask[] {
  return useSubtaskStore((s) => (todoId != null ? s.byTodo.get(todoId) : undefined) ?? NO_SUBTASKS)
}
