import { describe, it, expect, vi } from 'vitest'
import { parseTaskInput, applyNlpMetadata } from '../../services/nlp-task-creator'
import { Priority } from '../../models'
import type { Person, Tag, Project, PersistedTodoItem } from '../../models'

const people: Person[] = [
  { id: 1, name: 'Alice Smith', initials: 'AS', color: '#ff0000' },
  { id: 2, name: 'Bob Jones', initials: 'BJ', color: '#00ff00' },
]

const tags: Tag[] = [
  { id: 1, name: 'urgent', color: '#ff0000' },
  { id: 2, name: 'backend', color: '#0000ff' },
]

const projects: Project[] = [
  { id: 10, name: 'Backend', canvasId: 1, positionX: 0, positionY: 0, isCollapsed: false, sortOrder: 0, createdAt: new Date() },
  { id: 11, name: 'Frontend', canvasId: 1, positionX: 0, positionY: 0, isCollapsed: false, sortOrder: 1, createdAt: new Date() },
]

describe('parseTaskInput', () => {
  it('returns cleaned title with metadata tokens removed', () => {
    const result = parseTaskInput('Fix bug @Alice #urgent p1', people, tags)
    expect(result.title).toBe('Fix bug')
  })

  it('returns resolved personIds for @name tokens', () => {
    const result = parseTaskInput('Task @Alice @Bob', people, tags)
    expect(result.resolved.personIds).toEqual([1, 2])
  })

  it('returns resolved tagIds for #tag tokens', () => {
    const result = parseTaskInput('Task #urgent #backend', people, tags)
    expect(result.resolved.tagIds).toEqual([1, 2])
  })

  it('returns priority when p1/p2/p3 present', () => {
    const result = parseTaskInput('Task p1', people, tags)
    expect(result.resolved.priority).toBe(Priority.High)
  })

  it('returns empty resolved when no metadata tokens', () => {
    const result = parseTaskInput('Just a plain task', people, tags)
    expect(result.resolved.personIds).toEqual([])
    expect(result.resolved.tagIds).toEqual([])
    expect(result.resolved.priority).toBeUndefined()
    expect(result.resolved.dueDate).toBeUndefined()
  })

  it('resolves /project when projects provided', () => {
    const result = parseTaskInput('Fix bug /Backend', people, tags, projects)
    expect(result.title).toBe('Fix bug')
    expect(result.resolved.projectId).toBe(10)
  })

  it('returns undefined projectId when no projects provided', () => {
    const result = parseTaskInput('Fix bug /Backend', people, tags)
    expect(result.resolved.projectId).toBeUndefined()
  })
})

describe('applyNlpMetadata', () => {
  function makeTodo(): PersistedTodoItem {
    return {
      id: 1,
      title: 'Test task',
      priority: Priority.Normal,
      isCompleted: false,
      isStarred: false,
      createdAt: new Date(),
      modifiedAt: new Date(),
      sortOrder: 1,
    }
  }

  it('calls updateTodo with priority/dueDate/recurrenceRule when present', async () => {
    const todo = makeTodo()
    const getTodo = vi.fn().mockReturnValue(todo)
    const updateTodo = vi.fn()
    const assignPerson = vi.fn()
    const assignTag = vi.fn()

    const dueDate = new Date('2026-03-15')
    await applyNlpMetadata(
      1,
      {
        title: 'Test task',
        priority: Priority.High,
        dueDate,
        recurrence: 'weekly',
        personIds: [],
        tagIds: [],
        unmatchedPersons: [],
        unmatchedTags: [],
        unmatchedProjects: [],
      },
      getTodo,
      updateTodo,
      assignPerson,
      assignTag,
    )

    expect(updateTodo).toHaveBeenCalledOnce()
    const updated = updateTodo.mock.calls[0][0]
    expect(updated.priority).toBe(Priority.High)
    expect(updated.dueDate).toEqual(dueDate)
    expect(updated.recurrenceRule).toEqual({ type: 'weekly' })
  })

  it('skips updateTodo when no priority/dueDate/recurrence', async () => {
    const updateTodo = vi.fn()
    const assignPerson = vi.fn()
    const assignTag = vi.fn()

    await applyNlpMetadata(
      1,
      {
        title: 'Test task',
        personIds: [1],
        tagIds: [],
        unmatchedPersons: [],
        unmatchedTags: [],
        unmatchedProjects: [],
      },
      vi.fn(),
      updateTodo,
      assignPerson,
      assignTag,
    )

    expect(updateTodo).not.toHaveBeenCalled()
  })

  it('calls assignPerson for each resolved personId', async () => {
    const assignPerson = vi.fn()
    const assignTag = vi.fn()

    await applyNlpMetadata(
      1,
      {
        title: 'Test task',
        personIds: [1, 2],
        tagIds: [],
        unmatchedPersons: [],
        unmatchedTags: [],
        unmatchedProjects: [],
      },
      vi.fn(),
      vi.fn(),
      assignPerson,
      assignTag,
    )

    expect(assignPerson).toHaveBeenCalledTimes(2)
    expect(assignPerson).toHaveBeenCalledWith(1, 1)
    expect(assignPerson).toHaveBeenCalledWith(1, 2)
  })
})
