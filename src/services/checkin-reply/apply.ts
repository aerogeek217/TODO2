/**
 * Applies the changes the user ticked in the check-in import dialog. Every
 * write goes through the todo store, as a manual edit would (completion
 * time, task history, file-sync saves), and the whole import is one undo
 * entry with the undo snackbar: undo reopens the completed tasks and puts
 * back the old progress, notes and follow-up dates.
 */
import { useTodoStore } from '../../stores/todo-store'
import { useUndoStore } from '../../stores/undo-store'
import type { CheckinChange, CheckinReplyDiff } from './diff'

export type CheckinChangeField = CheckinChange['field']

/** A change's key in the dialog's selection. */
export function checkinChangeKey(todoId: number, field: CheckinChangeField): string {
  return `${todoId}:${field}`
}

/** The changes ticked when the dialog shows a reply (each change's `defaultSelected`). */
export function defaultCheckinSelection(diff: CheckinReplyDiff): Set<string> {
  const keys = new Set<string>()
  for (const task of diff.tasks) {
    for (const change of task.changes) {
      if (change.defaultSelected) keys.add(checkinChangeKey(task.todo.id, change.field))
    }
  }
  return keys
}

/**
 * `selection` without the changes of the tasks in `todoIds` — tasks whose
 * changes start unticked (e.g. not assigned to the person who replied).
 */
export function withoutTaskChanges(selection: ReadonlySet<string>, diff: CheckinReplyDiff, todoIds: ReadonlySet<number>): Set<string> {
  const next = new Set(selection)
  for (const task of diff.tasks) {
    if (!todoIds.has(task.todo.id)) continue
    for (const change of task.changes) next.delete(checkinChangeKey(task.todo.id, change.field))
  }
  return next
}

/** One task's ticked changes. */
export interface CheckinTaskUpdate {
  todoId: number
  /** Complete the task. */
  complete: boolean
  /** The new progress. */
  progress?: string
  /** The new notes (`''` removes them). */
  notes?: string
  /** Ticked changes on this task. */
  changeCount: number
}

/** The ticked changes, per task (tasks with none left out), in reply order. */
export function selectedCheckinUpdates(diff: CheckinReplyDiff, selected: ReadonlySet<string>): CheckinTaskUpdate[] {
  const updates: CheckinTaskUpdate[] = []
  for (const task of diff.tasks) {
    const id = task.todo.id
    const update: CheckinTaskUpdate = { todoId: id, complete: false, changeCount: 0 }
    for (const change of task.changes) {
      if (!selected.has(checkinChangeKey(id, change.field))) continue
      update.changeCount++
      if (change.field === 'completed') update.complete = true
      else if (change.field === 'progress') update.progress = change.to
      else update.notes = change.to
    }
    if (update.changeCount > 0) updates.push(update)
  }
  return updates
}

/** The undo snackbar's text after an import. */
export function checkinAppliedMessage(changeCount: number, personName: string): string {
  return `Applied ${changeCount} ${changeCount === 1 ? 'change' : 'changes'} from ${personName}`
}

/**
 * Writes `updates` as one undo entry (`Applied N changes from <name>`, with
 * the undo snackbar): completions first, then each task's progress / notes,
 * then — when `recordFollowup` — "Mark followed up" on every updated task.
 * Returns the number of changes applied. A failed write stops there; what
 * was written before it stays and is still one undo entry, named for the
 * changes that went in (N counts only those).
 */
export async function applyCheckinUpdates(
  updates: readonly CheckinTaskUpdate[],
  options: { recordFollowup: boolean; personName: string },
): Promise<number> {
  const changeCount = updates.reduce((n, u) => n + u.changeCount, 0)
  if (changeCount === 0) return 0
  // Counted as each write lands, so a failure part-way says how many went in.
  let applied = 0
  // One group (`runGroup`): ended — on a failure too — as one entry named for what went in.
  await useUndoStore.getState().runGroup(() => checkinAppliedMessage(applied, options.personName), async () => {
    const completeIds = updates.filter((u) => u.complete).map((u) => u.todoId)
    // The same path as completing tasks in the app (a repeating task moves
    // to its next due date instead).
    if (completeIds.length > 0) {
      await useTodoStore.getState().bulkSetCompleted(completeIds, true)
      applied += completeIds.length
    }

    for (const u of updates) {
      if (u.progress === undefined && u.notes === undefined) continue
      const saved = await useTodoStore.getState().update(u.todoId, {
        ...(u.progress !== undefined ? { progress: u.progress } : {}),
        ...(u.notes !== undefined ? { notes: u.notes === '' ? undefined : u.notes } : {}),
      })
      if (!saved) throw new Error(`Couldn't save the reply's changes to task ${u.todoId}`)
      applied += u.changeCount - (u.complete ? 1 : 0)
    }

    if (options.recordFollowup) await useTodoStore.getState().markFollowedUp(updates.map((u) => u.todoId))
  })
  return applied
}
