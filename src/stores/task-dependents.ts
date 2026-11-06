import type { PersistedListOrder, PersistedStatusUpdate, PersistedSubtask } from '../models'
import { listOrderRepository } from '../data/list-order-repository'
import { statusUpdateRepository } from '../data/status-update-repository'
import { subtaskRepository } from '../data/subtask-repository'
import { useListOrderStore } from './list-order-store'
import { usePersonStore } from './person-store'
import { useTagStore } from './tag-store'
import { useStatusUpdateStore } from './status-update-store'
import { useSubtaskStore } from './subtask-store'
import { captureAssignmentsBulk, type CapturedAssignments } from './store-helpers'

/**
 * A task's rows in other tables that a delete takes with it and its undo
 * brings back — people and tags, list ranks, status updates, subtasks (the
 * events come back from the delete itself, `todoRepository.bulkDelete`).
 * The one place every "a task goes / comes back" path in `todo-store`
 * reads, forgets and restores them: a new kind of row is added here.
 */
export interface TaskDependents {
  /** Task id → its people and tags. */
  assignments: ReadonlyMap<number, CapturedAssignments>
  ranks: readonly PersistedListOrder[]
  updates: readonly PersistedStatusUpdate[]
  subtasks: readonly PersistedSubtask[]
}

/** Reads the tasks' dependent rows as they are now (before a delete). */
export async function captureDependents(todoIds: readonly number[]): Promise<TaskDependents> {
  const ids = [...todoIds]
  const [assignments, ranks, updates, subtasks] = await Promise.all([
    captureAssignmentsBulk(ids),
    listOrderRepository.getByTodos(ids),
    statusUpdateRepository.getByTodos(ids),
    subtaskRepository.getByTodos(ids),
  ])
  return {
    assignments: new Map(assignments.map(({ todoId, personIds, tagIds }) => [todoId, { personIds, tagIds }])),
    ranks,
    updates,
    subtasks,
  }
}

/**
 * Drops deleted tasks' dependent rows from the stores (the repository
 * deleted them) — their assignment entries too, so putting a task back reads
 * its people and tags again.
 */
export function forgetDependents(todoIds: readonly number[]): void {
  usePersonStore.getState().forgetAssignments(todoIds)
  useTagStore.getState().forgetAssignments(todoIds)
  useListOrderStore.getState().forgetTodos(todoIds)
  useStatusUpdateStore.getState().forgetTodos(todoIds)
  useSubtaskStore.getState().forgetTodos(todoIds)
}

/**
 * Puts captured rows back once their tasks are back (people and tags go
 * back with the task rows, `restoreManyWithAssignments`).
 */
export async function restoreDependents(dependents: TaskDependents): Promise<void> {
  await useListOrderStore.getState().restoreRows(dependents.ranks)
  await useStatusUpdateStore.getState().restoreRows(dependents.updates)
  await useSubtaskStore.getState().restoreRows(dependents.subtasks)
}
