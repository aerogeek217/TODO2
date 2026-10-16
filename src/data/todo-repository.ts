import { db } from './database'
import { nextSortOrder } from './create-repository'
import type { TodoItem, PersistedTodoItem, NewTodoItem, TodoEvent } from '../models'
import { encodeDateValue } from './todo-event-repository'
import { resolveCompletedAt } from '../utils/completed-at'
import { newTodoUid } from '../utils/todo-uid'

/**
 * `completedAt` bookkeeping for a write that may touch `isCompleted`:
 * returns `changes` with `completedAt` set (newly completed),
 * kept (still completed) or `undefined` (reopened — Dexie `update` deletes
 * the key; `put` callers strip it with `withoutUndefinedCompletedAt`).
 * Writes that don't mention `isCompleted` pass through untouched.
 */
function withCompletedAt<T extends Partial<TodoItem>>(
  prior: Pick<TodoItem, 'isCompleted' | 'completedAt'> | undefined,
  changes: T,
  now: Date,
): T {
  if (changes.isCompleted === undefined) return changes
  const next = { isCompleted: changes.isCompleted, completedAt: changes.completedAt }
  return { ...changes, completedAt: resolveCompletedAt(prior, next, now) }
}

/** Drops an `undefined` `completedAt` key so a `put` / `add` doesn't store it. */
function withoutUndefinedCompletedAt<T extends Partial<TodoItem>>(row: T): T {
  if (!('completedAt' in row) || row.completedAt !== undefined) return row
  const rest: Partial<TodoItem> = { ...row }
  delete rest.completedAt
  return rest as T
}

/**
 * Repository-level invariant: a `recurrenceRule` is only meaningful when the
 * row has a due date to advance from.
 * When a write produces a merged row with a rule but no anchor — e.g. a bulk
 * `bulkSetDeadline(null)` clears the due date — splice
 * `recurrenceRule: undefined` into the patch so the rule is dropped on disk.
 * Mirrors TaskEditPopup's silent-clear UX so every write path converges on
 * the same shape regardless of caller.
 */
function dropOrphanedRule<T extends Partial<TodoItem>>(
  merged: Pick<TodoItem, 'dueDate' | 'recurrenceRule'>,
  changes: T,
): T {
  if (!merged.recurrenceRule) return changes
  if (merged.dueDate != null) return changes
  return { ...changes, recurrenceRule: undefined }
}

/**
 * Diff a todo write against its prior state and produce one event per
 * tracked-field change (`dueDate`, `statusId`,
 * `isCompleted`). Idempotent — an unchanged value emits nothing.
 *
 * `prior == null` means the row didn't exist (insert path) — only the
 * `isCompleted` axis matters there because the dedicated `created` event
 * carries the row's birth.
 */
function buildFieldChangeEvents(
  todoId: number,
  prior: PersistedTodoItem | undefined,
  next: Partial<TodoItem>,
  timestamp: string,
): Omit<TodoEvent, 'id'>[] {
  const out: Omit<TodoEvent, 'id'>[] = []
  if ('dueDate' in next) {
    const from = encodeDateValue(prior?.dueDate)
    const to = encodeDateValue(next.dueDate ?? null)
    if (from !== to) {
      out.push({ todoId, type: 'deadline', fromValue: from, toValue: to, timestamp })
    }
  }
  if ('statusId' in next) {
    const from = prior?.statusId ?? null
    const to = next.statusId ?? null
    if (from !== to) {
      out.push({ todoId, type: 'status', fromValue: from, toValue: to, timestamp })
    }
  }
  if ('isCompleted' in next) {
    const from = prior?.isCompleted === true
    const to = next.isCompleted === true
    if (from !== to) {
      out.push({
        todoId,
        type: to ? 'completed' : 'reopened',
        fromValue: null,
        toValue: null,
        timestamp,
      })
    }
  }
  return out
}

export const todoRepository = {
  async getAll(): Promise<PersistedTodoItem[]> {
    return db.todos.orderBy('sortOrder').toArray() as Promise<PersistedTodoItem[]>
  },

  async getById(id: number): Promise<PersistedTodoItem | undefined> {
    return db.todos.get(id) as Promise<PersistedTodoItem | undefined>
  },

  /** The rows that exist among `ids` (missing ids are skipped). */
  async getByIds(ids: readonly number[]): Promise<PersistedTodoItem[]> {
    const rows = await db.todos.bulkGet([...ids])
    return rows.filter((t): t is PersistedTodoItem => t != null)
  },

  /** The rows whose `uid` is among `uids` (unique index — at most one each). */
  async getByUids(uids: readonly string[]): Promise<PersistedTodoItem[]> {
    if (uids.length === 0) return []
    return db.todos.where('uid').anyOf([...uids]).toArray() as Promise<PersistedTodoItem[]>
  },

  /**
   * Inserts a task. Mints a `uid` unless one is passed (only paths that keep
   * an imported task's identity pass one) and stamps `completedAt` on a row
   * inserted already completed. Without a `sortOrder` the task goes last:
   * one past the highest stored, read in the same transaction.
   */
  async insert(todo: Omit<NewTodoItem, 'sortOrder'> & { sortOrder?: number }): Promise<number> {
    return db.transaction('rw', [db.todos, db.todoEvents], async () => {
      const row: TodoItem = withoutUndefinedCompletedAt({
        ...todo,
        sortOrder: todo.sortOrder ?? await nextSortOrder(db.todos, 0),
        uid: todo.uid ?? newTodoUid(),
        completedAt: todo.isCompleted ? (todo.completedAt ?? new Date()) : undefined,
      })
      const id = await db.todos.add(row) as number
      const createdAt = todo.createdAt instanceof Date
        ? todo.createdAt.toISOString()
        : new Date().toISOString()
      await db.todoEvents.add({
        todoId: id,
        type: 'created',
        fromValue: null,
        toValue: null,
        timestamp: createdAt,
      } as TodoEvent)
      return id
    })
  },

  /**
   * Inserts several open tasks with their people and tags in one
   * transaction (all or nothing), each with its `created` event, last and in
   * input order (sort orders from one past the highest stored). Returns the
   * new ids in input order.
   */
  async insertManyWithAssignments(
    items: readonly { todo: Omit<NewTodoItem, 'sortOrder'>; personIds: readonly number[]; tagIds: readonly number[] }[],
  ): Promise<number[]> {
    return db.transaction('rw', [db.todos, db.todoEvents, db.todoPeople, db.todoTags], async () => {
      const ids: number[] = []
      let sortOrder = await nextSortOrder(db.todos, 0)
      for (const { todo, personIds, tagIds } of items) {
        const row: TodoItem = withoutUndefinedCompletedAt({ ...todo, sortOrder: sortOrder++, uid: todo.uid ?? newTodoUid(), completedAt: undefined })
        const id = await db.todos.add(row) as number
        await db.todoEvents.add({
          todoId: id,
          type: 'created',
          fromValue: null,
          toValue: null,
          timestamp: todo.createdAt.toISOString(),
        } as TodoEvent)
        for (const personId of new Set(personIds)) await db.todoPeople.add({ todoId: id, personId })
        for (const tagId of new Set(tagIds)) await db.todoTags.add({ todoId: id, tagId })
        ids.push(id)
      }
      return ids
    })
  },

  /**
   * Puts tasks back with their ids, people, tags and event history (undo of
   * a delete, redo of a create that was undone). Join rows that already
   * exist are not duplicated; events go back with their own ids (`delete` /
   * `bulkDelete` return them).
   */
  async restoreManyWithAssignments(
    items: readonly {
      todo: PersistedTodoItem
      personIds: readonly number[]
      tagIds: readonly number[]
      events?: readonly TodoEvent[]
    }[],
  ): Promise<void> {
    await db.transaction('rw', [db.todos, db.todoPeople, db.todoTags, db.todoEvents], async () => {
      for (const { todo, personIds, tagIds, events } of items) {
        await db.todos.put(todo)
        if (events && events.length > 0) await db.todoEvents.bulkPut([...events])
        for (const personId of new Set(personIds)) {
          if (await db.todoPeople.where({ todoId: todo.id, personId }).count() === 0) {
            await db.todoPeople.add({ todoId: todo.id, personId })
          }
        }
        for (const tagId of new Set(tagIds)) {
          if (await db.todoTags.where({ todoId: todo.id, tagId }).count() === 0) {
            await db.todoTags.add({ todoId: todo.id, tagId })
          }
        }
      }
    })
  },

  /**
   * Writes `changes` to one task — only those fields, so a concurrent write
   * to its other fields survives. A field set to `undefined` is removed. No-op
   * when the task doesn't exist (a save racing a delete doesn't bring it back).
   * `now` stamps `modifiedAt` (the caller's timestamp, so its copy matches).
   */
  async update(id: number, changes: Partial<TodoItem>, now: Date = new Date()): Promise<void> {
    await todoRepository.bulkUpdate([{ todoId: id, changes }], now)
  },

  /**
   * Completes / reopens a task, keeping `completedAt` in step (set on
   * completion, cleared on reopen). `completedAt` overrides the completion
   * time — undo passes the original one back when it re-completes a task.
   * `now` stamps `modifiedAt` (the caller's timestamp, so its copy matches).
   */
  async complete(id: number, completed: boolean, completedAt?: Date, now: Date = new Date()): Promise<void> {
    await db.transaction('rw', [db.todos, db.todoEvents], async () => {
      const prior = await db.todos.get(id) as PersistedTodoItem | undefined
      await db.todos.update(id, withCompletedAt(prior, { isCompleted: completed, completedAt, modifiedAt: now }, now))
      const events = buildFieldChangeEvents(id, prior, { isCompleted: completed }, now.toISOString())
      if (events.length > 0) await db.todoEvents.bulkAdd(events as TodoEvent[])
    })
  },

  /**
   * Deletes a task with its people, tags, events and list ranks. Returns the
   * deleted event rows (undo puts them back with `restoreManyWithAssignments`).
   */
  async delete(id: number): Promise<TodoEvent[]> {
    return todoRepository.bulkDelete([id])
  },

  /** `delete` for several tasks in one transaction; returns their deleted event rows. */
  async bulkDelete(ids: readonly number[]): Promise<TodoEvent[]> {
    if (ids.length === 0) return []
    return db.transaction('rw', [db.todos, db.todoPeople, db.todoTags, db.todoEvents, db.listOrders], async () => {
      const todoIds = [...ids]
      const events = await db.todoEvents.where('todoId').anyOf(todoIds).sortBy('id')
      await db.todoPeople.where('todoId').anyOf(todoIds).delete()
      await db.todoTags.where('todoId').anyOf(todoIds).delete()
      await db.todoEvents.where('todoId').anyOf(todoIds).delete()
      await db.listOrders.where('todoId').anyOf(todoIds).delete()
      await db.todos.bulkDelete(todoIds)
      return events
    })
  },

  /**
   * Writes each mutation's fields to its task in one transaction, with their
   * events. `modifiedAt` is `now` (the caller's timestamp, so its copy
   * matches), or the mutation's own `modifiedAt` when it carries one (an undo
   * putting the earlier value back).
   */
  async bulkUpdate(mutations: Array<{ todoId: number; changes: Partial<TodoItem> }>, now: Date = new Date()): Promise<void> {
    if (mutations.length === 0) return
    const ts = now.toISOString()
    await db.transaction('rw', [db.todos, db.todoEvents], async () => {
      const events: Omit<TodoEvent, 'id'>[] = []
      for (const { todoId, changes } of mutations) {
        const prior = await db.todos.get(todoId) as PersistedTodoItem | undefined
        if (!prior) continue
        const merged = { ...prior, ...changes }
        const cleaned = withCompletedAt(prior, dropOrphanedRule(merged, changes), now)
        await db.todos.update(todoId, { ...cleaned, modifiedAt: changes.modifiedAt ?? now })
        events.push(...buildFieldChangeEvents(todoId, prior, cleaned, ts))
      }
      if (events.length > 0) await db.todoEvents.bulkAdd(events as TodoEvent[])
    })
  },
}

