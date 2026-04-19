import { db } from './database'
import type { Canvas } from '../models'

export const canvasRepository = {
  async getAll(): Promise<Canvas[]> {
    return db.canvases.orderBy('sortOrder').toArray()
  },

  async getById(id: number): Promise<Canvas | undefined> {
    return db.canvases.get(id)
  },

  async insert(canvas: Omit<Canvas, 'id'>): Promise<number> {
    return db.canvases.add(canvas as Canvas)
  },

  /** Reassign all data from duplicate canvases to the keeper, then delete duplicates. */
  async consolidate(keepId: number, removeIds: number[]): Promise<void> {
    await db.transaction(
      'rw',
      [db.canvases, db.projects, db.todos, db.listInsets, db.floatingNotes, db.floatingCalendars],
      async () => {
        for (const oldId of removeIds) {
          await db.todos.where('canvasId').equals(oldId).modify({ canvasId: keepId })
          await db.projects.where('canvasId').equals(oldId).modify({ canvasId: keepId })
          await db.listInsets.where('canvasId').equals(oldId).modify({ canvasId: keepId })
          await db.floatingNotes.where('canvasId').equals(oldId).modify({ canvasId: keepId })
          await db.floatingCalendars.where('canvasId').equals(oldId).modify({ canvasId: keepId })
          await db.canvases.delete(oldId)
        }
      },
    )
  },

  async delete(id: number): Promise<void> {
    // Cascade: delete projects, todos, floating notes/calendars, list insets belonging to this canvas
    await db.transaction(
      'rw',
      [db.canvases, db.projects, db.todos, db.todoTags, db.todoPeople, db.todoOrgs, db.taskboardEntries, db.floatingNotes, db.floatingCalendars, db.listInsets],
      async () => {
        const todoIds = await db.todos.where('canvasId').equals(id).primaryKeys()
        if (todoIds.length > 0) {
          await db.todoTags.where('todoId').anyOf(todoIds).delete()
          await db.todoPeople.where('todoId').anyOf(todoIds).delete()
          await db.todoOrgs.where('todoId').anyOf(todoIds).delete()
          await db.taskboardEntries.where('todoId').anyOf(todoIds).delete()
        }
        await db.todos.where('canvasId').equals(id).delete()
        await db.projects.where('canvasId').equals(id).delete()
        await db.floatingNotes.where('canvasId').equals(id).delete()
        await db.floatingCalendars.where('canvasId').equals(id).delete()
        await db.listInsets.where('canvasId').equals(id).delete()
        await db.canvases.delete(id)
      },
    )
  },
}
