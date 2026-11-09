import type { Table } from 'dexie'
import { db, DATA_TABLES } from './database'
import { TASK_CHILD_TABLE_NAMES } from './tables'
import { nextSortOrder } from './create-repository'
import { encodeMarkerFlags, type TodoItem, type PersistedTodoItem, type NewTodoItem, type TodoEvent, type TodoEventType } from '../models'
import { assignmentEvents, encodeDateValue } from './todo-event-repository'
import { resolveCompletedAt } from '../utils/completed-at'
import { newTodoUid } from '../utils/todo-uid'
import { withOrphanedRuleDropped } from '../utils/todo-changes'
import { stampAfter, type Stamp } from '../utils/task-stamps'

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

/** The priority flags `changes` writes (a key present as `undefined` clears its flag). */
function pickMarkers(changes: Partial<TodoItem>): Pick<TodoItem, 'urgent' | 'important' | 'focus'> {
  const out: Pick<TodoItem, 'urgent' | 'important' | 'focus'> = {}
  if ('urgent' in changes) out.urgent = changes.urgent
  if ('important' in changes) out.important = changes.important
  if ('focus' in changes) out.focus = changes.focus
  return out
}

/**
 * Diff a todo write against its prior state and produce one event per
 * tracked-field change (`dueDate`, `statusId`, `isCompleted`, and — the
 * history log H3 — `nextFollowupAt`, `lastFollowupAt` and the priority
 * flags; `models/todo-event` has the encodings). Idempotent — an unchanged
 * value emits nothing.
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
  const dateField = (key: 'dueDate' | 'nextFollowupAt' | 'lastFollowupAt', type: TodoEventType) => {
    if (!(key in next)) return
    const from = encodeDateValue(prior?.[key])
    const to = encodeDateValue(next[key] ?? null)
    if (from !== to) out.push({ todoId, type, fromValue: from, toValue: to, timestamp })
  }
  dateField('dueDate', 'deadline')
  dateField('nextFollowupAt', 'followup')
  dateField('lastFollowupAt', 'followedUp')
  if ('urgent' in next || 'important' in next || 'focus' in next) {
    const from = encodeMarkerFlags(prior ?? {})
    const to = encodeMarkerFlags({ ...prior, ...pickMarkers(next) })
    if (from !== to) out.push({ todoId, type: 'marker', fromValue: from, toValue: to, timestamp })
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

  /** The ids among `ids` that exist (keys only, in stored order). */
  async existingIds(ids: readonly number[]): Promise<number[]> {
    if (ids.length === 0) return []
    return db.todos.where(':id').anyOf([...ids]).primaryKeys()
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
   * transaction (all or nothing), each with its `created` event (and a
   * `person` / `tag` add for each of its people and tags, at the same
   * time), last and in
   * input order (sort orders from one past the highest stored). Returns the
   * stored rows, with their new ids, in input order — so a caller needs no
   * second read (which could fail after the tasks already exist).
   */
  async insertManyWithAssignments(
    items: readonly { todo: Omit<NewTodoItem, 'sortOrder'>; personIds: readonly number[]; tagIds: readonly number[] }[],
  ): Promise<PersistedTodoItem[]> {
    return db.transaction('rw', [db.todos, db.todoEvents, db.todoPeople, db.todoTags], async () => {
      const rows: PersistedTodoItem[] = []
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
        // The task's first people and tags, logged as added when it was created.
        const created = todo.createdAt.toISOString()
        const added = [
          ...assignmentEvents('person', [...new Set(personIds)].map((personId) => ({ todoId: id, id: personId })), 'add', created),
          ...assignmentEvents('tag', [...new Set(tagIds)].map((tagId) => ({ todoId: id, id: tagId })), 'add', created),
        ]
        if (added.length > 0) await db.todoEvents.bulkAdd(added as TodoEvent[])
        rows.push({ ...row, id })
      }
      return rows
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
   * `stamp` sets `modifiedAt` as `bulkUpdate`'s does.
   */
  async update(id: number, changes: Partial<TodoItem>, stamp: Stamp = new Date()): Promise<void> {
    await todoRepository.bulkUpdate([{ todoId: id, changes }], stamp)
  },

  /**
   * Completes / reopens a task, keeping `completedAt` in step (set on
   * completion, cleared on reopen). `completedAt` overrides the completion
   * time — undo passes the original one back when it re-completes a task.
   * `stamp` sets `modifiedAt` as `bulkUpdate`'s does.
   */
  async complete(id: number, completed: boolean, completedAt?: Date, stamp: Stamp = new Date()): Promise<void> {
    const now = stamp instanceof Date ? stamp : new Date()
    await db.transaction('rw', [db.todos, db.todoEvents], async () => {
      const prior = await db.todos.get(id) as PersistedTodoItem | undefined
      // Deleted meanwhile: no row to change, and no event (as `bulkUpdate`).
      if (!prior) return
      const modifiedAt = stampAfter(stamp, id, prior.modifiedAt)
      await db.todos.update(id, withCompletedAt(prior, { isCompleted: completed, completedAt, modifiedAt }, now))
      const events = buildFieldChangeEvents(id, prior, { isCompleted: completed }, now.toISOString())
      if (events.length > 0) await db.todoEvents.bulkAdd(events as TodoEvent[])
    })
  },

  /**
   * Deletes a task with its own rows — people, tags, events, list ranks,
   * status updates and subtasks (`TASK_CHILD_TABLE_NAMES`). Returns the
   * deleted event rows (undo puts them back with
   * `restoreManyWithAssignments`; the ranks, status updates and subtasks,
   * read before, go back through their own repositories).
   */
  async delete(id: number): Promise<TodoEvent[]> {
    return todoRepository.bulkDelete([id])
  },

  /** `delete` for several tasks in one transaction; returns their deleted event rows. */
  async bulkDelete(ids: readonly number[]): Promise<TodoEvent[]> {
    if (ids.length === 0) return []
    const children = TASK_CHILD_TABLE_NAMES.map((name) => DATA_TABLES[name] as Table)
    return db.transaction('rw', [db.todos, ...children], async () => {
      const todoIds = [...ids]
      const events = await db.todoEvents.where('todoId').anyOf(todoIds).sortBy('id')
      for (const table of children) await table.where('todoId').anyOf(todoIds).delete()
      await db.todos.bulkDelete(todoIds)
      return events
    })
  },

  /**
   * Writes each mutation's fields to its task in one transaction, with their
   * events. `stamp` sets `modifiedAt` (`utils/task-stamps`): a `Date` — the
   * caller's timestamp, so its copy matches — on every task; an undo / redo's
   * `StampChanges` — a step's stamps put back, each only where the task
   * still holds the one the other left (events and a completion time then
   * take the time of the write).
   */
  async bulkUpdate(mutations: Array<{ todoId: number; changes: Partial<TodoItem> }>, stamp: Stamp = new Date()): Promise<void> {
    if (mutations.length === 0) return
    const now = stamp instanceof Date ? stamp : new Date()
    const ts = now.toISOString()
    await db.transaction('rw', [db.todos, db.todoEvents], async () => {
      const events: Omit<TodoEvent, 'id'>[] = []
      for (const { todoId, changes } of mutations) {
        const prior = await db.todos.get(todoId) as PersistedTodoItem | undefined
        if (!prior) continue
        const merged = { ...prior, ...changes }
        // A rule left without a due date to advance from goes (the stores mirror it).
        const cleaned = withCompletedAt(prior, withOrphanedRuleDropped(merged, changes), now)
        await db.todos.update(todoId, { ...cleaned, modifiedAt: stampAfter(stamp, todoId, prior.modifiedAt) })
        events.push(...buildFieldChangeEvents(todoId, prior, cleaned, ts))
      }
      if (events.length > 0) await db.todoEvents.bulkAdd(events as TodoEvent[])
    })
  },
}

