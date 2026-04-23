import { db } from './database'
import type { Tag } from '../models'
import { createRepository } from './create-repository'
import { createJoinOps, buildAssignmentMap } from './join-helpers'

const base = createRepository<Tag>(db.tags, 'name')
const todoTagOps = createJoinOps(db.todoTags, 'todoId', 'tagId')

async function findConflictingTag(name: string, excludeId?: number): Promise<Tag | undefined> {
  const target = name.trim().toLowerCase()
  if (target.length === 0) return undefined
  const all = await db.tags.toArray()
  return all.find((t) => t.name.trim().toLowerCase() === target && t.id !== excludeId)
}

export const tagRepository = {
  ...base,

  async insert(tag: Omit<Tag, 'id'>): Promise<number> {
    const conflict = await findConflictingTag(tag.name)
    if (conflict) throw new Error(`A tag named "${tag.name}" already exists`)
    return db.tags.add(tag as Tag)
  },

  async update(tag: Tag): Promise<void> {
    if (tag.id === undefined) return
    const conflict = await findConflictingTag(tag.name, tag.id)
    if (conflict) throw new Error(`A tag named "${tag.name}" already exists`)
    await db.tags.put(tag)
  },

  async delete(id: number): Promise<void> {
    await db.transaction('rw', [db.tags, db.todoTags], async () => {
      await db.todoTags.where('tagId').equals(id).delete()
      await db.tags.delete(id)
    })
  },

  async getAssignedTagsForTodos(todoIds: number[]): Promise<Map<number, Tag[]>> {
    return buildAssignmentMap(db.todoTags, db.tags, 'todoId', 'tagId', todoIds)
  },

  async getTodoCount(tagId: number): Promise<number> {
    return db.todoTags.where('tagId').equals(tagId).count()
  },

  async assignTag(todoId: number, tagId: number): Promise<void> {
    await todoTagOps.assign(todoId, tagId)
  },

  async unassignTag(todoId: number, tagId: number): Promise<void> {
    await todoTagOps.unassign(todoId, tagId)
  },
}
