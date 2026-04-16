import { db } from './database'
import type { TodoItem, PersistedTodoItem } from '../models'
import { startOfToday } from '../utils/date'

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

  async getSubTasks(parentId: number): Promise<PersistedTodoItem[]> {
    return db.todos.where('parentId').equals(parentId).sortBy('sortOrder') as Promise<PersistedTodoItem[]>
  },

  async getById(id: number): Promise<PersistedTodoItem | undefined> {
    return db.todos.get(id) as Promise<PersistedTodoItem | undefined>
  },

  async insert(todo: Omit<TodoItem, 'id'>): Promise<number> {
    return db.todos.add(todo as TodoItem)
  },

  async update(todo: PersistedTodoItem): Promise<void> {
    await db.todos.put({ ...todo, modifiedAt: new Date() })
  },

  async complete(id: number, completed: boolean): Promise<void> {
    await db.todos.update(id, { isCompleted: completed, modifiedAt: new Date() })
  },

  async restore(todo: PersistedTodoItem): Promise<void> {
    await db.todos.put(todo)
  },

  async restoreWithAssignments(
    todo: PersistedTodoItem,
    personIds: number[],
    tagIds: number[],
    orgIds: number[] = [],
  ): Promise<void> {
    await db.transaction('rw', [db.todos, db.todoTags, db.todoPeople, db.todoOrgs], async () => {
      await db.todos.put(todo)
      for (const personId of personIds) {
        const existing = await db.todoPeople.where({ todoId: todo.id, personId }).count()
        if (existing === 0) await db.todoPeople.add({ todoId: todo.id, personId })
      }
      for (const tagId of tagIds) {
        const existing = await db.todoTags.where({ todoId: todo.id, tagId }).count()
        if (existing === 0) await db.todoTags.add({ todoId: todo.id, tagId })
      }
      for (const orgId of orgIds) {
        const existing = await db.todoOrgs.where({ todoId: todo.id, orgId }).count()
        if (existing === 0) await db.todoOrgs.add({ todoId: todo.id, orgId })
      }
    })
  },

  async delete(id: number): Promise<void> {
    await db.transaction('rw', [db.todos, db.todoTags, db.todoPeople, db.todoOrgs, db.taskboardEntries], async () => {
      // Clear parentId on children so they don't become orphaned
      const children = await db.todos.where('parentId').equals(id).toArray()
      for (const child of children) {
        await db.todos.update(child.id!, { parentId: undefined })
      }
      await db.todoTags.where('todoId').equals(id).delete()
      await db.todoPeople.where('todoId').equals(id).delete()
      await db.todoOrgs.where('todoId').equals(id).delete()
      await db.taskboardEntries.where('todoId').equals(id).delete()
      await db.todos.delete(id)
    })
  },

  async bulkDelete(ids: number[]): Promise<void> {
    if (ids.length === 0) return
    await db.transaction('rw', [db.todos, db.todoTags, db.todoPeople, db.todoOrgs, db.taskboardEntries], async () => {
      for (const id of ids) {
        const children = await db.todos.where('parentId').equals(id).toArray()
        for (const child of children) {
          await db.todos.update(child.id!, { parentId: undefined })
        }
        await db.todoTags.where('todoId').equals(id).delete()
        await db.todoPeople.where('todoId').equals(id).delete()
        await db.todoOrgs.where('todoId').equals(id).delete()
        await db.taskboardEntries.where('todoId').equals(id).delete()
        await db.todos.delete(id)
      }
    })
  },

  async reorder(id: number, newSortOrder: number): Promise<void> {
    await db.todos.update(id, { sortOrder: newSortOrder, modifiedAt: new Date() })
  },

  async bulkUpdate(mutations: Array<{ todoId: number; changes: Partial<TodoItem> }>): Promise<void> {
    if (mutations.length === 0) return
    const now = new Date()
    await db.transaction('rw', db.todos, async () => {
      for (const { todoId, changes } of mutations) {
        await db.todos.update(todoId, { ...changes, modifiedAt: now })
      }
    })
  },
}
