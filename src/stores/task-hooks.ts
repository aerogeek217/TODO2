/**
 * The links from the stores of a task's entries (status updates, subtasks,
 * people and tags) to the task store, which imports them — so they can't
 * import it back. The task store subscribes / registers here once, at
 * module load.
 */

import type { StampChanges } from '../utils/task-stamps'

/** Told the stamps a write put on its tasks (each task's `modifiedAt` before → after). */
type StampListener = (stamped: StampChanges) => void

const stampListeners = new Set<StampListener>()

/**
 * Calls `listener` after each write outside the task store that stamped its
 * tasks' `modifiedAt` in the database — a status update's or subtask's add,
 * edit, check or removal, a person or tag assigned or unassigned, and their
 * undo / redo (which put a step's stamps back, `utils/task-stamps`) — not a
 * task delete's undo putting entries back, nor a duplicate's copies — so the
 * task store can keep its copies in step. Returns the unsubscribe function.
 */
export function onTasksStamped(listener: StampListener): () => void {
  stampListeners.add(listener)
  return () => { stampListeners.delete(listener) }
}

/** The stamps a write put on its tasks (its `TaskTouch.stamped`), told to the listeners once they are stored. */
export function notifyTasksStamped(stamped: StampChanges): void {
  if (stamped.size === 0) return
  for (const listener of stampListeners) listener(stamped)
}

let completeTaskHandler: ((todoId: number) => Promise<void>) | null = null
let taskOpenHandler: ((todoId: number) => boolean) | null = null

/** Registers how a task is completed (the task store's `toggleComplete`), for the offer a checklist's last check makes. */
export function registerCompleteTask(handler: (todoId: number) => Promise<void>): void {
  completeTaskHandler = handler
}

/** Completes the task `todoId` through the registered handler (nothing before the task store loads). */
export function completeTask(todoId: number): Promise<void> {
  return completeTaskHandler ? completeTaskHandler(todoId) : Promise.resolve()
}

/** Registers how to tell whether a task is open (the task store's rows), for the offer to be made only then. */
export function registerTaskOpen(handler: (todoId: number) => boolean): void {
  taskOpenHandler = handler
}

/** Whether the task `todoId` is loaded and open (false before the task store registers). */
export function isTaskOpen(todoId: number): boolean {
  return taskOpenHandler ? taskOpenHandler(todoId) : false
}
