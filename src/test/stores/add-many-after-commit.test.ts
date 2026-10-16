import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { db } from '../../data/database'
import { todoRepository } from '../../data/todo-repository'
import { personRepository } from '../../data/person-repository'
import { useTodoStore } from '../../stores/todo-store'
import { useUndoStore } from '../../stores/undo-store'
import { createTasksFromDrafts } from '../../services/note-tasks'
import { draftFromText } from '../../services/task-draft'
import { resetDb } from '../helpers'

beforeEach(async () => {
  await resetDb()
})

afterEach(() => {
  vi.restoreAllMocks()
})

function item(title: string) {
  const now = new Date()
  return { todo: { title, isCompleted: false, createdAt: now, modifiedAt: now }, personIds: [], tagIds: [] }
}

/**
 * Once the insert transaction has committed, the tasks exist: whatever the
 * store does afterwards (reading the rows back, reloading the people / tag
 * caches) must not turn that into a reported failure — the create surfaces
 * stay open on a failure, and a retry would add the task twice.
 */
describe('addMany after its insert has committed', () => {
  it('a failing read-back still resolves the ids, shows the tasks and registers the undo step', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(todoRepository, 'getByIds').mockRejectedValue(new Error('read failed'))
    const ids = await useTodoStore.getState().addMany([item('One'), item('Two')], { description: 'Add 2 tasks' })
    expect(ids).toHaveLength(2)
    expect(useTodoStore.getState().todos.map((t) => t.title).sort()).toEqual(['One', 'Two'])
    expect(useUndoStore.getState().undoStack.map((e) => e.description)).toEqual(['Add 2 tasks'])
    await useUndoStore.getState().undo()
    expect(await db.todos.count()).toBe(0)
  })

  it('a failing assignment reload still resolves the ids', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(personRepository, 'getAssignedPeopleForTodos').mockRejectedValue(new Error('read failed'))
    const ids = await useTodoStore.getState().addMany([item('One')], { description: 'Add task' })
    expect(ids).toHaveLength(1)
    expect(await db.todos.count()).toBe(1)
    expect(useUndoStore.getState().undoStack).toHaveLength(1)
  })

  it('the notes convert reports success, so a retry never adds the drafts twice', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(todoRepository, 'getByIds').mockRejectedValue(new Error('read failed'))
    const ctx = { people: [], statuses: [], tags: [], today: new Date() }
    const drafts = [draftFromText('First', ctx), draftFromText('Second', ctx)]
    await expect(createTasksFromDrafts(drafts, { description: 'Convert' })).resolves.toHaveLength(2)
    expect(await db.todos.count()).toBe(2)
  })
})
