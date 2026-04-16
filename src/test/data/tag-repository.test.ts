import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '../../data/database'
import { tagRepository } from '../../data/tag-repository'

beforeEach(async () => {
  await db.delete()
  await db.open()
})

describe('tagRepository', () => {
  it('insert and retrieve tag', async () => {
    const id = await tagRepository.insert({ name: 'urgent', color: '#ff0000' })
    const tag = await tagRepository.getById(id)
    expect(tag).toBeDefined()
    expect(tag!.name).toBe('urgent')
  })

  it('getAll sorted by name', async () => {
    await tagRepository.insert({ name: 'zzz', color: '#000' })
    await tagRepository.insert({ name: 'aaa', color: '#000' })
    await tagRepository.insert({ name: 'mmm', color: '#000' })

    const all = await tagRepository.getAll()
    expect(all.map(t => t.name)).toEqual(['aaa', 'mmm', 'zzz'])
  })

  it('update modifies fields', async () => {
    const id = await tagRepository.insert({ name: 'urgent', color: '#ff0000' })
    await tagRepository.update({ id, name: 'critical', color: '#00ff00' })
    const tag = await tagRepository.getById(id)
    expect(tag!.name).toBe('critical')
    expect(tag!.color).toBe('#00ff00')
  })

  it('delete removes tag AND todoTags join entries', async () => {
    const tagId = await tagRepository.insert({ name: 'urgent', color: '#000' })
    const todoId = (await db.todos.add({
      title: 'Task', priority: 0, isCompleted: false,
      createdAt: new Date(), modifiedAt: new Date(), sortOrder: 1,
    })) as number
    await tagRepository.addTagToTodo(todoId, tagId)

    await tagRepository.delete(tagId)
    expect(await tagRepository.getById(tagId)).toBeUndefined()
    const links = await db.todoTags.where('tagId').equals(tagId).toArray()
    expect(links).toHaveLength(0)
  })

  it('getTagsForTodo returns tags for a todo', async () => {
    const t1 = await tagRepository.insert({ name: 'urgent', color: '#000' })
    const t2 = await tagRepository.insert({ name: 'backend', color: '#000' })
    const todoId = (await db.todos.add({
      title: 'Task', priority: 0, isCompleted: false,
      createdAt: new Date(), modifiedAt: new Date(), sortOrder: 1,
    })) as number
    await tagRepository.addTagToTodo(todoId, t1)
    await tagRepository.addTagToTodo(todoId, t2)

    const tags = await tagRepository.getTagsForTodo(todoId)
    expect(tags).toHaveLength(2)
    expect(tags.map(t => t.name).sort()).toEqual(['backend', 'urgent'])
  })

  it('addTagToTodo creates link; idempotent', async () => {
    const tagId = await tagRepository.insert({ name: 'urgent', color: '#000' })
    const todoId = (await db.todos.add({
      title: 'Task', priority: 0, isCompleted: false,
      createdAt: new Date(), modifiedAt: new Date(), sortOrder: 1,
    })) as number

    await tagRepository.addTagToTodo(todoId, tagId)
    await tagRepository.addTagToTodo(todoId, tagId) // duplicate
    const links = await db.todoTags.where('todoId').equals(todoId).toArray()
    expect(links).toHaveLength(1)
  })

  it('removeTagFromTodo removes link', async () => {
    const tagId = await tagRepository.insert({ name: 'urgent', color: '#000' })
    const todoId = (await db.todos.add({
      title: 'Task', priority: 0, isCompleted: false,
      createdAt: new Date(), modifiedAt: new Date(), sortOrder: 1,
    })) as number
    await tagRepository.addTagToTodo(todoId, tagId)

    await tagRepository.removeTagFromTodo(todoId, tagId)
    const tags = await tagRepository.getTagsForTodo(todoId)
    expect(tags).toHaveLength(0)
  })

  it('removeAllTagsFromTodo clears all links', async () => {
    const t1 = await tagRepository.insert({ name: 'urgent', color: '#000' })
    const t2 = await tagRepository.insert({ name: 'backend', color: '#000' })
    const todoId = (await db.todos.add({
      title: 'Task', priority: 0, isCompleted: false,
      createdAt: new Date(), modifiedAt: new Date(), sortOrder: 1,
    })) as number
    await tagRepository.addTagToTodo(todoId, t1)
    await tagRepository.addTagToTodo(todoId, t2)

    await tagRepository.removeAllTagsFromTodo(todoId)
    const tags = await tagRepository.getTagsForTodo(todoId)
    expect(tags).toHaveLength(0)
  })
})
