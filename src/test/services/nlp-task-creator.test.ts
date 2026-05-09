import { describe, it, expect, beforeEach, vi } from 'vitest'
import { parseTaskInput, applyNlpMetadata } from '../../services/nlp-task-creator'
import { resolveTags } from '../../services/nlp-resolver'
import { useTagStore } from '../../stores/tag-store'
import { db } from '../../data/database'
import type { Person, Project } from '../../models'
import { makeTodo } from '../helpers'

const people: Person[] = [
  { id: 1, name: 'Alice Smith', initials: 'AS' },
  { id: 2, name: 'Bob Jones', initials: 'BJ' },
]

const projects: Project[] = [
  { id: 10, name: 'Backend', canvasId: 1, positionX: 0, positionY: 0, isCollapsed: false, sortOrder: 0, createdAt: new Date() },
  { id: 11, name: 'Frontend', canvasId: 1, positionX: 0, positionY: 0, isCollapsed: false, sortOrder: 1, createdAt: new Date() },
  { id: 12, name: 'my-proj', canvasId: 1, positionX: 0, positionY: 0, isCollapsed: false, sortOrder: 2, createdAt: new Date() },
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
    expect(result.resolved.scheduledDate).toBeUndefined()
  })

  it('resolves /project when projects provided', () => {
    const result = parseTaskInput('Fix bug /Backend', people, projects)
    expect(result.title).toBe('Fix bug')
    expect(result.resolved.projectId).toBe(10)
  })

  it('returns undefined projectId when no projects provided', () => {
    const result = parseTaskInput('Fix bug /Backend', people)
    expect(result.resolved.projectId).toBeUndefined()
  })

  it('accepts hyphens in project slugs', () => {
    const result = parseTaskInput('/my-proj do thing', people, projects)
    expect(result.title).toBe('do thing')
    expect(result.resolved.projectId).toBe(12)
  })

  it('returns resolved tags for #tag tokens (end-to-end: fix #urgent)', () => {
    const result = parseTaskInput('fix #urgent', people)
    expect(result.title).toBe('fix')
    expect(result.resolved.tags).toEqual(['urgent'])
  })

  it('returns multiple resolved tags with other tokens', () => {
    const result = parseTaskInput('Fix /Backend #urgent @Alice #blocked', people, projects)
    expect(result.title).toBe('Fix')
    expect(result.resolved.projectId).toBe(10)
    expect(result.resolved.personIds).toEqual([1])
    expect(result.resolved.tags).toEqual(['urgent', 'blocked'])
  })

  it('returns empty tags when no # tokens', () => {
    const result = parseTaskInput('plain task @Alice', people)
    expect(result.resolved.tags).toEqual([])
  })
})

describe('applyNlpMetadata', () => {
  it('calls updateTodo with scheduledDate when present', async () => {
    const todo = makeTodo({ id: 1, title: 'Test task' })
    const getTodo = vi.fn().mockReturnValue(todo)
    const updateTodo = vi.fn()
    const assignPerson = vi.fn()

    const setAt = new Date('2026-04-16')
    await applyNlpMetadata(
      1,
      {
        title: 'Test task',
        scheduledDate: { kind: 'fuzzy', token: 'tomorrow', setAt },
        personIds: [],
        orgIds: [],
        unmatchedPersons: [],
        unmatchedProjects: [],
        tags: [],
        unmatchedStatuses: [],
      },
      getTodo,
      updateTodo,
      assignPerson,
    )

    expect(updateTodo).toHaveBeenCalledOnce()
    const updated = updateTodo.mock.calls[0]![0]
    expect(updated.scheduledDate).toEqual({ kind: 'fuzzy', token: 'tomorrow', setAt })
  })

  it('applies recurrence only when the todo has a deadline', async () => {
    const deadline = new Date('2026-03-15')
    const todo = makeTodo({ id: 1, title: 'Test task', dueDate: deadline })
    const getTodo = vi.fn().mockReturnValue(todo)
    const updateTodo = vi.fn()

    await applyNlpMetadata(
      1,
      {
        title: 'Test task',
        recurrence: 'weekly',
        personIds: [],
        orgIds: [],
        unmatchedPersons: [],
        unmatchedProjects: [],
        tags: [],
        unmatchedStatuses: [],
      },
      getTodo,
      updateTodo,
      vi.fn(),
    )

    expect(updateTodo).toHaveBeenCalledOnce()
    const updated = updateTodo.mock.calls[0]![0]
    expect(updated.recurrenceRule?.type).toBe('weekly')
  })

  it('skips updateTodo when no scheduledDate/recurrence', async () => {
    const updateTodo = vi.fn()
    const assignPerson = vi.fn()

    await applyNlpMetadata(
      1,
      {
        title: 'Test task',
        personIds: [1],
        orgIds: [],
        unmatchedPersons: [],
        unmatchedProjects: [],
        tags: [],
        unmatchedStatuses: [],
      },
      vi.fn(),
      updateTodo,
      assignPerson,
    )

    expect(updateTodo).not.toHaveBeenCalled()
  })

  it('calls assignPerson for each resolved personId', async () => {
    const assignPerson = vi.fn()

    await applyNlpMetadata(
      1,
      {
        title: 'Test task',
        personIds: [1, 2],
        orgIds: [],
        unmatchedPersons: [],
        unmatchedProjects: [],
        tags: [],
        unmatchedStatuses: [],
      },
      vi.fn(),
      vi.fn(),
      assignPerson,
    )

    expect(assignPerson).toHaveBeenCalledTimes(2)
    expect(assignPerson).toHaveBeenCalledWith(1, 1)
    expect(assignPerson).toHaveBeenCalledWith(1, 2)
  })

  it('calls assignOrg for each resolved orgId via the @-mention org-fallback path', async () => {
    const assignPerson = vi.fn()
    const assignOrg = vi.fn()

    await applyNlpMetadata(
      42,
      {
        title: 'Test task',
        personIds: [],
        orgIds: [50, 51],
        unmatchedPersons: [],
        unmatchedProjects: [],
        tags: [],
        unmatchedStatuses: [],
      },
      vi.fn(),
      vi.fn(),
      assignPerson,
      assignOrg,
    )

    expect(assignPerson).not.toHaveBeenCalled()
    expect(assignOrg).toHaveBeenCalledTimes(2)
    expect(assignOrg).toHaveBeenCalledWith(42, 50)
    expect(assignOrg).toHaveBeenCalledWith(42, 51)
  })

  it('skips org assignment when assignOrg is omitted (legacy callers)', async () => {
    const assignPerson = vi.fn()

    await applyNlpMetadata(
      1,
      {
        title: 'Test task',
        personIds: [9],
        orgIds: [50],
        unmatchedPersons: [],
        unmatchedProjects: [],
        tags: [],
        unmatchedStatuses: [],
      },
      vi.fn(),
      vi.fn(),
      assignPerson,
      // assignOrg omitted on purpose — `?` parameter; the persons branch still runs.
    )

    expect(assignPerson).toHaveBeenCalledWith(1, 9)
  })

  it('assigns NLP-resolved tags through the registry', async () => {
    await db.delete()
    await db.open()
    useTagStore.setState({ tags: [], assignedTagsMap: new Map(), loading: false, error: null })

    const todoId = (await db.todos.add({
      title: 'Test task', isCompleted: false,
      createdAt: new Date(), modifiedAt: new Date(), sortOrder: 1,
    })) as number

    await applyNlpMetadata(
      todoId,
      {
        title: 'Test task',
        personIds: [],
        orgIds: [],
        unmatchedPersons: [],
        unmatchedProjects: [],
        tags: ['urgent', 'blocked'],
        unmatchedStatuses: [],
      },
      vi.fn(),
      vi.fn(),
      vi.fn(),
    )

    const tags = await db.tags.toArray()
    expect(tags.map((t) => t.name).sort()).toEqual(['blocked', 'urgent'])
    const joins = await db.todoTags.where('todoId').equals(todoId).toArray()
    expect(joins).toHaveLength(2)
  })

  it('skips the tag path entirely when resolved.tags is empty', async () => {
    await db.delete()
    await db.open()
    useTagStore.setState({ tags: [], assignedTagsMap: new Map(), loading: false, error: null })

    const todoId = (await db.todos.add({
      title: 'Test task', isCompleted: false,
      createdAt: new Date(), modifiedAt: new Date(), sortOrder: 1,
    })) as number

    await applyNlpMetadata(
      todoId,
      {
        title: 'Test task',
        personIds: [1],
        orgIds: [],
        unmatchedPersons: [],
        unmatchedProjects: [],
        tags: [],
        unmatchedStatuses: [],
      },
      vi.fn(),
      vi.fn(),
      vi.fn(),
    )

    expect(await db.tags.count()).toBe(0)
    expect(await db.todoTags.count()).toBe(0)
  })
})

describe('NLP → tag registry end-to-end', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
    useTagStore.setState({ tags: [], assignedTagsMap: new Map(), loading: false, error: null })
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
