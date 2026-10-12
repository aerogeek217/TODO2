import { describe, it, expect, beforeEach, vi } from 'vitest'
import { parseTaskInput, applyNlpMetadata } from '../../services/nlp-task-creator'
import { resolveTags } from '../../services/nlp-resolver'
import { useTagStore } from '../../stores/tag-store'
import { usePersonStore } from '../../stores/person-store'
import { db } from '../../data/database'
import type { Person } from '../../models'
import { makeTodo } from '../helpers'

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

describe('applyNlpMetadata', () => {
  it('calls updateTodo with the due date when present', async () => {
    const todo = makeTodo({ id: 1, title: 'Test task' })
    const getTodo = vi.fn().mockReturnValue(todo)
    const updateTodo = vi.fn()
    const assignPerson = vi.fn()

    const due = new Date(2026, 3, 17)
    await applyNlpMetadata(
      1,
      {
        title: 'Test task',
        dueDate: due,
        personIds: [],
        unmatchedPersons: [],
        tags: [],
        unmatchedStatuses: [],
      },
      getTodo,
      updateTodo,
      assignPerson,
    )

    expect(updateTodo).toHaveBeenCalledOnce()
    const updated = updateTodo.mock.calls[0]![0]
    expect(updated.dueDate).toEqual(due)
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
        unmatchedPersons: [],
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

  it('skips updateTodo when no due date / recurrence / status', async () => {
    const updateTodo = vi.fn()
    const assignPerson = vi.fn()

    await applyNlpMetadata(
      1,
      {
        title: 'Test task',
        personIds: [1],
        unmatchedPersons: [],
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
        unmatchedPersons: [],
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
        unmatchedPersons: [],
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
        unmatchedPersons: [],
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

describe('applyNlpMetadata — @name that matches nobody', () => {
  async function setup() {
    await db.delete()
    await db.open()
    usePersonStore.setState({ people: [], assignedPeopleMap: new Map(), loading: false, error: null })
    return (await db.todos.add({
      title: 'Call legal', isCompleted: false,
      createdAt: new Date(), modifiedAt: new Date(), sortOrder: 1,
    })) as number
  }

  it('creates the person on submit and assigns it, alongside matched people', async () => {
    const todoId = await setup()
    const dana = await usePersonStore.getState().add('Dana Kim', 'DK')
    const { resolved } = parseTaskInput('Call legal @Dana @"Marco Rossi"', usePersonStore.getState().people)
    expect(resolved.unmatchedPersons).toEqual(['Marco Rossi'])

    await applyNlpMetadata(todoId, resolved, vi.fn(), vi.fn(), usePersonStore.getState().assignPerson)

    const marco = (await db.people.toArray()).find((p) => p.name === 'Marco Rossi')
    expect(marco).toMatchObject({ name: 'Marco Rossi', initials: 'MR' })
    expect(marco?.color).toBeUndefined()
    const joins = await db.todoPeople.where('todoId').equals(todoId).toArray()
    expect(joins.map((j) => j.personId).sort()).toEqual([dana, marco!.id].sort())
    expect(usePersonStore.getState().assignedPeopleMap.get(todoId)?.map((p) => p.name).sort())
      .toEqual(['Dana Kim', 'Marco Rossi'])
  })

  it('reuses a person added since the input was parsed (case-insensitive)', async () => {
    const todoId = await setup()
    const { resolved } = parseTaskInput('Call legal @marco', [])
    const marco = await usePersonStore.getState().add('Marco', 'M')

    await applyNlpMetadata(todoId, resolved, vi.fn(), vi.fn(), usePersonStore.getState().assignPerson)

    expect(await db.people.count()).toBe(1)
    const joins = await db.todoPeople.where('todoId').equals(todoId).toArray()
    expect(joins.map((j) => j.personId)).toEqual([marco])
  })

  it('one person for the same new name typed twice in different case', async () => {
    const todoId = await setup()
    const { resolved } = parseTaskInput('Call @Marco and @MARCO', [])

    await applyNlpMetadata(todoId, resolved, vi.fn(), vi.fn(), usePersonStore.getState().assignPerson)

    expect(await db.people.count()).toBe(1)
    expect(await db.todoPeople.where('todoId').equals(todoId).count()).toBe(1)
  })
})

describe('applyNlpMetadata — slash commands', () => {
  const base = { title: 'Task', personIds: [], unmatchedPersons: [], tags: [], unmatchedStatuses: [] }

  it('sets the marker flags from /urgent /important /focus', async () => {
    const todo = makeTodo({ id: 1, title: 'Task' })
    const updateTodo = vi.fn()
    await applyNlpMetadata(1, { ...base, urgent: true, important: true, focus: true }, () => todo, updateTodo, vi.fn())
    expect(updateTodo).toHaveBeenCalledOnce()
    expect(updateTodo.mock.calls[0]![0]).toMatchObject({ urgent: true, important: true, focus: true })
  })

  it('/followup replaces the default next follow-up', async () => {
    const todo = makeTodo({ id: 1, title: 'Task', nextFollowupAt: new Date(2026, 10, 10) })
    const updateTodo = vi.fn()
    const next = new Date(2026, 9, 24)
    await applyNlpMetadata(1, { ...base, nextFollowupAt: next }, () => todo, updateTodo, vi.fn())
    expect(updateTodo.mock.calls[0]![0].nextFollowupAt).toEqual(next)
  })

  it('/followup none clears the default next follow-up', async () => {
    const todo = makeTodo({ id: 1, title: 'Task', nextFollowupAt: new Date(2026, 10, 10) })
    const updateTodo = vi.fn()
    await applyNlpMetadata(1, { ...base, followupNone: true }, () => todo, updateTodo, vi.fn())
    expect(updateTodo.mock.calls[0]![0].nextFollowupAt).toBeUndefined()
  })

  it('without /followup the default next follow-up is kept', async () => {
    const todo = makeTodo({ id: 1, title: 'Task', nextFollowupAt: new Date(2026, 10, 10) })
    const updateTodo = vi.fn()
    await applyNlpMetadata(1, { ...base, urgent: true }, () => todo, updateTodo, vi.fn())
    expect(updateTodo.mock.calls[0]![0].nextFollowupAt).toEqual(new Date(2026, 10, 10))
  })

  it('/repeat without a due date is dropped', async () => {
    const todo = makeTodo({ id: 1, title: 'Task' })
    const updateTodo = vi.fn()
    await applyNlpMetadata(1, { ...base, recurrence: 'weekly' }, () => todo, updateTodo, vi.fn())
    expect(updateTodo.mock.calls[0]![0].recurrenceRule).toBeUndefined()
  })

  it('a full command line goes from text to task fields', async () => {
    const todo = makeTodo({ id: 1, title: 'x', nextFollowupAt: new Date(2026, 10, 10) })
    const updateTodo = vi.fn()
    const { resolved } = parseTaskInput('Standup /due 10/30 /repeat weekly /urgent /followup none', [])
    await applyNlpMetadata(1, resolved, () => todo, updateTodo, vi.fn())
    const updated = updateTodo.mock.calls[0]![0]
    expect(resolved.title).toBe('Standup')
    expect(updated.dueDate.getMonth()).toBe(9)
    expect(updated.dueDate.getDate()).toBe(30)
    expect(updated.recurrenceRule?.type).toBe('weekly')
    expect(updated.urgent).toBe(true)
    expect(updated.nextFollowupAt).toBeUndefined()
  })
})
