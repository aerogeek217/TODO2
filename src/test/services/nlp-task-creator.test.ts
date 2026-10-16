import { describe, it, expect, beforeEach } from 'vitest'
import { parseTaskInput } from '../../services/nlp-task-creator'
import { resolveTags } from '../../services/nlp-resolver'
import { useTagStore } from '../../stores/tag-store'
import { db } from '../../data/database'
import type { Person } from '../../models'

const people: Person[] = [
  { id: 1, name: 'Alice Smith', initials: 'AS' },
  { id: 2, name: 'Bob Jones', initials: 'BJ' },
]

describe('parseTaskInput', () => {
  it('returns cleaned title with metadata tokens removed', () => {
    const result = parseTaskInput('Fix bug @Alice', people)
    expect(result.title).toBe('Fix bug')
  })

  it('returns resolved personIds for @name tokens', () => {
    const result = parseTaskInput('Task @Alice @Bob', people)
    expect(result.resolved.personIds).toEqual([1, 2])
  })

  it('returns empty resolved when no metadata tokens', () => {
    const result = parseTaskInput('Just a plain task', people)
    expect(result.resolved.personIds).toEqual([])
    expect(result.resolved.dueDate).toBeUndefined()
  })

  it('leaves a /word in the title', () => {
    const result = parseTaskInput('Fix bug /Backend', people)
    expect(result.title).toBe('Fix bug /Backend')
  })

  it('returns resolved tags for #tag tokens (end-to-end: fix #urgent)', () => {
    const result = parseTaskInput('fix #urgent', people)
    expect(result.title).toBe('fix')
    expect(result.resolved.tags).toEqual(['urgent'])
  })

  it('returns multiple resolved tags with other tokens', () => {
    const result = parseTaskInput('Fix #urgent @Alice #blocked', people)
    expect(result.title).toBe('Fix')
    expect(result.resolved.personIds).toEqual([1])
    expect(result.resolved.tags).toEqual(['urgent', 'blocked'])
  })

  it('returns empty tags when no # tokens', () => {
    const result = parseTaskInput('plain task @Alice', people)
    expect(result.resolved.tags).toEqual([])
  })
})

describe('NLP → tag registry end-to-end', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
    useTagStore.setState({ tags: [], assignedTagsMap: new Map() })
  })

  async function addTodo(title = 'Task'): Promise<number> {
    return (await db.todos.add({
      title, isCompleted: false,
      createdAt: new Date(), modifiedAt: new Date(), sortOrder: 1,
    })) as number
  }

  it('"fix #urgent" creates the tag (if new) and yields one todoTags join row', async () => {
    const { title, resolved } = parseTaskInput('fix #urgent', [])
    expect(title).toBe('fix')
    expect(resolved.tags).toEqual(['urgent'])

    const todoId = await addTodo('fix')
    const tagIds = await resolveTags(resolved.tags, { tagStore: useTagStore.getState() })
    for (const tagId of tagIds) await useTagStore.getState().assignTag(todoId, tagId)

    const allTags = await db.tags.toArray()
    expect(allTags).toHaveLength(1)
    expect(allTags[0]!.name).toBe('urgent')

    const joins = await db.todoTags.where('todoId').equals(todoId).toArray()
    expect(joins).toHaveLength(1)
    expect(joins[0]!.tagId).toBe(allTags[0]!.id)
  })

  it('"fix #Urgent" reuses the existing `urgent` tag via case-insensitive lookup', async () => {
    // Pre-seed: the user already created "urgent" earlier.
    const existingId = await useTagStore.getState().add('urgent')

    const { resolved } = parseTaskInput('fix #Urgent', [])
    // Parser preserves user case; the resolver does the case-insensitive lookup.
    expect(resolved.tags).toEqual(['Urgent'])

    const todoId = await addTodo('fix')
    const tagIds = await resolveTags(resolved.tags, { tagStore: useTagStore.getState() })
    expect(tagIds).toEqual([existingId])
    for (const tagId of tagIds) await useTagStore.getState().assignTag(todoId, tagId)

    const allTags = await db.tags.toArray()
    expect(allTags).toHaveLength(1) // no duplicate created
    const joins = await db.todoTags.where('todoId').equals(todoId).toArray()
    expect(joins).toHaveLength(1)
    expect(joins[0]!.tagId).toBe(existingId)
  })

  it('duplicate slugs from the same input collapse to one join row', async () => {
    const { resolved } = parseTaskInput('note #foo #Foo #FOO', [])
    // Parser dedupes first-seen lowercase, so three `#foo` variants → ['foo'].
    expect(resolved.tags).toEqual(['foo'])

    const todoId = await addTodo('note')
    const tagIds = await resolveTags(resolved.tags, { tagStore: useTagStore.getState() })
    expect(tagIds).toHaveLength(1)
    for (const tagId of tagIds) await useTagStore.getState().assignTag(todoId, tagId)

    expect(await db.tags.count()).toBe(1)
    expect(await db.todoTags.where('todoId').equals(todoId).count()).toBe(1)
  })
})
