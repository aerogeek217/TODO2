/**
 * The links from the stores of a task's entries (status updates, subtasks)
 * to the task store, which imports them — so they can't import it back.
 * The task store subscribes / registers here once, at module load.
 */

/** Told the tasks an entry write stamped, and when. */
type TouchListener = (todoIds: readonly number[], at: Date) => void

const touchListeners = new Set<TouchListener>()

/**
 * Calls `listener` after each entry write that stamped its tasks'
 * `modifiedAt` in the database (an add, edit, check or removal, and their
 * undo / redo — not a task delete's undo putting entries back, nor a
 * duplicate's copies), so the task store can keep its copies in step.
 * Returns the unsubscribe function.
 */
export function onTasksTouched(listener: TouchListener): () => void {
  touchListeners.add(listener)
  return () => { touchListeners.delete(listener) }
}

/** The stamp `at` for a write touching the tasks `todoIds`, told to the listeners once it is stored. */
export function notifyTasksTouched(todoIds: Iterable<number>, at: Date): void {
  const ids = [...new Set(todoIds)]
  if (ids.length === 0) return
  for (const listener of touchListeners) listener(ids, at)
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
