import { db } from './database'
import type { TodoItem, PersistedTodoItem, TodoEvent } from '../models'
import { startOfToday } from '../utils/date'
import { encodeScheduledValue, encodeDateValue } from './todo-event-repository'
import { hasPreciseRecurrenceAnchor } from './recurrence-anchor'

/**
 * Repository-level invariant: a `recurrenceRule` is only meaningful when the
 * row has a precise anchor (`recurrenceAnchor` would return non-null). When a
 * write produces a merged row with a rule but no anchor — e.g. a bulk
 * `bulkSetScheduled` flips a recurring task to a fuzzy schedule, or a bulk
 * `bulkSetDeadline(null)` clears the only anchor — splice
 * `recurrenceRule: undefined` into the patch so the rule is dropped on disk.
 * Mirrors TaskEditPopup's silent-clear UX so every write path converges on
 * the same shape regardless of caller.
 */
function dropOrphanedRule<T extends Partial<TodoItem>>(
  merged: Pick<TodoItem, 'dueDate' | 'scheduledDate' | 'recurrenceRule'>,
  changes: T,
): T {
  if (!merged.recurrenceRule) return changes
  if (hasPreciseRecurrenceAnchor(merged)) return changes
  return { ...changes, recurrenceRule: undefined }
}

/**
 * Diff a todo write against its prior state and produce one event per
 * tracked-field change (`scheduledDate`, `dueDate`, `statusId`,
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
  if ('scheduledDate' in next) {
    const from = encodeScheduledValue(prior?.scheduledDate)
    const to = encodeScheduledValue(next.scheduledDate ?? null)
    if (from !== to) {
      out.push({ todoId, type: 'scheduled', fromValue: from, toValue: to, timestamp })
    }
  }
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

  async getByProject(projectId: number): Promise<PersistedTodoItem[]> {
    return db.todos.where('projectId').equals(projectId).sortBy('sortOrder') as Promise<PersistedTodoItem[]>
  },

  async getByCanvas(canvasId: number): Promise<PersistedTodoItem[]> {
    return db.todos.where('canvasId').equals(canvasId).sortBy('sortOrder') as Promise<PersistedTodoItem[]>
  },

  async getDueToday(): Promise<PersistedTodoItem[]> {
    const today = startOfToday()
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)
    return db.todos
      .where('dueDate')
      .between(today, tomorrow, true, false)
      .filter((t) => !t.isCompleted)
      .sortBy('priority') as Promise<PersistedTodoItem[]>
  },

  async getOverdue(): Promise<PersistedTodoItem[]> {
    const today = startOfToday()
    return db.todos
      .where('dueDate')
      .below(today)
      .filter((t) => !t.isCompleted)
      .sortBy('dueDate') as Promise<PersistedTodoItem[]>
  },

  async getById(id: number): Promise<PersistedTodoItem | undefined> {
    return db.todos.get(id) as Promise<PersistedTodoItem | undefined>
  },

  async insert(todo: Omit<TodoItem, 'id'>): Promise<number> {
    return db.transaction('rw', [db.todos, db.todoEvents], async () => {
      const id = await db.todos.add(todo as TodoItem) as number
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

  async update(todo: PersistedTodoItem): Promise<void> {
    const now = new Date()
    await db.transaction('rw', [db.todos, db.todoEvents], async () => {
      const prior = await db.todos.get(todo.id) as PersistedTodoItem | undefined
      const cleaned = dropOrphanedRule(todo, todo)
      const next = { ...cleaned, modifiedAt: now }
      const events = buildFieldChangeEvents(todo.id, prior, next, now.toISOString())
      await db.todos.put(next)
      if (events.length > 0) await db.todoEvents.bulkAdd(events as TodoEvent[])
    })
  },

  async complete(id: number, completed: boolean): Promise<void> {
    const now = new Date()
    await db.transaction('rw', [db.todos, db.todoEvents], async () => {
      const prior = await db.todos.get(id) as PersistedTodoItem | undefined
      await db.todos.update(id, { isCompleted: completed, modifiedAt: now })
      const events = buildFieldChangeEvents(id, prior, { isCompleted: completed }, now.toISOString())
      if (events.length > 0) await db.todoEvents.bulkAdd(events as TodoEvent[])
    })
  },

  async restore(todo: PersistedTodoItem): Promise<void> {
    await db.todos.put(todo)
  },

  async restoreWithAssignments(
    todo: PersistedTodoItem,
    personIds: number[],
    orgIds: number[] = [],
  ): Promise<void> {
    await db.transaction('rw', [db.todos, db.todoPeople, db.todoOrgs], async () => {
      await db.todos.put(todo)
      for (const personId of personIds) {
        const existing = await db.todoPeople.where({ todoId: todo.id, personId }).count()
        if (existing === 0) await db.todoPeople.add({ todoId: todo.id, personId })
      }
      for (const orgId of orgIds) {
        const existing = await db.todoOrgs.where({ todoId: todo.id, orgId }).count()
        if (existing === 0) await db.todoOrgs.add({ todoId: todo.id, orgId })
      }
    })
  },

  async delete(id: number): Promise<void> {
    await db.transaction('rw', [db.todos, db.todoPeople, db.todoOrgs, db.todoTags, db.todoEvents, db.taskboards], async () => {
      await db.todoPeople.where('todoId').equals(id).delete()
      await db.todoOrgs.where('todoId').equals(id).delete()
      await db.todoTags.where('todoId').equals(id).delete()
      await db.todoEvents.where('todoId').equals(id).delete()
      await stripTodoFromTaskboards([id])
      await db.todos.delete(id)
    })
  },

  async bulkDelete(ids: number[]): Promise<void> {
    if (ids.length === 0) return
    await db.transaction('rw', [db.todos, db.todoPeople, db.todoOrgs, db.todoTags, db.todoEvents, db.taskboards], async () => {
      for (const id of ids) {
        await db.todoPeople.where('todoId').equals(id).delete()
        await db.todoOrgs.where('todoId').equals(id).delete()
        await db.todoTags.where('todoId').equals(id).delete()
        await db.todoEvents.where('todoId').equals(id).delete()
        await db.todos.delete(id)
      }
      await stripTodoFromTaskboards(ids)
    })
  },

  async reorder(id: number, newSortOrder: number): Promise<void> {
    await db.todos.update(id, { sortOrder: newSortOrder, modifiedAt: new Date() })
  },

  async bulkUpdate(mutations: Array<{ todoId: number; changes: Partial<TodoItem> }>): Promise<void> {
    if (mutations.length === 0) return
    const now = new Date()
    const ts = now.toISOString()
    await db.transaction('rw', [db.todos, db.todoEvents], async () => {
      const events: Omit<TodoEvent, 'id'>[] = []
      for (const { todoId, changes } of mutations) {
        const prior = await db.todos.get(todoId) as PersistedTodoItem | undefined
        const merged = { ...prior, ...changes } as PersistedTodoItem
        const cleaned = dropOrphanedRule(merged, changes)
        await db.todos.update(todoId, { ...cleaned, modifiedAt: now })
        events.push(...buildFieldChangeEvents(todoId, prior, cleaned, ts))
      }
      if (events.length > 0) await db.todoEvents.bulkAdd(events as TodoEvent[])
    })
  },
}

/**
 * Run a callback inside a Dexie rw transaction over
 * `todos + todoPeople + todoOrgs + todoEvents`. Lets services (e.g.
 * nlp-task-creator) compose multi-table writes atomically without importing
 * `db` directly. `todoEvents` is included because nested
 * `todoRepository.update` opens its own sub-transaction that needs the
 * events table — Dexie rejects sub-transactions whose scope isn't a subset
 * of the parent.
 */
export async function runNlpMetadataTransaction<T>(fn: () => Promise<T>): Promise<T> {
  return db.transaction('rw', [db.todos, db.todoPeople, db.todoOrgs, db.todoEvents], fn)
}

// Full-scan is intentional: taskboards are inherently few (users rarely exceed
// a handful) and `entries` is an array of objects, which Dexie can't index
// directly. Adding a parallel scalar `entryTodoIds[]` index would require a
// migration + keep-in-sync discipline on every entry mutation — cost/benefit
// not worth it at current scale.
export async function stripTodoFromTaskboards(todoIds: number[]): Promise<void> {
  if (todoIds.length === 0) return
  const remove = new Set(todoIds)
  const boards = await db.taskboards.toArray()
  const now = new Date()
  for (const b of boards) {
    const filtered = b.entries.filter((e) => !remove.has(e.todoId))
    if (filtered.length !== b.entries.length) {
      await db.taskboards.update(b.id!, { entries: filtered, updatedAt: now })
    }
  }
}
