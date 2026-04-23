import { describe, it, expect, vi } from 'vitest'
import { parseTaskInput, applyNlpMetadata } from '../../services/nlp-task-creator'
import type { Person, Project, PersistedTodoItem } from '../../models'

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
  function makeTodo(overrides: Partial<PersistedTodoItem> = {}): PersistedTodoItem {
    return {
      id: 1,
      title: 'Test task',
      isCompleted: false,
      createdAt: new Date(),
      modifiedAt: new Date(),
      sortOrder: 1,
      ...overrides,
    }
  }

  it('calls updateTodo with scheduledDate when present', async () => {
    const todo = makeTodo()
    const getTodo = vi.fn().mockReturnValue(todo)
    const updateTodo = vi.fn()
    const assignPerson = vi.fn()

    await applyNlpMetadata(
      1,
      {
        title: 'Test task',
        scheduledDate: { kind: 'fuzzy', token: 'tomorrow' },
        personIds: [],
        orgIds: [],
        unmatchedPersons: [],
        unmatchedOrgs: [],
        unmatchedProjects: [],
        tags: [],
      },
      getTodo,
      updateTodo,
      assignPerson,
    )

    expect(updateTodo).toHaveBeenCalledOnce()
    const updated = updateTodo.mock.calls[0][0]
    expect(updated.scheduledDate).toEqual({ kind: 'fuzzy', token: 'tomorrow' })
  })

  it('applies recurrence only when the todo has a deadline', async () => {
    const deadline = new Date('2026-03-15')
    const todo = makeTodo({ dueDate: deadline })
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
        unmatchedOrgs: [],
        unmatchedProjects: [],
        tags: [],
      },
      getTodo,
      updateTodo,
      vi.fn(),
    )

    expect(updateTodo).toHaveBeenCalledOnce()
    const updated = updateTodo.mock.calls[0][0]
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
        unmatchedOrgs: [],
        unmatchedProjects: [],
        tags: [],
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
        unmatchedOrgs: [],
        unmatchedProjects: [],
        tags: [],
      },
      vi.fn(),
      vi.fn(),
      assignPerson,
    )

    expect(assignPerson).toHaveBeenCalledTimes(2)
    expect(assignPerson).toHaveBeenCalledWith(1, 1)
    expect(assignPerson).toHaveBeenCalledWith(1, 2)
  })

  it('calls setTags with resolved.tags when present', async () => {
    const setTags = vi.fn()

    await applyNlpMetadata(
      1,
      {
        title: 'Test task',
        personIds: [],
        orgIds: [],
        unmatchedPersons: [],
        unmatchedOrgs: [],
        unmatchedProjects: [],
        tags: ['urgent', 'blocked'],
      },
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      setTags,
    )

    expect(setTags).toHaveBeenCalledOnce()
    expect(setTags).toHaveBeenCalledWith(1, ['urgent', 'blocked'])
  })

  it('skips setTags entirely when resolved.tags is empty', async () => {
    const setTags = vi.fn()

    await applyNlpMetadata(
      1,
      {
        title: 'Test task',
        personIds: [1],
        orgIds: [],
        unmatchedPersons: [],
        unmatchedOrgs: [],
        unmatchedProjects: [],
        tags: [],
      },
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      setTags,
    )

    expect(setTags).not.toHaveBeenCalled()
  })
})
