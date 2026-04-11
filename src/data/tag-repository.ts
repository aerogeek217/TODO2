import { db } from './database'
import type { Tag } from '../models'
import { createRepository } from './create-repository'
import { createJoinOps, buildAssignmentMap } from './join-helpers'

const base = createRepository<Tag>(db.tags, 'name')
const todoTagOps = createJoinOps(db.todoTags, 'todoId', 'tagId')

export const tagRepository = {
  ...base,

  async delete(id: number): Promise<void> {
    await db.transaction('rw', [db.tags, db.todoTags], async () => {
      await db.todoTags.where('tagId').equals(id).delete()
      await db.tags.delete(id)
    })
  },

  async getTagsForTodos(todoIds: number[]): Promise<Map<number, Tag[]>> {
    return buildAssignmentMap(db.todoTags, db.tags, 'todoId', 'tagId', todoIds)
  },

  async getTagsForTodo(todoId: number): Promise<Tag[]> {
    const links = await db.todoTags.where('todoId').equals(todoId).toArray()
    const tagIds = links.map((l) => l.tagId)
    if (tagIds.length === 0) return []
    return db.tags.where('id').anyOf(tagIds).toArray()
  },

  async addTagToTodo(todoId: number, tagId: number): Promise<void> {
    await todoTagOps.assign(todoId, tagId)
  },

  async removeTagFromTodo(todoId: number, tagId: number): Promise<void> {
    await todoTagOps.unassign(todoId, tagId)
  },

  async removeAllTagsFromTodo(todoId: number): Promise<void> {
    await db.todoTags.where('todoId').equals(todoId).delete()
  },

  async getTodoCountForTag(tagId: number): Promise<number> {
    return db.todoTags.where('tagId').equals(tagId).count()
  },
}
